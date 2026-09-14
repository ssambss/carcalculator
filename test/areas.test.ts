// Helsinki by area: the arithmetic behind "continuing the trend", and the
// shape of the data file the fetch script writes.
//
// As with the rest of housing, the tests pin decisions rather than sums: how a
// window shortens when its first year is unpublished, when a deviation is too
// thin to report, that the band is symmetric in ratios, that a class with a
// price but no count cannot be weighted. The reference figures are worked out
// by hand. The data file is checked for shape only - its numbers change every
// May when the script is re-run, and a test that pins them would then fail for
// the right reason at the wrong time.

import { describe, expect, it } from 'vitest'

import {
  areaSeries,
  band,
  cagr,
  citySeries,
  cumulativePct,
  describeSeries,
  findArea,
  growthOver,
  growthSince,
  indexStats,
  nominalRates,
  outlook,
  project,
  resolveProjectionYear,
  type AreaRecord,
  type Series,
} from '../src/areas'
import { HELSINKI_PRICES } from '../src/data/helsinkiPrices'

const years = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k)

/** 100 in the first year, up 2 % a year after - the flat-world series. */
const steady = (n: number, pct = 2): Series =>
  Array.from({ length: n }, (_, k) => 100 * Math.pow(1 + pct / 100, k))

describe('growth', () => {
  it('compound yearly change, and its inverse', () => {
    expect(cagr(100, 121, 2)).toBeCloseTo(10, 9)
    expect(project(100, 10, 2)).toBeCloseTo(121, 9)
  })

  it('a ten-year window runs from ten years before the latest figure', () => {
    const g = growthOver(years(2009, 2025), steady(17), 10)
    expect(g).toEqual({ pct: expect.closeTo(2, 9), fromYear: 2015, toYear: 2025, years: 10 })
  })

  it('an unpublished first year shortens the window rather than reaching further back', () => {
    const values = steady(17)
    values[6] = null // 2015
    const g = growthOver(years(2009, 2025), values, 10)
    expect(g?.fromYear).toBe(2016)
    expect(g?.years).toBe(9)
    expect(g?.pct).toBeCloseTo(2, 9)
  })

  it('under half the window, no figure is given', () => {
    // Only 2023 and 2025 published: two years is not a "ten-year" trend...
    const values: Series = years(2009, 2025).map((y) => (y === 2023 ? 100 : y === 2025 ? 110 : null))
    expect(growthOver(years(2009, 2025), values, 10)).toBeNull()
    expect(growthOver(years(2009, 2025), values, 5)).toBeNull()
    // ...but it is all the history there is, and that window says so.
    const all = growthOver(years(2009, 2025), values, 16, 2)
    expect(all).toEqual({ pct: expect.closeTo(cagr(100, 110, 2), 9), fromYear: 2023, toYear: 2025, years: 2 })
  })

  it('growth since a particular year needs that year published', () => {
    const values = steady(17)
    expect(growthSince(years(2009, 2025), values, 2015)?.years).toBe(10)
    values[6] = null
    expect(growthSince(years(2009, 2025), values, 2015)).toBeNull()
  })
})

describe('describing a series', () => {
  it('finds the peak and the fall from it', () => {
    const s = describeSeries([2020, 2021, 2022, 2023], [100, 120, 110, 90])
    expect(s.peak).toEqual({ year: 2021, value: 120 })
    expect(s.fromPeakPct).toBeCloseTo(-25, 9)
    expect(s.latest).toEqual({ year: 2023, value: 90 })
    expect(s.points).toBe(4)
  })

  it('reports a deviation only from four consecutive changes', () => {
    // ±10 % alternating: log changes ±ln 1.1 with mean 0; sample deviation is
    // ln 1.1 · √(4/3) = 11.0 %.
    const s = describeSeries(years(2020, 2024), [100, 110, 100, 110, 100])
    expect(s.volatilityPct).toBeCloseTo(Math.log(1.1) * Math.sqrt(4 / 3) * 100, 6)
    expect(describeSeries(years(2020, 2023), [100, 110, 100, 110]).volatilityPct).toBeNull()
  })

  it('a change across an unpublished year is not a yearly change', () => {
    // Five figures but a hole in the middle: only three of the four steps are
    // consecutive years, so the deviation stays unreported.
    const s = describeSeries(years(2019, 2024), [100, 110, null, 100, 110, 100])
    expect(s.points).toBe(5)
    expect(s.volatilityPct).toBeNull()
  })

  it('an empty series describes itself as nothing', () => {
    const s = describeSeries([2020, 2021], [null, null])
    expect(s.latest).toBeNull()
    expect(s.growth10).toBeNull()
  })
})

describe('the band', () => {
  it('is symmetric in ratios around the trend', () => {
    const { low, high } = band(3000, 2, 8, 3)
    expect(Math.sqrt(low * high)).toBeCloseTo(project(3000, 2, 3), 6)
    expect(high / low).toBeCloseTo(Math.exp(2 * 0.08 * Math.sqrt(3)), 9)
  })

  it('collapses onto the trend without volatility', () => {
    const { low, high } = band(3000, 2, 0, 3)
    expect(low).toBeCloseTo(project(3000, 2, 3), 9)
    expect(high).toBeCloseTo(low, 9)
  })
})

const area = (over: Partial<AreaRecord> = {}): AreaRecord => ({
  code: '00730',
  name: 'Tapanila',
  zone: 3,
  price: { studio: [1000], two: [2000], three: [3000], terraced: [3200] },
  count: { studio: [1], two: [3], three: [null], terraced: [75] },
  ...over,
})

describe('picking a series', () => {
  it('weights "all flats" by sales, leaving out a class with a price but no count', () => {
    const s = areaSeries(area(), 'flats')
    expect(s.values[0]).toBeCloseTo((1000 * 1 + 2000 * 3) / 4, 9)
    expect(s.counts[0]).toBe(4)
  })

  it('a year with no weighable class is unpublished', () => {
    const s = areaSeries(area({ count: { studio: [null], two: [0], three: [null], terraced: [1] } }), 'flats')
    expect(s.values[0]).toBeNull()
    expect(s.counts[0]).toBeNull()
  })

  it('a named class is passed through untouched', () => {
    expect(areaSeries(area(), 'terraced').values).toEqual([3200])
    expect(areaSeries(area(), 'two').counts).toEqual([3])
  })

  it('aligns the city series to the area years', () => {
    const data = {
      ...HELSINKI_PRICES,
      years: [2010, 2011],
      city: {
        years: [2009, 2010, 2011, 2012],
        price: { all: [1, 2, 3, 4], flats: [10, 20, 30, 40], terraced: [100, 200, 300, 400] },
        count: { all: [1, 1, 1, 1], flats: [1, 1, 1, 1], terraced: [1, 1, 1, 1] },
      },
    }
    expect(citySeries(data, 'two').values).toEqual([20, 30])
    expect(citySeries(data, 'terraced').values).toEqual([200, 300])
  })
})

describe('the outlook', () => {
  const ys = years(2009, 2025)
  const values = steady(17, 3)
  const city = steady(17, 1).map((v) => v / 2) // half the area's level, growing slower
  const picked = { values, counts: ys.map(() => 20) }

  it('runs from the latest figure to the purchase year, and ten and twenty years past it', () => {
    const o = outlook({ code: 'x', name: 'X', zone: 3 }, ys, picked, city, null, 2028, 2)
    const p = o.projection!
    expect(p.targetYear).toBe(2028)
    expect(p.trend?.years).toBe(10)
    expect(p.horizons.map((h) => h.year)).toEqual([2028, 2038, 2048])
    expect(p.horizons.map((h) => h.years)).toEqual([3, 13, 23])
    expect(p.horizons[0].atTrend?.value).toBeCloseTo(project(values[16]!, 3, 3), 6)
    expect(p.horizons[2].atTrend?.value).toBeCloseTo(project(values[16]!, 3, 23), 6)
    expect(p.horizons[1].atGuess).toBeCloseTo(project(values[16]!, 2, 13), 6)
    expect(o.latestCount).toBe(20)
  })

  it('continues the zone’s long run alongside, when given one', () => {
    const o = outlook({ code: 'x', name: 'X', zone: 3 }, ys, picked, city, null, 2028, 2, 2.2)
    expect(o.projection?.longRunPct).toBe(2.2)
    expect(o.projection?.horizons[2].atLongRun).toBeCloseTo(project(values[16]!, 2.2, 23), 6)
    const none = outlook({ code: 'x', name: 'X', zone: 3 }, ys, picked, city, null, 2028, 2)
    expect(none.projection?.longRunPct).toBeNull()
    expect(none.projection?.horizons[0].atLongRun).toBeNull()
  })

  it('the likely range widens with the horizon', () => {
    const wobbly = { values: ys.map((_, k) => 100 * (1 + 0.03 * k) * (k % 2 ? 1.05 : 0.95)), counts: ys.map(() => 20) }
    const o = outlook({ code: 'x', name: 'X', zone: 3 }, ys, wobbly, city, null, 2028, 2)
    const ratio = (i: number) => o.projection!.horizons[i].atTrend!.high! / o.projection!.horizons[i].atTrend!.low!
    expect(ratio(1)).toBeGreaterThan(ratio(0))
    expect(ratio(2)).toBeGreaterThan(ratio(1))
    // √t: the log-width after 23 years is √(23/3) times that after 3
    expect(Math.log(ratio(2)) / Math.log(ratio(0))).toBeCloseTo(Math.sqrt(23 / 3), 6)
  })

  it('never projects into the past: a target at or before the data means one year', () => {
    const o = outlook({ code: 'x', name: 'X', zone: 3 }, ys, picked, city, null, 2020, 2)
    expect(o.projection?.horizons[0].years).toBe(1)
    expect(o.projection?.targetYear).toBe(2026)
  })

  it('measures the area against the city in the same years', () => {
    const o = outlook({ code: 'x', name: 'X', zone: 3 }, ys, picked, city, null, 2028, 2)
    expect(o.vsCity?.nowPct).toBeCloseTo((values[16]! / city[16]! - 1) * 100, 6)
    expect(o.vsCity?.thenYear).toBe(2015)
    expect(o.vsCity?.thenPct).toBeCloseTo((values[6]! / city[6]! - 1) * 100, 6)
  })

  it('a steady series has no deviation of its own, so the band borrows the city’s', () => {
    // A perfectly steady 3 % has zero deviation - reported as 0, not null - so
    // borrow only happens when the area has too few consecutive years.
    const thin = { values: ys.map((y) => (y >= 2023 ? 100 : null)), counts: ys.map(() => 5) }
    const o = outlook({ code: 'x', name: 'X', zone: 3 }, ys, thin, city, 6, 2028, 2)
    expect(o.summary.volatilityPct).toBeNull()
    expect(o.projection?.volatilityUsedPct).toBe(6)
    expect(o.projection?.horizons[0].atTrend?.low).not.toBeNull()
  })

  it('a series that stops more than two years before the data is not continued', () => {
    // Figures to 2020 only, in data that runs to 2025: the trend is still a
    // fact about 2010-2020, but eight years of compounding from it is not.
    const stopped = { values: ys.map((y, k) => (y <= 2020 ? values[k] : null)), counts: ys.map(() => 8) }
    const o = outlook({ code: 'x', name: 'X', zone: 3 }, ys, stopped, city, null, 2028, 2)
    expect(o.projection?.stale).toBe(true)
    expect(o.projection?.trend?.toYear).toBe(2020)
    // Nothing is continued - not even the reader's guess: every line would
    // start from a figure the market left behind years ago.
    expect(o.projection?.horizons).toEqual([])
    expect(o.projection?.volatilityUsedPct).toBeNull()
    // Two years behind is still current enough: 2023 figures in 2025 data continue.
    const recent = { values: ys.map((y, k) => (y <= 2023 ? values[k] : null)), counts: ys.map(() => 8) }
    expect(outlook({ code: 'x', name: 'X', zone: 3 }, ys, recent, city, null, 2028, 2).projection?.stale).toBe(false)
  })

  it('an area with nothing published has no projection', () => {
    const o = outlook({ code: 'x', name: 'X', zone: 3 }, ys, { values: ys.map(() => null), counts: ys.map(() => null) }, city, null, 2028, 2)
    expect(o.summary.latest).toBeNull()
    expect(o.projection).toBeNull()
    expect(o.vsCity).toBeNull()
  })
})

describe('the long run', () => {
  it('finds the deepest fall, the down years and the standing against the peak', () => {
    const s = indexStats(years(2000, 2005), [100, 120, 80, 90, 130, 110])
    expect(s.worst).toEqual({ fromYear: 2001, toYear: 2002, pct: expect.closeTo(-33.333, 2) })
    expect(s.peak).toEqual({ year: 2004, value: 130 })
    expect(s.fromPeakPct).toBeCloseTo((110 / 130 - 1) * 100, 6)
    expect(s.downYears).toBe(2)
    expect(s.sinceStart).toEqual({ pct: expect.closeTo(cagr(100, 110, 5), 9), fromYear: 2000, toYear: 2005, years: 5 })
  })

  it('a series that only rose has no worst fall', () => {
    expect(indexStats(years(2000, 2002), [100, 110, 120]).worst).toBeNull()
  })
})

describe('an index rather than a price', () => {
  it('reads the same compounding as a percentage from today', () => {
    // 2 % for ten years is 1.02^10 = 1.2190 - "+21,9 %", and the same number
    // project() would put on a euro figure.
    expect(cumulativePct(2, 10)).toBeCloseTo(21.899, 3)
    expect(cumulativePct(2, 10)).toBeCloseTo(project(100, 2, 10) - 100, 9)
    // Today is 100, whatever the rate.
    expect(cumulativePct(7, 0)).toBe(0)
    // Falling prices give a negative index, not a smaller positive one.
    expect(cumulativePct(-3, 20)).toBeCloseTo(-45.621, 3)
  })
})

describe('one place, nominally', () => {
  const d = HELSINKI_PRICES

  it('gives a Helsinki address its zone index and its own trend', () => {
    // 00730 Tapanila, zone 3.
    const r = nominalRates(d, '00730')
    expect(r.area?.name).toBe('Tapanila')
    expect(r.longRunSince).toBe(d.index.years[0])
    // The zone's long run is the index's own average change since it starts -
    // computed here the long way round, from the series.
    const expected = indexStats(d.index.years, d.index.series.zone3.nominal).sinceStart?.pct
    expect(r.longRunPct).toBeCloseTo(expected!, 9)
    // Prices in Helsinki have risen over the whole index, and not by 20 % a year.
    expect(r.longRunPct).toBeGreaterThan(0)
    expect(r.longRunPct).toBeLessThan(10)
  })

  it('takes the area trend from all flats, count-weighted', () => {
    const area = findArea(d, '00730')!
    const r = nominalRates(d, '00730')
    const summary = describeSeries(d.years, areaSeries(area, 'flats').values)
    const trend = summary.growth10 ?? summary.growthAll
    expect(r.latestYear).toBe(summary.latest?.year)
    if (r.trendPct !== null) expect(r.trendPct).toBeCloseTo(trend!.pct, 9)
  })

  it('says nothing at all about an address the data has no area for', () => {
    for (const code of ['02150', '', '  ', '99999']) {
      const r = nominalRates(d, code)
      expect(r.area).toBeNull()
      expect(r.longRunPct).toBeNull()
      expect(r.trendPct).toBeNull()
      expect(r.latestYear).toBeNull()
      expect(r.stale).toBe(false)
      // The index's own start year is a fact about the data, not the address.
      expect(r.longRunSince).toBe(d.index.years[0])
    }
  })

  it('keeps the zone index but drops the trend when the area stopped trading', () => {
    // Suomenlinna (00190) is the standing example of an area that publishes a
    // handful of years at most; whichever areas are stale, the rule is the
    // same one outlook() applies - no trend to continue, index unaffected.
    const stale = d.areas
      .map((a) => nominalRates(d, a.code))
      .filter((r) => r.stale)
    for (const r of stale) {
      expect(r.trendPct).toBeNull()
      expect(r.trendYears).toBeNull()
      expect(r.longRunPct).not.toBeNull()
      // Stale means the last figure is more than two years behind the data.
      expect(d.years[d.years.length - 1] - r.latestYear!).toBeGreaterThan(2)
    }
  })

  it('never reports a trend without the window it spans', () => {
    for (const a of d.areas) {
      const r = nominalRates(d, a.code)
      expect(r.trendPct === null).toBe(r.trendYears === null)
      if (r.trendYears !== null) expect(r.trendYears).toBeGreaterThan(0)
    }
  })
})

describe('the projection year', () => {
  const now = new Date('2026-09-14T12:00:00Z')
  it('defaults to two years from now', () => {
    expect(resolveProjectionYear(0, 2025, now)).toBe(2028)
  })
  it('keeps a year the reader typed, if it is after the data', () => {
    expect(resolveProjectionYear(2030, 2025, now)).toBe(2030)
    expect(resolveProjectionYear(2020, 2025, now)).toBe(2028)
  })
  it('is never earlier than the year after the last figure', () => {
    expect(resolveProjectionYear(0, 2025, new Date('2023-01-01T00:00:00Z'))).toBe(2026)
  })
})

describe('the data file', () => {
  const d = HELSINKI_PRICES
  const contiguous = (ys: number[]) => ys.every((y, k) => k === 0 || y === ys[k - 1] + 1)

  it('covers every Helsinki postal-code area from 2009, one figure per year', () => {
    expect(d.years[0]).toBe(2009)
    expect(contiguous(d.years)).toBe(true)
    expect(d.areas.length).toBeGreaterThanOrEqual(80)
    for (const a of d.areas) {
      expect(a.code).toMatch(/^00\d{3}$/)
      expect(a.name).toBeTruthy()
      expect([1, 2, 3, 4]).toContain(a.zone)
      for (const t of ['studio', 'two', 'three', 'terraced'] as const) {
        expect(a.price[t]).toHaveLength(d.years.length)
        expect(a.count[t]).toHaveLength(d.years.length)
      }
    }
    expect(new Set(d.areas.map((a) => a.code)).size).toBe(d.areas.length)
  })

  it('has the city back to 2006 and the index back to 1988, both unbroken', () => {
    expect(d.city.years[0]).toBe(2006)
    expect(contiguous(d.city.years)).toBe(true)
    expect(d.city.years).toEqual(expect.arrayContaining(d.years))
    expect(d.index.years[0]).toBe(1988)
    expect(contiguous(d.index.years)).toBe(true)
    for (const key of ['helsinki', 'zone1', 'zone2', 'zone3', 'zone4', 'capitalRegion', 'finland'] as const) {
      expect(d.index.series[key].nominal).toHaveLength(d.index.years.length)
      expect(d.index.series[key].real).toHaveLength(d.index.years.length)
      expect(d.index.series[key].nominal[d.index.years.length - 1]).not.toBeNull()
    }
    expect(d.latest.quarter).toMatch(/^\d{4}Q[1-4]$/)
  })

  it('places the postal codes in Statistics Finland’s zones', () => {
    expect(findArea(d, '00100')?.zone).toBe(1) // Helsinki keskusta
    expect(findArea(d, '00530')?.zone).toBe(2) // Kallio
    expect(findArea(d, '00730')?.zone).toBe(3) // Tapanila
    expect(findArea(d, '00700')?.zone).toBe(4) // Malmi - "every other postal code"
    expect(findArea(d, '00730')?.name).toBe('Tapanila')
    expect(findArea(d, '')).toBeNull()
    expect(findArea(d, '02100')).toBeNull()
  })
})
