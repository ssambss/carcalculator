// Reading data back that was written by an older version of this app, by hand,
// or by the listing watcher.
//
// `normalizeData` is the only gate between stored JSON and everything else, so
// every "what if the field is missing / wrong / hostile" question lands here.
// It is also what the throwaway script used to check by hand; these are those
// assertions, kept.

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_NEW_CAR,
  DEFAULT_SETTINGS,
  newCar,
  normalizeData,
} from '../src/storage'

const bare = (over: Record<string, unknown> = {}) => ({
  version: 1,
  settings: {},
  cars: [],
  tombstones: {},
  ...over,
})

describe('the new-car baseline', () => {
  it("is part of the settings, so it travels with a person's data", () => {
    expect(DEFAULT_SETTINGS.newCar).toEqual(DEFAULT_NEW_CAR)
  })

  it('gives a blank car the shipped baseline', () => {
    const blank = newCar()
    expect(blank.financing.annualRatePct).toBe(6)
    expect(blank.financing.termMonths).toBe(72)
    expect(blank.financing.downPayment).toBe(0)
  })

  it("gives a blank car somebody else's baseline when told one", () => {
    // The whole point: one person's assumptions about borrowing must not end up
    // in another person's calculator.
    const mine = newCar({
      downPayment: 5000,
      annualRatePct: 3.4,
      termMonths: 48,
      elecKwhPer100: 24,
      fuelLPer100: 8,
    })
    expect(mine.financing.annualRatePct).toBe(3.4)
    expect(mine.financing.termMonths).toBe(48)
    expect(mine.financing.downPayment).toBe(5000)
    expect(mine.elecKwhPer100).toBe(24)
    expect(mine.fuelLPer100).toBe(8)
  })

  it('gives data written before the setting existed the baseline, not zeros', () => {
    // A car financed at 0 % over 0 months would be worse than an assumption.
    const old = normalizeData(bare({ settings: { annualKm: 15000 } }))
    expect(old.settings.newCar).toEqual(DEFAULT_NEW_CAR)
    expect(old.settings.annualKm).toBe(15000)
  })

  it('falls back field by field, not all or nothing', () => {
    const partial = normalizeData(bare({ settings: { newCar: { annualRatePct: 2.9 } } }))
    expect(partial.settings.newCar.annualRatePct).toBe(2.9)
    expect(partial.settings.newCar.termMonths).toBe(DEFAULT_NEW_CAR.termMonths)
  })

  it('refuses values that would make a car uncomputable', () => {
    const junk = normalizeData(
      bare({ settings: { newCar: { annualRatePct: -5, termMonths: 0, fuelLPer100: 'lots' } } }),
    )
    expect(junk.settings.newCar.annualRatePct).toBe(0)
    // Zero months would divide by nothing in the annuity.
    expect(junk.settings.newCar.termMonths).toBe(1)
    expect(junk.settings.newCar.fuelLPer100).toBe(DEFAULT_NEW_CAR.fuelLPer100)
  })

  it("fills a partial car from that person's baseline, not a hardcoded one", () => {
    // The gap this closed: normalizeFinancing had its own 0 %/60-month
    // defaults, so a car with no financing block filled from neither.
    const data = normalizeData(
      bare({
        settings: { newCar: { annualRatePct: 3.4, termMonths: 48 } },
        cars: [{ id: 'c1', name: 'X' }],
      }),
    )
    expect(data.cars[0].financing.annualRatePct).toBe(3.4)
    expect(data.cars[0].financing.termMonths).toBe(48)
  })
})

describe('normalizing anything at all', () => {
  it('turns rubbish into an empty, valid dataset', () => {
    for (const input of [null, undefined, 'nope', 42, []]) {
      const data = normalizeData(input)
      expect(data.version).toBe(1)
      expect(data.cars).toEqual([])
      expect(data.settings.annualKm).toBe(DEFAULT_SETTINGS.annualKm)
    }
  })

  it('drops cars that are not objects rather than crashing on them', () => {
    const data = normalizeData(bare({ cars: [null, 'car', { id: 'ok', name: 'Real' }] }))
    expect(data.cars).toHaveLength(3)
    // The junk becomes blank cars rather than throwing; the real one survives.
    expect(data.cars.map((c) => c.name)).toContain('Real')
  })

  it('keeps an ownership period of at least a year', () => {
    expect(normalizeData(bare({ settings: { ownershipYears: 0 } })).settings.ownershipYears).toBe(1)
    expect(normalizeData(bare({ settings: { ownershipYears: -4 } })).settings.ownershipYears).toBe(1)
  })

  it('keeps only string tombstones', () => {
    const data = normalizeData(bare({ tombstones: { a: '2026-01-01', b: 7, c: null } }))
    expect(Object.keys(data.tombstones)).toEqual(['a'])
  })

  it('reads a comma decimal, and grouped thousands, out of stored JSON', () => {
    // The app writes real numbers, so this is for everything that is not the
    // app: a hand-edited export, a spreadsheet, a locale that puts commas in
    // decimals. `1,95` silently becoming the default price is a worse answer
    // than reading it - and this is the path an imported sheet comes in on.
    expect(normalizeData(bare({ settings: { petrolPrice: '1,95' } })).settings.petrolPrice)
      .toBeCloseTo(1.95, 6)
    expect(normalizeData(bare({ cars: [{ id: 'c', purchasePrice: '28 500' }] })).cars[0].purchasePrice)
      .toBe(28500)
    // A non-breaking space is what Intl puts in, so an exported figure pasted
    // back has to survive too.
    expect(
      normalizeData(bare({ cars: [{ id: 'c', purchasePrice: '28 500,50' }] })).cars[0]
        .purchasePrice,
    ).toBeCloseTo(28500.5, 6)
  })

  it('still refuses a string that is not a number', () => {
    expect(normalizeData(bare({ settings: { petrolPrice: 'lots' } })).settings.petrolPrice).toBe(
      DEFAULT_SETTINGS.petrolPrice,
    )
    expect(normalizeData(bare({ settings: { petrolPrice: '' } })).settings.petrolPrice).toBe(
      DEFAULT_SETTINGS.petrolPrice,
    )
  })
})

describe('cars written by an older version', () => {
  it('keeps a manual resale value and infers that auto-estimation was off', () => {
    // autoResale postdates the manual figure. A car with a resale value and no
    // flag meant the value, so switching it to auto would silently change it.
    const data = normalizeData(bare({ cars: [{ id: 'c', expectedResaleValue: 12000 }] }))
    expect(data.cars[0].autoResale).toBe(false)
    expect(data.cars[0].expectedResaleValue).toBe(12000)
  })

  it('estimates for a car that never had a resale value', () => {
    const data = normalizeData(bare({ cars: [{ id: 'c' }] }))
    expect(data.cars[0].autoResale).toBe(true)
  })

  it('dates a car with no updatedAt from its creation', () => {
    // updatedAt is what the per-car sync merge compares, so a missing one has
    // to become something orderable rather than empty.
    const data = normalizeData(
      bare({ cars: [{ id: 'c', createdAt: '2026-01-01T00:00:00.000Z' }] }),
    )
    expect(data.cars[0].updatedAt).toBe('2026-01-01T00:00:00.000Z')
  })
})
