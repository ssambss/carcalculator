// The JSON backup: both calculators in one file, readable in both directions
// across the version that added housing to it.
//
// The shape is the compatibility: the car data stays at the top level, where
// every backup has had it, and housing sits beside it under one key - so an
// old backup still restores its cars, and an old copy of the app reading a
// new backup still finds them.

import { describe, expect, it } from 'vitest'

import { backupJson, parseBackup } from '../src/backup'
import { EMPTY_HOUSING, newProperty, type HousingData } from '../src/housingStorage'
import { newCar, normalizeData } from '../src/storage'
import type { AppData } from '../src/types'

const cars = (): AppData =>
  normalizeData({ version: 1, settings: {}, cars: [{ ...newCar(), name: 'Octavia' }], tombstones: {} })

const housing = (): HousingData => ({
  ...structuredClone(EMPTY_HOUSING),
  situation: { ...EMPTY_HOUSING.situation, netIncomePerMonth: 3400, savings: 45000 },
  situationUpdatedAt: '2026-09-01T00:00:00.000Z',
  properties: [{ ...newProperty(), name: 'Tapanila 3h+k', price: 329000, postalCode: '00730' }],
})

describe('the backup', () => {
  it('carries both calculators, and reads back exactly', () => {
    const d = cars()
    const h = housing()
    const back = parseBackup(backupJson(d, h))
    expect(back.data).toEqual(d)
    expect(back.housing).toEqual(h)
  })

  it('keeps the cars where a backup always had them', () => {
    const raw = JSON.parse(backupJson(cars(), housing()))
    expect(raw.cars[0].name).toBe('Octavia')
    expect(raw.housing.properties[0].name).toBe('Tapanila 3h+k')
  })

  it('reads an older backup, from before housing was in it, as having none', () => {
    // An old backup is the car data and nothing else - null here is what
    // leaves the housing side alone instead of emptying it.
    const old = JSON.stringify(cars())
    const back = parseBackup(old)
    expect(back.data.cars[0].name).toBe('Octavia')
    expect(back.housing).toBeNull()
  })

  it('still gives an older copy of the app its cars', () => {
    // What a device on a cached bundle does with the file: normalizeData, and
    // nothing that knows about housing.
    const seen = normalizeData(JSON.parse(backupJson(cars(), housing())))
    expect(seen.cars[0].name).toBe('Octavia')
    expect(seen).not.toHaveProperty('housing')
  })

  it('normalises a mangled housing section rather than refusing the file', () => {
    const text = JSON.stringify({ ...cars(), housing: { properties: [{ name: 'Half a place', price: '215 000' }] } })
    const back = parseBackup(text)
    expect(back.housing?.properties[0].name).toBe('Half a place')
    expect(back.housing?.properties[0].price).toBe(215000)
    expect(back.housing?.situation).toEqual(EMPTY_HOUSING.situation)
  })
})
