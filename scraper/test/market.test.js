// The market record - every listing seen, kept after it leaves, with its asking
// price over time. What these pin is what a price history means: a change is a
// new entry, a correction within the day is not, and a crawl that missed pages
// cannot make a listing look sold.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  MARKET_VERSION,
  emptyMarket,
  hashVin,
  marketFileName,
  normalizeMarket,
  observe,
  recordMarket,
  serializeMarket,
  sight,
} from '../src/market.js';

const SEARCH = { make: 'polestar', model: '2' };
const at = (day) => new Date(`${day}T12:00:00Z`);
const listing = (id, price, extra = {}) => ({
  id,
  price,
  year: 2022,
  mileage: 60000,
  subTitle: '78 kWh, Long Range Dual Motor',
  fuelType: 'Sähkö',
  driveType: 'Neliveto',
  battery: '78',
  seller: 'Private seller',
  ...extra,
});

describe('where a search is recorded', () => {
  it('names the file after the source and the search, whatever the key order', () => {
    assert.equal(marketFileName('nettiauto', SEARCH), 'nettiauto-polestar-2.json');
    assert.equal(marketFileName('nettiauto', { model: '2', make: 'polestar' }), 'nettiauto-polestar-2.json');
  });

  it('spells a make with an accent plainly', () => {
    assert.equal(
      marketFileName('nettiauto', { make: 'Škoda', model: 'Octavia RS' }),
      'nettiauto-skoda-octavia-rs.json',
    );
  });
});

describe('a price history', () => {
  it('starts with the price the listing was first seen at', () => {
    const market = emptyMarket('nettiauto', SEARCH);
    observe(market, [listing(1, 32900)], { now: at('2026-10-01') });
    assert.deepEqual(market.listings['1'].prices, [['2026-10-01', 32900]]);
    assert.equal(market.listings['1'].first, '2026-10-01');
  });

  it('adds an entry when the price moves, and none when it holds', () => {
    const market = emptyMarket('nettiauto', SEARCH);
    observe(market, [listing(1, 32900)], { now: at('2026-10-01') });
    observe(market, [listing(1, 32900)], { now: at('2026-10-03') });
    observe(market, [listing(1, 31500)], { now: at('2026-10-08') });
    assert.deepEqual(market.listings['1'].prices, [
      ['2026-10-01', 32900],
      ['2026-10-08', 31500],
    ]);
    assert.equal(market.listings['1'].last, '2026-10-08');
  });

  it('treats a second change on the same day as a correction', () => {
    const market = emptyMarket('nettiauto', SEARCH);
    observe(market, [listing(1, 32900)], { now: at('2026-10-01') });
    observe(market, [listing(1, 3190)], { now: at('2026-10-05') });
    observe(market, [listing(1, 31900)], { now: at('2026-10-05') });
    assert.deepEqual(market.listings['1'].prices, [
      ['2026-10-01', 32900],
      ['2026-10-05', 31900],
    ]);
  });

  it('forgets a change that was undone within the day', () => {
    const market = emptyMarket('nettiauto', SEARCH);
    observe(market, [listing(1, 32900)], { now: at('2026-10-01') });
    observe(market, [listing(1, 30900)], { now: at('2026-10-05') });
    observe(market, [listing(1, 32900)], { now: at('2026-10-05') });
    assert.deepEqual(market.listings['1'].prices, [['2026-10-01', 32900]]);
  });

  it('counts what was new and what was repriced', () => {
    const market = emptyMarket('nettiauto', SEARCH);
    observe(market, [listing(1, 32900), listing(2, 28000)], { now: at('2026-10-01') });
    const counts = observe(market, [listing(1, 31900), listing(2, 28000), listing(3, 40000)], {
      now: at('2026-10-02'),
    });
    assert.deepEqual(counts, { added: 1, repriced: 1 });
  });
});

describe('what a listing keeps', () => {
  it('keeps the facts a later sighting does not repeat', () => {
    // A backfill from old state files knows the price and year but not the drive.
    const market = emptyMarket('nettiauto', SEARCH);
    observe(market, [listing(1, 32900)], { now: at('2026-10-01') });
    sight(market, 1, { price: 32900, year: 2022, title: '' }, { firstSeen: '2026-10-02', seen: '2026-10-02' });
    const entry = market.listings['1'];
    assert.equal(entry.drive, 'Neliveto');
    assert.equal(entry.battery, 78);
    assert.equal(entry.title, '78 kWh, Long Range Dual Motor');
  });

  it('widens the days on sale to cover an older sighting', () => {
    const market = emptyMarket('nettiauto', SEARCH);
    sight(market, 1, { price: 30000 }, { firstSeen: '2026-09-10', seen: '2026-09-20' });
    sight(market, 1, { price: 30000 }, { firstSeen: '2026-08-30', seen: '2026-09-15' });
    assert.equal(market.listings['1'].first, '2026-08-30');
    assert.equal(market.listings['1'].last, '2026-09-20');
  });

  it('hashes the VIN, the same way every time', () => {
    assert.equal(hashVin('lpsvsedeeml012345'), hashVin('LPSVSEDEEML012345'));
    assert.equal(hashVin('LPSVSEDEEML012345').length, 16);
    assert.equal(hashVin(''), null);
    assert.equal(hashVin(null), null);
  });
});

describe('a crawl that missed pages', () => {
  it('only a complete crawl moves the moment listings can be judged gone by', () => {
    const market = emptyMarket('nettiauto', SEARCH);
    observe(market, [listing(1, 32900)], { now: at('2026-10-01'), complete: true });
    observe(market, [listing(2, 28000)], { now: at('2026-10-02'), complete: false });
    assert.equal(market.completeAt, at('2026-10-01').toISOString());
    assert.equal(market.updatedAt, at('2026-10-02').toISOString());
  });
});

describe('the file', () => {
  it('is plain JSON, one listing per line, ids in numeric order', () => {
    const market = emptyMarket('nettiauto', SEARCH);
    observe(market, [listing(100, 30000), listing(9, 31000)], { now: at('2026-10-01') });
    const text = serializeMarket(market);
    const parsed = JSON.parse(text);
    assert.equal(parsed.version, MARKET_VERSION);
    assert.deepEqual(Object.keys(parsed.listings), ['9', '100']);
    const lines = text.split('\n').filter((line) => line.startsWith('    "'));
    assert.equal(lines.length, 2);
    assert.ok(lines[0].startsWith('    "9": {'));
  });

  it('reads an empty record as empty, and a foreign one as a fresh start', () => {
    const empty = emptyMarket('nettiauto', SEARCH);
    assert.deepEqual(JSON.parse(serializeMarket(empty)).listings, {});
    assert.deepEqual(normalizeMarket({ version: 99, listings: { 1: {} } }, 'nettiauto', SEARCH).listings, {});
  });

  it('round-trips through disk, run after run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'market-'));
    try {
      const read = (listings, complete = true) => ({ sourceId: 'nettiauto', search: SEARCH, listings, complete });
      await recordMarket([read([listing(1, 32900)])], { now: at('2026-10-01'), dir });
      const [summary] = await recordMarket([read([listing(1, 31900), listing(2, 28000)])], {
        now: at('2026-10-04'),
        dir,
      });
      assert.deepEqual(summary, { file: 'nettiauto-polestar-2.json', added: 1, repriced: 1, total: 2 });
      const saved = JSON.parse(await readFile(join(dir, 'nettiauto-polestar-2.json'), 'utf8'));
      assert.deepEqual(saved.listings['1'].prices, [
        ['2026-10-01', 32900],
        ['2026-10-04', 31900],
      ]);
      // The index the app reads first lists the record, from the file itself.
      const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
      assert.deepEqual(
        index.files.map((f) => [f.file, f.listings, f.search]),
        [['nettiauto-polestar-2.json', 2, SEARCH]],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
