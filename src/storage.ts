import type {
  AppData,
  CarListing,
  Financing,
  FinancingMethod,
  Lease,
  NewCarDefaults,
  Powertrain,
  Settings,
} from './types'

const STORAGE_KEY = 'carcalculator.data.v1'

/**
 * What a new car assumes before anyone has quoted a real rate.
 *
 * 6 % over 72 months with nothing down is a plausible Finnish used-car loan and,
 * more to the point, a *common* baseline - candidates only compare if they are
 * financed alike until one of them has a real offer. The consumption figures sit
 * above the WLTP numbers on purpose: roughly what a mid-size car actually uses
 * in mixed Finnish driving.
 */
export const DEFAULT_NEW_CAR: NewCarDefaults = {
  downPayment: 0,
  annualRatePct: 6,
  termMonths: 72,
  elecKwhPer100: 20,
  fuelLPer100: 6.5,
}

export const DEFAULT_SETTINGS: Settings = {
  annualKm: 20000,
  ownershipYears: 5,
  petrolPrice: 1.85,
  dieselPrice: 1.75,
  electricityPrice: 0.15,
  newCar: { ...DEFAULT_NEW_CAR },
}

/* A 36-month contract with a 20 000 km/yr allowance is the common Finnish
 * private-lease shape; nothing is assumed to be included in the price. */
export const DEFAULT_LEASE: Lease = {
  monthlyPayment: 0,
  upfront: 0,
  termMonths: 36,
  includedKmPerYear: 20000,
  excessKmFee: 0,
  includes: { insurance: false, tax: false, maintenance: false, tires: false },
}

export function cloneLease(lease: Lease): Lease {
  return { ...lease, includes: { ...lease.includes } }
}

/**
 * A blank car, on whichever financing baseline the owner of the data uses.
 *
 * The defaults are a *setting*, not a constant: one person's assumptions about
 * rate and term have no business in another person's calculator, and the same
 * baseline should apply whether a car is typed in or arrives from a reaction.
 */
export function newCar(defaults: NewCarDefaults = DEFAULT_NEW_CAR): CarListing {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name: '',
    notes: '',
    favorite: false,
    keepYears: 0,
    powertrain: 'petrol',
    purchasePrice: 0,
    odometerKm: 0,
    autoResale: true,
    expectedResaleValue: 0,
    financing: {
      method: 'cash',
      downPayment: defaults.downPayment,
      annualRatePct: defaults.annualRatePct,
      termMonths: defaults.termMonths,
      autoBalloon: true,
      balloon: 0,
    },
    lease: cloneLease(DEFAULT_LEASE),
    fuelLPer100: defaults.fuelLPer100,
    elecKwhPer100: defaults.elecKwhPer100,
    electricSharePct: 50,
    insurancePerYear: 0,
    taxPerYear: 0,
    maintenancePerYear: 0,
    tiresPerYear: 0,
    otherPerYear: 0,
    createdAt: now,
    updatedAt: now,
  }
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalizeData(JSON.parse(raw))
  } catch {
    // corrupt or unavailable storage — start fresh
  }
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, cars: [], tombstones: {} }
}

export function saveData(data: AppData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // storage full or blocked — the app keeps working in memory
  }
}

export function exportJson(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `car-tco-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importJson(file: File): Promise<AppData> {
  const text = await file.text()
  return normalizeData(JSON.parse(text))
}

/** Coerce unknown parsed JSON into a valid AppData, dropping anything malformed. */
export function normalizeData(raw: unknown): AppData {
  const obj = isRecord(raw) ? raw : {}
  const settings = normalizeSettings(obj.settings)
  // Settings first: a car with gaps fills them from this person's own baseline.
  const cars = Array.isArray(obj.cars)
    ? obj.cars.map((car) => normalizeCar(car, settings.newCar))
    : []
  const tombstones: Record<string, string> = {}
  if (isRecord(obj.tombstones)) {
    for (const [id, at] of Object.entries(obj.tombstones)) {
      if (typeof at === 'string') tombstones[id] = at
    }
  }
  return { version: 1, settings, cars, tombstones }
}

function normalizeSettings(raw: unknown): Settings {
  const s = isRecord(raw) ? raw : {}
  return {
    annualKm: toNum(s.annualKm, DEFAULT_SETTINGS.annualKm),
    ownershipYears: Math.max(1, toNum(s.ownershipYears, DEFAULT_SETTINGS.ownershipYears)),
    petrolPrice: toNum(s.petrolPrice, DEFAULT_SETTINGS.petrolPrice),
    dieselPrice: toNum(s.dieselPrice, DEFAULT_SETTINGS.dieselPrice),
    electricityPrice: toNum(s.electricityPrice, DEFAULT_SETTINGS.electricityPrice),
    newCar: normalizeNewCar(s.newCar),
  }
}

function normalizeNewCar(raw: unknown): NewCarDefaults {
  const n = isRecord(raw) ? raw : {}
  return {
    downPayment: Math.max(0, toNum(n.downPayment, DEFAULT_NEW_CAR.downPayment)),
    annualRatePct: Math.max(0, toNum(n.annualRatePct, DEFAULT_NEW_CAR.annualRatePct)),
    // A term of zero would divide by nothing in the annuity.
    termMonths: Math.max(1, toNum(n.termMonths, DEFAULT_NEW_CAR.termMonths)),
    elecKwhPer100: Math.max(0, toNum(n.elecKwhPer100, DEFAULT_NEW_CAR.elecKwhPer100)),
    fuelLPer100: Math.max(0, toNum(n.fuelLPer100, DEFAULT_NEW_CAR.fuelLPer100)),
  }
}

function normalizeCar(raw: unknown, defaults: NewCarDefaults = DEFAULT_NEW_CAR): CarListing {
  const c = isRecord(raw) ? raw : {}
  const base = newCar(defaults)
  return {
    id: typeof c.id === 'string' && c.id ? c.id : base.id,
    name: typeof c.name === 'string' ? c.name : '',
    notes: typeof c.notes === 'string' ? c.notes : '',
    favorite: c.favorite === true,
    keepYears: Math.max(0, toNum(c.keepYears, 0)),
    powertrain: isPowertrain(c.powertrain) ? c.powertrain : 'petrol',
    purchasePrice: toNum(c.purchasePrice, 0),
    odometerKm: toNum(c.odometerKm, 0),
    // Data saved before auto-estimates existed keeps its manual resale value
    autoResale:
      typeof c.autoResale === 'boolean' ? c.autoResale : !(toNum(c.expectedResaleValue, 0) > 0),
    expectedResaleValue: toNum(c.expectedResaleValue, 0),
    financing: normalizeFinancing(c.financing, defaults),
    lease: normalizeLease(c.lease),
    fuelLPer100: toNum(c.fuelLPer100, base.fuelLPer100),
    elecKwhPer100: toNum(c.elecKwhPer100, base.elecKwhPer100),
    electricSharePct: toNum(c.electricSharePct, base.electricSharePct),
    insurancePerYear: toNum(c.insurancePerYear, 0),
    taxPerYear: toNum(c.taxPerYear, 0),
    maintenancePerYear: toNum(c.maintenancePerYear, 0),
    tiresPerYear: toNum(c.tiresPerYear, 0),
    otherPerYear: toNum(c.otherPerYear, 0),
    createdAt: typeof c.createdAt === 'string' ? c.createdAt : base.createdAt,
    updatedAt:
      typeof c.updatedAt === 'string'
        ? c.updatedAt
        : typeof c.createdAt === 'string'
          ? c.createdAt
          : base.createdAt,
  }
}

/**
 * `defaults` fills the gaps, so a car arriving without financing lands on this
 * person's own baseline rather than on a rate and term picked here.
 */
function normalizeFinancing(raw: unknown, defaults: NewCarDefaults = DEFAULT_NEW_CAR): Financing {
  const f = isRecord(raw) ? raw : {}
  return {
    method: isFinancingMethod(f.method) ? f.method : 'cash',
    downPayment: toNum(f.downPayment, defaults.downPayment),
    annualRatePct: toNum(f.annualRatePct, defaults.annualRatePct),
    termMonths: toNum(f.termMonths, defaults.termMonths),
    // Data saved before the standard balloon existed keeps its explicit figure
    autoBalloon: typeof f.autoBalloon === 'boolean' ? f.autoBalloon : false,
    balloon: toNum(f.balloon, 0),
  }
}

function normalizeLease(raw: unknown): Lease {
  const l = isRecord(raw) ? raw : {}
  const inc = isRecord(l.includes) ? l.includes : {}
  return {
    monthlyPayment: toNum(l.monthlyPayment, 0),
    upfront: toNum(l.upfront, 0),
    termMonths: Math.max(1, toNum(l.termMonths, DEFAULT_LEASE.termMonths)),
    includedKmPerYear: Math.max(0, toNum(l.includedKmPerYear, DEFAULT_LEASE.includedKmPerYear)),
    excessKmFee: Math.max(0, toNum(l.excessKmFee, 0)),
    includes: {
      insurance: inc.insurance === true,
      tax: inc.tax === true,
      maintenance: inc.maintenance === true,
      tires: inc.tires === true,
    },
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function isPowertrain(v: unknown): v is Powertrain {
  return v === 'petrol' || v === 'diesel' || v === 'ev' || v === 'phev'
}

function isFinancingMethod(v: unknown): v is FinancingMethod {
  return v === 'cash' || v === 'loan' || v === 'lease'
}

/**
 * A number out of stored JSON, however it was written.
 *
 * Strings get the same treatment the number inputs give typing: a comma decimal
 * and grouping spaces are both accepted. The app itself always writes real
 * numbers, so this is for everything that is not the app - a hand-edited export,
 * a spreadsheet, a locale that puts commas in decimals. `1,95` silently becoming
 * the default petrol price is a worse answer than reading it.
 */
function toNum(v: unknown, fallback: number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback
  if (typeof v !== 'string') return fallback
  const cleaned = v.replace(/[\s  ]/g, '').replace(',', '.')
  if (!cleaned) return fallback
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : fallback
}
