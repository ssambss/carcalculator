// Reading a trend: the checks that say how much of an area's figure to believe.
// Synthetic series built so each check has one thing to find - a dip in the
// start year, a thin sample, a single year out of step with the city - and
// hand-worked references, as elsewhere in housing.

import { describe, expect, it } from 'vitest'

import { cagr, growthBetween, readTrend, type Series } from '../src/areas'

const years = Array.from({ length: 17 }, (_, k) => 2009 + k) // 2009..2025
const steady = (pct: number, start = 100): Series => years.map((_, k) => start * Math.pow(1 + pct / 100, k))
const counts = (n: number): Series => years.map(() => n)

describe('growth between two years', () => {
  it('needs both years published, in order', () => {
    const v = steady(2)
    expect(growthBetween(years, v, 2015, 2025)?.pct).toBeCloseTo(2, 9)
    expect(growthBetween(years, v, 2025, 2015)).toBeNull()
    const gap = [...v]
    gap[6] = null
    expect(growthBetween(years, gap, 2015, 2025)).toBeNull()
    expect(growthBetween(years, v, 2000, 2025)).toBeNull()
  })
})

describe('reading a trend', () => {
  const city = steady(1, 3000)

  it('a steady series is steady whichever year you start from, and moves with the city', () => {
    const r = readTrend(years, steady(1, 2500), counts(60), city, null)!
    expect(r.windows.low).toBeCloseTo(r.windows.high, 6)
    expect(r.windows.fragile).toBe(false)
    expect(r.sample).toEqual({ median: 60, min: 60, thin: false })
    expect(r.excessPct).toBeCloseTo(0, 6)
    expect(r.divergences).toEqual([])
    expect(r.divergenceShare).toBeNull()
  })

  it('a dip in the start year makes the trend fragile', () => {
    // 2 %/yr, except 2015 sits 15 % under its line: the ten-year figure
    // borrows a recovery that never happened to the homes.
    const v = steady(2, 2500)
    v[6] = v[6]! * 0.85
    const r = readTrend(years, v, counts(60), city, null)!
    expect(r.trend.fromYear).toBe(2015)
    expect(r.trend.pct).toBeGreaterThan(3.5)
    // starting a year later (or earlier) reads the true 2 %; ending a year
    // earlier spreads the same dip over nine years and reads higher still
    expect(r.windows.low).toBeCloseTo(2, 6)
    expect(r.windows.high).toBeCloseTo((1.02 * Math.pow(1 / 0.85, 1 / 9) - 1) * 100, 6)
    expect(r.windows.fragile).toBe(true)
  })

  it('a handful of sales a year is a thin sample', () => {
    const c: Series = years.map((y) => (y === 2020 ? 4 : 12))
    const r = readTrend(years, steady(1, 2500), c, city, null)!
    expect(r.sample).toEqual({ median: 12, min: 4, thin: true })
  })

  it('a gap to the city that arrives in one year is named, with its share', () => {
    // The area tracks the city exactly, then jumps 25 % in 2023 while the
    // city does 1 %: that one year is the whole excess.
    const v = years.map((y, k) => city[k]! * (y >= 2023 ? 1.25 : 1))
    const r = readTrend(years, v, counts(60), city, null)!
    expect(r.divergences).toHaveLength(1)
    expect(r.divergences[0].year).toBe(2023)
    expect(r.divergences[0].areaPct).toBeCloseTo((1.25 * 1.01 - 1) * 100, 6)
    expect(r.divergences[0].cityPct).toBeCloseTo(1, 6)
    expect(r.divergences[0].aligned).toBe(true)
    expect(r.divergenceShare).toBeCloseTo(1, 6)
    // rates compound, so the excess is not simply the 25 % spread over ten years
    expect(r.excessPct).toBeCloseTo((1.01 * Math.pow(1.25, 0.1) - 1) * 100 - 1, 6)
    expect(r.excessPct).toBeGreaterThan(cagr(1, 1.25, 10))
  })

  it('a year out of step the other way does not count towards the gap', () => {
    // Up 25 % in 2020, back down 20 % in 2021 - two big moves that net to
    // nothing against the city, so the shared gap is not theirs to explain.
    const v = years.map((y, k) => city[k]! * (y === 2020 ? 1.25 : 1))
    const r = readTrend(years, v, counts(60), city, null)!
    expect(r.divergences.map((d) => d.year).sort()).toEqual([2020, 2021])
    expect(Math.abs(r.excessPct!)).toBeLessThan(1e-6)
    expect(r.divergences.every((d) => !d.aligned)).toBe(true)
    expect(r.divergenceShare).toBeNull()
  })

  it('a year that cut against the gap is listed but does not explain it', () => {
    // Up 30 % against the city in 2023 - the whole gap and more - after a
    // 12 % drop against it in 2018 that was never made back separately.
    const v = years.map((y, k) => city[k]! * (y >= 2023 ? 1.3 : 1) * (y >= 2018 ? 0.88 : 1))
    const r = readTrend(years, v, counts(60), city, null)!
    const byYear = Object.fromEntries(r.divergences.map((d) => [d.year, d.aligned]))
    expect(byYear).toEqual({ 2023: true, 2018: false })
    // 2023 alone is more than the whole gap (1.3 · 0.88 = 1.144), so its share caps at one.
    expect(r.divergenceShare).toBeCloseTo(1, 6)
  })

  it('measures the area against its zone’s index over the same years, on the index’s own axis', () => {
    const indexYears = Array.from({ length: 38 }, (_, k) => 1988 + k)
    const zone = { years: indexYears, values: indexYears.map((_, k) => 100 * Math.pow(1.03, k)) }
    const r = readTrend(years, steady(1, 2500), counts(60), city, zone)!
    expect(r.zone?.fromYear).toBe(2015)
    expect(r.zone?.pct).toBeCloseTo(3, 6)
    expect(r.zoneExcessPct).toBeCloseTo(-2, 6)
  })

  it('reports both sides against their own peaks', () => {
    const v = steady(1, 2500)
    v[16] = v[16]! * 0.8 // the last year drops a fifth off where its 1 % step would have put it
    const r = readTrend(years, v, counts(60), city, null)!
    expect(r.fromPeak.areaPeakYear).toBe(2024)
    expect(r.fromPeak.area).toBeCloseTo((0.8 * 1.01 - 1) * 100, 6)
    expect(r.fromPeak.city).toBeCloseTo(0, 6)
    expect(r.fromPeak.cityPeakYear).toBe(2025)
  })

  it('has nothing to read without a trend', () => {
    expect(readTrend(years, years.map(() => null), counts(1), city, null)).toBeNull()
  })
})
