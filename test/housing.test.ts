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
  splitLoan,
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

describe('buying together', () => {
  it('makes a couple exactly the sum of its parts', () => {
    // The bank sizes one household: a partner's income, obligations and
    // savings count in full, nothing more and nothing less. So a couple must
    // produce the identical result to one borrower holding the summed figures.
    const couple = situation({
      buyingTogether: true,
      partnerNetIncomePerMonth: 2600,
      partnerOtherLoanPaymentsPerMonth: 150,
      partnerSavings: 20000,
    })
    const summed = situation({
      netIncomePerMonth: 3400 + 2600,
      otherLoanPaymentsPerMonth: 190 + 150,
      savings: 40000 + 20000,
    })
    expect(affordability(couple)).toEqual(affordability(summed))
    expect(propertyCost(flat(), couple, 0)).toEqual(propertyCost(flat(), summed, 0))
  })

  it('keeps the partner fields inert until the toggle is on', () => {
    // Filled-in partner figures with the toggle off must change nothing - a
    // couple that splits up does not want ghost income in the ceiling.
    const off = situation({ partnerNetIncomePerMonth: 5000, partnerSavings: 100000 })
    expect(affordability(off)).toEqual(affordability(situation()))
  })

  it('raises the ceiling with the partner income, budget first', () => {
    // Second income 2 600 €: budget (6 000 × 35 %) − 190 − 250 = 1 660 €/mo,
    // carrying 1 660 × 155.2069 ≈ 257 643 under stress. Savings unchanged.
    const a = affordability(situation({ buyingTogether: true, partnerNetIncomePerMonth: 2600 }))
    expect(a.paymentBudget).toBeCloseTo(1660, 6)
    expect(a.maxLoanByStress).toBeCloseTo(257643, 0)
  })

  it('puts the partner savings into a candidate loan', () => {
    // 249 000 × 1.015 − (40 000 + 20 000) = 192 735.
    const couple = situation({ buyingTogether: true, partnerSavings: 20000 })
    const c = propertyCost(flat(), couple, 0)
    expect(c.loan).toBeCloseTo(192735, 4)
  })
})

describe('the ASP split', () => {
  // Annuity factors used in the hand references:
  //   3.0 % / 300 mo → 210.8745    3.5 % / 300 mo → 199.7510
  const asp = (over: Partial<HousingSituation> = {}) =>
    situation({ useAspLoan: true, aspRatePct: 3.0, aspMaxLoan: 230000, ...over })

  it('is off by default and changes nothing', () => {
    const split = splitLoan(200000, situation())
    expect(split.asp).toBe(0)
    expect(split.regular).toBe(200000)
    expect(split.payment).toBeCloseTo(paymentForLoan(200000, 3.5, 300), 6)
  })

  it('buys a home under the cap fully on ASP', () => {
    const split = splitLoan(150000, asp())
    expect(split.asp).toBe(150000)
    expect(split.regular).toBe(0)
    expect(split.payment).toBeCloseTo(paymentForLoan(150000, 3.0, 300), 6)
  })

  it('puts a regular loan on top once the cap is hit', () => {
    const split = splitLoan(250000, asp())
    expect(split.asp).toBe(230000)
    expect(split.regular).toBe(20000)
    // Two annuities at their own rates, not one blended loan.
    expect(split.payment).toBeCloseTo(
      paymentForLoan(230000, 3.0, 300) + paymentForLoan(20000, 3.5, 300),
      6,
    )
  })

  it('runs the ASP part over at most 25 years, whatever the regular term', () => {
    const s = asp({ termYears: 30 })
    const split = splitLoan(330000, s)
    // The ASP annuity is priced on 300 months, the regular top-up on 360.
    expect(split.aspPayment).toBeCloseTo(paymentForLoan(230000, 3.0, 300), 6)
    expect(split.regularPayment).toBeCloseTo(paymentForLoan(100000, 3.5, 360), 6)
  })

  it('stretches an income-limited loan but never the stress test', () => {
    // Cheaper money carries more: 750 €/mo at 3.0 % is 750 × 210.8745
    // ≈ 158 156 of ASP loan against 149 813 at the regular 3.5 %. The stress
    // test does not care how the debt is packaged, so it stays put - which is
    // why ASP alone does not move a stress-limited ceiling.
    const without = affordability(situation())
    const withAsp = affordability(asp())
    expect(withAsp.maxLoanByPayment).toBeCloseTo(158156, -1)
    expect(withAsp.maxLoanByPayment).toBeGreaterThan(without.maxLoanByPayment)
    expect(withAsp.maxLoanByStress).toBeCloseTo(without.maxLoanByStress, 6)
    expect(withAsp.limitedBy).toBe('stress')
    expect(withAsp.maxPrice).toBeCloseTo(without.maxPrice, 6)
    // ...but the ceiling loan gets cheaper: all of it fits inside the cap.
    expect(withAsp.aspLoan).toBeCloseTo(withAsp.loan, 6)
    expect(withAsp.regularLoan).toBe(0)
    // 116 405 at 3.0 %/25 y ≈ 552 €/mo, against 583 at the regular rate.
    expect(withAsp.paymentAtRate).toBeCloseTo(552, 0)
    expect(withAsp.paymentAtRate).toBeLessThan(without.paymentAtRate)
  })

  it('fills ASP first, then the regular loan with what is left of the budget', () => {
    // Cap 100 000: its payment is 100 000 / 210.8745 ≈ 474.22, leaving
    // 275.78 €/mo to carry 275.78 × 199.7510 ≈ 55 088 of regular loan.
    const a = affordability(asp({ aspMaxLoan: 100000 }))
    expect(a.maxLoanByPayment).toBeCloseTo(100000 + 55088, -1)
  })

  it('degenerates to a plain mortgage at the same rate and a high cap', () => {
    const plain = affordability(situation())
    const pointless = affordability(asp({ aspRatePct: 3.5, aspMaxLoan: 10_000_000 }))
    expect(pointless.maxLoanByPayment).toBeCloseTo(plain.maxLoanByPayment, 4)
    expect(pointless.maxPrice).toBeCloseTo(plain.maxPrice, 4)
  })

  it('packages a candidate loan as ASP plus the top-up, and prices each part', () => {
    // Espoo's lower cap: the 212 735 € loan splits 185 000 + 27 735.
    const s = asp({ aspMaxLoan: 185000 })
    const c = propertyCost(flat(), s, affordability(s).maxPrice)
    expect(c.aspLoan).toBe(185000)
    expect(c.regularLoan).toBeCloseTo(27735, 0)
    expect(c.aspLoan + c.regularLoan).toBeCloseTo(c.loan, 4)
    // 185 000 / 210.8745 ≈ 877.30 plus 27 735 / 199.7510 ≈ 138.85.
    expect(c.loanPayment).toBeCloseTo(877.3 + 138.85, 1)
    // First-month interest at each part's own rate:
    // 185 000 × 3.0 %/12 + 27 735 × 3.5 %/12 ≈ 462.50 + 80.89.
    expect(c.breakdown.interest).toBeCloseTo(543.39, 1)
    expect(c.breakdown.interest + c.breakdown.principal).toBeCloseTo(c.loanPayment, 4)
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
