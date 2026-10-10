// The price line a post carries: a listing's asking price against similar ones
// in the market record. A port of checkPrice in the app's src/market.ts - these
// mirror test/market.test.ts there, so the post and the card it becomes cannot
// quietly drift apart.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MIN_SIMILAR,
  ageAt,
  checkListingPrice,
  driveOf,
  fuelOf,
} from '../src/sources/nettiauto-market.js';

const TODAY = new Date('2026-10-10T12:00:00Z');

/** The same pretend market as the app's test: 55 000 € new, -12 % a year, -4 % per 10 000 km. */
const truth = (year, km, day = '2026-10-10') =>
  55000 * Math.exp(-0.12 * ageAt(year, day) - 0.04 * (km / 10000));

let seed = 7;
const noise = () => {
  seed = (seed * 16807) % 2147483647;
  return 1 + ((seed / 2147483647) * 2 - 1) * 0.04;
};

function entry({ year, mileage, title = '78 kWh, Long Range Dual Motor', last = '2026-10-09', ...rest }) {
  return {
    title,
    year,
    mileage,
    fuel: null,
    drive: null,
    battery: null,
    seller: 'Dealer Oy',
    vin: null,
    first: '2026-09-01',
    last,
    prices: [[last, Math.round(truth(year, mileage, last) * noise())]],
    ...rest,
  };
}

function market(extra = {}) {
  const listings = {};
  let id = 1000;
  for (const year of [2021, 2022, 2023, 2024]) {
    for (const km of [20000, 45000, 70000, 95000, 120000, 140000, 30000, 60000, 85000, 110000]) {
      listings[String(id++)] = entry({ year, mileage: km - (2024 - year) * 5000 });
    }
  }
  return { version: 1, source: 'nettiauto', search: { make: 'polestar', model: '2' }, completeAt: null, listings: { ...listings, ...extra } };
}

/** A crawled listing, as the search card gives it. */
const crawled = (over = {}) => ({
  id: '555',
  year: 2022,
  mileage: 62000,
  price: 30000,
  subTitle: '78 kWh, Long Range Dual Motor',
  fuelType: 'Sähkö',
  driveType: 'Neliveto',
  battery: '78',
  vin: null,
  ...over,
});

const check = (listing, record = market()) => checkListingPrice(listing, record, { today: TODAY });

describe('the price line', () => {
  it('finds what the market asks, within a few percent', () => {
    const result = check(crawled());
    assert.ok(result);
    assert.ok(Math.abs(result.typical / truth(2022, 62000) - 1) < 0.03);
  });

  it('calls a cheap listing cheap and a dear one dear', () => {
    const fair = truth(2022, 62000);
    const cheap = check(crawled({ price: Math.round(fair * 0.85) }));
    const dear = check(crawled({ price: Math.round(fair * 1.15) }));
    assert.ok(cheap.diff < 0 && cheap.pricierShare > 0.9);
    assert.ok(dear.diff > 0 && dear.pricierShare < 0.1);
  });

  it('does not count the listing against itself', () => {
    // Already in the record - this run's crawl wrote it there before posting.
    const record = market({ 555: entry({ year: 2022, mileage: 62000 }) });
    const withSelf = check(crawled(), record);
    const without = check(crawled());
    assert.equal(withSelf.count, without.count);
  });

  it('keeps the single motors out of a dual motor comparison', () => {
    const others = {};
    for (let i = 0; i < 15; i += 1) {
      others[`sr${i}`] = entry({ year: 2022, mileage: 40000 + i * 5000, title: '69 kWh, Standard Range Single Motor' });
    }
    assert.equal(check(crawled(), market(others)).count, check(crawled()).count);
  });

  it('says nothing with too few similar listings, or no year', () => {
    const few = Object.fromEntries(Object.entries(market().listings).slice(0, MIN_SIMILAR - 1));
    assert.equal(check(crawled(), { ...market(), listings: few }), null);
    assert.equal(check(crawled({ year: null })), null);
    assert.equal(check(crawled({ price: null })), null);
    assert.equal(check(crawled(), null), null);
  });

  it('reads fuel and drive the way the app does', () => {
    assert.equal(fuelOf('Sähkö', ''), 'ev');
    assert.equal(fuelOf(null, '2,0, 320D F31 LCI Xdrive'), 'diesel');
    assert.equal(fuelOf(null, '330e M Sport'), 'phev');
    assert.equal(fuelOf(null, '320i Sedan'), 'petrol');
    assert.equal(driveOf('Neliveto', ''), 'awd');
    assert.equal(driveOf(null, 'Long Range Single Motor'), '2wd');
  });
});
