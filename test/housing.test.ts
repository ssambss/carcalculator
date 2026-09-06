// The housing maths: the ceiling, what binds it, and what a candidate costs.
//
// Same discipline as the car tests: the point is not to pin arithmetic but the
// decisions - which of the four constraints set the ceiling, why the stress
// test uses 25 years whatever the term says, why a candidate's loan is derived
// from the buyer's savings rather than typed in. The reference figures are
// computed independently (annuity tables and by hand), not read back from the
// code.

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_HOUSING,
  HOUSING_CATEGORIES,
  affordability,
  maxLoanForPayment,
  paymentForLoan,
  propertyCost,
  type HousingSituation,
  type PropertyListing,
} from '../src/housing'
import { calcLoan } from '../src/calc'
import { newCar } from '../src/storage'

const situation = (over: Partial<HousingSituation> = {}): HousingSituation => ({
  ...DEFAULT_HOUSING,
  netIncomePerMonth: 3400,
  otherLoanPaymentsPerMonth: 190,
  savings: 40000,
  maintenanceEstimatePerMonth: 250,
  ratePct: 3.5,
  termYears: 25,
  ...over,
})

const flat = (over: Partial<PropertyListing> = {}): PropertyListing => ({
  id: 'p1',
  name: 'Kamppi 58 m²',
  notes: '',
  favorite: false,
  price: 249000,
  sizeM2: 58,
  maintenancePerMonth: 245,
  financingChargePerMonth: 0,
  otherPerMonth: 20,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

describe('the annuity, both ways round', () => {
  it('inverts to the textbook figure', () => {
    // 1 000 €/mo at 6 % over 25 years carries 155 207 € - annuity factor
    // (1 - 1.005^-300) / 0.005 = 155.2069.
    expect(maxLoanForPayment(1000, 6, 300)).toBeCloseTo(155207, 0)
  })

  it('degenerates to simple division at zero per cent', () => {
    expect(maxLoanForPayment(1000, 0, 300)).toBe(300000)
    expect(paymentForLoan(300000, 0, 300)).toBe(1000)
  })

  it('is the exact inverse of the payment', () => {
    const loan = maxLoanForPayment(750, 6, 300)
    expect(paymentForLoan(loan, 6, 300)).toBeCloseTo(750, 6)
  })

  it('agrees with the car module about what a loan costs', () => {
    // Two implementations of the same annuity exist - calc.ts for cars, this
    // one for housing. If they ever drift apart, one of them is lying.
    const car = {
      ...newCar(),
      purchasePrice: 212735,
      financing: {
        method: 'loan' as const,
        downPayment: 0,
        annualRatePct: 3.5,
        termMonths: 300,
        autoBalloon: false,
        balloon: 0,
      },
    }
    expect(calcLoan(car).monthlyPayment).toBeCloseTo(paymentForLoan(212735, 3.5, 300), 6)
  })

  it('handles the empty cases without infinities', () => {
    expect(maxLoanForPayment(0, 6, 300)).toBe(0)
    expect(maxLoanForPayment(-100, 6, 300)).toBe(0)
    expect(paymentForLoan(0, 6, 300)).toBe(0)
    expect(maxLoanForPayment(1000, 6, 0)).toBe(0)
  })
})

describe('the ceiling', () => {
  it('is usually set by the stress test, and says so', () => {
    // Budget: 3 400 × 35 % − 190 − 250 = 750 €/mo.
    // At 3.5 %/25 y that carries ~149 800; at the 6 % stress rate only
    // ~116 405 - so the stress test binds, as it does for most real buyers.
    // Price: (40 000 + 116 405.2) / 1.015 ≈ 154 093.7.
    const a = affordability(situation())
    expect(a.paymentBudget).toBeCloseTo(750, 6)
    expect(a.maxLoanByStress).toBeCloseTo(116405, 0)
    expect(a.maxLoanByStress).toBeLessThan(a.maxLoanByPayment)
    expect(a.limitedBy).toBe('stress')
    expect(a.maxPrice).toBeCloseTo(154093.7, 0)
    expect(a.loan).toBeCloseTo(116405, 0)
    expect(a.downPayment).toBeCloseTo(154093.7 - 116405.2, 0)
  })

  it('is set by savings when income could carry more', () => {
    // 2 100 €/mo of budget carries ~325 900 even under stress, but 20 000 € of
    // savings must cover the 10 % cash share plus 1.5 % tax:
    // price ≤ 20 000 / 0.115 ≈ 173 913.
    const a = affordability(
      situation({
        netIncomePerMonth: 6000,
        otherLoanPaymentsPerMonth: 0,
        maintenanceEstimatePerMonth: 0,
        savings: 20000,
      }),
    )
    expect(a.limitedBy).toBe('savings')
    expect(a.maxPrice).toBeCloseTo(173913, 0)
    // At the savings-limited ceiling the loan sits exactly on the LTV cap.
    expect(a.loan).toBeCloseTo(0.9 * a.maxPrice, 0)
  })

  it('is set by income when the stress test is not the tighter screw', () => {
    // Stress rate equal to the own rate: the test adds nothing, income binds.
    const a = affordability(situation({ stressRatePct: 3.5 }))
    expect(a.limitedBy).toBe('income')
    expect(a.maxLoanByStress).toBeCloseTo(a.maxLoanByPayment, 4)
  })

  it('caps the stress term at 25 years however long the loan is', () => {
    // A 30-year term lowers the real payment, but the bank still tests it as
    // 25 - a longer term must not make the stress loan look bigger.
    const at25 = affordability(situation({ termYears: 25 }))
    const at30 = affordability(situation({ termYears: 30 }))
    expect(at30.maxLoanByStress).toBeCloseTo(at25.maxLoanByStress, 4)
    // The own-rate loan does grow with the longer term.
    expect(at30.maxLoanByPayment).toBeGreaterThan(at25.maxLoanByPayment)
  })

  it('lets pure savings buy with no income at all', () => {
    // No income means no loan - but 100 000 € in cash still buys a
    // 100 000 / 1.015 ≈ 98 522 € flat plus its transfer tax.
    const a = affordability(situation({ netIncomePerMonth: 0, savings: 100000 }))
    expect(a.loan).toBe(0)
    expect(a.maxPrice).toBeCloseTo(98522, 0)
    expect(a.downPayment).toBeCloseTo(a.maxPrice, 0)
  })

  it('spends the flat buying costs before anything else', () => {
    const without = affordability(situation({ buyingCosts: 0 }))
    const withCosts = affordability(situation({ buyingCosts: 2000 }))
    expect(withCosts.maxPrice).toBeLessThan(without.maxPrice)
  })

  it('collapses to zero rather than to nonsense when there is nothing', () => {
    const a = affordability(situation({ netIncomePerMonth: 0, savings: 0 }))
    expect(a.maxPrice).toBe(0)
    expect(a.loan).toBe(0)
    expect(Number.isFinite(a.maxPrice)).toBe(true)
  })

  it('checks payment consistency: the ceiling loan really costs the budget under stress', () => {
    // The stress-limited loan was sized so its stress payment equals the
    // budget; anything else means the inversion is wrong.
    const a = affordability(situation())
    expect(a.paymentAtStress).toBeCloseTo(a.paymentBudget, 0)
    expect(a.paymentAtRate).toBeLessThan(a.paymentBudget)
  })
})

describe('what a candidate costs', () => {
  const s = situation()
  const ceiling = affordability(s).maxPrice

  it('derives the loan from the buyer, not from a field on the flat', () => {
    // Price plus tax minus every euro of savings: 249 000 × 1.015 − 40 000.
    const c = propertyCost(flat(), s, ceiling)
    expect(c.loan).toBeCloseTo(249000 * 1.015 - 40000, 4)
    expect(c.downPayment).toBeCloseTo(249000 - c.loan, 4)
  })

  it('prices the monthly bill: annuity plus the charges', () => {
    const c = propertyCost(flat(), s, ceiling)
    // 212 735 at 3.5 %/25 y ≈ 1 065 €/mo, plus 245 + 0 + 20 of charges.
    expect(c.loanPayment).toBeCloseTo(1065, 0)
    expect(c.totalPerMonth).toBeCloseTo(c.loanPayment + 265, 6)
  })

  it('splits the first payment into interest and principal that add up', () => {
    const c = propertyCost(flat(), s, ceiling)
    // First month interest: loan × 3.5 %/12 ≈ 620 €.
    expect(c.breakdown.interest).toBeCloseTo((c.loan * 0.035) / 12, 4)
    expect(c.breakdown.interest + c.breakdown.principal).toBeCloseTo(c.loanPayment, 4)
  })

  it('counts principal out of the cost, because it buys equity', () => {
    const c = propertyCost(flat(), s, ceiling)
    expect(c.costPerMonth).toBeCloseTo(c.totalPerMonth - c.breakdown.principal, 6)
    expect(c.costPerMonth).toBeLessThan(c.totalPerMonth)
  })

  it('measures against the ceiling', () => {
    expect(propertyCost(flat({ price: 120000 }), s, ceiling).fits).toBe(true)
    expect(propertyCost(flat({ price: 500000 }), s, ceiling).fits).toBe(false)
  })

  it('handles a place cheap enough to buy outright', () => {
    const c = propertyCost(flat({ price: 30000 }), s, ceiling)
    expect(c.loan).toBe(0)
    expect(c.loanPayment).toBe(0)
    expect(c.breakdown.interest).toBe(0)
    // Only the charges remain.
    expect(c.totalPerMonth).toBeCloseTo(265, 6)
  })

  it('gives €/m² only when a size is known', () => {
    expect(propertyCost(flat(), s, ceiling).pricePerM2).toBeCloseTo(249000 / 58, 4)
    expect(propertyCost(flat({ sizeM2: 0 }), s, ceiling).pricePerM2).toBeNull()
  })

  it('keeps every breakdown key a declared category', () => {
    // The bar renders whatever the categories declare; a key that is not
    // declared is money that silently never shows.
    const c = propertyCost(flat(), s, ceiling)
    const declared = HOUSING_CATEGORIES.map((cat) => cat.key).sort()
    expect(Object.keys(c.breakdown).sort()).toEqual(declared)
  })
})
