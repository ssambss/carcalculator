// The filter shape, which is a contract with something outside this codebase.
//
// `src/scraperFilters.ts` writes it and `scraper/src/filters.js` reads it, each
// normalising without trusting the other. That means the compatibility rules are
// the interesting part: the gist is hand-edited, and a phone can hold a cached
// bundle for months, so both sides have to read shapes the other stopped
// writing. These were a throwaway script before the harness existed.

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PACKAGE_QUALIFIERS,
  mergeFilterSets,
  newScraperFilter,
  normalizeFilter,
  normalizeFilterSet,
  normalizeQualifiers,
  normalizeRanges,
  parseFilterJson,
  parseNettiautoUrl,
  toWire,
} from '../src/scraperFilters'
import { describeRanges, rangeInputs, rangeValue, withRange } from '../src/listingFields'

describe('numeric limits', () => {
  it('starts a new filter with none', () => {
    expect(newScraperFilter().ranges).toEqual({})
  })

  it('reads the range bag directly', () => {
    const f = normalizeFilter({ make: 'a', model: 'b', ranges: { year: { min: 2021, max: 2023 } } })
    expect(f.ranges.year).toEqual({ min: 2021, max: 2023 })
  })

  it('still reads the five old spellings', () => {
    // Forever, not for one release: a filter typed into the gist before the
    // range bag existed is still a filter somebody means to run.
    const f = normalizeFilter({ make: 'a', model: 'b', yearFrom: 2021, maxMileage: 120000 })
    expect(f.ranges).toEqual({
      mileage: { min: null, max: 120000 },
      year: { min: 2021, max: null },
    })
  })

  it('lets the old spelling win where the two disagree', () => {
    // Only a writer that has never heard of `ranges` sets one without the
    // other: it edits maxPrice and copies the stale range straight through, so
    // trusting the range would silently discard the edit.
    const f = normalizeFilter({
      make: 'a',
      model: 'b',
      ranges: { price: { min: null, max: 29000 } },
      maxPrice: 24000,
    })
    expect(f.ranges.price.max).toBe(24000)
  })

  it('drops a field that asks for nothing', () => {
    // An empty range must not read as a requirement - the scraper rejects any
    // listing whose facts do not mention a bounded field.
    const f = normalizeFilter({
      make: 'a',
      model: 'b',
      ranges: { year: {}, mileage: { min: null, max: null }, price: { max: 30000 } },
    })
    expect(Object.keys(f.ranges)).toEqual(['price'])
  })

  it('sorts the keys, so two devices serialize an identical set alike', () => {
    const one = normalizeFilter({ make: 'a', model: 'b', ranges: { price: { max: 1 }, mileage: { max: 2 } } })
    const two = normalizeFilter({ make: 'a', model: 'b', ranges: { mileage: { max: 2 }, price: { max: 1 } } })
    expect(JSON.stringify(one.ranges)).toBe(JSON.stringify(two.ranges))
  })

  it('passes a field nobody has declared straight through', () => {
    // The proof that none of this knows what a car is: an apartment filter
    // survives the app's normalizer untouched.
    const flat = normalizeFilter({
      make: 'helsinki',
      model: 'kamppi',
      ranges: { sizeM2: { min: 55 }, rooms: { min: 3 } },
    })
    expect(flat.ranges).toEqual({
      rooms: { min: 3, max: null },
      sizeM2: { min: 55, max: null },
    })
  })

  it('reads a hand-typed number the way a person writes one', () => {
    expect(normalizeRanges({ ranges: { price: { max: '29 000' } } }).price.max).toBe(29000)
  })
})

describe('the wire shape', () => {
  it('writes the range bag and every old spelling it can express', () => {
    // The copies exist for a reader that predates the bag - a phone on a cached
    // bundle, or the gist opened by hand. Without them such a reader sees a
    // filter with no limits at all, and could push that widened version back.
    const wire = toWire(
      normalizeFilter({ make: 'a', model: 'b', ranges: { year: { min: 2019 }, mileage: { max: 150000 } } }),
    )
    expect(wire.yearFrom).toBe(2019)
    expect(wire.yearTo).toBeNull()
    expect(wire.maxMileage).toBe(150000)
    expect(wire.minPrice).toBeNull()
    expect(wire.ranges).toEqual({
      mileage: { min: null, max: 150000 },
      year: { min: 2019, max: null },
    })
  })

  it('round-trips through the normalizer without drifting', () => {
    // The gist is read, merged and written repeatedly; drift across those passes
    // would be a slow corruption rather than a visible failure.
    const once = normalizeFilter({ make: 'a', model: 'b', maxPrice: 100 })
    expect(normalizeFilter(once)).toEqual(once)
    expect(normalizeFilter(toWire(once)).ranges).toEqual(once.ranges)
  })
})

describe('package qualifiers', () => {
  it('seeds a new filter with the two that used to be hardcoded', () => {
    // Inert unless a filter asks for a package called "pilot", so shipping them
    // is harmless - and it means a Polestar filter behaves correctly without
    // the user having to discover the feature.
    expect(newScraperFilter().packageQualifiers).toEqual(DEFAULT_PACKAGE_QUALIFIERS)
  })

  it('gives the defaults to a filter that names none', () => {
    // A filter already in the gist has never heard of the field, and must not
    // quietly start accepting the smaller pack.
    expect(normalizeQualifiers(undefined)).toEqual(DEFAULT_PACKAGE_QUALIFIERS)
    expect(normalizeQualifiers(null)).toEqual(DEFAULT_PACKAGE_QUALIFIERS)
  })

  it('honours an explicitly empty list as a statement', () => {
    expect(normalizeQualifiers([])).toEqual([])
  })

  it('cleans up what somebody typed', () => {
    expect(
      normalizeQualifiers([
        { package: '  Pilot ', word: 'LITE', means: 'lesser' },
        { package: 'pilot', word: 'lite', means: 'lesser' },
        { package: 'pilot', word: 'two words', means: 'feature' },
        { package: '', word: 'x' },
        null,
      ]),
    ).toEqual([{ package: 'pilot', word: 'lite', means: 'lesser' }])
  })
})

describe('the editor inputs', () => {
  it('generates both ends of a field, or one where only one is worth the space', () => {
    // A maximum odometer is what everyone filters on; a minimum is noise. This
    // is what made the generated form come out identical to the hand-written one.
    expect(rangeInputs().map((r) => r.label)).toEqual([
      'Year from',
      'Year to',
      'Max odometer',
      'Max price',
      'Min price',
    ])
  })

  it('reads and writes one end at a time', () => {
    let r = withRange({}, 'year', 'min', 2021)
    r = withRange(r, 'price', 'max', 29000)
    expect(rangeValue(r, 'year', 'min')).toBe(2021)
    expect(Object.keys(r)).toEqual(['price', 'year'])
  })

  it('drops a field once both its ends are cleared', () => {
    let r = withRange({}, 'year', 'min', 2021)
    r = withRange(r, 'year', 'min', null)
    expect(r).toEqual({})
  })

  it('summarises the limits for the filter list', () => {
    expect(
      describeRanges({ year: { min: 2021, max: 2023 }, mileage: { min: null, max: 120000 } }).map(
        (p) => p.replace(/\s/g, ' '),
      ),
    ).toEqual(['2021–2023', '≤ 120 000 km'])
  })
})

describe('pasting things in', () => {
  it('pulls make and model out of any nettiauto address', () => {
    expect(parseNettiautoUrl('https://www.nettiauto.com/polestar/2')).toEqual({
      make: 'polestar',
      model: '2',
    })
    // A single listing works too: the first two segments are the same either way.
    expect(parseNettiautoUrl('https://www.nettiauto.com/polestar/2/15900001')).toEqual({
      make: 'polestar',
      model: '2',
    })
  })

  it('refuses a path it does not understand', () => {
    expect(parseNettiautoUrl('https://example.com/a/b')).toBeNull()
    expect(parseNettiautoUrl('nettiauto.com/12345/x')).toBeNull()
    expect(parseNettiautoUrl('')).toBeNull()
  })

  it('accepts every shape somebody might reasonably paste', () => {
    const one = parseFilterJson('{"make":"polestar","model":"2"}')
    const many = parseFilterJson('[{"make":"a","model":"b"},{"make":"c","model":"d"}]')
    const enveloped = parseFilterJson('{"filters":[{"make":"a","model":"b"}]}')
    expect(one).toHaveLength(1)
    expect(many).toHaveLength(2)
    expect(enveloped).toHaveLength(1)
  })

  it('keeps a pasted id, so the watcher history carries on', () => {
    const [f] = parseFilterJson('{"id":"polestar2-lr-dm","make":"polestar","model":"2"}')
    expect(f.id).toBe('polestar2-lr-dm')
  })

  it('complains readably rather than throwing something internal', () => {
    expect(() => parseFilterJson('not json')).toThrow(/not valid JSON/)
    expect(() => parseFilterJson('[{"name":"no page to read"}]')).toThrow(/make and model/)
  })
})

describe('merging filters between devices', () => {
  const set = (filters: unknown[], tombstones = {}) =>
    normalizeFilterSet({ version: 1, filters, tombstones })

  it('takes the newer edit of a filter both sides have', () => {
    const merged = mergeFilterSets(
      set([{ id: 'x', make: 'a', model: 'b', createdAt: '2026-01-01', updatedAt: '2026-01-02', ranges: { price: { max: 1 } } }]),
      set([{ id: 'x', make: 'a', model: 'b', createdAt: '2026-01-01', updatedAt: '2026-01-01', ranges: { price: { max: 2 } } }]),
    )
    expect(merged.filters[0].ranges.price.max).toBe(1)
  })

  it('keeps a deleted filter deleted', () => {
    const merged = mergeFilterSets(
      set([], { x: '2026-02-01' }),
      set([{ id: 'x', make: 'a', model: 'b', createdAt: '2026-01-01', updatedAt: '2026-01-01' }]),
    )
    expect(merged.filters).toEqual([])
  })

  it('brings one back that was edited after the deletion', () => {
    const merged = mergeFilterSets(
      set([], { x: '2026-02-01' }),
      set([{ id: 'x', make: 'a', model: 'b', createdAt: '2026-01-01', updatedAt: '2026-03-01' }]),
    )
    expect(merged.filters.map((f) => f.id)).toEqual(['x'])
    expect(merged.tombstones.x).toBeUndefined()
  })
})
