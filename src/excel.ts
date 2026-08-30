/**
 * Export to and import from a spreadsheet.
 *
 * The JSON export is a backup - complete, exact, and unreadable. This is the
 * other thing people want: every car in a grid they can sort, tweak in bulk, and
 * send to somebody who lives in Excel.
 *
 * ## One schema, both directions
 *
 * Every column is declared once below, with how to read it and how to write it.
 * That is the whole design: a column defined twice is a column that drifts, and
 * a spreadsheet whose export and import disagree silently corrupts data rather
 * than failing.
 *
 * ## What import does, and does not do
 *
 * It **merges**. A row whose `Id` matches a car updates that car; a row without
 * one becomes a new car. Cars that are in the app but not in the sheet are left
 * alone - deleting by omission is far too easy to do by accident with a
 * spreadsheet, so deleting stays something you do in the app.
 *
 * Computed columns (€/month and friends) are written for reading and **ignored**
 * on the way back in. They are outputs; treating them as inputs would let a
 * stale figure overwrite the numbers it was derived from.
 *
 * Headers are matched loosely - lowercased, with units and punctuation stripped -
 * so a sheet survives being reordered, having columns deleted, or being
 * retyped by hand.
 */

import writeXlsxFile from 'write-excel-file/browser'
import readXlsxFile from 'read-excel-file/browser'
import type { Sheet } from 'write-excel-file/browser'

import { calcTco } from './calc'
import { DEFAULT_NEW_CAR, newCar, normalizeData } from './storage'
import type { AppData, CarListing, FinancingMethod, Powertrain, Settings } from './types'

/* ------------------------------------------------------------------ helpers */

/**
 * A header reduced to something two humans would agree on.
 *
 * "Purchase price (€)", "purchase price" and "PurchasePrice" all become
 * `purchaseprice`, so a sheet that has been reordered, retyped or translated in
 * the unit still lands on the right field.
 */
function headerKey(text: unknown): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/** Excel gives numbers as numbers, but a hand-typed cell arrives as text. */
function num(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[\s  €%]/g, '').replace(',', '.')
  if (!cleaned) return undefined
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Yes/no, in as many spellings as somebody might reasonably use.
 *
 * Written as "yes"/"no" rather than as an Excel boolean on purpose: a Finnish
 * Excel renders those as TOSI/EPÄTOSI, which then has to be read back.
 */
const YES = new Set(['yes', 'y', 'true', 'x', '1', 'kyllä', 'kylla', 'k', 'on', 'ja'])
const NO = new Set(['no', 'n', 'false', '0', 'ei', 'off', '-', ''])

function bool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value !== 'string') return undefined
  const v = value.trim().toLowerCase()
  if (YES.has(v)) return true
  if (NO.has(v)) return false
  return undefined
}

function text(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  return String(value).trim()
}

/** One of a fixed set, however it was capitalised, with a few synonyms. */
function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  synonyms: Record<string, T> = {},
): T | undefined {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return undefined
  const found = allowed.find((option) => option.toLowerCase() === v)
  if (found) return found
  return synonyms[v]
}

const POWERTRAINS = ['petrol', 'diesel', 'ev', 'phev'] as const
const POWERTRAIN_SYNONYMS: Record<string, Powertrain> = {
  bensiini: 'petrol',
  bensa: 'petrol',
  gasoline: 'petrol',
  electric: 'ev',
  sähkö: 'ev',
  sahko: 'ev',
  'plug-in hybrid': 'phev',
  'plugin hybrid': 'phev',
  lataushybridi: 'phev',
  hybrid: 'petrol',
}

const METHODS = ['cash', 'loan', 'lease'] as const
const METHOD_SYNONYMS: Record<string, FinancingMethod> = {
  käteinen: 'cash',
  kateinen: 'cash',
  laina: 'loan',
  leasing: 'lease',
  rahoitus: 'loan',
}

const yesNo = (on: boolean) => (on ? 'yes' : 'no')

/* ------------------------------------------------------------------- schema */

interface Column {
  /** The header written to the sheet. Units belong here; matching strips them. */
  header: string
  /** Reading a car for export. */
  get: (car: CarListing, settings: Settings) => string | number | null
  /**
   * Writing a value back onto a car. Absent means the column is computed -
   * written for reading and ignored on the way in.
   */
  set?: (car: CarListing, value: unknown) => void
  width?: number
  /** Excel number format, for the columns where a raw float reads badly. */
  format?: string
}

/** Every column, in the order they appear. Declared once, used both ways. */
const COLUMNS: Column[] = [
  {
    header: 'Name',
    width: 34,
    get: (car) => car.name,
    set: (car, v) => {
      const t = text(v)
      if (t !== undefined) car.name = t
    },
  },
  {
    header: 'Favourite',
    width: 11,
    get: (car) => yesNo(car.favorite),
    set: (car, v) => {
      const b = bool(v)
      if (b !== undefined) car.favorite = b
    },
  },
  {
    header: 'Powertrain',
    width: 12,
    get: (car) => car.powertrain,
    set: (car, v) => {
      const p = oneOf(v, POWERTRAINS, POWERTRAIN_SYNONYMS)
      if (p) car.powertrain = p
    },
  },
  {
    header: 'Purchase price (€)',
    width: 16,
    format: '#,##0',
    get: (car) => car.purchasePrice,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.purchasePrice = Math.max(0, n)
    },
  },
  {
    header: 'Odometer (km)',
    width: 14,
    format: '#,##0',
    get: (car) => car.odometerKm,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.odometerKm = Math.max(0, n)
    },
  },
  {
    header: 'Keep for (years, 0 = shared)',
    width: 24,
    get: (car) => car.keepYears,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.keepYears = Math.max(0, n)
    },
  },

  {
    header: 'Paying by (cash / loan / lease)',
    width: 26,
    get: (car) => car.financing.method,
    set: (car, v) => {
      const m = oneOf(v, METHODS, METHOD_SYNONYMS)
      if (m) car.financing.method = m
    },
  },
  {
    header: 'Down payment (€)',
    width: 16,
    format: '#,##0',
    get: (car) => car.financing.downPayment,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.financing.downPayment = Math.max(0, n)
    },
  },
  {
    header: 'Interest (%/yr)',
    width: 14,
    format: '0.00',
    get: (car) => car.financing.annualRatePct,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.financing.annualRatePct = Math.max(0, n)
    },
  },
  {
    header: 'Loan term (months)',
    width: 17,
    get: (car) => car.financing.termMonths,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.financing.termMonths = Math.max(1, Math.round(n))
    },
  },
  {
    header: 'Standard balloon (yes/no)',
    width: 22,
    get: (car) => yesNo(car.financing.autoBalloon),
    set: (car, v) => {
      const b = bool(v)
      if (b !== undefined) car.financing.autoBalloon = b
    },
  },
  {
    header: 'Balloon (€)',
    width: 13,
    format: '#,##0',
    get: (car) => car.financing.balloon,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.financing.balloon = Math.max(0, n)
    },
  },

  {
    header: 'Estimate resale (yes/no)',
    width: 21,
    get: (car) => yesNo(car.autoResale),
    set: (car, v) => {
      const b = bool(v)
      if (b !== undefined) car.autoResale = b
    },
  },
  {
    header: 'Resale value (€)',
    width: 16,
    format: '#,##0',
    get: (car) => car.expectedResaleValue,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.expectedResaleValue = Math.max(0, n)
    },
  },

  {
    header: 'Lease / month (€)',
    width: 17,
    format: '#,##0',
    get: (car) => car.lease.monthlyPayment,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.lease.monthlyPayment = Math.max(0, n)
    },
  },
  {
    header: 'Lease at signing (€)',
    width: 19,
    format: '#,##0',
    get: (car) => car.lease.upfront,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.lease.upfront = Math.max(0, n)
    },
  },
  {
    header: 'Lease term (months)',
    width: 18,
    get: (car) => car.lease.termMonths,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.lease.termMonths = Math.max(1, Math.round(n))
    },
  },
  {
    header: 'Lease km / year (0 = no cap)',
    width: 24,
    format: '#,##0',
    get: (car) => car.lease.includedKmPerYear,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.lease.includedKmPerYear = Math.max(0, n)
    },
  },
  {
    header: 'Excess km fee (€/km)',
    width: 19,
    format: '0.00',
    get: (car) => car.lease.excessKmFee,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.lease.excessKmFee = Math.max(0, n)
    },
  },
  {
    header: 'Lease covers insurance',
    width: 20,
    get: (car) => yesNo(car.lease.includes.insurance),
    set: (car, v) => {
      const b = bool(v)
      if (b !== undefined) car.lease.includes.insurance = b
    },
  },
  {
    header: 'Lease covers tax',
    width: 17,
    get: (car) => yesNo(car.lease.includes.tax),
    set: (car, v) => {
      const b = bool(v)
      if (b !== undefined) car.lease.includes.tax = b
    },
  },
  {
    header: 'Lease covers maintenance',
    width: 22,
    get: (car) => yesNo(car.lease.includes.maintenance),
    set: (car, v) => {
      const b = bool(v)
      if (b !== undefined) car.lease.includes.maintenance = b
    },
  },
  {
    header: 'Lease covers tires',
    width: 17,
    get: (car) => yesNo(car.lease.includes.tires),
    set: (car, v) => {
      const b = bool(v)
      if (b !== undefined) car.lease.includes.tires = b
    },
  },

  {
    header: 'Fuel use (l/100km)',
    width: 17,
    format: '0.0',
    get: (car) => car.fuelLPer100,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.fuelLPer100 = Math.max(0, n)
    },
  },
  {
    header: 'Electricity use (kWh/100km)',
    width: 24,
    format: '0.0',
    get: (car) => car.elecKwhPer100,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.elecKwhPer100 = Math.max(0, n)
    },
  },
  {
    header: 'Driven on electricity (%)',
    width: 22,
    get: (car) => car.electricSharePct,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.electricSharePct = Math.min(100, Math.max(0, n))
    },
  },

  {
    header: 'Insurance (€/yr)',
    width: 15,
    format: '#,##0',
    get: (car) => car.insurancePerYear,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.insurancePerYear = Math.max(0, n)
    },
  },
  {
    header: 'Vehicle tax (€/yr)',
    width: 16,
    format: '#,##0',
    get: (car) => car.taxPerYear,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.taxPerYear = Math.max(0, n)
    },
  },
  {
    header: 'Maintenance (€/yr)',
    width: 17,
    format: '#,##0',
    get: (car) => car.maintenancePerYear,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.maintenancePerYear = Math.max(0, n)
    },
  },
  {
    header: 'Tires (€/yr)',
    width: 13,
    format: '#,##0',
    get: (car) => car.tiresPerYear,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.tiresPerYear = Math.max(0, n)
    },
  },
  {
    header: 'Other (€/yr)',
    width: 13,
    format: '#,##0',
    get: (car) => car.otherPerYear,
    set: (car, v) => {
      const n = num(v)
      if (n !== undefined) car.otherPerYear = Math.max(0, n)
    },
  },

  // --- Computed from here down: written for reading, ignored on import. ---
  {
    header: '→ € / month',
    width: 13,
    format: '#,##0',
    get: (car, settings) => Math.round(calcTco(car, settings).perMonth),
  },
  {
    header: '→ Out of pocket / month',
    width: 21,
    format: '#,##0',
    get: (car, settings) => Math.round(calcTco(car, settings).outOfPocketPerMonth),
  },
  {
    header: '→ € / km',
    width: 11,
    format: '0.000',
    get: (car, settings) => Number(calcTco(car, settings).perKm.toFixed(3)),
  },
  {
    header: '→ Total',
    width: 13,
    format: '#,##0',
    get: (car, settings) => Math.round(calcTco(car, settings).total),
  },
  {
    header: '→ Over years',
    width: 12,
    get: (car, settings) => calcTco(car, settings).years,
  },

  {
    header: 'Notes',
    width: 46,
    get: (car) => car.notes,
    set: (car, v) => {
      const t = text(v)
      if (t !== undefined) car.notes = t
    },
  },
  {
    header: 'Id',
    width: 38,
    get: (car) => car.id,
    // Read directly by the importer, not through `set`: it decides which car a
    // row *is*, rather than being one of its fields.
  },
]

/** The shared assumptions, as label/value rows on their own sheet. */
interface SettingRow {
  header: string
  get: (settings: Settings) => number
  set: (settings: Settings, value: number) => void
  format?: string
}

const SETTING_ROWS: SettingRow[] = [
  {
    header: 'Driving per year (km)',
    get: (s) => s.annualKm,
    set: (s, v) => {
      s.annualKm = Math.max(0, v)
    },
    format: '#,##0',
  },
  {
    header: 'Ownership period (years)',
    get: (s) => s.ownershipYears,
    set: (s, v) => {
      s.ownershipYears = Math.max(1, v)
    },
  },
  {
    header: 'Petrol (€/l)',
    get: (s) => s.petrolPrice,
    set: (s, v) => {
      s.petrolPrice = Math.max(0, v)
    },
    format: '0.000',
  },
  {
    header: 'Diesel (€/l)',
    get: (s) => s.dieselPrice,
    set: (s, v) => {
      s.dieselPrice = Math.max(0, v)
    },
    format: '0.000',
  },
  {
    header: 'Electricity (€/kWh)',
    get: (s) => s.electricityPrice,
    set: (s, v) => {
      s.electricityPrice = Math.max(0, v)
    },
    format: '0.000',
  },
  {
    header: 'New car: down payment (€)',
    get: (s) => s.newCar.downPayment,
    set: (s, v) => {
      s.newCar.downPayment = Math.max(0, v)
    },
    format: '#,##0',
  },
  {
    header: 'New car: interest (%/yr)',
    get: (s) => s.newCar.annualRatePct,
    set: (s, v) => {
      s.newCar.annualRatePct = Math.max(0, v)
    },
    format: '0.00',
  },
  {
    header: 'New car: loan term (months)',
    get: (s) => s.newCar.termMonths,
    set: (s, v) => {
      s.newCar.termMonths = Math.max(1, Math.round(v))
    },
  },
  {
    header: 'New car: electricity use (kWh/100km)',
    get: (s) => s.newCar.elecKwhPer100,
    set: (s, v) => {
      s.newCar.elecKwhPer100 = Math.max(0, v)
    },
    format: '0.0',
  },
  {
    header: 'New car: fuel use (l/100km)',
    get: (s) => s.newCar.fuelLPer100,
    set: (s, v) => {
      s.newCar.fuelLPer100 = Math.max(0, v)
    },
    format: '0.0',
  },
]

export const CARS_SHEET = 'Cars'
export const ASSUMPTIONS_SHEET = 'Assumptions'

/* ------------------------------------------------------------------- export */

type Cell = { value?: string | number | null; type?: unknown; format?: string; fontWeight?: string; alignVertical?: string; wrap?: boolean; backgroundColor?: string; color?: string }

const HEADER_STYLE = {
  fontWeight: 'bold' as const,
  backgroundColor: '#efece5',
  color: '#191813',
  alignVertical: 'bottom' as const,
  wrap: true,
}

function carRows(data: AppData): Cell[][] {
  const header: Cell[] = COLUMNS.map((column) => ({
    value: column.header,
    type: String,
    ...HEADER_STYLE,
  }))
  const rows = data.cars.map((car) =>
    COLUMNS.map((column): Cell => {
      const value = column.get(car, data.settings)
      return typeof value === 'number'
        ? { value, type: Number, format: column.format }
        : { value: value ?? '', type: String }
    }),
  )
  return [header, ...rows]
}

function settingRows(settings: Settings): Cell[][] {
  return [
    [
      { value: 'Assumption', type: String, ...HEADER_STYLE },
      { value: 'Value', type: String, ...HEADER_STYLE },
    ],
    ...SETTING_ROWS.map((row): Cell[] => [
      { value: row.header, type: String },
      { value: row.get(settings), type: Number, format: row.format },
    ]),
  ]
}

/**
 * Download the data as a spreadsheet.
 *
 * Two sheets: the cars, and the assumptions they are costed against. Both are
 * read back by `importExcel`, so a round trip through Excel changes only what
 * somebody edited.
 */
export async function exportExcel(data: AppData, fileName?: string): Promise<void> {
  const sheets = [
    {
      sheet: CARS_SHEET,
      data: carRows(data),
      columns: COLUMNS.map((column) => ({ width: column.width })),
      // The header row stays visible while scrolling a long list of cars.
      stickyRowsCount: 1,
    },
    {
      sheet: ASSUMPTIONS_SHEET,
      data: settingRows(data.settings),
      columns: [{ width: 38 }, { width: 16 }],
      stickyRowsCount: 1,
    },
  ] as unknown as Sheet<Blob>[]

  // v4 hands back { toBlob, toFile } rather than taking a filename, so the
  // download is the caller's decision.
  await writeXlsxFile(sheets).toFile(
    fileName ?? `car-tco-${new Date().toISOString().slice(0, 10)}.xlsx`,
  )
}

/** The workbook as a blob, for tests and for anything that is not a download. */
export async function excelBlob(data: AppData): Promise<Blob> {
  const sheets = [
    { sheet: CARS_SHEET, data: carRows(data), stickyRowsCount: 1 },
    { sheet: ASSUMPTIONS_SHEET, data: settingRows(data.settings), stickyRowsCount: 1 },
  ] as unknown as Sheet<Blob>[]
  return writeXlsxFile(sheets).toBlob()
}

/* ------------------------------------------------------------------- import */

export interface ImportReport {
  data: AppData
  added: number
  updated: number
  /** Rows that looked empty, so were passed over rather than made into cars. */
  skipped: number
  settingsChanged: boolean
  /** Things worth telling the user, rather than failing over. */
  warnings: string[]
}

/** Map each known column to where it appears in this particular sheet. */
function locate(headerRow: unknown[]): Map<number, Column> {
  const byKey = new Map(COLUMNS.map((column) => [headerKey(column.header), column]))
  const found = new Map<number, Column>()
  headerRow.forEach((cell, index) => {
    const column = byKey.get(headerKey(cell))
    if (column) found.set(index, column)
  })
  return found
}

function idIndex(headerRow: unknown[]): number {
  return headerRow.findIndex((cell) => headerKey(cell) === 'id')
}

/**
 * Read a workbook back over the current data.
 *
 * Merges rather than replaces: a row with a known `Id` updates that car, a row
 * without one becomes a new car, and a car missing from the sheet is left alone.
 * Deleting by omission is much too easy to do by accident in a spreadsheet, so
 * deleting stays something you do in the app.
 *
 * A row that changes nothing counts as nothing: neither reported as an update
 * nor stamped with a new `updatedAt`. Stamping every matched row would make the
 * whole import "newer" than another device's real edits and win the sync merge
 * against them - importing a sheet you had not edited would quietly undo
 * somebody else's work.
 */
export async function importExcel(file: File, current: AppData): Promise<ImportReport> {
  const warnings: string[] = []

  // Every sheet in one read, then picked by name. A file saved by something
  // that renames or reorders sheets still works: the first one is the right
  // guess for anything we wrote.
  const sheets = await readXlsxFile(file)
  if (!sheets.length) throw new Error('That file has no sheets in it.')

  const named = sheets.find((sheet) => sheet.sheet === CARS_SHEET)
  if (!named) warnings.push(`No sheet named "${CARS_SHEET}"; read "${sheets[0].sheet}" instead.`)
  const carSheet = (named ?? sheets[0]).data as unknown[][]

  if (!carSheet?.length) throw new Error('That spreadsheet has no rows in it.')

  const [headerRow, ...rows] = carSheet
  const columns = locate(headerRow)
  if (columns.size === 0) {
    throw new Error(
      'None of the columns in that sheet look familiar. Export one first and edit that, ' +
        'so the headers match.',
    )
  }
  const idAt = idIndex(headerRow)
  if (idAt === -1) {
    warnings.push('No "Id" column, so every row was added as a new car rather than matched up.')
  }

  const byId = new Map(current.cars.map((car) => [car.id, car]))
  const cars: CarListing[] = current.cars.map((car) => structuredClone(car))
  const carsById = new Map(cars.map((car) => [car.id, car]))
  const now = new Date().toISOString()
  let added = 0
  let updated = 0
  let skipped = 0

  for (const row of rows) {
    // A row is empty when every column we understand is empty - which is what
    // the hundreds of blank rows Excel keeps below a table look like.
    const hasContent = [...columns.keys()].some((index) => {
      const value = row[index]
      return value !== null && value !== undefined && String(value).trim() !== ''
    })
    if (!hasContent) {
      skipped += 1
      continue
    }

    const id = idAt === -1 ? '' : String(row[idAt] ?? '').trim()
    const existing = id ? carsById.get(id) : undefined
    if (id && !existing && byId.size > 0) {
      // An id that matches nothing: probably a car deleted in the app since the
      // sheet was exported. Adding it back is the kinder reading, but say so.
      warnings.push(`Row with id ${id.slice(0, 8)}… matched no car, so it was added as a new one.`)
    }

    const car = existing ?? { ...newCar(current.settings.newCar), createdAt: now, updatedAt: now }
    // Compared afterwards, so an untouched row is not counted as a change.
    const was = existing ? JSON.stringify(existing) : null

    for (const [index, column] of columns) {
      if (!column.set) continue // computed
      const value = row[index]
      // A blank cell means "unchanged", never "zero". Reading it as zero would
      // let somebody tidying up the sheet wipe every price they cleared.
      if (value === null || value === undefined || String(value).trim() === '') continue
      column.set(car, value)
    }

    if (!existing) {
      cars.push(car)
      carsById.set(car.id, car)
      added += 1
      continue
    }

    // `updatedAt` is only moved for a car that actually changed. Bumping it on
    // every matched row would make the whole sheet "newer" than another device's
    // genuine edits and quietly win the sync merge against them.
    if (JSON.stringify(car) !== was) {
      car.updatedAt = now
      updated += 1
    }
  }

  // --- The assumptions sheet, if the file has one. ---
  const settings: Settings = structuredClone(current.settings)
  let settingsChanged = false
  // No assumptions sheet is normal - somebody may have exported only the cars,
  // or built one themselves - and then their current settings simply stand.
  const assumptions = sheets.find((sheet) => sheet.sheet === ASSUMPTIONS_SHEET)
  if (assumptions) {
    const before = JSON.stringify(settings)
    const byHeader = new Map(SETTING_ROWS.map((row) => [headerKey(row.header), row]))
    for (const [label, value] of assumptions.data as unknown[][]) {
      const row = byHeader.get(headerKey(label))
      const parsed = num(value)
      if (row && parsed !== undefined) row.set(settings, parsed)
    }
    // Changed, not merely read. Re-importing an unedited sheet has to be a
    // no-op, or the report cries wolf and every import looks like a change.
    settingsChanged = JSON.stringify(settings) !== before
  }

  // Back through the normalizer, so a spreadsheet cannot put the app into a
  // state its own storage would refuse.
  const data = normalizeData({ version: 1, settings, cars, tombstones: current.tombstones })
  return { data, added, updated, skipped, settingsChanged, warnings }
}

/** Column headers, for the docs and for tests to assert against. */
export function columnHeaders(): string[] {
  return COLUMNS.map((column) => column.header)
}

/** Which headers are read back, as opposed to written for reading only. */
export function editableHeaders(): string[] {
  return COLUMNS.filter((column) => column.set).map((column) => column.header)
}

export { DEFAULT_NEW_CAR }
