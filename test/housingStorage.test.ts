// The housing data's storage rules: normalising what a gist or an old device
// hands back, and merging two copies without losing anyone's edit.
//
// The interesting decisions: the situation merges whole (half of one person's
// income and half of another's savings is nobody's situation), tombstones make
// deletes stick across devices, and ordering is canonical so identical merges
// serialize identically everywhere - the same rules the cars and the filters
// already live by.

import { describe, expect, it } from 'vitest'

import { DEFAULT_HOUSING } from '../src/housing'
import {
  EMPTY_HOUSING,
  mergeHousing,
  newProperty,
  normalizeHousing,
  normalizeProperty,
  normalizeSituation,
  type HousingData,
} from '../src/housingStorage'

// Merge-window rule from PLAN.md: values the code compares against *now*
// (tombstone TTL) must be relative; values only compared against other rows
// (updatedAt ordering) must be fixed.
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

const data = (over: Partial<HousingData> = {}): HousingData => ({
  ...structuredClone(EMPTY_HOUSING),
  ...over,
})

const prop = (id: string, updatedAt: string, name = id) => ({
  ...newProperty(),
  id,
  name,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt,
})

describe('normalising', () => {
  it('reads numbers the way a person types them', () => {
    const s = normalizeSituation({ netIncomePerMonth: '3 400', ratePct: '3,5' })
    expect(s.netIncomePerMonth).toBe(3400)
    expect(s.ratePct).toBe(3.5)
  })

  it('falls back to the defaults field by field, not wholesale', () => {
    const s = normalizeSituation({ savings: 40000 })
    expect(s.savings).toBe(40000)
    expect(s.stressRatePct).toBe(DEFAULT_HOUSING.stressRatePct)
  })

  it('refuses values that would break the maths', () => {
    const s = normalizeSituation({ termYears: 0, netIncomePerMonth: -5, housingSharePct: 250 })
    expect(s.termYears).toBe(1) // zero would zero every annuity
    expect(s.netIncomePerMonth).toBe(0)
    expect(s.housingSharePct).toBe(100)
  })

  it('gives a property an id and timestamps when they are missing', () => {
    const p = normalizeProperty({ name: 'Kamppi', price: 249000 })
    expect(p.id).toBeTruthy()
    expect(p.createdAt).toBeTruthy()
    expect(p.updatedAt).toBe(p.createdAt)
  })

  it('survives complete garbage without throwing', () => {
    expect(normalizeHousing(null).properties).toEqual([])
    expect(normalizeHousing('what').version).toBe(1)
    expect(normalizeHousing({ properties: 'no', tombstones: 7 }).tombstones).toEqual({})
  })

  it('ignores the sync envelope keys mixed into the file', () => {
    // pushHousing writes { app, savedAt, ...data }; reading it back must not care.
    const d = normalizeHousing({ app: 'carcalculator', savedAt: 'x', situation: { savings: 1 } })
    expect(d.situation.savings).toBe(1)
  })
})

describe('merging between devices', () => {
  it('takes the newer edit of a property both sides have', () => {
    const a = data({ properties: [prop('p1', '2026-02-01T00:00:00.000Z', 'newer')] })
    const b = data({ properties: [prop('p1', '2026-01-15T00:00:00.000Z', 'older')] })
    expect(mergeHousing(a, b).properties[0].name).toBe('newer')
    expect(mergeHousing(b, a).properties[0].name).toBe('newer')
  })

  it('keeps a deleted property deleted', () => {
    const deleted = data({ tombstones: { p1: daysAgo(1) } })
    const stale = data({ properties: [prop('p1', daysAgo(30))] })
    expect(mergeHousing(deleted, stale).properties).toEqual([])
    expect(mergeHousing(stale, deleted).properties).toEqual([])
  })

  it('brings one back that was edited after the deletion', () => {
    const deleted = data({ tombstones: { p1: daysAgo(10) } })
    const edited = data({ properties: [prop('p1', daysAgo(2))] })
    const merged = mergeHousing(deleted, edited)
    expect(merged.properties).toHaveLength(1)
    expect(merged.tombstones.p1).toBeUndefined()
  })

  it('merges the situation whole, by its own timestamp', () => {
    const a = data({
      situation: { ...DEFAULT_HOUSING, netIncomePerMonth: 3400, savings: 10000 },
      situationUpdatedAt: '2026-02-01T00:00:00.000Z',
    })
    const b = data({
      situation: { ...DEFAULT_HOUSING, netIncomePerMonth: 5000, savings: 90000 },
      situationUpdatedAt: '2026-03-01T00:00:00.000Z',
    })
    const merged = mergeHousing(a, b)
    // b is newer: its situation wins entirely, no field-by-field mixing.
    expect(merged.situation.netIncomePerMonth).toBe(5000)
    expect(merged.situation.savings).toBe(90000)
  })

  it('lets a device that never edited the situation lose to one that did', () => {
    const untouched = data() // situationUpdatedAt: ''
    const edited = data({
      situation: { ...DEFAULT_HOUSING, savings: 40000 },
      situationUpdatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(mergeHousing(untouched, edited).situation.savings).toBe(40000)
  })

  it('orders the result the same whichever side merges', () => {
    const a = data({
      properties: [prop('b', '2026-01-02T00:00:00.000Z'), prop('a', '2026-01-03T00:00:00.000Z')],
    })
    const b = data({ properties: [prop('c', '2026-01-04T00:00:00.000Z')] })
    const one = mergeHousing(a, b)
    const two = mergeHousing(b, a)
    expect(JSON.stringify(one.properties)).toBe(JSON.stringify(two.properties))
  })

  it('expires tombstones after the window instead of hoarding them', () => {
    const old = data({ tombstones: { ancient: daysAgo(120), recent: daysAgo(5) } })
    const merged = mergeHousing(old, data())
    expect(merged.tombstones.ancient).toBeUndefined()
    expect(merged.tombstones.recent).toBeTruthy()
  })
})

describe('the ASP fields', () => {
  it('defaults to off with the standard figures', () => {
    const s = normalizeSituation({})
    expect(s.useAspLoan).toBe(false)
    expect(s.aspRatePct).toBe(DEFAULT_HOUSING.aspRatePct)
    expect(s.aspMaxLoan).toBe(DEFAULT_HOUSING.aspMaxLoan)
  })

  it('reads them back, cap typed the way a person types it', () => {
    const s = normalizeSituation({ useAspLoan: true, aspMaxLoan: '185 000', aspRatePct: '2,9' })
    expect(s.useAspLoan).toBe(true)
    expect(s.aspMaxLoan).toBe(185000)
    expect(s.aspRatePct).toBe(2.9)
  })

  it('treats anything but literal true as off', () => {
    // A hand-edited gist saying "yes" must not switch financing models.
    expect(normalizeSituation({ useAspLoan: 'yes' }).useAspLoan).toBe(false)
    expect(normalizeSituation({ useAspLoan: 1 }).useAspLoan).toBe(false)
  })
})
