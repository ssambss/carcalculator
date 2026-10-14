// Clearing away cards whose advert has come down: reading an advert's status
// off its page, deciding which cards go, and deleting them so they stay gone.

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { findGoneCards } from '../src/cleanup.js';
import {
  advertUrlOf,
  keptMessage,
  linkedCards,
  removeCarsFromTco,
  removedMessage,
} from '../src/sinks/car-tco.js';
import { parseDetailPage } from '../src/sources/nettiauto.js';
import { keyOf, needsTcoAdd, recordTcoAdd, recordTcoRemoved } from '../src/state.js';

const K = (id) => keyOf('nettiauto', id);
const url = (id) => `https://www.nettiauto.com/polestar/2/${id}`;
const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-10-14T12:00:00Z');
const later = (hours) => new Date(T0.getTime() + hours * HOUR);

// The parts of a real advert page that decide it, as nettiauto served them on
// 2026-10-14 for one advert on sale and one taken down seven weeks earlier.
const advert = (availability) =>
  `<script type="application/ld+json">{"@context":"https://schema.org","@type":["Product","Car"],
    "name":"Polestar 2 Long Range Dual Motor","offers":{"@type":"Offer","priceCurrency":"EUR",
    "availability":"https://schema.org/${availability}","price":30300}}</script>`;
const ON_SALE = advert('InStock');
const REMOVED = `${advert('OutOfStock')}
  <div class="details-page-header__item-price_sold">
      Poistettu myynnistä
  </div>`;
// A purged advert's link lands on the model's search instead.
const SEARCH = `<script type="application/ld+json">{"@context":"https://schema.org",
  "@type":["CollectionPage","SearchResultsPage"],"name":"Polestar 2 vaihtoautot"}</script>`;

describe("reading an advert's status off its page", () => {
  it('reads an advert on sale as on sale', () => {
    const detail = parseDetailPage(ON_SALE);
    assert.equal(detail.availability, 'on-sale');
    assert.equal(detail.sold, false);
  });

  it('reads a taken-down advert as removed, and as sold', () => {
    const detail = parseDetailPage(REMOVED);
    assert.equal(detail.availability, 'removed');
    assert.equal(detail.sold, true);
  });

  it('believes either sign on its own', () => {
    assert.equal(parseDetailPage(advert('OutOfStock')).availability, 'removed');
    assert.equal(parseDetailPage(advert('SoldOut')).availability, 'removed');
    assert.equal(
      parseDetailPage(`${ON_SALE}<div class="details-page-header__item-price_sold">x</div>`)
        .availability,
      'removed',
    );
  });

  it('reads a link that now opens the search as a missing advert', () => {
    assert.equal(parseDetailPage(SEARCH).availability, 'missing');
  });

  it('says nothing about a page it cannot read', () => {
    assert.equal(parseDetailPage('<html><body>Huoltokatko</body></html>').availability, null);
  });
});

describe('which advert a card links to', () => {
  it('is the first address in its notes, as for the app', () => {
    assert.equal(
      advertUrlOf(`${url(1)}\n78 kWh · Musta\nLisätty Discord-reaktiosta.`),
      url(1),
    );
    assert.equal(advertUrlOf(`Katso (${url(2)}).`), url(2));
    assert.equal(advertUrlOf('Soitettu myyjälle'), null);
    assert.equal(advertUrlOf(undefined), null);
  });
});

/** A source whose adverts answer from a table, counting how often each is opened. */
function fakeSource(statuses) {
  const opened = [];
  return {
    opened,
    source: {
      id: 'nettiauto',
      label: 'Nettiauto',
      async checkListing(link) {
        opened.push(link);
        const reply = statuses[link] ?? 'on-sale';
        if (reply instanceof Error) throw reply;
        return { status: reply, why: reply === 'gone' ? 'marked removed' : null };
      },
    },
  };
}

const card = (id, overrides = {}) => ({
  id: `nettiauto-${id}`,
  name: `Polestar 2 #${id}`,
  url: url(id),
  favorite: false,
  price: 30000,
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

/** What the crawl saw: by default one advert on sale, for the checker's own check. */
const crawled = (...ids) =>
  new Map(
    (ids.length ? ids : ['500']).map((id) => [
      K(id),
      { id, sourceId: 'nettiauto', url: url(id) },
    ]),
  );

async function sweep(cards, { store, statuses = {}, listed = crawled(), now = T0, ...rest } = {}) {
  const fake = fakeSource(statuses);
  const result = await findGoneCards(cards, {
    store,
    listed,
    sources: [fake.source],
    recheckHours: 6,
    now,
    ...rest,
  });
  return { ...result, opened: fake.opened, removedIds: result.remove.map((r) => r.card.id) };
}

describe('deciding which cards go', () => {
  it('trusts the crawl for a card it just saw, opening nothing', async () => {
    const store = { tco: {} };
    const run = await sweep([card(1)], { store, listed: crawled('1') });
    assert.deepEqual(run.opened, []);
    assert.deepEqual(run.removedIds, []);
    // Nothing on record, and nothing made for a card that is simply fine.
    assert.deepEqual(store.tco, {});
  });

  it('deletes only on the second check in a row to find it gone', async () => {
    const store = { tco: {} };
    const statuses = { [url(1)]: 'gone' };

    const first = await sweep([card(1)], { store, statuses });
    assert.deepEqual(first.removedIds, []);
    assert.ok(store.tco[K(1)].goneSince);

    const second = await sweep([card(1)], { store, statuses, now: later(6) });
    assert.deepEqual(second.removedIds, ['nettiauto-1']);
  });

  it('does not reopen an advert before the recheck is due', async () => {
    const store = { tco: {} };
    const statuses = { [url(1)]: 'gone' };
    await sweep([card(1)], { store, statuses });
    const soon = await sweep([card(1)], { store, statuses, now: later(1) });
    assert.ok(!soon.opened.includes(url(1)));
    assert.deepEqual(soon.removedIds, []);
  });

  it('checks a car that drops out of the crawl that same run', async () => {
    // Seen by the crawl every run until now, and never opened: no clock to wait for.
    const store = { tco: {} };
    await sweep([card(1)], { store, listed: crawled('1', '500') });
    const dropped = await sweep([card(1)], { store, now: later(0.5) });
    assert.deepEqual(dropped.opened.slice(0, 1), [url(1)]);
  });

  it('starts over when the advert is back up in between', async () => {
    const store = { tco: {} };
    await sweep([card(1)], { store, statuses: { [url(1)]: 'gone' } });
    await sweep([card(1)], { store, now: later(6) });
    assert.equal(store.tco[K(1)].goneSince, undefined);
    const third = await sweep([card(1)], { store, statuses: { [url(1)]: 'gone' }, now: later(12) });
    assert.deepEqual(third.removedIds, []);
  });

  it('believes no "gone" when a live advert does not read as on sale either', async () => {
    // The site changed under the parser: every advert reads as removed, the
    // one the crawl just saw included. Two runs of that must not empty the
    // calculator.
    const store = { tco: {} };
    const statuses = { [url(1)]: 'gone', [url(500)]: 'gone' };
    await sweep([card(1)], { store, statuses });
    const second = await sweep([card(1)], { store, statuses, now: later(6) });
    assert.deepEqual(second.removedIds, []);
    assert.equal(store.tco[K(1)].goneSince, undefined);
  });

  it('believes no "gone" from a site the crawl found nothing on this run', async () => {
    const store = { tco: {} };
    const statuses = { [url(1)]: 'gone' };
    await sweep([card(1)], { store, statuses, listed: new Map() });
    const second = await sweep([card(1)], { store, statuses, listed: new Map(), now: later(6) });
    assert.deepEqual(second.removedIds, []);
  });

  it('opens nothing extra on a run with no "gone" in it', async () => {
    const store = { tco: {} };
    const run = await sweep([card(1)], { store });
    assert.deepEqual(run.opened, [url(1)]);
  });

  it('keeps a card it could not read, and does not reopen it every run', async () => {
    const store = { tco: {} };
    const statuses = { [url(1)]: new Error('HTTP 503 for listing 1') };
    const first = await sweep([card(1)], { store, statuses });
    assert.deepEqual(first.removedIds, []);
    const next = await sweep([card(1)], { store, statuses, now: later(1) });
    assert.deepEqual(next.opened, []);
  });

  it('keeps a starred card, says so once, then leaves it be', async () => {
    const store = { tco: {} };
    const statuses = { [url(1)]: 'gone' };
    const starred = card(1, { favorite: true });
    await sweep([starred], { store, statuses });
    const second = await sweep([starred], { store, statuses, now: later(6) });
    assert.deepEqual(second.removedIds, []);
    assert.deepEqual(
      second.kept.map((k) => k.card.id),
      ['nettiauto-1'],
    );

    store.tco[K(1)].keptAt = later(6).toISOString(); // the notice went out
    const third = await sweep([starred], { store, statuses, now: later(12) });
    assert.deepEqual(third.opened, []);
    assert.deepEqual(third.kept, []);
  });

  it('deletes a starred card once it is unstarred', async () => {
    const store = { tco: {} };
    const statuses = { [url(1)]: 'gone' };
    await sweep([card(1, { favorite: true })], { store, statuses });
    await sweep([card(1, { favorite: true })], { store, statuses, now: later(6) });
    store.tco[K(1)].keptAt = later(6).toISOString();
    const unstarred = await sweep([card(1)], { store, statuses, now: later(12) });
    assert.deepEqual(unstarred.removedIds, ['nettiauto-1']);
  });

  it('deletes starred cards too when told to', async () => {
    const store = { tco: {} };
    const statuses = { [url(1)]: 'gone' };
    const starred = card(1, { favorite: true });
    await sweep([starred], { store, statuses, keepFavorites: false });
    const second = await sweep([starred], { store, statuses, keepFavorites: false, now: later(6) });
    assert.deepEqual(second.removedIds, ['nettiauto-1']);
  });

  it('leaves alone a card it deleted once and somebody brought back', async () => {
    const store = { tco: {} };
    recordTcoRemoved(store, K(1), T0);
    const run = await sweep([card(1)], { store, statuses: { [url(1)]: 'gone' }, now: later(24) });
    assert.deepEqual(run.opened, []);
    assert.deepEqual(run.removedIds, []);
  });

  it('opens a shared advert once and deletes every card on it', async () => {
    const store = { tco: {} };
    const statuses = { [url(1)]: 'gone' };
    const twins = [card(1), card(1, { id: 'hand-made' })];
    const first = await sweep(twins, { store, statuses });
    assert.equal(first.opened.filter((link) => link === url(1)).length, 1);
    const second = await sweep(twins, { store, statuses, now: later(6) });
    assert.deepEqual(second.removedIds.sort(), ['hand-made', 'nettiauto-1']);
  });

  it('leaves alone cards linking to a site it cannot check', async () => {
    const store = { tco: {} };
    const run = await sweep([card(1, { url: 'https://www.autotalli.com/x/123' })], { store });
    assert.deepEqual(run.opened, []);
    assert.deepEqual(store.tco, {});
  });
});

describe('a deleted card stays deleted', () => {
  it('is never re-added from the reaction still on its post', () => {
    const store = { tco: {} };
    recordTcoAdd(store, K(1));
    assert.equal(needsTcoAdd(store, K(1)), true);
    recordTcoRemoved(store, K(1));
    assert.equal(needsTcoAdd(store, K(1)), false);
  });
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A gist holding one calculator, recording what gets written back. */
function stubGist(data, { savedAt = '2026-10-01T00:00:00.000Z' } = {}) {
  const writes = [];
  const content = JSON.stringify({ app: 'carcalculator', savedAt, data });
  globalThis.fetch = async (target, init = {}) => {
    const path = String(target);
    if (init.method === 'PATCH') {
      writes.push(JSON.parse(JSON.parse(init.body).files['car-tco-data.json'].content));
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (path.includes('/gists?')) {
      return { ok: true, status: 200, json: async () => [{ id: 'g1', files: { 'car-tco-data.json': {} } }] };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'g1', files: { 'car-tco-data.json': { content } } }),
    };
  };
  return writes;
}

const stored = (id, overrides = {}) => ({
  id,
  name: `Car ${id}`,
  notes: `${url(id)}\nLisätty Discord-reaktiosta.`,
  favorite: false,
  purchasePrice: 30000,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

describe('deleting cards from the calculator', () => {
  it('lists the cards that link to an advert', async () => {
    stubGist({ cars: [stored('1'), stored('2', { notes: 'Ei linkkiä' })], tombstones: {} });
    const cards = await linkedCards({ token: 't' });
    assert.deepEqual(
      cards.map((c) => [c.id, c.url]),
      [['1', url('1')]],
    );
  });

  it('removes the card and leaves a tombstone newer than it, so phones drop it too', async () => {
    const writes = stubGist({
      cars: [stored('1'), stored('2')],
      tombstones: { old: '2026-09-15T00:00:00.000Z' },
    });
    const cards = await linkedCards({ token: 't' });
    const { removed } = await removeCarsFromTco([cards[0]], { token: 't', now: T0 });

    assert.deepEqual(removed, ['1']);
    assert.equal(writes.length, 1);
    const [written] = writes;
    assert.deepEqual(
      written.data.cars.map((c) => c.id),
      ['2'],
    );
    assert.deepEqual(Object.keys(written.data.tombstones), ['1', 'old']);
    // The app keeps a card edited after its tombstone, so the stamp must be later.
    assert.ok(written.data.tombstones['1'] > stored('1').updatedAt);
    // And newer than every device's last edit, so each one pulls it in.
    assert.equal(written.savedAt, T0.toISOString());
  });

  it('leaves a card edited since it was checked', async () => {
    const writes = stubGist({ cars: [stored('1', { updatedAt: '2026-10-14T11:59:00.000Z' })] });
    const { removed } = await removeCarsFromTco([{ id: '1', updatedAt: stored('1').updatedAt }], {
      token: 't',
      now: T0,
    });
    assert.deepEqual(removed, []);
    assert.equal(writes.length, 0);
  });
});

describe('saying so in the channel', () => {
  const gone = { name: 'Polestar 2 Long Range 2022 · 67 tkm', price: 27790, url: url(1) };

  it('names the card, its price and its advert', () => {
    const text = removedMessage([gone]);
    assert.match(text, /Poistettu laskurista/);
    assert.match(text, /Polestar 2 Long Range 2022 · 67 tkm/);
    assert.match(text, /27\s790\s€/);
    assert.ok(text.includes(`<${url(1)}>`));
  });

  it('lists several in one message, within Discord limits', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...gone, url: url(1000 + i) }));
    const text = removedMessage(many);
    assert.match(text, /Poistettu laskurista 60 autoa/);
    assert.ok(text.length <= 1900);
  });

  it('tells a starred card apart from a deleted one', () => {
    const text = keptMessage([gone]);
    assert.match(text, /jäi laskuriin/);
    assert.doesNotMatch(text, /Poistettu laskurista/);
  });
});
