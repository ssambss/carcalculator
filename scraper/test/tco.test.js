// Reaction pickup: shaping listings into the app's CarListing, deciding what
// counts as a reaction, and the add/confirm dance that survives the app's
// last-write-wins sync.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import config from '../src/config.js';
import {
  addedMessage,
  carName,
  newCarDefaults,
  powertrainOf,
  toCarListing,
  variantHint,
} from '../src/sinks/car-tco.js';
import { webhookIdFrom } from '../src/reactions.js';
import {
  keyOf,
  loadState,
  needsTcoAdd,
  isFirstTcoAdd,
  recordTcoAdd,
  recordTcoConfirmed,
  saveState,
} from '../src/state.js';
/**
 * A record key. Listings are filed under `sourceId:id`, since a site's ids are
 * only unique within that site - see keyOf() in state.js.
 */
const K = (id) => keyOf('nettiauto', id);


const tempDirs = [];
async function tempFile(name) {
  const dir = await mkdtemp(join(tmpdir(), 'nettiauto-tco-test-'));
  tempDirs.push(dir);
  return join(dir, name);
}
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

function listing(overrides = {}) {
  return {
    id: '15905450',
    url: 'https://www.nettiauto.com/polestar/2/15905450',
    title: 'Polestar 2',
    subTitle: '78 kWh, Long Range Dual Motor 300kW 78kWh / Pilot- ja Plus-pkt.',
    year: 2021,
    mileage: 120000,
    price: 27790,
    seller: 'Testi Oy',
    color: 'Musta',
    location: 'Vantaa, Testi Oy',
    ...overrides,
  };
}

describe('turning a listing into a calculator car', () => {
  it('produces the app CarListing shape with the agreed defaults', () => {
    const car = toCarListing(listing(), { now: new Date('2026-08-26T12:00:00Z') });

    // Stable, recognisable id: the same reaction can never duplicate a car.
    assert.equal(car.id, 'nettiauto-15905450');
    assert.equal(car.powertrain, 'ev');
    assert.equal(car.purchasePrice, 27790);
    assert.equal(car.odometerKm, 120000);
    assert.equal(car.autoResale, true);
    assert.equal(car.electricSharePct, 100);
    assert.equal(car.createdAt, '2026-08-26T12:00:00.000Z');

    // Financing baseline as agreed: 0 down, 6 % for comparison, 72 months.
    assert.equal(car.financing.method, 'loan');
    assert.equal(car.financing.downPayment, 0);
    assert.equal(car.financing.annualRatePct, 6);
    assert.equal(car.financing.termMonths, 72);
    assert.equal(car.financing.autoBalloon, true);

    // The nettiauto link survives into the notes.
    assert.match(car.notes, /nettiauto\.com\/polestar\/2\/15905450/);
  });

  it('covers every field the app knows, so nothing normalises to a surprise', async () => {
    // Field list mirrored from CarListing in src/types.ts (repo root).
    const expected = [
      'id', 'name', 'notes', 'favorite', 'powertrain', 'purchasePrice', 'odometerKm',
      'autoResale', 'expectedResaleValue', 'financing', 'fuelLPer100',
      'elecKwhPer100', 'electricSharePct', 'insurancePerYear', 'taxPerYear',
      'maintenancePerYear', 'tiresPerYear', 'otherPerYear', 'createdAt', 'updatedAt',
    ];
    const car = toCarListing(listing());
    assert.deepEqual(Object.keys(car).sort(), [...expected].sort());
    const financing = ['method', 'downPayment', 'annualRatePct', 'termMonths', 'autoBalloon', 'balloon'];
    assert.deepEqual(Object.keys(car.financing).sort(), [...financing].sort());
  });

  it('handles a listing rebuilt from the state record, with fields missing', () => {
    const sparse = listing({ price: null, mileage: null, color: null, location: null });
    const car = toCarListing(sparse);
    assert.equal(car.purchasePrice, 0);
    assert.equal(car.odometerKm, 0);
    assert.match(car.notes, /nettiauto\.com/);
  });

  it('names the car from the listing, whatever the car is', () => {
    assert.equal(carName(listing()), 'Polestar 2 Long Range Dual Motor 2021 · 120 tkm');
    assert.equal(
      carName(listing({ subTitle: '78 kWh, Long Range Dual Motor Performance', mileage: 29000, year: 2023 })),
      'Polestar 2 Long Range Dual Motor Performance 2023 · 29 tkm',
    );
    // Now that a filter can watch anything, nothing here may assume Polestar.
    assert.equal(
      carName({ title: 'Toyota Corolla', subTitle: '1.8 Hybrid Active', year: 2022, mileage: 45000 }),
      'Toyota Corolla 1.8 Hybrid Active 2022 · 45 tkm',
    );
    assert.equal(carName({ title: '', subTitle: '', year: null, mileage: null }), 'Auto');
  });

  it('drops the figures the card already shows from the variant name', () => {
    assert.equal(variantHint('78 kWh, Long Range Dual Motor, 300kW, 78kWh'), 'Long Range Dual Motor');
    assert.equal(variantHint('2.0 TDI'), '2.0 TDI', 'an engine size is not a stray measurement');
    // Long enough to be cut, and cut on a word boundary rather than mid-word.
    const long = variantHint('Long Range Dual Motor Performance Launch Edition');
    assert.ok(long.length <= 40);
    assert.ok(!long.endsWith(' '));
    assert.equal(long, 'Long Range Dual Motor Performance');
  });

  it('takes the powertrain from what the listing says it burns', () => {
    assert.equal(powertrainOf({ fuelType: 'Sähkö' }), 'ev');
    assert.equal(powertrainOf({ fuelType: 'Diesel' }), 'diesel');
    assert.equal(powertrainOf({ fuelType: 'Bensiini' }), 'petrol');
    assert.equal(powertrainOf({ fuelType: 'Lataushybridi' }), 'phev');
    // A non-plug hybrid is fuelled with petrol, and the app has no other name
    // for it.
    assert.equal(powertrainOf({ fuelType: 'Hybridi' }), 'petrol');
    assert.equal(powertrainOf({}, 'diesel'), 'diesel', 'falls back when the ad is silent');
  });

  it('gives a combustion car the fuel figures, not the electric ones', () => {
    const car = toCarListing({ ...listing(), fuelType: 'Diesel' });
    assert.equal(car.powertrain, 'diesel');
    assert.equal(car.electricSharePct, 50);
    assert.equal(car.fuelLPer100, config.tco.carDefaults.fuelLPer100);
  });
});

describe('saying a reacted car has arrived', () => {
  const polestar = {
    id: '15998743',
    title: 'Polestar 2',
    subTitle: 'Long Range Dual Motor 78 kWh',
    year: 2021,
    mileage: 101000,
    price: 28790,
    url: 'https://www.nettiauto.com/polestar/2/15998743',
  };
  const appUrl = 'https://ssambss.github.io/carcalculator/';

  it('names the car as its card will be, with price, listing and app', () => {
    // A reaction used to be silent; the car just turned up on the next sync.
    const text = addedMessage([polestar], { appUrl });
    assert.match(text, /Lisätty laskuriin/);
    assert.ok(text.includes(carName(polestar)), 'the card name, so it can be found in the app');
    assert.match(text, /28\s790\s€/);
    assert.ok(text.includes(`<${appUrl}>`));
  });

  it('keeps Discord from unfurling a second copy of the listing', () => {
    assert.ok(addedMessage([polestar], { appUrl }).includes(`<${polestar.url}>`));
  });

  it('lists several cars in one message', () => {
    const text = addedMessage([polestar, { ...polestar, id: '2', price: null }], { appUrl });
    assert.match(text, /2 autoa/);
    assert.equal(text.split('\n').filter((line) => line.startsWith('• ')).length, 2);
  });

  it('fits every car into the one message, dropping links before cars', () => {
    // Twenty cars with links is well past Discord's limit. Cutting the text
    // would silently drop cars from the notice; dropping the links does not.
    const many = Array.from({ length: 20 }, (_, i) => ({ ...polestar, id: String(i), year: 2000 + i }));
    const text = addedMessage(many, { appUrl });
    assert.ok(text.length <= 1900);
    for (const car of many) assert.ok(text.includes(carName(car)), `${car.year} is missing`);
    assert.ok(text.includes(`<${appUrl}>`), 'the calculator link stays');
  });

  it('says how many it left out when even the names do not fit', () => {
    const lots = Array.from({ length: 60 }, (_, i) => ({ ...polestar, id: String(i) }));
    const text = addedMessage(lots, { appUrl });
    assert.ok(text.length <= 1900);
    const listed = text.split('\n').filter((line) => line.startsWith('• ')).length;
    assert.match(text, new RegExp(`…ja ${60 - listed} muuta`));
    assert.match(text, /60 autoa/);
  });

  it('leaves out what it does not know', () => {
    const text = addedMessage([{ ...polestar, price: null }], { appUrl: '' });
    assert.doesNotMatch(text, /€/);
    assert.doesNotMatch(text, /Avaa laskuri/);
  });
});

describe('reaction plumbing', () => {
  it('extracts the webhook id used to recognise our own posts', () => {
    assert.equal(webhookIdFrom('https://discord.com/api/webhooks/123456/token-abc'), '123456');
    assert.equal(webhookIdFrom('https://example.com/nope'), null);
    assert.equal(webhookIdFrom(undefined), null);
  });

  it('any reaction counts by default', () => {
    // requiredEmoji stays null unless deliberately configured.
    assert.equal(config.tco.requiredEmoji, null);
  });
});

describe('add/confirm against last-write-wins sync', () => {
  it('counts only the first write as news', async () => {
    // A car written again after a sync race was already announced; a second
    // "added to the calculator" would read as a second car.
    const store = await loadState(await tempFile('seen.json'));
    assert.equal(isFirstTcoAdd(store, K('15905450')), true);
    recordTcoAdd(store, K('15905450'));
    assert.equal(isFirstTcoAdd(store, K('15905450')), false);
  });

  it('adds, then confirms, then leaves the car alone forever', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);

    // Never seen: add it.
    assert.equal(needsTcoAdd(store, K('15905450')), true);

    // Added but not yet observed in the gist: keep trying, in case a device
    // pushed older data over our write moments later.
    recordTcoAdd(store, K('15905450'));
    assert.equal(needsTcoAdd(store, K('15905450')), true);

    // Observed present once: done. If it disappears from the gist after this,
    // that was the user deleting it in the app, and it must stay deleted.
    recordTcoConfirmed(store, K('15905450'));
    assert.equal(needsTcoAdd(store, K('15905450')), false);
  });

  it('keeps the pickup record across a state file round-trip', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    recordTcoAdd(store, K('15905450'), new Date('2026-08-26T12:00:00Z'));
    recordTcoConfirmed(store, K('15905450'), new Date('2026-08-26T12:30:00Z'));
    await saveState(store, path);

    const reloaded = await loadState(path);
    assert.equal(needsTcoAdd(reloaded, K('15905450')), false);
    assert.equal(reloaded.tco[K('15905450')].addedAt, '2026-08-26T12:00:00.000Z');
    assert.equal(reloaded.tco[K('15905450')].confirmedAt, '2026-08-26T12:30:00.000Z');
  });

  it('tolerates a state file from before reaction pickup existed', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    delete store.tco;
    await saveState(store, path);
    const reloaded = await loadState(path);
    assert.deepEqual(reloaded.tco, {});
    assert.equal(needsTcoAdd(reloaded, K('anything')), true);
  });

  it('timestamps are first-write-wins, like the announce marker', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    recordTcoAdd(store, K('x'), new Date('2026-01-01T00:00:00Z'));
    recordTcoAdd(store, K('x'), new Date('2026-02-01T00:00:00Z'));
    assert.equal(store.tco[K('x')].addedAt, '2026-01-01T00:00:00.000Z');
  });
});

describe('whose financing baseline a new car arrives on', () => {
  // The watcher runs for several people. A rate and term hardcoded in the
  // scraper put one person's assumptions about borrowing into everybody's
  // calculator - defensible as a starting point, but not ours to decide.

  const listing = {
    id: '900',
    url: 'https://www.nettiauto.com/polestar/2/900',
    title: 'Polestar 2',
    subTitle: '78 kWh, Long Range Dual Motor',
    price: 30000,
    mileage: 50000,
    year: 2022,
    fuelType: 'Sähkö',
  };

  const envelope = (settings) => ({ data: { cars: [], settings } });

  it('takes it from their own calculator settings', () => {
    const defaults = newCarDefaults(
      envelope({ newCar: { downPayment: 5000, annualRatePct: 3.4, termMonths: 48 } }),
    );
    assert.equal(defaults.financing.downPayment, 5000);
    assert.equal(defaults.financing.annualRatePct, 3.4);
    assert.equal(defaults.financing.termMonths, 48);

    const car = toCarListing(listing, { defaults });
    assert.equal(car.financing.annualRatePct, 3.4);
    assert.equal(car.financing.termMonths, 48);
    assert.equal(car.financing.downPayment, 5000);
  });

  it('takes their consumption assumptions too', () => {
    const defaults = newCarDefaults(envelope({ newCar: { elecKwhPer100: 24, fuelLPer100: 8 } }));
    const car = toCarListing(listing, { defaults });
    assert.equal(car.elecKwhPer100, 24);
    assert.equal(car.fuelLPer100, 8);
  });

  it('falls back to the shipped baseline when their app predates the setting', () => {
    // Not a broken car: somebody on an older bundle has no settings.newCar, and
    // a car financed at 0 % over 0 months would be worse than an assumption.
    for (const shape of [envelope({}), envelope(undefined), {}, null]) {
      const defaults = newCarDefaults(shape);
      assert.equal(defaults.financing.annualRatePct, config.tco.carDefaults.financing.annualRatePct);
      assert.equal(defaults.financing.termMonths, config.tco.carDefaults.financing.termMonths);
    }
  });

  it('falls back field by field, not all or nothing', () => {
    // Somebody who has set only a rate should keep the shipped term.
    const defaults = newCarDefaults(envelope({ newCar: { annualRatePct: 2.9 } }));
    assert.equal(defaults.financing.annualRatePct, 2.9);
    assert.equal(defaults.financing.termMonths, config.tco.carDefaults.financing.termMonths);
  });

  it('ignores nonsense rather than building an uncomputable car', () => {
    const defaults = newCarDefaults(
      envelope({ newCar: { annualRatePct: -1, termMonths: 0, downPayment: 'lots' } }),
    );
    assert.equal(defaults.financing.annualRatePct, config.tco.carDefaults.financing.annualRatePct);
    // Zero months would divide by nothing in the app's annuity.
    assert.equal(defaults.financing.termMonths, config.tco.carDefaults.financing.termMonths);
    assert.equal(defaults.financing.downPayment, config.tco.carDefaults.financing.downPayment);
  });

  it('leaves the costs nobody can guess at zero', () => {
    // Insurance, tax and maintenance are not assumptions the app can make, and
    // a guessed number reads as a real one. Deliberately untouched by this.
    const car = toCarListing(listing, {
      defaults: newCarDefaults(envelope({ newCar: { annualRatePct: 3 } })),
    });
    assert.equal(car.insurancePerYear, 0);
    assert.equal(car.taxPerYear, 0);
    assert.equal(car.maintenancePerYear, 0);
  });
});
