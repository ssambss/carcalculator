import type { CarListing, Settings } from './types'

/**
 * Cost categories in fixed display order. The `series` number maps to the
 * CSS custom properties --series-1..8 (validated categorical palette),
 * so a category keeps its color everywhere it appears.
 *
 * Lease sits last on purpose: a leased car has no depreciation or loan
 * interest, so its bar starts at Energy, and red-next-to-aqua is the one
 * adjacency in this palette that drops into the colorblind-warning band.
 */
export const CATEGORIES = [
  { key: 'depreciation', label: 'Depreciation', series: 1 },
  { key: 'financing', label: 'Financing', series: 2 },
  { key: 'energy', label: 'Energy', series: 3 },
  { key: 'insurance', label: 'Insurance', series: 4 },
  { key: 'tax', label: 'Vehicle tax', series: 5 },
  { key: 'maintenance', label: 'Maintenance & tires', series: 6 },
  { key: 'other', label: 'Other', series: 7 },
  { key: 'lease', label: 'Lease payments', series: 8 },
] as const

export type CategoryKey = (typeof CATEGORIES)[number]['key']

export type Breakdown = Record<CategoryKey, number>

export interface LoanInfo {
  loanAmount: number
  monthlyPayment: number
  totalInterest: number
}

export interface LeaseInfo {
  /** the contract's monthly rate */
  monthlyPayment: number
  /** upfront payments falling inside the comparison period (one per term started) */
  termsStarted: number
  /** rates + upfronts over the comparison period */
  payments: number
  /** km / yr driven past the contract's allowance */
  excessKmPerYear: number
  /** cost of those kilometres over the comparison period */
  excessKmCost: number
  /** payments + excess kilometres — what lands in the breakdown */
  total: number
  /** everything above spread over the comparison period */
  perMonth: number
}

export interface TcoResult {
  breakdown: Breakdown
  /** the comparison period this car was costed over (its own, or the shared assumption) */
  years: number
  /** total cost of ownership over the whole period */
  total: number
  perMonth: number
  perKm: number
  /** monthly outlay to keep the car on the road: energy, insurance, tax, maintenance, other */
  runningPerMonth: number
  loan: LoanInfo
  lease: LeaseInfo
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

/**
 * The period this car is compared over: its own `keepYears` when set (a lease
 * kept for its 18-month term, a purchase held for 6 years), otherwise the
 * shared assumption. €/month and €/km stay comparable across periods; totals
 * are each over the car's own period.
 */
export function resolveYears(car: CarListing, settings: Settings): number {
  return car.keepYears > 0 ? car.keepYears : Math.max(0, settings.ownershipYears)
}

export function estimateResaleValue(car: CarListing, settings: Settings): number {
  const years = resolveYears(car, settings)
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
 *
 * With `horizonMonths` set, `totalInterest` is only the interest actually
 * accrued by then — selling at that point settles the remaining principal
 * (balloon included), which is capital, not cost. Without it, the full term.
 */
export function calcLoan(car: CarListing, horizonMonths?: number): LoanInfo {
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
  let totalInterest = Math.max(0, totalPaid - principal)
  if (horizonMonths !== undefined) {
    const m = Math.min(n, Math.max(0, Math.round(horizonMonths)))
    if (m < n) {
      if (i === 0) {
        totalInterest = 0
      } else {
        const grownToM = Math.pow(1 + i, m)
        const remaining = principal * grownToM - (payment * (grownToM - 1)) / i
        const principalRepaid = principal - remaining
        totalInterest = Math.max(0, payment * m - principalRepaid)
      }
    }
  }
  return {
    loanAmount: principal,
    monthlyPayment: payment,
    totalInterest,
  }
}

const NO_LEASE: LeaseInfo = {
  monthlyPayment: 0,
  termsStarted: 0,
  payments: 0,
  excessKmPerYear: 0,
  excessKmCost: 0,
  total: 0,
  perMonth: 0,
}

export function isLeased(car: CarListing): boolean {
  return car.financing.method === 'lease'
}

/**
 * Cost of a lease over the comparison period. Where the period outlasts the
 * contract the assumption is that you lease again on the same terms, so the
 * rate runs for the whole period and the signing payment is charged once per
 * term started — that keeps a 36-month lease comparable with a car you keep
 * for five years instead of making its last two years look free.
 *
 * Driving past the mileage allowance is billed per kilometre. An allowance of
 * 0 means the contract sets no cap, not that every kilometre costs extra.
 */
export function calcLease(car: CarListing, settings: Settings): LeaseInfo {
  if (!isLeased(car)) return NO_LEASE
  const lease = car.lease
  const years = resolveYears(car, settings)
  const months = years * 12
  const term = Math.max(1, Math.round(lease.termMonths))
  const termsStarted = Math.ceil(months / term)
  const payments =
    Math.max(0, lease.monthlyPayment) * months + Math.max(0, lease.upfront) * termsStarted
  const allowance = Math.max(0, lease.includedKmPerYear)
  const excessKmPerYear =
    allowance > 0 ? Math.max(0, Math.max(0, settings.annualKm) - allowance) : 0
  const excessKmCost = excessKmPerYear * Math.max(0, lease.excessKmFee) * years
  const total = payments + excessKmCost
  return {
    monthlyPayment: Math.max(0, lease.monthlyPayment),
    termsStarted,
    payments,
    excessKmPerYear,
    excessKmCost,
    total,
    perMonth: months > 0 ? total / months : 0,
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
  const years = resolveYears(car, settings)
  const months = years * 12
  const totalKm = Math.max(0, settings.annualKm) * years
  const loan = calcLoan(car, months)
  const lease = calcLease(car, settings)
  // A full-service lease can already cover some yearly costs; those are held in
  // the car (so unticking a box brings the figure back) but cost nothing here.
  const covered = isLeased(car) ? car.lease.includes : null
  const yearly = (value: number, includedInLease: boolean) =>
    (covered && includedInLease ? 0 : value) * years
  const breakdown: Breakdown = {
    depreciation: isLeased(car)
      ? 0 // a lease is handed back — no purchase price to lose value
      : Math.max(0, car.purchasePrice - Math.max(0, resolveResaleValue(car, settings))),
    financing: loan.totalInterest,
    energy: energyCostPerYear(car, settings) * years,
    insurance: yearly(car.insurancePerYear, Boolean(covered?.insurance)),
    tax: yearly(car.taxPerYear, Boolean(covered?.tax)),
    maintenance:
      yearly(car.maintenancePerYear, Boolean(covered?.maintenance)) +
      yearly(car.tiresPerYear, Boolean(covered?.tires)),
    other: car.otherPerYear * years,
    lease: lease.total,
  }
  const total = CATEGORIES.reduce((sum, c) => sum + breakdown[c.key], 0)
  const running =
    breakdown.energy + breakdown.insurance + breakdown.tax + breakdown.maintenance + breakdown.other
  return {
    breakdown,
    years,
    total,
    perMonth: months > 0 ? total / months : 0,
    perKm: totalKm > 0 ? total / totalKm : 0,
    runningPerMonth: months > 0 ? running / months : 0,
    loan,
    lease,
  }
}
