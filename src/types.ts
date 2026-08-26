export type Powertrain = 'petrol' | 'diesel' | 'ev' | 'phev'

export type FinancingMethod = 'cash' | 'loan'

export interface Financing {
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

export interface CarListing {
  id: string
  name: string
  notes: string
  /** part of the curated shortlist — synced, unlike the device-local compare selection */
  favorite: boolean
  powertrain: Powertrain
  purchasePrice: number
  /** km on the clock when bought */
  odometerKm: number
  /** estimate the resale value from age and mileage instead of a manual figure */
  autoResale: boolean
  /** manually set resale value at the end of the ownership period (used when autoResale is off) */
  expectedResaleValue: number
  financing: Financing
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

export interface Settings {
  annualKm: number
  ownershipYears: number
  /** €/l */
  petrolPrice: number
  /** €/l */
  dieselPrice: number
  /** €/kWh */
  electricityPrice: number
}

export interface AppData {
  version: 1
  settings: Settings
  cars: CarListing[]
  /** deleted car ids → deletion time; lets deletes win over stale copies when syncing */
  tombstones: Record<string, string>
}
