// The card orders. The default is the headline's own (see byOutOfPocket in
// calc.test.ts); these pin the others, and that an order never drops a car.

import { describe, expect, it } from 'vitest'

import { calcTco } from '../src/calc'
import { CAR_SORTS, carComparator, type CarSort } from '../src/carSort'
import { DEFAULT_SETTINGS, newCar } from '../src/storage'
import type { CarListing, Settings } from '../src/types'

const settings: Settings = { ...DEFAULT_SETTINGS, annualKm: 20000, ownershipYears: 5 }

function car(id: string, overrides: Partial<CarListing> = {}): CarListing {
  return {
    ...newCar(),
    id,
    name: id,
    purchasePrice: 30000,
    autoResale: false,
    expectedResaleValue: 15000,
    ...overrides,
  }
}

const cars = [
  car('Škoda', { purchasePrice: 20000, createdAt: '2026-09-02T10:00:00.000Z' }),
  car('Audi', { purchasePrice: 45000, createdAt: '2026-09-03T10:00:00.000Z' }),
  car('BMW', { purchasePrice: 30000, createdAt: '2026-09-01T10:00:00.000Z' }),
]
const results = new Map(cars.map((c) => [c.id, calcTco(c, settings)]))
const order = (sort: CarSort) => [...cars].sort(carComparator(sort, results)).map((c) => c.id)

describe('sorting the cards', () => {
  it('orders by the cost after resale, lowest first', () => {
    // Same resale everywhere, so the dearer purchase loses more.
    expect(order('perMonth')).toEqual(['Škoda', 'BMW', 'Audi'])
  })

  it('orders by cost per kilometre, lowest first', () => {
    expect(order('perKm')).toEqual(['Škoda', 'BMW', 'Audi'])
  })

  it('puts the newest-added car first', () => {
    expect(order('newest')).toEqual(['Audi', 'Škoda', 'BMW'])
  })

  it('sorts names the Finnish way', () => {
    // Š after S and before T in Finnish - after Audi and BMW either way here.
    expect(order('name')).toEqual(['Audi', 'BMW', 'Škoda'])
  })

  it('keeps every car, in every order', () => {
    for (const { key } of CAR_SORTS) expect(order(key)).toHaveLength(cars.length)
  })
})
