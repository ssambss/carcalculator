// The mileage data's storage rules: normalising what a gist or an old device
// hands back, and merging two copies without losing a reading.
//
// The same rules as housing: the contract merges whole, readings and trips
// per item by `updatedAt`, tombstones make deletes stick, and the order is
// canonical - by day, the order the log is read in.

import { describe, expect, it } from 'vitest'

import { DEFAULT_LEASE, type OdometerReading } from '../src/mileage'
import {
  EMPTY_MILEAGE,
  mergeMileage,
  normalizeLease,
  normalizeMileage,
  normalizeReading,
  type MileageData,
} from '../src/mileageStorage'

// Merge-window rule from PLAN.md: values compared against *now* (tombstone
// TTL) must be relative; values only compared with each other must be fixed.
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

const data = (over: Partial<MileageData> = {}): MileageData => ({
  ...structuredClone(EMPTY_MILEAGE),
  ...over,
})

const r = (id: string, date: string, km: number, updatedAt = '2026-09-01T00:00:00.000Z'): OdometerReading => ({
  id,
  date,
  km,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt,
})

describe('normalising', () => {
  it('reads numbers the way a person types them', () => {
    const l = normalizeLease({ allowanceKm: '26 250', excessFeePerKm: '0,12' })
    expect(l.allowanceKm).toBe(26_250)
    expect(l.excessFeePerKm).toBe(0.12)
  })

  it('falls back field by field, and refuses what would break the maths', () => {
    const l = normalizeLease({ termMonths: 0, startDate: '2026-02-30' })
    expect(l.termMonths).toBe(1)
    expect(l.startDate).toBe('')
    expect(l.allowanceKm).toBe(DEFAULT_LEASE.allowanceKm)
  })

  it('drops a reading with no real day, and keeps one without an id', () => {
    expect(normalizeReading({ km: 45_000 })).toBeNull()
    expect(normalizeReading({ date: '14.9.2026', km: 45_000 })).toBeNull()
    const kept = normalizeReading({ date: '2026-09-14', km: '45 210' })!
    expect(kept.km).toBe(45_210)
    expect(kept.id).toBeTruthy()
    expect(kept.updatedAt).toBe(kept.createdAt)
  })

  it('an empty or foreign file is an empty log', () => {
    expect(normalizeMileage(null)).toEqual({ ...EMPTY_MILEAGE, lease: { ...DEFAULT_LEASE } })
    expect(normalizeMileage({ readings: 'nope' }).readings).toEqual([])
  })
})

describe('merging', () => {
  it('keeps the readings logged on each device, in day order', () => {
    const phone = data({ readings: [r('b', '2026-09-20', 45_600)] })
    const laptop = data({ readings: [r('a', '2026-09-13', 45_300)] })
    const merged = mergeMileage(phone, laptop)
    expect(merged.readings.map((x) => x.id)).toEqual(['a', 'b'])
    expect(mergeMileage(laptop, phone)).toEqual(merged)
  })

  it('the newer edit of a reading wins', () => {
    const older = data({ readings: [r('a', '2026-09-13', 45_300, '2026-09-13T10:00:00.000Z')] })
    const newer = data({ readings: [r('a', '2026-09-13', 45_030, '2026-09-13T11:00:00.000Z')] })
    expect(mergeMileage(older, newer).readings[0].km).toBe(45_030)
  })

  it('a delete sticks against a stale copy, and an edit after it brings the reading back', () => {
    const stale = data({ readings: [r('a', '2026-09-13', 45_300, daysAgo(5))] })
    const deleted = data({ tombstones: { a: daysAgo(2) } })
    expect(mergeMileage(stale, deleted).readings).toEqual([])
    const edited = data({ readings: [r('a', '2026-09-13', 45_300, daysAgo(1))] })
    const merged = mergeMileage(edited, deleted)
    expect(merged.readings).toHaveLength(1)
    expect(merged.tombstones).toEqual({})
  })

  it('the contract merges whole, by its own timestamp', () => {
    const a = data({
      lease: { ...DEFAULT_LEASE, startDate: '2026-01-15' },
      leaseUpdatedAt: '2026-09-02T00:00:00.000Z',
    })
    const b = data({
      lease: { ...DEFAULT_LEASE, allowanceKm: 30_000 },
      leaseUpdatedAt: '2026-09-01T00:00:00.000Z',
    })
    expect(mergeMileage(b, a).lease).toEqual(a.lease)
  })

  it('old tombstones are let go', () => {
    const merged = mergeMileage(data({ tombstones: { old: daysAgo(120), recent: daysAgo(3) } }), data())
    expect(Object.keys(merged.tombstones)).toEqual(['recent'])
  })
})
