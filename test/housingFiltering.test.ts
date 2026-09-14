// Narrowing the housing list down - the same discipline as the car filters,
// with the decisions that differ pinned rather than the string matching:
// that "within reach" is asked of the ceiling and not of the listing, that a
// zone can be picked whole, and that an area selection which no longer names
// anything falls back to everything instead of blanking the view.

import { describe, expect, it } from 'vitest'

import {
  ALL_AREAS,
  NO_AREA,
  NO_PROPERTY_FILTERS,
  areaFilterExists,
  areaOf,
  isPropertyFilterActive,
  listPropertyAreas,
  matchesPropertyFilters,
  type PropertyFilters,
} from '../src/housingFiltering'
import type { PropertyListing } from '../src/housing'

const place = (over: Partial<PropertyListing> = {}): PropertyListing => ({
  id: 'p1',
  name: 'Kamppi 58 m²',
  notes: '',
  favorite: false,
  price: 249000,
  sizeM2: 58,
  postalCode: '',
  homeType: '',
  rooms: 0,
  maintenancePerMonth: 245,
  financingChargePerMonth: 0,
  otherPerMonth: 20,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const filters = (over: Partial<PropertyFilters> = {}): PropertyFilters => ({
  ...NO_PROPERTY_FILTERS,
  ...over,
})

const none = new Set<string>()
/** the common case: no filter here cares about the ceiling, so say it fits */
const matches = (p: PropertyListing, f: PropertyFilters, selected = none, fits = true) =>
  matchesPropertyFilters(p, f, selected, fits)

// 00180 Kamppi - Ruoholahti is zone 1, 00730 Tapanila zone 3, 00940 Kontula zone 4.
const kamppi = place({ id: 'k', name: 'Kamppi 2h', postalCode: '00180' })
const tapanila = place({ id: 't', name: 'Tapanila house', postalCode: '00730' })
const kontula = place({ id: 'c', name: 'Kontula 3h', postalCode: '00940' })
const espoo = place({ id: 'e', name: 'Espoo flat', postalCode: '02150' })

describe('no filters', () => {
  it('is not active, and lets everything through', () => {
    expect(isPropertyFilterActive(NO_PROPERTY_FILTERS)).toBe(false)
    for (const p of [kamppi, tapanila, espoo, place()]) {
      expect(matches(p, NO_PROPERTY_FILTERS)).toBe(true)
    }
  })

  it('counts any single filter as active', () => {
    expect(isPropertyFilterActive(filters({ query: 'kamppi' }))).toBe(true)
    expect(isPropertyFilterActive(filters({ area: 'zone:3' }))).toBe(true)
    expect(isPropertyFilterActive(filters({ reach: ['fits'] }))).toBe(true)
    expect(isPropertyFilterActive(filters({ favoritesOnly: true }))).toBe(true)
    expect(isPropertyFilterActive(filters({ selectedOnly: true }))).toBe(true)
    // Whitespace is not a search - a stray space should not put the bar into
    // "1 of 4 places" mode.
    expect(isPropertyFilterActive(filters({ query: '   ' }))).toBe(false)
  })
})

describe('the search', () => {
  it('reads the name, the notes, the postal code and the area name', () => {
    const p = place({ name: 'Tapanila', notes: 'viewing on Tuesday', postalCode: '00730' })
    for (const q of ['tapanil', 'tuesday', '0073', 'TAPANILA']) {
      expect(matches(p, filters({ query: q }))).toBe(true)
    }
    expect(matches(p, filters({ query: 'kontula' }))).toBe(false)
  })

  it('finds a place by the area name it never typed', () => {
    // The listing says "Kamppi 2h"; the data knows 00180 is Ruoholahti too.
    expect(matches(kamppi, filters({ query: 'ruoholahti' }))).toBe(true)
  })
})

describe('the area filter', () => {
  it('offers the zones of the places actually listed, each openable whole', () => {
    const groups = listPropertyAreas([kamppi, tapanila, kontula])
    expect(groups.map((g) => g.zone)).toEqual([1, 3, 4])
    expect(groups[0].options[0].value).toBe('zone:1')
    expect(groups[0].options[1].value).toBe('code:00180')
    // Zone 2 holds no listed place, so it is not on offer at all.
    expect(groups.some((g) => g.zone === 2)).toBe(false)
  })

  it('groups the places the price data has no area for, and only then', () => {
    expect(listPropertyAreas([kamppi]).some((g) => g.zone === null)).toBe(false)
    const groups = listPropertyAreas([kamppi, espoo, place()])
    const unplaced = groups.find((g) => g.zone === null)
    expect(unplaced?.options[0].value).toBe(NO_AREA)
    // Both the Espoo code and the blank one: neither resolves to a Helsinki area.
    expect(unplaced?.options[0].label).toContain('(2)')
  })

  it('lists an area once however many places are in it', () => {
    const groups = listPropertyAreas([kamppi, place({ id: 'k2', postalCode: '00180' })])
    expect(groups[0].options).toHaveLength(2)
  })

  it('matches one area by its code', () => {
    const f = filters({ area: 'code:00730' })
    expect(matches(tapanila, f)).toBe(true)
    expect(matches(kamppi, f)).toBe(false)
    expect(matches(espoo, f)).toBe(false)
  })

  it('matches a whole price zone', () => {
    const f = filters({ area: 'zone:3' })
    expect(matches(tapanila, f)).toBe(true)
    // 00940 is zone 4 and 00180 zone 1 - a zone is not a prefix of the code.
    expect(matches(kontula, f)).toBe(false)
    expect(matches(kamppi, f)).toBe(false)
  })

  it('matches the places outside the data', () => {
    const f = filters({ area: NO_AREA })
    expect(matches(espoo, f)).toBe(true)
    expect(matches(place(), f)).toBe(true)
    expect(matches(tapanila, f)).toBe(false)
  })

  it('knows when a selection no longer names anything', () => {
    const groups = listPropertyAreas([kamppi])
    expect(areaFilterExists(groups, ALL_AREAS)).toBe(true)
    expect(areaFilterExists(groups, 'code:00180')).toBe(true)
    expect(areaFilterExists(groups, 'zone:1')).toBe(true)
    // Tapanila's place has been deleted: the view must not go blank for good.
    expect(areaFilterExists(groups, 'code:00730')).toBe(false)
    expect(areaFilterExists([], 'zone:3')).toBe(false)
  })
})

describe('the ceiling chips', () => {
  it('take reach from the ceiling, not from the listing', () => {
    // The same flat, twice: only the ceiling moved between the two calls.
    expect(matchesPropertyFilters(kamppi, filters({ reach: ['fits'] }), none, true)).toBe(true)
    expect(matchesPropertyFilters(kamppi, filters({ reach: ['fits'] }), none, false)).toBe(false)
    expect(matchesPropertyFilters(kamppi, filters({ reach: ['over'] }), none, false)).toBe(true)
  })

  it('constrains nothing when both are picked', () => {
    const f = filters({ reach: ['fits', 'over'] })
    expect(matchesPropertyFilters(kamppi, f, none, true)).toBe(true)
    expect(matchesPropertyFilters(kamppi, f, none, false)).toBe(true)
  })
})

describe('favorites and the compare selection', () => {
  it('keeps only favorites', () => {
    expect(matches(place({ favorite: true }), filters({ favoritesOnly: true }))).toBe(true)
    expect(matches(place({ favorite: false }), filters({ favoritesOnly: true }))).toBe(false)
  })

  it('keeps only what this device picked', () => {
    const f = filters({ selectedOnly: true })
    expect(matches(kamppi, f, new Set(['k']))).toBe(true)
    expect(matches(tapanila, f, new Set(['k']))).toBe(false)
  })
})

describe('the filters together', () => {
  it('all have to hold', () => {
    // "2h" is in the name and nowhere else, so only the name can satisfy it -
    // the area name would otherwise answer a query like "kamppi" on its own.
    const f = filters({ query: '2h', area: 'zone:1', favoritesOnly: true, reach: ['fits'] })
    const fav = { ...kamppi, favorite: true }
    expect(matchesPropertyFilters(fav, f, none, true)).toBe(true)
    // One at a time, each on its own would have excluded it.
    expect(matchesPropertyFilters(kamppi, f, none, true)).toBe(false)
    expect(matchesPropertyFilters(fav, f, none, false)).toBe(false)
    expect(matchesPropertyFilters({ ...fav, name: 'Kamppi 3h' }, f, none, true)).toBe(false)
    expect(matchesPropertyFilters({ ...fav, postalCode: '00730' }, f, none, true)).toBe(false)
  })
})

describe('the area lookup', () => {
  it('resolves a Helsinki code and nothing else', () => {
    expect(areaOf(tapanila)?.name).toBe('Tapanila')
    expect(areaOf(tapanila)?.zone).toBe(3)
    expect(areaOf(espoo)).toBeNull()
    expect(areaOf(place())).toBeNull()
  })
})
