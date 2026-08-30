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

import { decodeEntities, htmlToText, oneLine, parseInteger } from '../src/html.js';
import { applyImplications, containsPhrase, evaluate, tokenize } from '../src/filter.js';
import {
  describeFilter,
  groupBySearch,
  loadFilters,
  normalizeFilter,
  normalizeFilters,
} from '../src/filters.js';
import { parseDetailPage, parseSearchPage, buildSearchUrl, buildListingUrl } from '../src/nettiauto.js';
import { accentColour, buildEmbed } from '../src/discord.js';
import {
  hasSeen,
  isNewFilter,
  loadState,
  markAnnounced,
  needsRecheck,
  prune,
  record,
  recordFilterRun,
  saveState,
  summarise,
  verdictFor,
  wasAnnounced,
} from '../src/state.js';

// The committed default filter is the Polestar spec this watcher was built
// for, so checking the matcher against it checks that file too.
const { filters: FILE_FILTERS } = await loadFilters({ source: 'file', log: () => {} });
const [POLESTAR] = FILE_FILTERS;
const SEARCH = { make: 'polestar', model: '2' };

/** A filter with nothing required: matches anything the crawl returns. */
const ANY = normalizeFilter({ id: 'any', name: 'Anything', make: 'polestar', model: '2' });

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
    assert.equal(buildSearchUrl(SEARCH, 1), 'https://www.nettiauto.com/polestar/2');
    assert.equal(buildSearchUrl(SEARCH, 4), 'https://www.nettiauto.com/polestar/2?page=4');
    assert.equal(buildListingUrl(SEARCH, '123'), 'https://www.nettiauto.com/polestar/2/123');
  });

  it('points at whatever make and model the filter names', () => {
    const search = { make: 'toyota', model: 'corolla' };
    assert.equal(buildSearchUrl(search, 2), 'https://www.nettiauto.com/toyota/corolla?page=2');
    assert.equal(buildListingUrl(search, '9'), 'https://www.nettiauto.com/toyota/corolla/9');
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
    const parsed = parseSearchPage(html, SEARCH);
    assert.equal(parsed.total, 262);
    assert.equal(parsed.lastPage, 9);
  });

  it('merges the nested schema.org ItemList onto the card by listing id', () => {
    const [first] = parseSearchPage(html, SEARCH).listings;
    assert.equal(first.id, '15900001');
    assert.equal(first.color, 'Musta');
    assert.equal(first.bodyType, 'Viistoperä');
    assert.equal(first.image, 'https://images.nettiauto.com/live/a-large.jpg');
    // The ItemList carries `&quot;` inside a JSON string; decoding before
    // JSON.parse would break the whole payload.
    assert.equal(first.schemaName, 'Polestar 2 12,3" (2022)');
  });

  it('reads the card fields', () => {
    const [first] = parseSearchPage(html, SEARCH).listings;
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
    assert.equal(parseSearchPage(promo, SEARCH).listings.length, 0);
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
      assert.equal(evaluate(listing({ usp }), null, POLESTAR).matched, true);
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
      assert.equal(evaluate(listing({ usp }), null, POLESTAR).matched, false);
    });
  }

  it('explains a Pilot Lite rejection specifically', () => {
    const verdict = evaluate(listing({ usp: 'Pilot Lite / Plus / Vetokoukku' }), null, POLESTAR);
    assert.equal(verdict.matched, false);
    assert.ok(verdict.reasons.some((reason) => /only pilot lite/i.test(reason)));
  });

  it('warns when a listing claims both Pilot and Pilot Lite', () => {
    const verdict = evaluate(
      listing({ subTitle: '78 kWh, Long Range Dual Motor ** Pilot&Plus **', usp: 'Pilot Lite / Plus' }),
      null,
      POLESTAR,
    );
    assert.equal(verdict.matched, true);
    assert.ok(verdict.warnings.some((warning) => /pilot lite/i.test(warning)));
  });

  it('quotes the seller text it matched on, for a human to check', () => {
    const verdict = evaluate(listing({ usp: 'ACC / Pilot- ja Plus-paketit / 360' }), null, POLESTAR);
    assert.equal(verdict.packages.pilot.snippet, 'Pilot- ja Plus-paketit');
  });

  it('finds packages named only on the listing page', () => {
    const bare = listing({ usp: 'Panorama / H&K' });
    assert.equal(evaluate(bare, null, POLESTAR).matched, false);
    assert.equal(evaluate(bare, null, POLESTAR).needsDetail, true);
    const verdict = evaluate(
      bare,
      { description: 'Pilot- ja Plus-varustepaketit\nPanorama lasikatto' },
      POLESTAR,
    );
    assert.equal(verdict.matched, true);
  });

  it('accepts a bare mention when configured to', () => {
    // No paketti/varuste word anywhere, and the two names sit far apart, so
    // there is nothing to corroborate either of them.
    const usp = 'Pilot mukana. Autossa myös hyvät kesärenkaat ja talvirenkaat, sekä Plus.';
    assert.equal(evaluate(listing({ usp }), null, POLESTAR).matched, false);
    assert.equal(
      evaluate(listing({ usp }), null, { ...POLESTAR, packageEvidence: 'weak' }).matched,
      true,
    );
  });
});

describe('packages whose name is more than one word', () => {
  // Regression: the matcher used to compare a whole package name against a
  // single token, so "m sport" - and every other two-word or hyphenated pack -
  // silently matched nothing at all, on every listing.
  const bmw = (usp, extra = {}) => ({
    id: '15900002',
    url: 'https://www.nettiauto.com/bmw/320/15900002',
    title: 'BMW 320',
    subTitle: '2,0, G20 Sedan 320i A xDrive Business',
    specs: ['2021', '89 000 km', 'Bensiini', 'Automaatti', 'Neliveto'],
    usp,
    year: 2021,
    mileage: 89000,
    price: 29580,
    driveType: 'Neliveto',
    ...extra,
  });
  const wants = (packages, patch = {}) =>
    normalizeFilter({ id: 'bmw', make: 'bmw', model: '320', packages, ...patch });

  it('finds a two-word package however it is punctuated', () => {
    for (const usp of ['M-Sport-paketti', 'M Sport -paketti', 'M-Sport pkt.', 'M Sport paketti']) {
      const verdict = evaluate(bmw(usp), null, wants(['m sport']));
      assert.equal(verdict.matched, true, usp);
      assert.equal(verdict.packages['m sport'].strength, 'strong', usp);
    }
  });

  it('reads a hyphenated requirement as the same package', () => {
    const verdict = evaluate(bmw('M-Sport-varustepaketti'), null, wants(['m-sport']));
    assert.equal(verdict.matched, true);
    assert.equal(verdict.packages['m-sport'].snippet, 'M-Sport-varustepaketti');
  });

  it('still wants evidence: a bare trim mention is weak, not a package', () => {
    // How BMW dealers actually write it - a suffix on the variant name, with no
    // paketti/pack word anywhere near it.
    const trim = bmw('', { subTitle: '2,0, G20 Sedan 320i A xDrive Business M Sport' });
    assert.equal(evaluate(trim, null, wants(['m sport'])).matched, false);
    assert.equal(
      evaluate(trim, null, wants(['m sport'], { packageEvidence: 'weak' })).matched,
      true,
    );
    // Which is why a trim name belongs in variantMust, where it is exactly the
    // kind of claim that field is for.
    assert.equal(
      evaluate(trim, null, wants([], { variantMust: ['m sport'] })).matched,
      true,
    );
  });

  it('pairs two multi-word packages to corroborate each other', () => {
    const verdict = evaluate(
      bmw('M Sport ja Tech Pack mukana'),
      null,
      wants(['m sport', 'tech pack']),
    );
    assert.equal(verdict.matched, true);
    assert.equal(verdict.packages['m sport'].pairedWith, 'tech pack');
  });

  it('ignores a package name that is only punctuation', () => {
    const verdict = evaluate(bmw('M-Sport-paketti'), null, wants(['-']));
    assert.equal(verdict.matched, false);
  });
});

describe('powertrain and limits', () => {
  const withPackages = (overrides) => listing({ usp: 'Pilot- ja Plus-paketit', ...overrides });

  it('rejects single motor cars', () => {
    const verdict = evaluate(withPackages({ subTitle: '78 kWh, Long Range Single Motor', driveType: 'Etuveto', specs: ['2022', 'Etuveto'] }), null, POLESTAR);
    assert.equal(verdict.matched, false);
    assert.ok(verdict.reasons.includes('single motor'));
    // Nothing on the listing page can undo "single motor", so don't fetch it.
    assert.equal(verdict.needsDetail, false);
  });

  it('rejects standard range cars', () => {
    const verdict = evaluate(withPackages({ subTitle: '64 kWh, Standard Range Single Motor', driveType: 'Etuveto', specs: ['2022', 'Etuveto'] }), null, POLESTAR);
    assert.ok(verdict.reasons.includes('standard range'));
  });

  it('infers dual motor from AWD, and long range from dual motor', () => {
    // Launch Edition names neither, but AWD implies dual motor, which on a
    // Polestar 2 only ever came as a long range car.
    const verdict = evaluate(withPackages({ subTitle: '78 kWh, Launch Edition, 300kW' }), null, POLESTAR);
    assert.equal(verdict.matched, true);
    assert.deepEqual([...verdict.inferred].sort(), ['dual motor', 'long range']);
    assert.ok(verdict.notes.some((note) => /dual motor inferred from neliveto/.test(note)));
    assert.ok(verdict.notes.some((note) => /long range inferred from dual motor/.test(note)));
  });

  it('accepts Performance variants', () => {
    assert.equal(evaluate(withPackages({ subTitle: '78 kWh, Long Range Dual Motor Performance, 350kW' }), null, POLESTAR).matched, true);
  });

  it('enforces the year window', () => {
    assert.equal(evaluate(withPackages({ year: 2020 }), null, POLESTAR).matched, false);
    assert.equal(evaluate(withPackages({ year: 2024 }), null, POLESTAR).matched, false);
    assert.equal(evaluate(withPackages({ year: 2021 }), null, POLESTAR).matched, true);
    assert.equal(evaluate(withPackages({ year: 2023 }), null, POLESTAR).matched, true);
  });

  it('enforces the mileage ceiling, inclusively', () => {
    assert.equal(evaluate(withPackages({ mileage: 120000 }), null, POLESTAR).matched, true);
    assert.equal(evaluate(withPackages({ mileage: 120001 }), null, POLESTAR).matched, false);
  });

  it('does not spend a detail fetch on a car ruled out by year or mileage', () => {
    assert.equal(evaluate(listing({ year: 2019, usp: '' }), null, POLESTAR).needsDetail, false);
    assert.equal(evaluate(listing({ mileage: 200000, usp: '' }), null, POLESTAR).needsDetail, false);
  });

  it('rejects a listing whose year or mileage is unknown', () => {
    assert.equal(evaluate(withPackages({ year: null }), null, POLESTAR).matched, false);
    assert.equal(evaluate(withPackages({ mileage: null }), null, POLESTAR).matched, false);
  });
});

describe('filter definitions', () => {
  it('fills in every field a source left out', () => {
    const filter = normalizeFilter({ make: 'Tesla', model: 'Model 3' });
    assert.equal(filter.make, 'tesla');
    assert.equal(filter.model, 'model-3');
    assert.equal(filter.name, 'tesla model-3');
    assert.equal(filter.enabled, true);
    assert.equal(filter.postExisting, true);
    assert.equal(filter.packageEvidence, 'strong');
    assert.deepEqual(filter.variantMust, []);
    assert.equal(filter.yearFrom, null);
    assert.equal(filter.maxPrice, null);
  });

  it('is idempotent, so it can guard every entry point', () => {
    const once = normalizeFilter(POLESTAR);
    assert.deepEqual(normalizeFilter(once), once);
  });

  it('cleans up hand-typed values instead of trusting them', () => {
    const filter = normalizeFilter({
      make: '/polestar/',
      model: 2,
      yearFrom: '2021',
      maxMileage: '120 000',
      variantMust: ['  Long Range  ', 'LONG RANGE', '', 7],
      implications: [
        { if: 'Neliveto', then: 'Dual Motor' },
        { if: 'x', then: 'x' },
        { then: 'no if' },
      ],
    });
    assert.equal(filter.make, 'polestar');
    assert.equal(filter.model, '');
    assert.equal(filter.yearFrom, 2021);
    assert.equal(filter.maxMileage, 120000);
    assert.deepEqual(filter.variantMust, ['long range']);
    assert.deepEqual(filter.implications, [{ if: 'neliveto', then: 'dual motor' }]);
  });

  it('drops filters that name no listing page to read', () => {
    const filters = normalizeFilters([
      { make: 'polestar', model: '2' },
      { make: 'polestar' },
      null,
      'nonsense',
    ]);
    assert.equal(filters.length, 1);
  });

  it('reads the committed default filter', () => {
    assert.equal(POLESTAR.id, 'polestar2-lr-dm');
    assert.equal(POLESTAR.make, 'polestar');
    assert.deepEqual(POLESTAR.packages, ['pilot', 'plus']);
    // Intl groups thousands with a non-breaking space; compare normalised.
    const described = describeFilter(POLESTAR).replace(/\s/g, ' ');
    assert.match(described, /polestar\/2, 2021-2023, max 120 000 km/);
    assert.match(described, /long range \+ dual motor/);
    assert.match(described, /pilot \+ plus packages/);
    assert.match(described, /not standard range, single motor/);
  });

  it('accepts a filter exactly as the app writes one', () => {
    // Verbatim from localStorage after building this in the calculator's
    // filter editor (src/scraperFilters.ts in the repo root). The app fields
    // the scraper has no use for - createdAt, updatedAt - must be ignored, not
    // tripped over.
    const fromApp = {
      id: '289f8da2-9177-40db-a56c-c0f18cf2f786',
      name: 'Corolla estate, cheap',
      enabled: true,
      make: 'toyota',
      model: 'corolla',
      yearFrom: 2019,
      yearTo: null,
      maxMileage: 150000,
      minPrice: null,
      maxPrice: 18000,
      variantMust: [],
      variantMustNot: [],
      textMust: ['touring sports', 'vetokoukku'],
      textMustNot: [],
      packages: [],
      packageEvidence: 'strong',
      acceptLesserPackages: false,
      implications: [],
      postExisting: true,
      createdAt: '2026-08-26T18:59:57.042Z',
      updatedAt: '2026-08-26T18:59:57.188Z',
    };

    const filter = normalizeFilter(fromApp);
    assert.equal(filter.id, fromApp.id);
    assert.equal(filter.make, 'toyota');
    assert.equal(filter.maxPrice, 18000);
    assert.deepEqual(filter.textMust, ['touring sports', 'vetokoukku']);
    assert.equal(buildSearchUrl(filter, 1), 'https://www.nettiauto.com/toyota/corolla');

    const corolla = {
      id: '16000001',
      title: 'Toyota Corolla',
      subTitle: '1.8 Hybrid Touring Sports Active',
      specs: ['2021', '90 000 km', 'Hybridi', 'Automaatti'],
      usp: 'Vetokoukku / Peruutuskamera',
      year: 2021,
      mileage: 90000,
      price: 17500,
      driveType: null,
    };
    assert.equal(evaluate(corolla, null, filter).matched, true);
    assert.equal(evaluate({ ...corolla, price: 21000 }, null, filter).matched, false);
    assert.equal(evaluate({ ...corolla, usp: 'Peruutuskamera' }, null, filter).matched, false);
  });

  // With a token in the environment this would go to the network, which the
  // tests never do.
  const skipGist = process.env.GIST_TOKEN ? 'GIST_TOKEN is set' : false;

  it('refuses to fall back when pinned to the gist', { skip: skipGist }, async () => {
    // --filters=gist means "these filters or nothing": running something else
    // silently is the one outcome that would be worse than stopping.
    const loaded = await loadFilters({ source: 'gist', log: () => {} }).catch((error) => error);
    assert.ok(loaded instanceof Error);
    assert.match(loaded.message, /No filters file in the gist/);
  });

  it('gives filters over the same listing page a single crawl', () => {
    const cheap = normalizeFilter({ id: 'cheap', make: 'polestar', model: '2', maxPrice: 25000 });
    const tesla = normalizeFilter({ id: 't', make: 'tesla', model: 'model-3' });
    const groups = groupBySearch([POLESTAR, cheap, tesla]);
    assert.equal(groups.length, 2);
    assert.deepEqual(
      groups.map((group) => [group.key, group.filters.length]),
      [
        ['polestar/2', 2],
        ['tesla/model-3', 1],
      ],
    );
  });
});

describe('phrase matching', () => {
  const tokens = (text) => tokenize(text);

  it('ignores however the seller spelled the separators', () => {
    for (const text of ['Long Range', 'Long-Range', 'LONG RANGE / 78kWh', 'long/range']) {
      assert.equal(containsPhrase(tokens(text), 'long range'), true, text);
    }
  });

  it('requires the words in order and next to each other', () => {
    assert.equal(containsPhrase(tokens('Range, Long termiini'), 'long range'), false);
    assert.equal(containsPhrase(tokens('long tail range'), 'long range'), false);
  });

  it('matches a Finnish compound by its start, but only a long enough one', () => {
    assert.equal(containsPhrase(tokens('Lasikattoluukku'), 'lasikatto'), true);
    assert.equal(containsPhrase(tokens('Vetokoukku'), 'koukku'), false, 'not a suffix match');
    assert.equal(containsPhrase(tokens('Access-järjestelmä'), 'acc'), false, 'too short to guess');
  });

  it('finds nothing in an empty phrase or empty text', () => {
    assert.equal(containsPhrase(tokens('Pilot'), ''), false);
    assert.equal(containsPhrase(tokens(''), 'pilot'), false);
  });
});

describe('implication rules', () => {
  it('chains, so an AWD badge alone proves the battery', () => {
    const implied = applyImplications(tokenize('Launch Edition | Neliveto'), POLESTAR.implications);
    assert.equal(implied.get('dual motor'), 'neliveto');
    assert.equal(implied.get('long range'), 'dual motor');
  });

  it('stays quiet when the listing says it outright', () => {
    const implied = applyImplications(
      tokenize('Long Range Dual Motor | Neliveto'),
      POLESTAR.implications,
    );
    assert.equal(implied.size, 0);
  });

  it('terminates on rules that point at each other', () => {
    const implied = applyImplications(tokenize('alpha'), [
      { if: 'alpha', then: 'beta' },
      { if: 'beta', then: 'alpha' },
    ]);
    assert.equal(implied.get('beta'), 'alpha');
  });
});

describe('a filter with no requirements', () => {
  it('matches whatever the crawl returns, gaps and all', () => {
    const verdict = evaluate(listing({ year: null, mileage: null, price: null, usp: '' }), null, ANY);
    assert.equal(verdict.matched, true);
    assert.equal(verdict.needsDetail, false, 'nothing to prove, so nothing to fetch');
  });
});

describe('price and text limits', () => {
  const priced = normalizeFilter({
    id: 'budget',
    make: 'polestar',
    model: '2',
    minPrice: 20000,
    maxPrice: 29000,
  });

  it('enforces both ends of the price range', () => {
    assert.equal(evaluate(listing({ price: 28990 }), null, priced).matched, true);
    assert.equal(evaluate(listing({ price: 31000 }), null, priced).matched, false);
    assert.equal(evaluate(listing({ price: 15000 }), null, priced).matched, false);
    assert.equal(evaluate(listing({ price: null }), null, priced).matched, false);
  });

  it('does not spend a detail fetch on a car that is simply too expensive', () => {
    assert.equal(evaluate(listing({ price: 40000 }), null, priced).needsDetail, false);
  });

  it('reports the numbers it compared, so a rejection can be checked', () => {
    const verdict = evaluate(listing({ price: 31000 }), null, priced);
    assert.match(verdict.reasons.join(' ').replace(/\s/g, ' '), /31 000 € over 29 000 €/);
  });

  it('looks for a required phrase in the seller text, listing page included', () => {
    const towbar = normalizeFilter({
      id: 'towbar',
      make: 'polestar',
      model: '2',
      textMust: ['vetokoukku'],
    });
    const bare = listing({ usp: 'Panorama' });
    assert.equal(evaluate(bare, null, towbar).matched, false);
    assert.equal(evaluate(bare, null, towbar).needsDetail, true);
    assert.equal(evaluate(bare, { description: 'Vetokoukku ja lohkolämmitin' }, towbar).matched, true);
  });

  it('treats an excluded phrase as final - more text can only add hits', () => {
    const clean = normalizeFilter({
      id: 'clean',
      make: 'polestar',
      model: '2',
      textMustNot: ['kolarikorjattu'],
    });
    const verdict = evaluate(listing({ usp: 'Kolarikorjattu, hinta halpa' }), null, clean);
    assert.equal(verdict.matched, false);
    assert.equal(verdict.needsDetail, false);
    assert.ok(verdict.reasons.some((reason) => /kolarikorjattu/.test(reason)));
  });
});

describe('state', () => {
  const MATCH = { matched: true, reasons: [] };
  const REJECT = (reason) => ({ matched: false, reasons: [reason] });

  it('starts empty and flags itself as new', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    assert.equal(store.isNew, true);
    assert.equal(Object.keys(store.listings).length, 0);
  });

  it('round-trips through the file without the isNew marker', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    record(store, listing(), 'f1', MATCH);
    markAnnounced(store, '15900001', 'f1');
    await saveState(store, path);

    const reloaded = await loadState(path);
    assert.equal(reloaded.isNew, false);
    assert.equal(hasSeen(reloaded, '15900001'), true);
    assert.equal(wasAnnounced(reloaded, '15900001', 'f1'), true);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).isNew, undefined);
  });

  it('keeps each filter\'s verdict and posts separate', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    record(store, listing(), 'strict', REJECT('no plus package found'));
    record(store, listing(), 'loose', MATCH);
    markAnnounced(store, '15900001', 'loose');

    assert.equal(verdictFor(store, '15900001', 'strict').status, 'rejected');
    assert.equal(verdictFor(store, '15900001', 'loose').status, 'match');
    assert.equal(wasAnnounced(store, '15900001', 'loose'), true);
    assert.equal(wasAnnounced(store, '15900001', 'strict'), false);
    // One listing, one shared set of facts about the advert.
    assert.equal(store.listings['15900001'].price, 30000);
  });

  it('never moves firstSeenAt or announcedAt once set', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    record(store, listing(), 'f1', MATCH, { now: new Date('2026-01-01T00:00:00Z') });
    markAnnounced(store, '15900001', 'f1', new Date('2026-01-01T00:00:00Z'));
    record(store, listing({ price: 28000 }), 'f1', MATCH, { now: new Date('2026-02-01T00:00:00Z') });

    const entry = store.listings['15900001'];
    assert.equal(entry.firstSeenAt, '2026-01-01T00:00:00.000Z');
    assert.equal(entry.filters.f1.announcedAt, '2026-01-01T00:00:00.000Z');
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

  it('upgrades a pre-filters record without re-announcing its cars', async () => {
    const path = await tempFile('seen.json');
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        listings: {
          posted: {
            status: 'match',
            announcedAt: '2026-01-01T00:00:00.000Z',
            lastSeenAt: '2026-01-01T00:00:00.000Z',
            price: 27000,
            reasons: [],
          },
          skipped: { status: 'rejected', announcedAt: null, reasons: ['no plus package found'] },
        },
      }),
      'utf8',
    );

    const store = await loadState(path);
    assert.equal(store.migrated, true);
    assert.equal(store.listings.posted.price, 27000);
    // The old spec's verdicts are not attributed to any filter, so they are
    // not reused as if they were.
    assert.equal(verdictFor(store, 'posted', 'some-new-filter-id'), null);

    // Whatever the filters are called now, a car already in the channel stays
    // out of it: the first filter to judge the listing inherits the old
    // watcher's timestamp into its own record. The legacy key used to answer
    // for every filter directly, which meant no filter could ever announce
    // these cars again - not a mute that wears off, one that never did.
    record(store, listing({ id: 'posted', price: 27000 }), 'some-new-filter-id', MATCH);
    record(store, listing({ id: 'skipped', price: 27000 }), 'some-new-filter-id', MATCH);
    assert.equal(wasAnnounced(store, 'posted', 'some-new-filter-id'), true);
    assert.equal(wasAnnounced(store, 'skipped', 'some-new-filter-id'), false);
    assert.equal(
      verdictFor(store, 'posted', 'some-new-filter-id').announcedAt,
      '2026-01-01T00:00:00.000Z',
      'inherited verbatim, so the channel history stays honest',
    );

    // And it holds on the next run, rather than the inheritance being
    // re-derived into a fresh announcement every cycle.
    record(store, listing({ id: 'posted', price: 26500 }), 'some-new-filter-id', MATCH);
    assert.equal(wasAnnounced(store, 'posted', 'some-new-filter-id'), true);
    assert.equal(
      verdictFor(store, 'posted', 'some-new-filter-id').announcedAt,
      '2026-01-01T00:00:00.000Z',
    );
    // A car the old watcher never posted is still news for a filter that
    // matches it, which is the whole point of the change.
    assert.equal(wasAnnounced(store, 'skipped', 'another-filter'), false);
  });

  it('re-checks a rejected listing only when something changed or it went stale', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    record(store, listing(), 'f1', REJECT('no plus package found'), { detailChecked: true });

    assert.equal(needsRecheck(store, listing(), 'f1'), false);
    assert.equal(needsRecheck(store, listing(), 'other'), true, 'another filter never decided');
    assert.equal(needsRecheck(store, listing({ price: 27000 }), 'f1'), true, 'price moved');
    assert.equal(needsRecheck(store, listing({ mileage: 90000 }), 'f1'), true, 'mileage moved');

    store.listings['15900001'].detailCheckedAt = new Date(Date.now() - 30 * 864e5).toISOString();
    assert.equal(needsRecheck(store, listing(), 'f1'), true, 'cached verdict is stale');
  });

  it('never re-checks a listing already recorded as a match', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    record(store, listing(), 'f1', MATCH, { detailChecked: true });
    assert.equal(needsRecheck(store, listing({ price: 1 }), 'f1'), false);
  });

  it('knows a filter that has never run, which is what postExisting hangs on', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    assert.equal(isNewFilter(store, POLESTAR.id), true);
    recordFilterRun(store, POLESTAR);
    assert.equal(isNewFilter(store, POLESTAR.id), false);
  });

  it('forgets listings not seen for a long time', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    record(store, listing(), 'f1', MATCH);
    record(store, listing({ id: 'old' }), 'f1', MATCH, { now: new Date(Date.now() - 200 * 864e5) });

    assert.equal(prune(store, { forgetAfterDays: 90 }), 1);
    assert.equal(hasSeen(store, 'old'), false);
    assert.equal(hasSeen(store, '15900001'), true);
    assert.deepEqual(summarise(store), { tracked: 1, matches: 1, announced: 0 });
  });

  it('forgets a filter that stopped running, and its verdicts with it', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    record(store, listing(), 'kept', MATCH);
    record(store, listing(), 'deleted', REJECT('no plus package found'));
    recordFilterRun(store, { id: 'kept', name: 'Kept' });
    recordFilterRun(store, { id: 'deleted', name: 'Deleted' }, new Date(Date.now() - 200 * 864e5));

    prune(store, { forgetAfterDays: 90 });
    assert.deepEqual(Object.keys(store.filters), ['kept']);
    assert.deepEqual(Object.keys(store.listings['15900001'].filters), ['kept']);
    // A run whose filter source was briefly unreadable must not lose anything:
    // pruning goes by age, never by "not in this run's list".
    assert.equal(verdictFor(store, '15900001', 'kept').status, 'match');
  });

  it('counts per filter when asked, and across all of them otherwise', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    record(store, listing(), 'a', MATCH);
    record(store, listing(), 'b', REJECT('no plus package found'));
    markAnnounced(store, '15900001', 'a');

    assert.deepEqual(summarise(store, 'a'), { tracked: 1, matches: 1, announced: 1 });
    assert.deepEqual(summarise(store, 'b'), { tracked: 1, matches: 0, announced: 0 });
    assert.deepEqual(summarise(store), { tracked: 1, matches: 1, announced: 1 });
  });
});

describe('discord embed', () => {
  it('links the listing and shows the matched package text', () => {
    const item = listing({ usp: 'Pilot- ja Plus-paketit / 360', image: 'https://img/x.jpg', color: 'Musta' });
    const embed = buildEmbed(item, evaluate(item, null, POLESTAR), POLESTAR);
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

  it('names the filter that matched, and keeps the id reactions.js reads', () => {
    const item = listing({ usp: 'Pilot- ja Plus-paketit' });
    const embed = buildEmbed(item, evaluate(item, null, POLESTAR), POLESTAR);
    assert.match(embed.footer.text, /Polestar 2 LR DM/);
    assert.match(embed.footer.text, /ilmoitus 15900001/);
  });

  it('reads the price against the filter\'s own ceiling', () => {
    // 24 000 € is a bargain under a 30 000 € budget and merely mid-range under
    // a 25 000 € one, so the same car is not always the same colour.
    assert.notEqual(accentColour(24000, 30000), accentColour(24000, 25000));
    assert.equal(accentColour(null, 30000), accentColour(null, null));
  });

  it('stays inside Discord field limits on absurdly long seller text', () => {
    const item = listing({ usp: `Pilot- ja Plus-paketit ${'x'.repeat(4000)}` });
    const embed = buildEmbed(item, evaluate(item, null, POLESTAR), POLESTAR);
    assert.ok(embed.title.length <= 256);
    for (const field of embed.fields) assert.ok(field.value.length <= 1024, `${field.name} too long`);
  });

  it('renders a missing price and mileage without crashing', () => {
    const item = listing({ price: null, mileage: null, usp: 'Pilot- ja Plus-paketit' });
    const embed = buildEmbed(item, evaluate(item, null, POLESTAR), POLESTAR);
    const fieldText = embed.fields.map((field) => field.value).join(' ').replace(/\s/g, ' ');
    assert.match(fieldText, /hinta \?/);
    assert.match(fieldText, /\? km/);
  });
});

describe('verdict reuse', () => {
  // Mirrors the reuse decision in index.js: a cached verdict may stand in for
  // a detail fetch, but only when nothing has moved and, for a match, only
  // once it has actually been announced.
  function canReuse(store, item, cardVerdict, filterId = 'f1') {
    const cached = verdictFor(store, item.id, filterId);
    return Boolean(
      cardVerdict.needsDetail &&
        cached &&
        !needsRecheck(store, item, filterId) &&
        (cached.status !== 'match' || wasAnnounced(store, item.id, filterId)),
    );
  }

  it('reuses a rejection instead of re-reading the listing page', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    const item = listing({ usp: 'Panorama / H&K' });
    const cardVerdict = evaluate(item, null, POLESTAR);
    assert.equal(cardVerdict.needsDetail, true);

    record(store, item, 'f1', { matched: false, reasons: ['no pilot package found'] }, { detailChecked: true });
    assert.equal(canReuse(store, item, cardVerdict), true);
  });

  it('keeps an announced match matched without re-reading it', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    // Matched last run only because the listing page named the packages.
    const item = listing({ usp: 'Panorama / H&K' });
    record(store, item, 'f1', { matched: true, reasons: [] }, { detailChecked: true });
    markAnnounced(store, item.id, 'f1');

    assert.equal(canReuse(store, item, evaluate(item, null, POLESTAR)), true);
    // Regression: reusing must not silently downgrade it to a rejection.
    assert.equal(verdictFor(store, item.id, 'f1').status, 'match');
  });

  it('re-reads a match that was never announced, so the post has its evidence', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    const item = listing({ usp: 'Panorama / H&K' });
    record(store, item, 'f1', { matched: true, reasons: [] }, { detailChecked: true });
    assert.equal(canReuse(store, item, evaluate(item, null, POLESTAR)), false);
  });

  it('re-reads for a filter that has never seen the listing', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    const item = listing({ usp: 'Panorama / H&K' });
    record(store, item, 'f1', { matched: false, reasons: ['no plus package found'] }, { detailChecked: true });
    assert.equal(canReuse(store, item, evaluate(item, null, POLESTAR), 'brand-new'), false);
  });

  it('re-reads when the advertised price moved', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    const item = listing({ usp: 'Panorama / H&K' });
    record(store, item, 'f1', { matched: false, reasons: ['no plus package found'] }, { detailChecked: true });
    assert.equal(
      canReuse(store, listing({ usp: 'Panorama / H&K', price: 28500 }), evaluate(item, null, POLESTAR)),
      false,
    );
  });
});
