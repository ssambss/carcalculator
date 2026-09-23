// The lease mileage: the straight line, the readings against it, and the
// week / month / year cuts.
//
// Most cases use a contract built to make the line a round number - a year
// from 1.1.2026 allowing 36 500 km, exactly 100 km a day - so every reference
// figure can be worked by hand. The one real contract (21 months, 26 250 km)
// is checked where its calendar matters: the number of days, and the short
// second year.

import { describe, expect, it } from 'vitest'

import {
  MIN_PACE_DAYS,
  addMonths,
  dayOf,
  drivenAt,
  isoOf,
  isoWeek,
  leaseSpan,
  mileageStatus,
  mondayOf,
  odometerOnTheLine,
  periods,
  projectionPoints,
  timeline,
  todayIso,
  valueOn,
  type MileageLease,
  type OdometerReading,
  type PlannedTrip,
} from '../src/mileage'

const lease = (over: Partial<MileageLease> = {}): MileageLease => ({
  startDate: '2026-01-01',
  termMonths: 12,
  allowanceKm: 36_500,
  startOdometerKm: 10_000,
  excessFeePerKm: 0.1,
  ...over,
})

const reading = (id: string, date: string, km: number): OdometerReading => ({
  id,
  date,
  km,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const trip = (id: string, date: string, km: number): PlannedTrip => ({
  id,
  name: id,
  date,
  km,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const start = dayOf('2026-01-01')!

// Over the line after January, back under it by the end of February.
const readings = [reading('jan', '2026-01-31', 13_600), reading('feb', '2026-02-28', 15_500)]

describe('days', () => {
  it('reads a date, and refuses one that does not exist', () => {
    expect(isoOf(dayOf('2026-09-23')!)).toBe('2026-09-23')
    expect(dayOf('2026-02-30')).toBeNull()
    expect(dayOf('23.9.2026')).toBeNull()
    expect(dayOf('')).toBeNull()
  })

  it('adds months the way a contract does, clamped to the month end', () => {
    expect(isoOf(addMonths(dayOf('2026-01-15')!, 21))).toBe('2027-10-15')
    expect(isoOf(addMonths(dayOf('2026-01-31')!, 1))).toBe('2026-02-28')
  })

  it('weeks start on Monday and are numbered the ISO way', () => {
    // 23.9.2026 is a Wednesday in week 39; 1.1.2027 is a Friday in 2026's week 53.
    expect(isoOf(mondayOf(dayOf('2026-09-23')!))).toBe('2026-09-21')
    expect(isoWeek(dayOf('2026-09-23')!)).toBe(39)
    expect(isoWeek(dayOf('2027-01-01')!)).toBe(53)
    expect(isoWeek(dayOf('2027-01-04')!)).toBe(1)
  })

  it('today is the local calendar day', () => {
    expect(todayIso(new Date(2026, 8, 3, 23, 30))).toBe('2026-09-03')
  })
})

describe('the lease', () => {
  it('the real contract: 21 months from 15.1. is 638 days, 15 000 km a year', () => {
    const span = leaseSpan(lease({ startDate: '2026-01-15', termMonths: 21, allowanceKm: 26_250 }))!
    expect(span.days).toBe(638)
    expect(isoOf(span.end)).toBe('2027-10-15')
    expect(span.perDay * 638).toBeCloseTo(26_250, 9)
  })

  it('has no span until it has a start', () => {
    expect(leaseSpan(lease({ startDate: '' }))).toBeNull()
    expect(mileageStatus(lease({ startDate: '' }), readings, [])).toBeNull()
  })
})

describe('readings', () => {
  it('become a line of km since hand-over, a reading at the end of its day', () => {
    const line = timeline(lease(), readings)!
    expect(line.points).toEqual([
      { t: start, km: 0 },
      { t: start + 31, km: 3_600 },
      { t: start + 59, km: 5_500 },
    ])
    // Halfway between the two readings, halfway between their km.
    expect(drivenAt(line.points, start + 45)).toBeCloseTo(4_550, 9)
    expect(drivenAt(line.points, start + 60)).toBeNull()
  })

  it('a reading lower than an earlier one is left out and flagged', () => {
    const typo = reading('typo', '2026-02-10', 1_450)
    const line = timeline(lease(), [...readings, typo])!
    expect(line.flags.get('typo')).toBe('lower')
    expect(line.points).toHaveLength(3)
  })

  it('outside the contract is flagged; on the return day it still counts', () => {
    const line = timeline(lease(), [
      reading('early', '2025-12-31', 9_990),
      reading('late', '2027-01-02', 50_000),
      reading('return', '2027-01-01', 46_000),
    ])!
    expect(line.flags.get('early')).toBe('before-start')
    expect(line.flags.get('late')).toBe('after-end')
    expect(line.points.at(-1)).toEqual({ t: start + 365, km: 36_000 })
  })

  it('two on one day: the higher one', () => {
    const line = timeline(lease(), [
      reading('am', '2026-01-10', 10_950),
      reading('pm', '2026-01-10', 11_200),
    ])!
    expect(line.points).toEqual([
      { t: start, km: 0 },
      { t: start + 10, km: 1_200 },
    ])
    expect(line.flags.size).toBe(0)
  })
})

describe('where you stand', () => {
  const trips = [trip('behind', '2026-02-20', 800), trip('midsummer', '2026-06-19', 2_000)]
  const s = mileageStatus(lease(), readings, trips)!

  it('measures to the last reading', () => {
    expect(s.asOf).toBe(start + 59)
    expect(s.driven).toBe(5_500)
    expect(s.allowedSoFar).toBeCloseTo(5_900, 9)
    expect(s.balance).toBeCloseTo(400, 9)
    expect(s.remaining).toBe(31_000)
    expect(s.daysLeft).toBe(306)
  })

  it('sets aside only the trips still ahead', () => {
    expect(s.upcoming.map((t) => t.id)).toEqual(['midsummer'])
    expect(s.plannedKm).toBe(2_000)
    // (31 000 − 2 000) over 306 days
    expect(s.budgetPerDay).toBeCloseTo(29_000 / 306, 9)
  })

  it('a trip on the day after the last reading is still ahead', () => {
    const next = mileageStatus(lease(), readings, [trip('march', '2026-03-01', 500)])!
    expect(next.plannedKm).toBe(500)
  })

  it('takes the listed trips already driven out of the everyday pace', () => {
    // 5 500 driven, 800 of it the trip on 20.2.
    expect(s.pastTripsKm).toBe(800)
    expect(s.pacePerDay).toBeCloseTo(4_700 / 59, 9)
    // a trip listed that never happened cannot make the pace negative
    const phantom = mileageStatus(lease(), readings, [trip('never', '2026-02-01', 9_000)])!
    expect(phantom.pacePerDay).toBe(0)
  })

  it('projects at the everyday pace with the trips on top, and agrees with the budget', () => {
    expect(s.projected).toBeCloseTo(5_500 + (4_700 / 59) * 306 + 2_000, 9)
    // over exactly when the pace beats the budget - here it does not
    expect(s.projectedOver).toBeCloseTo(306 * (s.pacePerDay! - s.budgetPerDay!), 9)
    expect(s.projectedOver!).toBeLessThan(0)
  })

  it('has no pace from too few days', () => {
    const early = mileageStatus(lease(), [reading('a', '2026-01-05', 10_600)], [])!
    expect(early.asOf - start).toBeLessThan(MIN_PACE_DAYS)
    expect(early.pacePerDay).toBeNull()
    expect(early.projected).toBeNull()
  })

  it('the last four weeks, once there are eight to compare them with', () => {
    // February: 1 900 driven, the 800 km trip on 20.2. taken out
    expect(s.recentPerDay).toBeCloseTo(1_100 / 28, 9)
    const short = mileageStatus(lease(), [reading('jan', '2026-01-31', 13_600)], [])!
    expect(short.recentPerDay).toBeNull()
    // One reading half a year in: nothing near four weeks back to measure from.
    const lone = mileageStatus(lease(), [reading('jul', '2026-07-01', 28_000)], [])!
    expect(lone.pacePerDay).not.toBeNull()
    expect(lone.recentPerDay).toBeNull()
  })

  it('with no readings, stands at the hand-over', () => {
    const none = mileageStatus(lease(), [], [])!
    expect(none.hasReadings).toBe(false)
    expect(none.driven).toBe(0)
    expect(none.daysLeft).toBe(365)
    expect(none.budgetPerDay).toBeCloseTo(100, 9)
  })

  it('once the car is back, there is no budget left to spread', () => {
    const done = mileageStatus(lease(), [reading('return', '2027-01-01', 46_000)], [])!
    expect(done.daysLeft).toBe(0)
    expect(done.budgetPerDay).toBeNull()
  })

  it('the odometer that would be on the line, at the end of a day', () => {
    const l = lease()
    expect(odometerOnTheLine(l, start)).toBeCloseTo(10_100, 9)
    expect(odometerOnTheLine(l, start - 10)).toBe(10_000)
    expect(odometerOnTheLine(l, start + 400)).toBeCloseTo(46_500, 9)
  })
})

describe('the projection line', () => {
  const s = mileageStatus(lease(), readings, [trip('midsummer', '2026-06-19', 2_000)])!
  const pts = projectionPoints(s)
  const tripDay = dayOf('2026-06-19')!

  it('ends at the projected figure', () => {
    expect(pts[0]).toEqual({ t: s.asOf, km: 5_500 })
    expect(pts.at(-1)!.km).toBeCloseTo(s.projected!, 9)
  })

  it('steps up on the trip day, and reads the top of the step', () => {
    const before = 5_500 + s.pacePerDay! * (tripDay - s.asOf)
    expect(valueOn(pts, tripDay - 1)).toBeCloseTo(before - s.pacePerDay!, 9)
    expect(valueOn(pts, tripDay)).toBeCloseTo(before + 2_000, 9)
  })
})

describe('periods', () => {
  it('months: calendar months, the allowance adding up to the contract', () => {
    const rows = periods('month', lease(), readings, [trip('midsummer', '2026-06-19', 2_000)])
    expect(rows).toHaveLength(12)
    expect(rows.reduce((sum, r) => sum + r.allowance, 0)).toBeCloseTo(36_500, 9)
    const [jan, feb, mar] = rows
    expect(jan).toMatchObject({ allowance: 3_100, driven: 3_600, measuredDays: 31 })
    expect(jan.diff).toBeCloseTo(-500, 9)
    expect(jan.balance).toBeCloseTo(-500, 9)
    expect(feb.driven).toBeCloseTo(1_900, 9)
    expect(feb.diff).toBeCloseTo(900, 9)
    expect(feb.balance).toBeCloseTo(400, 9)
    // The readings stop on the last day of February: March is all ahead.
    expect(mar).toMatchObject({ driven: null, diff: null, balance: null, measuredDays: 0 })
    expect(rows[5].planned).toBe(2_000)
  })

  it('weeks: Monday to Sunday, the first cut short at the hand-over', () => {
    const rows = periods('week', lease(), readings, [])
    // 1.1.2026 is a Thursday: its week began on Monday 29.12.2025.
    expect(isoOf(rows[0].periodStart)).toBe('2025-12-29')
    expect(rows[0].from).toBe(start)
    expect(rows[0].allowance).toBeCloseTo(400, 9)
    expect(rows.reduce((sum, r) => sum + r.allowance, 0)).toBeCloseTo(36_500, 9)
  })

  it('a week the readings stop inside is compared for its measured days', () => {
    const rows = periods('week', lease(), readings, [])
    // Mon 23.2. – Sun 1.3.: measured to the end of 28.2., six days of seven.
    const week = rows.find((r) => isoOf(r.periodStart) === '2026-02-23')!
    expect(week.measuredDays).toBe(6)
    const drivenBy23Feb = 3_600 + (1_900 * 22) / 28
    expect(week.driven).toBeCloseTo(5_500 - drivenBy23Feb, 9)
    expect(week.diff).toBeCloseTo(600 - (5_500 - drivenBy23Feb), 9)
  })

  it('years: from the hand-over, the last one short', () => {
    const real = lease({ startDate: '2026-01-15', termMonths: 21, allowanceKm: 26_250 })
    const rows = periods('year', real, [], [])
    expect(rows).toHaveLength(2)
    expect(rows[0].to - rows[0].from).toBe(365)
    expect(rows[1].to - rows[1].from).toBe(273)
    expect(rows[0].allowance + rows[1].allowance).toBeCloseTo(26_250, 9)
  })
})
