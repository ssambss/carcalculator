export type Powertrain = 'petrol' | 'diesel' | 'ev' | 'phev'

export type FinancingMethod = 'cash' | 'loan' | 'lease'

export interface Financing {
  /** cash, an annuity loan (the fields below) or a lease (see `CarListing.lease`) */
  method: FinancingMethod
  /** € paid upfront; the rest is the loan principal */
  downPayment: number
  /** nominal annual interest rate, e.g. 4.9 */
  annualRatePct: number
  termMonths: number
  /** use the standard balloon (25 % of purchase price) instead of a manual figure */
  autoBalloon: boolean
  /** manually set final installment (residual / balloon), used when autoBalloon is off */
  balloon: number
}

/** Yearly costs a full-service lease price already covers, so they aren't paid twice. */
export interface LeaseIncludes {
  insurance: boolean
  tax: boolean
  maintenance: boolean
  tires: boolean
}

/** Terms of a lease contract — used instead of purchase, resale and loan figures. */
export interface Lease {
  /** € / month, the contract rate */
  monthlyPayment: number
  /** € due at signing (enlarged first installment, delivery fees) — once per term */
  upfront: number
  termMonths: number
  /** km / year the contract allows; 0 means the contract sets no cap */
  includedKmPerYear: number
  /** € / km charged for driving past the allowance */
  excessKmFee: number
  includes: LeaseIncludes
}

export interface CarListing {
  id: string
  name: string
  notes: string
  /** part of the curated shortlist — synced, unlike the device-local compare selection */
  favorite: boolean
  /** how long THIS car would be kept, in years; 0 = use the shared assumption */
  keepYears: number
  powertrain: Powertrain
  purchasePrice: number
  /** km on the clock when bought */
  odometerKm: number
  /** estimate the resale value from age and mileage instead of a manual figure */
  autoResale: boolean
  /** manually set resale value at the end of the ownership period (used when autoResale is off) */
  expectedResaleValue: number
  financing: Financing
  /** lease terms — used only when `financing.method` is 'lease' */
  lease: Lease
  /** l/100km — used by petrol, diesel and phev */
  fuelLPer100: number
  /** kWh/100km — used by ev and phev */
  elecKwhPer100: number
  /** % of yearly km driven on electricity — phev only */
  electricSharePct: number
  insurancePerYear: number
  taxPerYear: number
  maintenancePerYear: number
  tiresPerYear: number
  otherPerYear: number
  createdAt: string
  /** last time this car itself was edited — used for per-car sync merging */
  updatedAt: string
}

/**
 * The financing a car starts with before a dealer has quoted anything.
 *
 * Yours, not everybody's. The listing watcher used to add cars on one hardcoded
 * baseline, which meant one person's assumptions about rates and term landed in
 * everyone's calculator - so it lives with your own data now, and applies to a
 * car you add by hand as much as to one that arrives from a reaction.
 *
 * A common baseline is the point: candidates are only comparable if they are
 * financed the same way until a real offer exists for one of them.
 */
export interface NewCarDefaults {
  /** € paid upfront */
  downPayment: number
  /** nominal annual interest rate, e.g. 4.9 */
  annualRatePct: number
  termMonths: number
  /** kWh/100km assumed for an EV or plug-in hybrid */
  elecKwhPer100: number
  /** l/100km assumed for petrol, diesel and a plug-in hybrid's engine */
  fuelLPer100: number
}

export interface Settings {
  annualKm: number
  ownershipYears: number
  /** €/l */
  petrolPrice: number
  /** €/l */
  dieselPrice: number
  /** €/kWh */
  electricityPrice: number
  /** what a newly added car assumes until it is refined */
  newCar: NewCarDefaults
}

export interface AppData {
  version: 1
  settings: Settings
  cars: CarListing[]
  /** deleted car ids → deletion time; lets deletes win over stale copies when syncing */
  tombstones: Record<string, string>
}
