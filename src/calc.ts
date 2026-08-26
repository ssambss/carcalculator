import type { CarListing, Settings } from './types'

/**
 * Cost categories in fixed display order. The `series` number maps to the
 * CSS custom properties --series-1..7 (validated categorical palette),
 * so a category keeps its color everywhere it appears.
 */
export const CATEGORIES = [
  { key: 'depreciation', label: 'Depreciation', series: 1 },
  { key: 'financing', label: 'Financing', series: 2 },
  { key: 'energy', label: 'Energy', series: 3 },
  { key: 'insurance', label: 'Insurance', series: 4 },
  { key: 'tax', label: 'Vehicle tax', series: 5 },
  { key: 'maintenance', label: 'Maintenance & tires', series: 6 },
  { key: 'other', label: 'Other', series: 7 },
] as const

export type CategoryKey = (typeof CATEGORIES)[number]['key']

export type Breakdown = Record<CategoryKey, number>

export interface LoanInfo {
  loanAmount: number
  monthlyPayment: number
  totalInterest: number
}

export interface TcoResult {
  breakdown: Breakdown
  /** total cost of ownership over the whole period */
  total: number
  perMonth: number
  perKm: number
  /** monthly outlay to keep the car on the road: energy, insurance, tax, maintenance, other */
  runningPerMonth: number
  loan: LoanInfo
}

/*
 * Resale estimate: purchase price decayed by pure age (garage queens lose
 * value too) and by mileage on a power curve, so the same kilometres cost a
 * nearly-new car more of its value than a high-mileage one. Calibrated to
 * roughly match Finnish used-market asking prices at ~15-20 000 km/yr.
 */
const RESALE_AGE_RATE = 0.04 // value lost per year regardless of driving
const RESALE_KM_OFFSET = 30000 // km — softens the curve for low-odometer cars
const RESALE_KM_EXP = 0.4 // mileage elasticity of value

export function estimateResaleValue(car: CarListing, settings: Settings): number {
  const years = Math.max(0, settings.ownershipYears)
  const kmStart = Math.max(0, car.odometerKm)
  const kmEnd = kmStart + Math.max(0, settings.annualKm) * years
  const ageFactor = Math.pow(1 - RESALE_AGE_RATE, years)
  const kmFactor = Math.pow(
    (kmEnd + RESALE_KM_OFFSET) / (kmStart + RESALE_KM_OFFSET),
    -RESALE_KM_EXP,
  )
  return Math.round(car.purchasePrice * ageFactor * kmFactor)
}

export function resolveResaleValue(car: CarListing, settings: Settings): number {
  return car.autoResale ? estimateResaleValue(car, settings) : car.expectedResaleValue
}

const NO_LOAN: LoanInfo = { loanAmount: 0, monthlyPayment: 0, totalInterest: 0 }

/** Standardized final balloon payment for loan financing: 25 % of purchase price. */
export const STANDARD_BALLOON_SHARE = 0.25

export function resolveBalloon(car: CarListing): number {
  const fin = car.financing
  if (fin.method !== 'loan') return 0
  return fin.autoBalloon
    ? Math.round(car.purchasePrice * STANDARD_BALLOON_SHARE)
    : Math.max(0, fin.balloon)
}

/**
 * Annuity loan with an optional balloon (residual) payment at the end of the
 * term. With monthly rate i over n months and balloon B, the payment is
 *   ((P - B/(1+i)^n) * i) / (1 - (1+i)^-n)
 * and the interest cost is everything paid beyond the principal.
 */
export function calcLoan(car: CarListing): LoanInfo {
  const fin = car.financing
  if (fin.method !== 'loan') return NO_LOAN
  const principal = Math.max(0, car.purchasePrice - Math.max(0, fin.downPayment))
  if (principal <= 0) return NO_LOAN
  const n = Math.max(1, Math.round(fin.termMonths))
  const balloon = Math.min(resolveBalloon(car), principal)
  const i = Math.max(0, fin.annualRatePct) / 100 / 12
  let payment: number
  if (i === 0) {
    payment = (principal - balloon) / n
  } else {
    const growth = Math.pow(1 + i, n)
    payment = ((principal - balloon / growth) * i) / (1 - 1 / growth)
  }
  const totalPaid = payment * n + balloon
  return {
    loanAmount: principal,
    monthlyPayment: payment,
    totalInterest: Math.max(0, totalPaid - principal),
  }
}

export function energyCostPerYear(car: CarListing, settings: Settings): number {
  const km = Math.max(0, settings.annualKm)
  switch (car.powertrain) {
    case 'petrol':
      return (km / 100) * car.fuelLPer100 * settings.petrolPrice
    case 'diesel':
      return (km / 100) * car.fuelLPer100 * settings.dieselPrice
    case 'ev':
      return (km / 100) * car.elecKwhPer100 * settings.electricityPrice
    case 'phev': {
      const share = Math.min(100, Math.max(0, car.electricSharePct)) / 100
      const electric = ((km * share) / 100) * car.elecKwhPer100 * settings.electricityPrice
      const fuel = ((km * (1 - share)) / 100) * car.fuelLPer100 * settings.petrolPrice
      return electric + fuel
    }
  }
}

export function calcTco(car: CarListing, settings: Settings): TcoResult {
  const years = Math.max(0, settings.ownershipYears)
  const months = years * 12
  const totalKm = Math.max(0, settings.annualKm) * years
  const loan = calcLoan(car)
  const breakdown: Breakdown = {
    depreciation: Math.max(0, car.purchasePrice - Math.max(0, resolveResaleValue(car, settings))),
    financing: loan.totalInterest,
    energy: energyCostPerYear(car, settings) * years,
    insurance: car.insurancePerYear * years,
    tax: car.taxPerYear * years,
    maintenance: (car.maintenancePerYear + car.tiresPerYear) * years,
    other: car.otherPerYear * years,
  }
  const total = CATEGORIES.reduce((sum, c) => sum + breakdown[c.key], 0)
  const running =
    breakdown.energy + breakdown.insurance + breakdown.tax + breakdown.maintenance + breakdown.other
  return {
    breakdown,
    total,
    perMonth: months > 0 ? total / months : 0,
    perKm: totalKm > 0 ? total / totalKm : 0,
    runningPerMonth: months > 0 ? running / months : 0,
    loan,
  }
}
