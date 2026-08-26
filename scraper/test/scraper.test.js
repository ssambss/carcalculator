// Run with: npm test  (node --test)
//
// The package cases below are all real phrasings taken from live nettiauto
// listings - sellers write the same two packages a dozen different ways, so
// this is the part of the scraper most worth pinning down.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import config from '../src/config.js';
import { decodeEntities, htmlToText, oneLine, parseInteger } from '../src/html.js';
import { evaluate } from '../src/filter.js';
import { parseDetailPage, parseSearchPage, buildSearchUrl, buildListingUrl } from '../src/nettiauto.js';
import { buildEmbed } from '../src/discord.js';
import {
  hasSeen,
  loadState,
  markAnnounced,
  needsRecheck,
  prune,
  record,
  saveState,
  summarise,
  wasAnnounced,
} from '../src/state.js';

const tempDirs = [];
async function tempFile(name) {
  const dir = await mkdtemp(join(tmpdir(), 'nettiauto-test-'));
  tempDirs.push(dir);
  return join(dir, name);
}
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

/** A listing that meets every requirement except the packages. */
function listing(overrides = {}) {
  return {
    id: '15900001',
    url: 'https://www.nettiauto.com/polestar/2/15900001',
    title: 'Polestar 2',
    subTitle: '78 kWh, Long Range Dual Motor, 300kW, 78kWh',
    specs: ['2022', '80 000 km', 'Sähkö', 'Automaatti', 'Neliveto'],
    usp: '',
    location: 'Helsinki, Testi Oy',
    seller: 'Testi Oy',
    year: 2022,
    mileage: 80000,
    price: 30000,
    driveType: 'Neliveto',
    ...overrides,
  };
}

describe('html helpers', () => {
  it('decodes the entities nettiauto emits', () => {
    assert.equal(oneLine('26 390&nbsp;&euro;'), '26 390 €');
    assert.equal(oneLine('S&auml;hk&ouml; 360&deg;'), 'Sähkö 360°');
    assert.equal(oneLine('&#9679;&thinsp;149 000 km'), '● 149 000 km');
  });

  it('leaves unknown entities alone rather than mangling them', () => {
    assert.equal(decodeEntities('&notanentity; &amp;'), '&notanentity; &');
  });

  it('keeps block boundaries as line breaks', () => {
    assert.equal(htmlToText('<p>Pilot</p><p>Plus</p>'), 'Pilot\nPlus');
  });

  it('parses Finnish thousands separators', () => {
    assert.equal(parseInteger('149 000 km'), 149000);
    assert.equal(parseInteger('26 390 €'), 26390);
    assert.equal(parseInteger(null), null);
    assert.equal(parseInteger('ei tiedossa'), null);
  });
});

describe('search url', () => {
  it('does not send filters, which would break pagination', () => {
    assert.equal(buildSearchUrl(1), 'https://www.nettiauto.com/polestar/2');
    assert.equal(buildSearchUrl(4), 'https://www.nettiauto.com/polestar/2?page=4');
    assert.equal(buildListingUrl('123'), 'https://www.nettiauto.com/polestar/2/123');
  });
});

describe('page parsing', () => {
  const card = (id, extra = '') => `
    <div class="product-card" data-pagename="advanceSearch" data-datalayer="{&quot;item_name&quot;:&quot;Polestar 2&quot;,&quot;item_id&quot;:${id},&quot;item_seller&quot;:&quot;Testi Oy&quot;,&quot;item_year_model&quot;:2022,&quot;item_vehicle_price&quot;:29990,&quot;item_mileage&quot;:88000,&quot;item_power_type&quot;:&quot;S\\u00e4hk\\u00f6&quot;,&quot;item_list_location&quot;:&quot;Hakutulos&quot;}">
      <div class="product-card__info">
        <div class="product-card__sub-title">78 kWh, Long Range Dual Motor</div>
        <div class="product-card__basic-info-list"><span>2022</span><span>&#9679;&thinsp;88 000 km</span><span>&#9679;&thinsp;S&auml;hk&ouml;</span><span>&#9679;&thinsp;Neliveto</span></div>
        <div class="product-card__usp-info">${extra}</div>
        <div class="block-row" data-testid="ad_user_details">Oulu, Testi Oy</div>
      </div>
    </div>`;

  const html = `
    <span data-testid="listing-total-ads-counter">262</span>
    <a href="/polestar/2?yearFrom=2021&amp;page=9">9</a>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":["CollectionPage","SearchResultsPage"],
      "mainEntity":{"@type":"ItemList","itemListElement":[
        {"@type":"ListItem","position":1,"item":{"@type":["Product","Car"],"url":"https://www.nettiauto.com/polestar/2/15900001",
          "color":"Musta","bodyType":"Viistoperä","vehicleIdentificationNumber":"YSMVSE0000000001",
          "image":"https://images.nettiauto.com/live/a-large.jpg","name":"Polestar 2 12,3&quot; (2022)",
          "mileageFromOdometer":{"@type":"QuantitativeValue","value":88000},"offers":{"@type":"Offer","price":29990}}}]}}</script>
    ${card('15900001', 'Pilot- ja Plus-paketit')}`;

  it('reads the reported total and the last page through escaped ampersands', () => {
    const parsed = parseSearchPage(html);
    assert.equal(parsed.total, 262);
    assert.equal(parsed.lastPage, 9);
  });

  it('merges the nested schema.org ItemList onto the card by listing id', () => {
    const [first] = parseSearchPage(html).listings;
    assert.equal(first.id, '15900001');
    assert.equal(first.color, 'Musta');
    assert.equal(first.bodyType, 'Viistoperä');
    assert.equal(first.image, 'https://images.nettiauto.com/live/a-large.jpg');
    // The ItemList carries `&quot;` inside a JSON string; decoding before
    // JSON.parse would break the whole payload.
    assert.equal(first.schemaName, 'Polestar 2 12,3" (2022)');
  });

  it('reads the card fields', () => {
    const [first] = parseSearchPage(html).listings;
    assert.equal(first.year, 2022);
    assert.equal(first.mileage, 88000);
    assert.equal(first.price, 29990);
    assert.equal(first.driveType, 'Neliveto');
    assert.equal(first.battery, '78');
    assert.equal(first.location, 'Oulu, Testi Oy');
    assert.equal(first.url, 'https://www.nettiauto.com/polestar/2/15900001');
  });

  it('ignores cross-sell cards that are not search hits', () => {
    const promo = html.replace('&quot;Hakutulos&quot;', '&quot;Suositellut&quot;');
    assert.equal(parseSearchPage(promo).listings.length, 0);
  });

  it('reads variant name and description off a listing page', () => {
    const detail = parseDetailPage(`
      <script type="application/ld+json">{"@context":"https://schema.org","@type":["Product","Car"],
        "name":"Polestar 2 Long Range Dual Motor AWD Sedan 2021",
        "offers":{"@type":"Offer","price":26739,"seller":{"@type":"Organization","name":"Autoliike",
        "address":{"@type":"PostalAddress","addressLocality":"Lahti"}}}}</script>
      <div class="grid-x cell unique-selling-point">* Pilot- ja Plus * Vetokoukku</div>
      <div id="fullNote" class="full-note-disc"><p>Pilot- ja Plus-varustepaketit</p><p>Panorama</p></div></div>`);
    assert.equal(detail.schemaName, 'Polestar 2 Long Range Dual Motor AWD Sedan 2021');
    assert.equal(detail.seller, 'Autoliike');
    assert.equal(detail.locality, 'Lahti');
    assert.equal(detail.price, 26739);
    assert.match(detail.description, /Pilot- ja Plus-varustepaketit/);
    assert.equal(detail.sold, false);
  });
});

describe('option package matching', () => {
  const accepts = [
    ['Pilot- ja Plus-varustepaketit', 'canonical Finnish compound'],
    ['Pilot- ja Plus-pkt.', 'abbreviated'],
    ['Pilot&Plus / H/K / Lasikatto', 'no spaces around the ampersand'],
    ['Plus&Pilot / HarmanKardon', 'reversed order'],
    ['Pilot / Plus / 360 kamera', 'slash separated equipment list'],
    ['Pilot ja Plus, 1-om., Panorama', 'no paketti word at all'],
    ['Pilot + Plus / 2x Vanteet', 'plus sign as separator'],
    ['Pilot sekä Plus -paketit', 'sekä instead of ja'],
    ['PILOT & PLUS / Koukku', 'shouting'],
    ['Pilot, Plus & Performance- paketit', 'three packages listed'],
    ['Plus- ja Pilot-paketit', 'reversed compound'],
    ['Autossa Pilot sekä Plus -paketit ja Pixel-LED ajovalot!', 'inside a sentence'],
  ];

  for (const [usp, note] of accepts) {
    it(`accepts ${note}: ${usp}`, () => {
      assert.equal(evaluate(listing({ usp })).matched, true);
    });
  }

  const rejects = [
    ['Pilot Lite ja Plus paketit', 'Pilot Lite is a smaller, separate package'],
    ['Pilot lite & Plus / Nappanahat', 'lite in lower case'],
    ['Plus- ja Pilot Lite-paketit', 'lite inside the compound'],
    ['Pilot Assist, ACC / Plus-varustepaketti', 'Pilot Assist ships with Pilot Lite too'],
    ['Plus paketti / Lämpöpumppu', 'Plus only'],
    ['Pilot-pkt. / ACC / 360-kamera', 'Pilot only'],
    ['Adapt.Vakkari / 360 Kamera / Blis', 'neither package'],
  ];

  for (const [usp, note] of rejects) {
    it(`rejects ${note}: ${usp}`, () => {
      assert.equal(evaluate(listing({ usp })).matched, false);
    });
  }

  it('explains a Pilot Lite rejection specifically', () => {
    const verdict = evaluate(listing({ usp: 'Pilot Lite / Plus / Vetokoukku' }));
    assert.equal(verdict.matched, false);
    assert.ok(verdict.reasons.some((reason) => /only Pilot Lite/.test(reason)));
  });

  it('warns when a listing claims both Pilot and Pilot Lite', () => {
    const verdict = evaluate(
      listing({ subTitle: '78 kWh, Long Range Dual Motor ** Pilot&Plus **', usp: 'Pilot Lite / Plus' }),
    );
    assert.equal(verdict.matched, true);
    assert.ok(verdict.warnings.some((warning) => /Pilot Lite/.test(warning)));
  });

  it('quotes the seller text it matched on, for a human to check', () => {
    const verdict = evaluate(listing({ usp: 'ACC / Pilot- ja Plus-paketit / 360' }));
    assert.equal(verdict.packages.pilot.snippet, 'Pilot- ja Plus-paketit');
  });

  it('finds packages named only on the listing page', () => {
    const bare = listing({ usp: 'Panorama / H&K' });
    assert.equal(evaluate(bare).matched, false);
    assert.equal(evaluate(bare).needsDetail, true);
    const verdict = evaluate(bare, { description: 'Pilot- ja Plus-varustepaketit\nPanorama lasikatto' });
    assert.equal(verdict.matched, true);
  });

  it('accepts a bare mention when configured to', () => {
    // No paketti/varuste word anywhere, and the two names sit far apart, so
    // there is nothing to corroborate either of them.
    const usp = 'Pilot mukana. Autossa myös hyvät kesärenkaat ja talvirenkaat, sekä Plus.';
    const strict = config.require;
    assert.equal(evaluate(listing({ usp }), null, strict).matched, false);
    assert.equal(evaluate(listing({ usp }), null, { ...strict, packageEvidence: 'weak' }).matched, true);
  });
});

describe('powertrain and limits', () => {
  const withPackages = (overrides) => listing({ usp: 'Pilot- ja Plus-paketit', ...overrides });

  it('rejects single motor cars', () => {
    const verdict = evaluate(withPackages({ subTitle: '78 kWh, Long Range Single Motor', driveType: 'Etuveto', specs: ['2022', 'Etuveto'] }));
    assert.equal(verdict.matched, false);
    assert.ok(verdict.reasons.includes('single motor'));
    // Nothing on the listing page can undo "single motor", so don't fetch it.
    assert.equal(verdict.needsDetail, false);
  });

  it('rejects standard range cars', () => {
    const verdict = evaluate(withPackages({ subTitle: '64 kWh, Standard Range Single Motor', driveType: 'Etuveto', specs: ['2022', 'Etuveto'] }));
    assert.ok(verdict.reasons.includes('standard range'));
  });

  it('infers dual motor from AWD, and long range from dual motor', () => {
    // Launch Edition names neither, but AWD implies dual motor, which on a
    // Polestar 2 only ever came as a long range car.
    const verdict = evaluate(withPackages({ subTitle: '78 kWh, Launch Edition, 300kW' }));
    assert.equal(verdict.matched, true);
    assert.equal(verdict.powertrain.dualMotor, true);
    assert.equal(verdict.powertrain.longRange, true);
    assert.ok(verdict.notes.some((note) => /inferred from AWD/.test(note)));
  });

  it('accepts Performance variants', () => {
    assert.equal(evaluate(withPackages({ subTitle: '78 kWh, Long Range Dual Motor Performance, 350kW' })).matched, true);
  });

  it('enforces the year window', () => {
    assert.equal(evaluate(withPackages({ year: 2020 })).matched, false);
    assert.equal(evaluate(withPackages({ year: 2024 })).matched, false);
    assert.equal(evaluate(withPackages({ year: 2021 })).matched, true);
    assert.equal(evaluate(withPackages({ year: 2023 })).matched, true);
  });

  it('enforces the mileage ceiling, inclusively', () => {
    assert.equal(evaluate(withPackages({ mileage: 120000 })).matched, true);
    assert.equal(evaluate(withPackages({ mileage: 120001 })).matched, false);
  });

  it('does not spend a detail fetch on a car ruled out by year or mileage', () => {
    assert.equal(evaluate(listing({ year: 2019, usp: '' })).needsDetail, false);
    assert.equal(evaluate(listing({ mileage: 200000, usp: '' })).needsDetail, false);
  });

  it('rejects a listing whose year or mileage is unknown', () => {
    assert.equal(evaluate(withPackages({ year: null })).matched, false);
    assert.equal(evaluate(withPackages({ mileage: null })).matched, false);
  });
});

describe('state', () => {
  it('starts empty and flags itself as new', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    assert.equal(store.isNew, true);
    assert.equal(Object.keys(store.listings).length, 0);
  });

  it('round-trips through the file without the isNew marker', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    record(store, listing(), { matched: true, reasons: [] });
    markAnnounced(store, '15900001');
    await saveState(store, path);

    const reloaded = await loadState(path);
    assert.equal(reloaded.isNew, false);
    assert.equal(hasSeen(reloaded, '15900001'), true);
    assert.equal(wasAnnounced(reloaded, '15900001'), true);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).isNew, undefined);
  });

  it('never moves firstSeenAt or announcedAt once set', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    record(store, listing(), { matched: true, reasons: [] }, { now: new Date('2026-01-01T00:00:00Z') });
    markAnnounced(store, '15900001', new Date('2026-01-01T00:00:00Z'));
    record(store, listing({ price: 28000 }), { matched: true, reasons: [] }, { now: new Date('2026-02-01T00:00:00Z') });

    const entry = store.listings['15900001'];
    assert.equal(entry.firstSeenAt, '2026-01-01T00:00:00.000Z');
    assert.equal(entry.announcedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(entry.lastSeenAt, '2026-02-01T00:00:00.000Z');
    assert.equal(entry.price, 28000);
  });

  it('refuses to load a state file it does not understand', async () => {
    const path = await tempFile('seen.json');
    await writeFile(path, '{"version":99,"listings":{}}', 'utf8');
    await assert.rejects(() => loadState(path), /version 99/);
    await writeFile(path, 'not json', 'utf8');
    await assert.rejects(() => loadState(path), /not valid JSON/);
  });

  it('re-checks a rejected listing only when something changed or it went stale', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    const rejected = { matched: false, reasons: ['no plus package found'] };
    record(store, listing(), rejected, { detailChecked: true });

    assert.equal(needsRecheck(store, listing()), false);
    assert.equal(needsRecheck(store, listing({ price: 27000 })), true, 'price moved');
    assert.equal(needsRecheck(store, listing({ mileage: 90000 })), true, 'mileage moved');

    store.listings['15900001'].detailCheckedAt = new Date(Date.now() - 30 * 864e5).toISOString();
    assert.equal(needsRecheck(store, listing()), true, 'cached verdict is stale');
  });

  it('never re-checks a listing already recorded as a match', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    record(store, listing(), { matched: true, reasons: [] }, { detailChecked: true });
    assert.equal(needsRecheck(store, listing({ price: 1 })), false);
  });

  it('forgets listings not seen for a long time', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    record(store, listing(), { matched: true, reasons: [] });
    record(store, listing({ id: 'old' }), { matched: true, reasons: [] }, { now: new Date(Date.now() - 200 * 864e5) });

    assert.equal(prune(store, { forgetAfterDays: 90 }), 1);
    assert.equal(hasSeen(store, 'old'), false);
    assert.equal(hasSeen(store, '15900001'), true);
    assert.deepEqual(summarise(store), { tracked: 1, matches: 1, announced: 0 });
  });
});

describe('discord embed', () => {
  it('links the listing and shows the matched package text', () => {
    const item = listing({ usp: 'Pilot- ja Plus-paketit / 360', image: 'https://img/x.jpg', color: 'Musta' });
    const embed = buildEmbed(item, evaluate(item));
    assert.equal(embed.url, item.url);
    assert.match(embed.title, /^2022 78 kWh, Long Range Dual Motor/);
    assert.equal(embed.image.url, 'https://img/x.jpg');
    // Intl formats thousands with a non-breaking space, so compare against a
    // whitespace-normalised copy.
    const fieldText = embed.fields
      .map((field) => `${field.name}: ${field.value}`)
      .join('\n')
      .replace(/\s/g, ' ');
    assert.match(fieldText, /30 000/);
    assert.match(fieldText, /80 000 km/);
    assert.match(fieldText, /Pilot- ja Plus-paketit/);
    assert.match(embed.footer.text, /15900001/);
  });

  it('stays inside Discord field limits on absurdly long seller text', () => {
    const item = listing({ usp: `Pilot- ja Plus-paketit ${'x'.repeat(4000)}` });
    const embed = buildEmbed(item, evaluate(item));
    assert.ok(embed.title.length <= 256);
    for (const field of embed.fields) assert.ok(field.value.length <= 1024, `${field.name} too long`);
  });

  it('renders a missing price and mileage without crashing', () => {
    const item = listing({ price: null, mileage: null, usp: 'Pilot- ja Plus-paketit' });
    const embed = buildEmbed(item, evaluate(item));
    const fieldText = embed.fields.map((field) => field.value).join(' ').replace(/\s/g, ' ');
    assert.match(fieldText, /hinta \?/);
    assert.match(fieldText, /\? km/);
  });
});

describe('verdict reuse', () => {
  // Mirrors the reuse decision in index.js: a cached verdict may stand in for
  // a detail fetch, but only when nothing has moved and, for a match, only
  // once it has actually been announced.
  function canReuse(store, item, cardVerdict) {
    const cached = store.listings[item.id];
    return Boolean(
      cardVerdict.needsDetail &&
        cached &&
        !needsRecheck(store, item) &&
        (cached.status !== 'match' || wasAnnounced(store, item.id)),
    );
  }

  it('reuses a rejection instead of re-reading the listing page', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    const item = listing({ usp: 'Panorama / H&K' });
    const cardVerdict = evaluate(item);
    assert.equal(cardVerdict.needsDetail, true);

    record(store, item, { matched: false, reasons: ['no pilot package found'] }, { detailChecked: true });
    assert.equal(canReuse(store, item, cardVerdict), true);
  });

  it('keeps an announced match matched without re-reading it', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    // Matched last run only because the listing page named the packages.
    const item = listing({ usp: 'Panorama / H&K' });
    record(store, item, { matched: true, reasons: [] }, { detailChecked: true });
    markAnnounced(store, item.id);

    assert.equal(canReuse(store, item, evaluate(item)), true);
    // Regression: reusing must not silently downgrade it to a rejection.
    assert.equal(store.listings[item.id].status, 'match');
  });

  it('re-reads a match that was never announced, so the post has its evidence', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    const item = listing({ usp: 'Panorama / H&K' });
    record(store, item, { matched: true, reasons: [] }, { detailChecked: true });
    assert.equal(canReuse(store, item, evaluate(item)), false);
  });

  it('re-reads when the advertised price moved', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    const item = listing({ usp: 'Panorama / H&K' });
    record(store, item, { matched: false, reasons: ['no plus package found'] }, { detailChecked: true });
    assert.equal(canReuse(store, listing({ usp: 'Panorama / H&K', price: 28500 }), evaluate(item)), false);
  });
});
