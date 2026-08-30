// The money. Every number the app shows comes through here, and until now none
// of it was tested.
//
// The point of these is not to pin arithmetic - a spreadsheet does that - but to
// pin the *decisions*: which costs a lease has and does not, what a balloon does
// to a payment, why selling before the term ends is not the same as paying it
// off, and which figure is the budget line versus the economic one. Those are
// the things a refactor breaks silently.

import { describe, expect, it } from 'vitest'

import {
  CATEGORIES,
  STANDARD_BALLOON_SHARE,
  calcLease,
  calcLoan,
  calcTco,
  energyCostPerYear,
  estimateResaleValue,
  isLeased,
  resolveBalloon,
  resolveResaleValue,
  resolveYears,
} from '../src/calc'
import { DEFAULT_SETTINGS, newCar } from '../src/storage'
import type { CarListing, Settings } from '../src/types'

const settings: Settings = { ...DEFAULT_SETTINGS, annualKm: 20000, ownershipYears: 5 }

/** A cash-bought petrol car with round numbers, so a total can be read by eye. */
function car(overrides: Partial<CarListing> = {}): CarListing {
  return {
    ...newCar(),
    name: 'Test',
    purchasePrice: 30000,
    odometerKm: 0,
    autoResale: false,
    expectedResaleValue: 15000,
    fuelLPer100: 8,
    ...overrides,
  }
}

describe('the comparison period', () => {
  it('uses the shared assumption unless the car overrides it', () => {
    expect(resolveYears(car(), settings)).toBe(5)
    // A lease kept for its 18-month term against a car held for six years: both
    // are legitimate, and comparing them needs each over its own period.
    expect(resolveYears(car({ keepYears: 1.5 }), settings)).toBe(1.5)
  })

  it('never goes negative, whatever the settings say', () => {
    expect(resolveYears(car(), { ...settings, ownershipYears: -3 })).toBe(0)
  })
})

describe('resale value', () => {
  it('falls with both age and mileage', () => {
    const base = estimateResaleValue(car({ purchasePrice: 30000 }), settings)
    const older = estimateResaleValue(car({ purchasePrice: 30000 }), {
      ...settings,
      ownershipYears: 8,
    })
    const driven = estimateResaleValue(car({ purchasePrice: 30000 }), {
      ...settings,
      annualKm: 40000,
    })
    expect(older).toBeLessThan(base)
    expect(driven).toBeLessThan(base)
  })

  it('loses value to age even when the car never moves', () => {
    // A garage queen still depreciates, which is why age is its own term.
    const parked = estimateResaleValue(car({ purchasePrice: 30000 }), {
      ...settings,
      annualKm: 0,
    })
    expect(parked).toBeLessThan(30000)
    expect(parked).toBeGreaterThan(0)
  })

  it('costs a nearly-new car more of its value than a high-mileage one', () => {
    // The mileage curve is the reason: the same 100 000 km hurts a fresh car far
    // more than one that has already done 200 000.
    const fresh = car({ purchasePrice: 30000, odometerKm: 0 })
    const worn = car({ purchasePrice: 30000, odometerKm: 200000 })
    const lossFresh = 30000 - estimateResaleValue(fresh, settings)
    const lossWorn = 30000 - estimateResaleValue(worn, settings)
    expect(lossFresh).toBeGreaterThan(lossWorn)
  })

  it('honours a manual figure when auto-estimation is off', () => {
    expect(resolveResaleValue(car({ autoResale: false, expectedResaleValue: 12345 }), settings)).toBe(
      12345,
    )
    expect(resolveResaleValue(car({ autoResale: true }), settings)).not.toBe(12345)
  })
})

describe('the loan', () => {
  const loaned = (overrides = {}) =>
    car({
      purchasePrice: 30000,
      financing: {
        method: 'loan',
        downPayment: 0,
        annualRatePct: 6,
        termMonths: 60,
        autoBalloon: false,
        balloon: 0,
        ...overrides,
      },
    })

  it('costs nothing when the car is bought for cash', () => {
    const cash = calcLoan(car())
    expect(cash.loanAmount).toBe(0)
    expect(cash.monthlyPayment).toBe(0)
    expect(cash.totalInterest).toBe(0)
  })

  it('borrows only what is not paid upfront', () => {
    expect(calcLoan(loaned({ downPayment: 10000 })).loanAmount).toBe(20000)
  })

  it('charges no interest at zero per cent, but still splits the principal', () => {
    const free = calcLoan(loaned({ annualRatePct: 0 }))
    expect(free.totalInterest).toBe(0)
    expect(free.monthlyPayment).toBeCloseTo(30000 / 60, 6)
  })

  it('produces the textbook annuity payment', () => {
    // 30 000 € at 6 % nominal over 60 months. i = 0.005/month.
    // ((P) * i) / (1 - (1+i)^-n) = 579.98...
    const { monthlyPayment, totalInterest } = calcLoan(loaned())
    expect(monthlyPayment).toBeCloseTo(579.98, 1)
    expect(totalInterest).toBeCloseTo(monthlyPayment * 60 - 30000, 4)
  })

  it('lowers the payment with a balloon but does not make the loan cheaper', () => {
    // The balloon defers principal rather than forgiving it, so the monthly
    // figure drops while total interest rises - the money is borrowed longer.
    const plain = calcLoan(loaned())
    const ballooned = calcLoan(loaned({ autoBalloon: true }))
    expect(ballooned.monthlyPayment).toBeLessThan(plain.monthlyPayment)
    expect(ballooned.totalInterest).toBeGreaterThan(plain.totalInterest)
  })

  it('uses a quarter of the purchase price as the standard balloon', () => {
    expect(STANDARD_BALLOON_SHARE).toBe(0.25)
    expect(resolveBalloon(loaned({ autoBalloon: true }))).toBe(7500)
    expect(resolveBalloon(loaned({ autoBalloon: false, balloon: 4000 }))).toBe(4000)
    // Cash and lease have no balloon to resolve.
    expect(resolveBalloon(car())).toBe(0)
  })

  it('counts only the interest accrued by the time the car is sold', () => {
    // Selling two years into a five-year loan settles the remaining principal.
    // That is capital, not cost, so a shorter horizon must cost less interest.
    const full = calcLoan(loaned())
    const early = calcLoan(loaned(), 24)
    expect(early.totalInterest).toBeLessThan(full.totalInterest)
    expect(early.monthlyPayment).toBeCloseTo(full.monthlyPayment, 6)
  })

  it('does not credit interest back for holding the car past the term', () => {
    const full = calcLoan(loaned())
    expect(calcLoan(loaned(), 120).totalInterest).toBeCloseTo(full.totalInterest, 4)
  })
})

describe('the lease', () => {
  const leased = (overrides = {}, leaseOverrides = {}) =>
    car({
      financing: { ...newCar().financing, method: 'lease' },
      lease: {
        monthlyPayment: 400,
        upfront: 1000,
        termMonths: 36,
        includedKmPerYear: 20000,
        excessKmFee: 0.1,
        includes: { insurance: false, tax: false, maintenance: false, tires: false },
        ...leaseOverrides,
      },
      ...overrides,
    })

  it('knows a leased car from a bought one', () => {
    expect(isLeased(leased())).toBe(true)
    expect(isLeased(car())).toBe(false)
  })

  it('charges the signing payment once per term started, not once ever', () => {
    // Five years against a 36-month contract means leasing again, so the
    // upfront is paid twice. Charging it once would make the last two years
    // look free.
    const over5 = calcLease(leased(), settings)
    expect(over5.termsStarted).toBe(2)
    expect(over5.payments).toBeCloseTo(400 * 60 + 1000 * 2, 4)
  })

  it('charges it once when the period fits inside one term', () => {
    const over3 = calcLease(leased({ keepYears: 3 }), settings)
    expect(over3.termsStarted).toBe(1)
    expect(over3.payments).toBeCloseTo(400 * 36 + 1000, 4)
  })

  it('bills the kilometres driven past the allowance', () => {
    const over = calcLease(leased(), { ...settings, annualKm: 30000 })
    expect(over.excessKmPerYear).toBe(10000)
    expect(over.excessKmCost).toBeCloseTo(10000 * 0.1 * 5, 4)
    expect(over.total).toBeCloseTo(over.payments + over.excessKmCost, 4)
  })

  it('bills nothing extra when the contract caps nothing', () => {
    // includedKmPerYear of 0 means no cap at all, not an allowance of zero -
    // reading it the other way would invent a fee for every kilometre driven.
    const uncapped = calcLease(leased({}, { includedKmPerYear: 0 }), {
      ...settings,
      annualKm: 50000,
    })
    expect(uncapped.excessKmPerYear).toBe(0)
    expect(uncapped.excessKmCost).toBe(0)
  })

  it('costs nothing on a car that is not leased', () => {
    expect(calcLease(car(), settings).total).toBe(0)
  })
})

describe('energy', () => {
  it('bills petrol and diesel at their own prices', () => {
    const petrol = energyCostPerYear(car({ powertrain: 'petrol', fuelLPer100: 8 }), settings)
    const diesel = energyCostPerYear(car({ powertrain: 'diesel', fuelLPer100: 8 }), settings)
    expect(petrol).toBeCloseTo((8 / 100) * 20000 * settings.petrolPrice, 4)
    expect(diesel).toBeCloseTo((8 / 100) * 20000 * settings.dieselPrice, 4)
  })

  it('bills an EV in kilowatt-hours and ignores its fuel figure', () => {
    const ev = car({ powertrain: 'ev', elecKwhPer100: 20, fuelLPer100: 99 })
    expect(energyCostPerYear(ev, settings)).toBeCloseTo(
      (20 / 100) * 20000 * settings.electricityPrice,
      4,
    )
  })

  it('splits a plug-in hybrid by its electric share', () => {
    const phev = car({
      powertrain: 'phev',
      electricSharePct: 50,
      elecKwhPer100: 20,
      fuelLPer100: 6,
    })
    const km = 20000
    const expected =
      (20 / 100) * (km * 0.5) * settings.electricityPrice +
      (6 / 100) * (km * 0.5) * settings.petrolPrice
    expect(energyCostPerYear(phev, settings)).toBeCloseTo(expected, 4)
  })

  it('is free when the car never moves', () => {
    expect(energyCostPerYear(car(), { ...settings, annualKm: 0 })).toBe(0)
  })
})

describe('the total', () => {
  it('adds up to exactly the sum of its categories', () => {
    // The breakdown bar and the total are the same number seen twice; if they
    // ever disagree, one of them is lying to the user.
    const result = calcTco(car(), settings)
    const summed = CATEGORIES.reduce((sum, c) => sum + result.breakdown[c.key], 0)
    expect(result.total).toBeCloseTo(summed, 6)
  })

  it('costs a cash car its depreciation and nothing else', () => {
    const result = calcTco(
      car({ purchasePrice: 30000, expectedResaleValue: 15000, fuelLPer100: 0 }),
      settings,
    )
    expect(result.breakdown.depreciation).toBe(15000)
    expect(result.breakdown.financing).toBe(0)
    expect(result.breakdown.lease).toBe(0)
    expect(result.total).toBe(15000)
  })

  it('never counts depreciation as a gain', () => {
    // A resale value above the purchase price would otherwise pay for the fuel.
    const result = calcTco(car({ purchasePrice: 10000, expectedResaleValue: 25000 }), settings)
    expect(result.breakdown.depreciation).toBe(0)
  })

  it('gives a leased car no depreciation, because it is handed back', () => {
    const result = calcTco(
      car({
        financing: { ...newCar().financing, method: 'lease' },
        lease: {
          monthlyPayment: 400,
          upfront: 0,
          termMonths: 60,
          includedKmPerYear: 0,
          excessKmFee: 0,
          includes: { insurance: false, tax: false, maintenance: false, tires: false },
        },
      }),
      settings,
    )
    expect(result.breakdown.depreciation).toBe(0)
    expect(result.breakdown.lease).toBeCloseTo(400 * 60, 4)
  })

  it('does not charge for what a lease price already covers', () => {
    // Held on the car rather than zeroed, so unticking the box brings the
    // figure back - but not billed twice while the box is ticked.
    const base = {
      financing: { ...newCar().financing, method: 'lease' as const },
      insurancePerYear: 800,
      taxPerYear: 200,
      maintenancePerYear: 500,
      tiresPerYear: 300,
    }
    const lease = {
      monthlyPayment: 400,
      upfront: 0,
      termMonths: 60,
      includedKmPerYear: 0,
      excessKmFee: 0,
    }
    const paying = calcTco(
      car({
        ...base,
        lease: { ...lease, includes: { insurance: false, tax: false, maintenance: false, tires: false } },
      }),
      settings,
    )
    const covered = calcTco(
      car({
        ...base,
        lease: { ...lease, includes: { insurance: true, tax: true, maintenance: true, tires: true } },
      }),
      settings,
    )
    expect(paying.breakdown.insurance).toBeCloseTo(800 * 5, 4)
    expect(covered.breakdown.insurance).toBe(0)
    expect(covered.breakdown.tax).toBe(0)
    expect(covered.breakdown.maintenance).toBe(0)
    expect(covered.total).toBeLessThan(paying.total)
  })

  it('keeps a bought car paying its own insurance even if the lease boxes are ticked', () => {
    // The toggles belong to the lease. A car that is not leased must ignore them.
    const result = calcTco(
      car({
        insurancePerYear: 800,
        lease: { ...newCar().lease, includes: { insurance: true, tax: true, maintenance: true, tires: true } },
      }),
      settings,
    )
    expect(result.breakdown.insurance).toBeCloseTo(800 * 5, 4)
  })
})

describe('the two monthly figures', () => {
  // They answer different questions and are routinely confused, which is why
  // the app shows both.
  const loaned = car({
    purchasePrice: 30000,
    expectedResaleValue: 15000,
    fuelLPer100: 0,
    insurancePerYear: 1200,
    financing: {
      method: 'loan',
      downPayment: 0,
      annualRatePct: 6,
      termMonths: 60,
      autoBalloon: false,
      balloon: 0,
    },
  })

  it('has out-of-pocket carry the loan payment where the economic one does not', () => {
    const result = calcTco(loaned, settings)
    // Out of pocket: what leaves the account - the annuity plus running costs.
    expect(result.outOfPocketPerMonth).toBeCloseTo(
      result.loan.monthlyPayment + result.runningPerMonth,
      6,
    )
    // Economic: depreciation and interest, with the resale value netted out. It
    // does not include repaying the principal, because that buys an asset.
    expect(result.perMonth).toBeCloseTo(result.total / 60, 6)
    expect(result.outOfPocketPerMonth).toBeGreaterThan(result.perMonth)
  })

  it('counts only running costs out of pocket for a cash car', () => {
    const cash = calcTco(car({ fuelLPer100: 0, insurancePerYear: 1200 }), settings)
    expect(cash.outOfPocketPerMonth).toBeCloseTo(cash.runningPerMonth, 6)
    expect(cash.runningPerMonth).toBeCloseTo(1200 / 12, 6)
  })

  it('leaves running costs out of the financing figures', () => {
    const result = calcTco(loaned, settings)
    expect(result.runningPerMonth).toBeCloseTo(1200 / 12, 6)
  })
})

describe('a period of zero', () => {
  it('divides by nothing rather than producing Infinity', () => {
    // Reachable: ownershipYears can be set to 0, and the app must not render
    // Infinity € / month at anybody.
    const result = calcTco(car(), { ...settings, ownershipYears: 0 })
    expect(Number.isFinite(result.perMonth)).toBe(true)
    expect(Number.isFinite(result.perKm)).toBe(true)
    expect(result.perMonth).toBe(0)
    expect(result.perKm).toBe(0)
  })
})
