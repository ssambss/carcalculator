// The saving plan's storage rules: normalising what a gist or an old device
// hands back, and merging two copies without losing a balance.
//
// The same rules as mileage: the plan merges whole, check-ins per item by
// `updatedAt`, tombstones make deletes stick, and the order is canonical -
// by day, the order the log is read in.

import { describe, expect, it } from 'vitest'

import { DEFAULT_PLAN, type SavingReading } from '../src/saving'
import {
  EMPTY_SAVING,
  mergeSaving,
  newSavingReading,
  normalizePlan,
  normalizeSaving,
  normalizeSavingReading,
  type SavingData,
} from '../src/savingStorage'

// Merge-window rule from PLAN.md: values compared against *now* (tombstone
// TTL) must be relative; values only compared with each other must be fixed.
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

const data = (over: Partial<SavingData> = {}): SavingData => ({
  ...structuredClone(EMPTY_SAVING),
  ...over,
})

const r = (
  id: string,
  date: string,
  amount: number,
  updatedAt = '2026-09-01T00:00:00.000Z',
): SavingReading => ({
  id,
  date,
  saver: 'self',
  amount,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt,
})

describe('normalising', () => {
  it('reads numbers the way a person types them', () => {
    const p = normalizePlan({ monthlyDeposit: '700', interestPct: '1,5', goalPrice: '329 000' })
    expect(p.monthlyDeposit).toBe(700)
    expect(p.interestPct).toBe(1.5)
    expect(p.goalPrice).toBe(329_000)
  })

  it('falls back field by field, and refuses what would break the maths', () => {
    const p = normalizePlan({
      targetDate: '2028-02-30',
      monthlyDeposit: -50,
      interestPct: -1,
      goalHomeType: 'castle',
      aspFirstMonth: '2026-13',
      partnerAspFirstMonth: '2026-8',
    })
    expect(p.targetDate).toBe('')
    expect(p.monthlyDeposit).toBe(0)
    expect(p.interestPct).toBe(0)
    expect(p.goalHomeType).toBe('')
    expect(p.aspFirstMonth).toBe('')
    expect(p.partnerAspFirstMonth).toBe('')
    expect(p.bonusPct).toBe(DEFAULT_PLAN.bonusPct)
  })

  it('keeps a real month and a real day', () => {
    const p = normalizePlan({ targetDate: '2028-06-01', aspFirstMonth: '2026-08' })
    expect(p.targetDate).toBe('2028-06-01')
    expect(p.aspFirstMonth).toBe('2026-08')
  })

  it('drops a balance with no real day, and reads one without a saver as yours', () => {
    expect(normalizeSavingReading({ amount: 2400 })).toBeNull()
    expect(normalizeSavingReading({ date: '30.9.2026', amount: 2400 })).toBeNull()
    const kept = normalizeSavingReading({ date: '2026-09-30', amount: '2 400,50' })!
    expect(kept.amount).toBe(2400.5)
    expect(kept.saver).toBe('self')
    expect(kept.id).toBeTruthy()
    expect(kept.updatedAt).toBe(kept.createdAt)
    expect(normalizeSavingReading({ date: '2026-09-30', saver: 'partner' })!.saver).toBe('partner')
  })

  it('an empty or foreign file is an empty plan', () => {
    expect(normalizeSaving(null)).toEqual({ ...EMPTY_SAVING, plan: { ...DEFAULT_PLAN } })
    expect(normalizeSaving({ readings: 'nope' }).readings).toEqual([])
  })

  it('reads back what it writes', () => {
    const d = data({
      plan: { ...DEFAULT_PLAN, targetDate: '2028-06-01', monthlyDeposit: 700 },
      planUpdatedAt: '2026-09-30T10:00:00.000Z',
      readings: [newSavingReading('2026-09-30', 'partner', 1000)],
    })
    expect(normalizeSaving(JSON.parse(JSON.stringify(d)))).toEqual(d)
  })
})

describe('merging', () => {
  it('keeps the balances logged on each device, in day order', () => {
    const phone = data({ readings: [r('b', '2026-10-30', 2400)] })
    const laptop = data({ readings: [r('a', '2026-09-30', 1700)] })
    const merged = mergeSaving(phone, laptop)
    expect(merged.readings.map((x) => x.id)).toEqual(['a', 'b'])
    expect(mergeSaving(laptop, phone)).toEqual(merged)
  })

  it('the newer edit of a balance wins', () => {
    const older = data({ readings: [r('a', '2026-09-30', 1700, '2026-09-30T10:00:00.000Z')] })
    const newer = data({ readings: [r('a', '2026-09-30', 1070, '2026-09-30T11:00:00.000Z')] })
    expect(mergeSaving(older, newer).readings[0].amount).toBe(1070)
  })

  it('a delete beats a stale copy, and an edit after it brings the balance back', () => {
    const deleted = data({ tombstones: { a: daysAgo(1) } })
    const stale = data({ readings: [r('a', '2026-09-30', 1700, daysAgo(2))] })
    expect(mergeSaving(stale, deleted).readings).toEqual([])
    const edited = data({ readings: [r('a', '2026-09-30', 1700, daysAgo(0))] })
    const back = mergeSaving(edited, deleted)
    expect(back.readings).toHaveLength(1)
    expect(back.tombstones).toEqual({})
  })

  it('forgets tombstones after ninety days', () => {
    const merged = mergeSaving(data({ tombstones: { old: daysAgo(91), new: daysAgo(1) } }), data())
    expect(Object.keys(merged.tombstones)).toEqual(['new'])
  })

  it('the plan merges whole, the newer edit winning', () => {
    const a = data({
      plan: { ...DEFAULT_PLAN, monthlyDeposit: 600, targetDate: '2028-06-01' },
      planUpdatedAt: '2026-09-07T10:00:00.000Z',
    })
    const b = data({
      plan: { ...DEFAULT_PLAN, monthlyDeposit: 700 },
      planUpdatedAt: '2026-09-21T10:00:00.000Z',
    })
    expect(mergeSaving(a, b).plan).toEqual(b.plan)
    expect(mergeSaving(b, a).plan).toEqual(b.plan)
    expect(mergeSaving(a, b).planUpdatedAt).toBe(b.planUpdatedAt)
  })
})
