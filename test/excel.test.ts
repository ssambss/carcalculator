// Export to a spreadsheet and read it back.
//
// A real round trip: a workbook is actually written, actually parsed, and the
// data compared. Testing the two halves separately would miss the thing that
// matters - export and import agreeing about what a column means. A schema
// defined twice is a schema that drifts, and a spreadsheet whose halves disagree
// corrupts data quietly instead of failing.

import { describe, expect, it } from 'vitest'
import readXlsxFile from 'read-excel-file/node'

import {
  ASSUMPTIONS_SHEET,
  CARS_SHEET,
  columnHeaders,
  editableHeaders,
  excelBlob,
  importExcel,
} from '../src/excel'
import { DEFAULT_SETTINGS, newCar, normalizeData } from '../src/storage'
import type { AppData, CarListing } from '../src/types'

/** A cell, typed from its value - write-excel-file refuses a mismatch. */
function cell(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return { value, type: Number }
  return { value: value === null || value === undefined ? '' : String(value), type: String }
}

function car(over: Partial<CarListing> = {}): CarListing {
  return { ...newCar(), name: 'Test car', purchasePrice: 30000, odometerKm: 40000, ...over }
}

function app(cars: CarListing[], settings = DEFAULT_SETTINGS): AppData {
  return normalizeData({ version: 1, settings, cars, tombstones: {} })
}

/** A Blob is not a File, and `importExcel` takes what an <input> hands it. */
async function asFile(blob: Blob): Promise<File> {
  return new File([await blob.arrayBuffer()], 'book.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** Read the raw sheets, for assertions about the sheet itself. */
async function sheetsOf(data: AppData) {
  const buffer = Buffer.from(await (await excelBlob(data)).arrayBuffer())
  return readXlsxFile(buffer)
}

describe('the workbook that comes out', () => {
  it('has a sheet of cars and a sheet of assumptions', async () => {
    const sheets = await sheetsOf(app([car()]))
    expect(sheets.map((s) => s.sheet)).toEqual([CARS_SHEET, ASSUMPTIONS_SHEET])
  })

  it('puts every declared column in the header row, in order', async () => {
    const [cars] = await sheetsOf(app([car()]))
    expect(cars.data[0]).toEqual(columnHeaders())
  })

  it('gives one row per car', async () => {
    const [cars] = await sheetsOf(app([car({ name: 'A' }), car({ name: 'B' })]))
    expect(cars.data).toHaveLength(3) // header + two
    expect(cars.data[1][0]).toBe('A')
    expect(cars.data[2][0]).toBe('B')
  })

  it('writes numbers as numbers, not as text', async () => {
    // So they can be summed and sorted in Excel, which is the point of going
    // there rather than to CSV.
    const [cars] = await sheetsOf(app([car({ purchasePrice: 28500 })]))
    const at = columnHeaders().indexOf('Purchase price (€)')
    expect(cars.data[1][at]).toBe(28500)
  })

  it('writes yes/no rather than an Excel boolean', async () => {
    // A Finnish Excel renders booleans as TOSI/EPÄTOSI, which then has to be
    // read back. Text is locale-proof.
    const [cars] = await sheetsOf(app([car({ favorite: true })]))
    const at = columnHeaders().indexOf('Favourite')
    expect(cars.data[1][at]).toBe('yes')
  })

  it('includes the computed figures for reading', async () => {
    const [cars] = await sheetsOf(app([car({ autoResale: false, expectedResaleValue: 15000 })]))
    const at = columnHeaders().indexOf('→ € / month')
    expect(typeof cars.data[1][at]).toBe('number')
    expect(cars.data[1][at]).toBeGreaterThan(0)
  })

  it('does not offer the computed figures back as inputs', () => {
    // They are outputs. Reading them back would let a stale figure overwrite the
    // numbers it was derived from.
    const editable = editableHeaders()
    for (const header of columnHeaders().filter((h) => h.startsWith('→'))) {
      expect(editable).not.toContain(header)
    }
  })

  it('lists the assumptions with their values', async () => {
    const data = app([], { ...DEFAULT_SETTINGS, annualKm: 17000 })
    const [, assumptions] = await sheetsOf(data)
    const row = assumptions.data.find((r) => String(r[0]).startsWith('Driving per year'))
    expect(row?.[1]).toBe(17000)
  })
})

describe('the round trip', () => {
  it('brings every car back unchanged', async () => {
    const before = app([
      car({ name: 'Polestar 2', purchasePrice: 30000, powertrain: 'ev', elecKwhPer100: 19.5 }),
      car({
        name: 'Corolla',
        powertrain: 'petrol',
        fuelLPer100: 5.4,
        favorite: true,
        insurancePerYear: 780,
        financing: {
          method: 'loan',
          downPayment: 3000,
          annualRatePct: 4.25,
          termMonths: 48,
          autoBalloon: false,
          balloon: 2500,
        },
      }),
    ])

    const after = await importExcel(await asFile(await excelBlob(before)), before)

    expect(after.added).toBe(0)
    // Nothing was edited, so nothing counts as updated - and nothing is
    // restamped, which is what stops an unedited import winning a sync merge
    // against another device's real work.
    expect(after.updated).toBe(0)
    expect(after.data.cars).toHaveLength(2)
    expect(after.data.cars.map((c) => c.updatedAt)).toEqual(before.cars.map((c) => c.updatedAt))

    // Every editable field, compared field by field rather than by eye.
    for (const [index, original] of before.cars.entries()) {
      const returned = after.data.cars[index]
      expect(returned.id).toBe(original.id)
      expect(returned.name).toBe(original.name)
      expect(returned.powertrain).toBe(original.powertrain)
      expect(returned.purchasePrice).toBe(original.purchasePrice)
      expect(returned.odometerKm).toBe(original.odometerKm)
      expect(returned.favorite).toBe(original.favorite)
      expect(returned.fuelLPer100).toBeCloseTo(original.fuelLPer100, 6)
      expect(returned.elecKwhPer100).toBeCloseTo(original.elecKwhPer100, 6)
      expect(returned.insurancePerYear).toBe(original.insurancePerYear)
      expect(returned.financing).toEqual(original.financing)
      expect(returned.lease).toEqual(original.lease)
      expect(returned.notes).toBe(original.notes)
    }
  })


  it('is a complete no-op when nothing in the sheet was edited', async () => {
    // Exporting and re-importing must change nothing and *say* nothing changed.
    // Reporting a phantom change makes every import look risky, and restamping
    // would let it win a sync merge against another device's real work.
    const before = app([car({ name: 'Untouched' })], {
      ...DEFAULT_SETTINGS,
      annualKm: 17000,
      petrolPrice: 1.929,
    })
    const after = await importExcel(await asFile(await excelBlob(before)), before)
    expect(after.added).toBe(0)
    expect(after.updated).toBe(0)
    expect(after.settingsChanged).toBe(false)
    expect(after.data.cars.map((c) => c.updatedAt)).toEqual(before.cars.map((c) => c.updatedAt))
    expect(after.data.settings).toEqual(before.settings)
  })

  it('brings the assumptions back too', async () => {
    const before = app([car()], {
      ...DEFAULT_SETTINGS,
      annualKm: 17000,
      ownershipYears: 4,
      petrolPrice: 1.929,
      newCar: { ...DEFAULT_SETTINGS.newCar, annualRatePct: 3.45, termMonths: 48 },
    })
    const after = await importExcel(await asFile(await excelBlob(before)), before)
    // Every value survives the trip - and `settingsChanged` stays false, because
    // surviving unchanged is not a change.
    expect(after.data.settings.annualKm).toBe(17000)
    expect(after.data.settings.ownershipYears).toBe(4)
    expect(after.data.settings.petrolPrice).toBeCloseTo(1.929, 6)
    expect(after.data.settings.newCar.annualRatePct).toBeCloseTo(3.45, 6)
    expect(after.data.settings.newCar.termMonths).toBe(48)
    expect(after.settingsChanged).toBe(false)
  })

  it('reports an assumption that was actually edited', async () => {
    const before = app([car()], { ...DEFAULT_SETTINGS, annualKm: 17000 })
    const buffer = Buffer.from(await (await excelBlob(before)).arrayBuffer())
    const sheets = await readXlsxFile(buffer)
    const cars = sheets[0].data.map((r) => [...r])
    const rows = sheets[1].data.map((r) => [...r])
    const at = rows.findIndex((r) => String(r[0]).startsWith('Driving per year'))
    rows[at][1] = 25000 as never

    const { default: writeXlsxFile } = await import('write-excel-file/node')
    const out = await writeXlsxFile([
      { sheet: CARS_SHEET, data: cars.map((r) => r.map(cell)) },
      { sheet: ASSUMPTIONS_SHEET, data: rows.map((r) => r.map(cell)) },
    ] as never).toBuffer()

    const after = await importExcel(new File([out], 'edited.xlsx'), before)
    expect(after.settingsChanged).toBe(true)
    expect(after.data.settings.annualKm).toBe(25000)
  })


  it('reports and restamps only the row that changed', async () => {
    const before = app([
      car({ name: 'Untouched', purchasePrice: 30000 }),
      car({ name: 'Edited', purchasePrice: 20000 }),
    ])
    const buffer = Buffer.from(await (await excelBlob(before)).arrayBuffer())
    const sheets = await readXlsxFile(buffer)
    const rows = sheets[0].data.map((r) => [...r])
    const nameAt = columnHeaders().indexOf('Name')
    const priceAt = columnHeaders().indexOf('Purchase price (€)')
    const target = rows.findIndex((r) => r[nameAt] === 'Edited')
    rows[target][priceAt] = 17500 as never

    const { default: writeXlsxFile } = await import('write-excel-file/node')
    const out = await writeXlsxFile(
      [{ sheet: CARS_SHEET, data: rows.map((r) => r.map(cell)) }] as never,
    ).toBuffer()
    const after = await importExcel(new File([out], 'one-edit.xlsx'), before)

    expect(after.updated).toBe(1)
    const untouched = after.data.cars.find((c) => c.name === 'Untouched')!
    const edited = after.data.cars.find((c) => c.name === 'Edited')!
    expect(edited.purchasePrice).toBe(17500)
    expect(untouched.purchasePrice).toBe(30000)
    // The one that did not change keeps its old timestamp.
    expect(untouched.updatedAt).toBe(before.cars[0].updatedAt)
    expect(edited.updatedAt).not.toBe(before.cars[1].updatedAt)
  })

  it('survives a lease with everything set', async () => {
    const before = app([
      car({
        name: 'Leased',
        financing: { ...newCar().financing, method: 'lease' },
        lease: {
          monthlyPayment: 415,
          upfront: 1200,
          termMonths: 36,
          includedKmPerYear: 15000,
          excessKmFee: 0.12,
          includes: { insurance: true, tax: true, maintenance: false, tires: true },
        },
      }),
    ])
    const after = await importExcel(await asFile(await excelBlob(before)), before)
    expect(after.data.cars[0].lease).toEqual(before.cars[0].lease)
    expect(after.data.cars[0].financing.method).toBe('lease')
  })
})

describe('importing a sheet somebody edited', () => {
  const base = () => app([car({ name: 'Original', purchasePrice: 30000 })])

  /** Rewrite one cell of the exported sheet, the way a person would. */
  async function editedFile(data: AppData, header: string, value: unknown, row = 1) {
    const buffer = Buffer.from(await (await excelBlob(data)).arrayBuffer())
    const sheets = await readXlsxFile(buffer)
    const rows = sheets[0].data.map((r) => [...r])
    rows[row][columnHeaders().indexOf(header)] = value as never
    // Rebuild a workbook from the edited rows, which is what Excel would save.
    const { default: writeXlsxFile } = await import('write-excel-file/node')
    const out = await writeXlsxFile(
      [{ sheet: CARS_SHEET, data: rows.map((r) => r.map(cell)) }] as never,
    ).toBuffer()
    return new File([out], 'edited.xlsx')
  }

  it('applies a changed price to the matching car', async () => {
    const data = base()
    const after = await importExcel(await editedFile(data, 'Purchase price (€)', '24 900'), data)
    expect(after.updated).toBe(1)
    expect(after.added).toBe(0)
    expect(after.data.cars[0].purchasePrice).toBe(24900)
    expect(after.data.cars[0].name).toBe('Original')
  })

  it('reads a comma decimal, because a Finnish sheet is full of them', async () => {
    const data = base()
    const after = await importExcel(await editedFile(data, 'Interest (%/yr)', '4,25'), data)
    expect(after.data.cars[0].financing.annualRatePct).toBeCloseTo(4.25, 6)
  })

  it('accepts a euro sign or a per-cent sign in the cell', async () => {
    const data = base()
    const after = await importExcel(await editedFile(data, 'Purchase price (€)', '28 500 €'), data)
    expect(after.data.cars[0].purchasePrice).toBe(28500)
  })

  it('accepts yes/no in several languages', async () => {
    for (const [written, expected] of [
      ['kyllä', true],
      ['ei', false],
      ['TRUE', true],
      ['x', true],
      ['-', false],
    ] as const) {
      const data = base()
      const after = await importExcel(await editedFile(data, 'Favourite', written), data)
      expect(after.data.cars[0].favorite, `for "${written}"`).toBe(expected)
    }
  })

  it('accepts a Finnish powertrain word', async () => {
    const data = base()
    const after = await importExcel(await editedFile(data, 'Powertrain', 'Sähkö'), data)
    expect(after.data.cars[0].powertrain).toBe('ev')
  })

  it('leaves a field alone when its cell was cleared', async () => {
    // A blank cell means "unchanged", not "zero". Reading it as zero would let a
    // tidy-up of the sheet wipe prices.
    const data = base()
    const after = await importExcel(await editedFile(data, 'Purchase price (€)', ''), data)
    expect(after.data.cars[0].purchasePrice).toBe(30000)
  })

  it('ignores a value it cannot make sense of, rather than zeroing the field', async () => {
    const data = base()
    const after = await importExcel(await editedFile(data, 'Purchase price (€)', 'about thirty k'), data)
    expect(after.data.cars[0].purchasePrice).toBe(30000)
  })

  it('ignores an edit to a computed column', async () => {
    const data = base()
    const after = await importExcel(await editedFile(data, '→ € / month', '1'), data)
    // Nothing about the car changed, so its own numbers still produce the real
    // figure rather than the one typed over it.
    expect(after.data.cars[0].purchasePrice).toBe(30000)
  })
})

describe('importing something that is not our export', () => {
  async function bookFrom(rows: unknown[][], sheet = CARS_SHEET) {
    const { default: writeXlsxFile } = await import('write-excel-file/node')
    const out = await writeXlsxFile(
      [{ sheet, data: rows.map((r) => r.map(cell)) }] as never,
    ).toBuffer()
    return new File([out], 'theirs.xlsx')
  }

  it('adds cars from a hand-made sheet with only a few columns', async () => {
    // The most likely real case: somebody types a shortlist in Excel first.
    const file = await bookFrom([
      ['Name', 'Purchase price', 'Powertrain'],
      ['Skoda Octavia', '19 500', 'diesel'],
      ['Nissan Leaf', '14 000', 'ev'],
    ])
    const after = await importExcel(file, app([]))
    expect(after.added).toBe(2)
    expect(after.data.cars.map((c) => c.name)).toEqual(['Skoda Octavia', 'Nissan Leaf'])
    expect(after.data.cars[0].purchasePrice).toBe(19500)
    expect(after.data.cars[1].powertrain).toBe('ev')
    expect(after.warnings.join(' ')).toMatch(/no "id" column/i)
  })

  it('matches headers however they are capitalised or punctuated', async () => {
    const file = await bookFrom([
      ['name', 'PURCHASE PRICE (EUR)', 'Odometer  (km)'],
      ['Golf', 15000, 90000],
    ])
    const after = await importExcel(file, app([]))
    expect(after.data.cars[0].name).toBe('Golf')
    expect(after.data.cars[0].purchasePrice).toBe(15000)
    expect(after.data.cars[0].odometerKm).toBe(90000)
  })

  it('gives a new car this person own financing baseline', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      newCar: { ...DEFAULT_SETTINGS.newCar, annualRatePct: 2.9, termMonths: 36 },
    }
    const file = await bookFrom([['Name'], ['Fresh']])
    const after = await importExcel(file, app([], settings))
    expect(after.data.cars[0].financing.annualRatePct).toBeCloseTo(2.9, 6)
    expect(after.data.cars[0].financing.termMonths).toBe(36)
  })

  it('passes over a row with nothing in any column it understands', async () => {
    // The reachable version of "blank rows below the table": somebody has their
    // own column off to the right, and a stray note in it on a row that names no
    // car. Turning that into a nameless, priceless car would be worse than
    // ignoring it.
    const file = await bookFrom([
      ['Name', 'Purchase price', 'My own notes'],
      ['Real', 10000, 'ask about the timing belt'],
      ['', '', 'leftover scribble'],
    ])
    const after = await importExcel(file, app([]))
    expect(after.added).toBe(1)
    expect(after.skipped).toBe(1)
    expect(after.data.cars.map((c) => c.name)).toEqual(['Real'])
  })

  it('reads the first sheet when none is named Cars, and says so', async () => {
    const file = await bookFrom([['Name'], ['Whatever']], 'Sheet1')
    const after = await importExcel(file, app([]))
    expect(after.added).toBe(1)
    expect(after.warnings.join(' ')).toMatch(/Sheet1/)
  })

  it('refuses a sheet with no recognisable columns rather than making junk', async () => {
    const file = await bookFrom([
      ['Sukunimi', 'Puhelin'],
      ['Virtanen', '040'],
    ])
    await expect(importExcel(file, app([]))).rejects.toThrow(/look familiar/)
  })

  it('never deletes a car just because the sheet does not mention it', async () => {
    // Deleting by omission is far too easy to do by accident in a spreadsheet.
    const existing = app([car({ name: 'Keep me' })])
    const file = await bookFrom([['Name'], ['Someone else']])
    const after = await importExcel(file, existing)
    expect(after.data.cars.map((c) => c.name)).toContain('Keep me')
    expect(after.data.cars).toHaveLength(2)
  })
})
