// Reaction pickup: shaping listings into the app's CarListing, deciding what
// counts as a reaction, and the add/confirm dance that survives the app's
// last-write-wins sync.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import config from '../src/config.js';
import { carName, toCarListing } from '../src/gist.js';
import { webhookIdFrom } from '../src/reactions.js';
import { loadState, needsTcoAdd, recordTcoAdd, recordTcoConfirmed, saveState } from '../src/state.js';

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
      'id', 'name', 'notes', 'powertrain', 'purchasePrice', 'odometerKm',
      'autoResale', 'expectedResaleValue', 'financing', 'fuelLPer100',
      'elecKwhPer100', 'electricSharePct', 'insurancePerYear', 'taxPerYear',
      'maintenancePerYear', 'tiresPerYear', 'otherPerYear', 'createdAt',
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

  it('names the car tersely for the comparison table', () => {
    assert.equal(carName(listing()), 'Polestar 2 LR DM 2021 · 120 tkm');
    assert.equal(
      carName(listing({ subTitle: '78 kWh, Long Range Dual Motor Performance', mileage: 29000, year: 2023 })),
      'Polestar 2 LR DM Perf 2023 · 29 tkm',
    );
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
  it('adds, then confirms, then leaves the car alone forever', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);

    // Never seen: add it.
    assert.equal(needsTcoAdd(store, '15905450'), true);

    // Added but not yet observed in the gist: keep trying, in case a device
    // pushed older data over our write moments later.
    recordTcoAdd(store, '15905450');
    assert.equal(needsTcoAdd(store, '15905450'), true);

    // Observed present once: done. If it disappears from the gist after this,
    // that was the user deleting it in the app, and it must stay deleted.
    recordTcoConfirmed(store, '15905450');
    assert.equal(needsTcoAdd(store, '15905450'), false);
  });

  it('keeps the pickup record across a state file round-trip', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    recordTcoAdd(store, '15905450', new Date('2026-08-26T12:00:00Z'));
    recordTcoConfirmed(store, '15905450', new Date('2026-08-26T12:30:00Z'));
    await saveState(store, path);

    const reloaded = await loadState(path);
    assert.equal(needsTcoAdd(reloaded, '15905450'), false);
    assert.equal(reloaded.tco['15905450'].addedAt, '2026-08-26T12:00:00.000Z');
    assert.equal(reloaded.tco['15905450'].confirmedAt, '2026-08-26T12:30:00.000Z');
  });

  it('tolerates a state file from before reaction pickup existed', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    delete store.tco;
    await saveState(store, path);
    const reloaded = await loadState(path);
    assert.deepEqual(reloaded.tco, {});
    assert.equal(needsTcoAdd(reloaded, 'anything'), true);
  });

  it('timestamps are first-write-wins, like the announce marker', async () => {
    const path = await tempFile('seen.json');
    const store = await loadState(path);
    recordTcoAdd(store, 'x', new Date('2026-01-01T00:00:00Z'));
    recordTcoAdd(store, 'x', new Date('2026-02-01T00:00:00Z'));
    assert.equal(store.tco.x.addedAt, '2026-01-01T00:00:00.000Z');
  });
});
