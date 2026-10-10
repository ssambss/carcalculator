// The market check: an asking price against similar listings, for their age
// and mileage. These pin what "similar" means, that the fit finds the price a
// market actually asks, and when the check stays quiet rather than guess.

import { describe, expect, it } from 'vitest'

import {
  MIN_SIMILAR,
  ageAt,
  checkPrice,
  driveOf,
  fuelOf,
  listingRefOf,
  recordFor,
  type MarketIndex,
  type MarketListing,
  type MarketRecord,
} from '../src/market'
import { newCar, yearFromName } from '../src/storage'
import type { CarListing } from '../src/types'

const TODAY = new Date('2026-10-10T12:00:00Z')

/** What this pretend market asks: 55 000 € new, -12 % a year, -4 % per 10 000 km. */
const truth = (year: number, km: number, day = '2026-10-10') =>
  55000 * Math.exp(-0.12 * ageAt(year, day) - 0.04 * (km / 10000))

let seed = 7
/** Deterministic noise, about ±4 %. */
const noise = () => {
  seed = (seed * 16807) % 2147483647
  return 1 + ((seed / 2147483647) * 2 - 1) * 0.04
}

function listing(over: Partial<MarketListing> & { year: number; mileage: number }): MarketListing {
  const last = over.last ?? '2026-10-09'
  return {
    title: '78 kWh, Long Range Dual Motor',
    fuel: null,
    drive: null,
    battery: null,
    seller: 'Dealer Oy',
    vin: null,
    first: '2026-09-01',
    last,
    prices: [[last, Math.round(truth(over.year, over.mileage, last) * noise())]],
    ...over,
  }
}

function record(listings: Record<string, MarketListing>, completeAt: string | null = '2026-10-09T08:00:00Z'): MarketRecord {
  return {
    version: 1,
    source: 'nettiauto',
    search: { make: 'polestar', model: '2' },
    updatedAt: '2026-10-09T08:00:00Z',
    completeAt,
    listings,
  }
}

/** Forty Long Range Dual Motors across four years and the usual mileages. */
function market(extra: Record<string, MarketListing> = {}) {
  const listings: Record<string, MarketListing> = {}
  let id = 1000
  for (const year of [2021, 2022, 2023, 2024]) {
    for (const km of [20000, 45000, 70000, 95000, 120000, 140000, 30000, 60000, 85000, 110000]) {
      listings[String(id++)] = listing({ year, mileage: km - (2024 - year) * 5000 })
    }
  }
  return record({ ...listings, ...extra })
}

function car(over: Partial<CarListing> = {}): CarListing {
  return {
    ...newCar(),
    name: 'Polestar 2 Long Range Dual Motor 2022',
    powertrain: 'ev',
    purchasePrice: 30000,
    odometerKm: 62000,
    year: 2022,
    ...over,
  }
}

const check = (c: CarListing, r: MarketRecord = market()) => checkPrice(c, r, { today: TODAY })

describe('finding a car in the record', () => {
  const index: MarketIndex = {
    version: 1,
    updatedAt: '2026-10-10T00:00:00Z',
    files: [
      { file: 'nettiauto-polestar-2.json', source: 'nettiauto', search: { make: 'polestar', model: '2' }, listings: 838, updatedAt: null, completeAt: null },
      { file: 'nettiauto-bmw-320.json', source: 'nettiauto', search: { make: 'bmw', model: '320' }, listings: 617, updatedAt: null, completeAt: null },
    ],
  }

  it('reads the listing a car came from out of its notes', () => {
    const c = car({ notes: 'https://www.nettiauto.com/polestar/2/14899145\nMusta · Espoo' })
    expect(listingRefOf(c)).toEqual({ make: 'polestar', model: '2', id: '14899145' })
    expect(recordFor(c, index)?.file).toBe('nettiauto-polestar-2.json')
  })

  it('finds the model in a name, with the engine letter after it', () => {
    expect(recordFor(car({ name: 'BMW 320e G20 2021' }), index)?.file).toBe('nettiauto-bmw-320.json')
    expect(recordFor(car({ name: 'Polestar 2 LRDM' }), index)?.file).toBe('nettiauto-polestar-2.json')
  })

  it('does not take a different model, or a year, for the watched one', () => {
    expect(recordFor(car({ name: 'Polestar 3 Long Range' }), index)).toBeNull()
    expect(recordFor(car({ name: 'Polestar 2024' }), index)).toBeNull()
    expect(recordFor(car({ name: 'Skoda Octavia' }), index)).toBeNull()
  })
})

describe('what a listing is', () => {
  it('reads the fuel from the site, or else from the title', () => {
    expect(fuelOf('Sähkö', '')).toBe('ev')
    expect(fuelOf('Diesel', '')).toBe('diesel')
    expect(fuelOf(null, '2,0, 320D F31 LCI Xdrive')).toBe('diesel')
    expect(fuelOf(null, '330e M Sport')).toBe('phev')
    expect(fuelOf(null, '320i Sedan')).toBe('petrol')
    expect(fuelOf(null, '78 kWh, Long Range Dual Motor')).toBe('ev')
    expect(fuelOf(null, 'Hieno yksilö')).toBeNull()
  })

  it('reads the drive the same way', () => {
    expect(driveOf('Neliveto', '')).toBe('awd')
    expect(driveOf(null, 'Long Range Single Motor')).toBe('2wd')
    expect(driveOf(null, '320d xDrive')).toBe('awd')
    expect(driveOf(null, '320d')).toBeNull()
  })

  it('takes a model year out of a name, but not the model', () => {
    expect(yearFromName('Polestar 2 Long Range Dual Motor 2022 · 62 tkm')).toBe(2022)
    expect(yearFromName('Peugeot 2008 1.2 PureTech 2021')).toBe(2021)
    expect(yearFromName('Peugeot 2008')).toBe(0)
  })
})

describe('the price check', () => {
  it('finds what the market asks, within a few percent', () => {
    const result = check(car())
    expect(result?.ok).toBe(true)
    if (!result?.ok) return
    const expected = truth(2022, 62000, '2026-10-10')
    expect(Math.abs(result.typical / expected - 1)).toBeLessThan(0.03)
    expect(result.low).toBeLessThan(result.typical)
    expect(result.high).toBeGreaterThan(result.typical)
  })

  it('calls a cheap car cheap and a dear one dear', () => {
    const fair = truth(2022, 62000)
    const cheap = check(car({ purchasePrice: Math.round(fair * 0.85) }))
    const dear = check(car({ purchasePrice: Math.round(fair * 1.15) }))
    if (!cheap?.ok || !dear?.ok) throw new Error('expected both checks to run')
    expect(cheap.diff).toBeLessThan(0)
    expect(cheap.pricierShare).toBeGreaterThan(0.9)
    expect(dear.diff).toBeGreaterThan(0)
    expect(dear.pricierShare).toBeLessThan(0.1)
  })

  it('does not count the car against its own listing', () => {
    const own = listing({ year: 2022, mileage: 62000 })
    own.prices = [['2026-09-01', 42900], ['2026-09-24', 36900]]
    const c = car({ notes: 'https://www.nettiauto.com/polestar/2/555' })
    const result = check(c, market({ 555: own }))
    if (!result?.ok) throw new Error('expected a check')
    expect(result.points.some((p) => p.id === '555')).toBe(false)
    expect(result.listing?.prices).toEqual([['2026-09-01', 42900], ['2026-09-24', 36900]])
  })

  it('narrows to the same battery and drive when there are enough', () => {
    const others: Record<string, MarketListing> = {}
    for (let i = 0; i < 15; i += 1) {
      others[`sr${i}`] = listing({ year: 2022, mileage: 40000 + i * 5000, title: '69 kWh, Standard Range Single Motor' })
    }
    const result = check(car({ name: 'Polestar 2 78 kWh Long Range Dual Motor 2022' }), market(others))
    if (!result?.ok) throw new Error('expected a check')
    expect(result.criteria).toEqual(['Polestar 2', 'electric', '78 kWh', 'AWD'])
    expect(result.points.some((p) => p.id.startsWith('sr'))).toBe(false)
    // A name that only says Dual Motor still keeps the single motors out.
    const byDrive = check(car(), market(others))
    if (!byDrive?.ok) throw new Error('expected a check')
    expect(byDrive.criteria).toEqual(['Polestar 2', 'electric', 'AWD'])
    expect(byDrive.points.some((p) => p.id.startsWith('sr'))).toBe(false)
  })

  it('reads the battery off the listing the car came from when the name leaves it out', () => {
    const own = listing({ year: 2022, mileage: 62000, title: '78 kWh, Long Range Dual Motor' })
    const result = check(car({ notes: 'https://www.nettiauto.com/polestar/2/555' }), market({ 555: own }))
    if (!result?.ok) throw new Error('expected a check')
    expect(result.criteria).toEqual(['Polestar 2', 'electric', '78 kWh', 'AWD'])
  })

  it('widens what similar means rather than give up', () => {
    // Only a handful share the battery: the check falls back to the model and fuel.
    const few: Record<string, MarketListing> = {}
    for (let i = 0; i < 12; i += 1) {
      few[i] = listing({ year: 2022, mileage: 40000 + i * 7000, title: '82 kWh, Performance Dual Motor' })
    }
    const result = check(car({ name: 'Polestar 2 Performance 82 kWh 2022' }), record(few))
    if (!result?.ok) throw new Error('expected a check')
    expect(result.criteria).toEqual(['Polestar 2', 'electric', '82 kWh'])
    const sparse = check(car({ name: 'Polestar 2 Performance 82 kWh 2022' }), record(Object.fromEntries(Object.entries(few).slice(0, 4))))
    expect(sparse).toEqual({ ok: false, reason: 'similar', count: 4 })
  })

  it('says it needs the model year rather than guess one', () => {
    expect(check(car({ year: 0, name: 'Polestar 2' }))).toEqual({ ok: false, reason: 'year' })
  })

  it('has nothing to say about a lease, or a car with no price', () => {
    expect(check(car({ financing: { ...newCar().financing, method: 'lease' } }))).toBeNull()
    expect(check(car({ purchasePrice: 0 }))).toBeNull()
  })

  it('only counts listings as gone once a crawl has read the whole search', () => {
    const old = listing({ year: 2022, mileage: 50000, last: '2026-09-15' })
    const known = check(car(), market({ old }))
    const unknown = check(car(), { ...market({ old }), completeAt: null })
    if (!known?.ok || !unknown?.ok) throw new Error('expected checks')
    expect(known.gone).toBeGreaterThan(0)
    expect(known.goneKnown).toBe(true)
    expect(unknown.goneKnown).toBe(false)
    expect(unknown.gone).toBe(0)
  })

  it('needs at least the minimum to fit anything', () => {
    expect(MIN_SIMILAR).toBeGreaterThanOrEqual(8)
  })
})
