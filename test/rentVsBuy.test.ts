// Rent or buy: the renter keeps the closing cash and invests the monthly gap,
// the buyer ends with a home less a loan. As with the rest of housing, the
// tests pin decisions rather than arithmetic - what counts as invested, who
// invests when rent is the dearer option, how the gains tax lands, and what
// "break-even return" means - against figures worked out by hand.

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_HOUSING,
  amortization,
  rentVsBuy,
  type Holding,
  type HousingSituation,
} from '../src/housing'
import { normalizeSituation } from '../src/housingStorage'

const situation = (over: Partial<HousingSituation> = {}): HousingSituation => ({
  ...DEFAULT_HOUSING,
  netIncomePerMonth: 3400,
  otherLoanPaymentsPerMonth: 190,
  savings: 40000,
  ratePct: 3.5,
  termYears: 25,
  rentPerMonth: 800,
  ...over,
})

// The Kamppi flat of the housing tests: 249 000 € at 1.5 % transfer tax on
// 40 000 € of savings leaves a 212 735 € loan, 36 265 € down and 3 735 € tax.
const kamppi: Holding = {
  price: 249000,
  loan: 212735,
  cashAtClosing: 40000,
  chargesPerMonth: 265,
}

/** Everything flat: no returns, no growth, no rent rises, no tax. */
const still = (over: Partial<HousingSituation> = {}) =>
  situation({
    investmentReturnPct: 0,
    homeValueGrowthPct: 0,
    rentGrowthPct: 0,
    gainsTaxPct: 0,
    ...over,
  })

describe('rent or buy', () => {
  it('runs the whole term, even for a home bought outright', () => {
    const r = rentVsBuy({ ...kamppi, loan: 0, cashAtClosing: 252735 }, still({ rentPerMonth: 0 }))
    expect(r.months).toHaveLength(300)
    // No loan: the owner pays the charges alone, and owns the whole home.
    expect(r.months[0].buyerPays).toBeCloseTo(265, 6)
    expect(r.months[0].homeEquity).toBeCloseTo(249000, 4)
  })

  it('with everything still, the gap is exactly the money that bought nothing', () => {
    // Rent 0 and no returns: the renter banks the closing cash and every
    // payment; the buyer ends holding the home. The difference must then be
    // precisely the transfer tax plus all the interest plus all the charges -
    // the euros that bought neither equity nor a place to live.
    const s = still({ rentPerMonth: 0 })
    const r = rentVsBuy(kamppi, s)
    const end = r.months[r.months.length - 1]
    const { totalInterest } = amortization(kamppi.loan, s)
    expect(end.renterNetWorth - end.buyerNetWorth).toBeCloseTo(3735 + totalInterest + 265 * 300, 2)
    expect(end.loanBalance).toBe(0)
    expect(r.totalInterest).toBeCloseTo(totalInterest, 6)
    expect(r.totalCharges).toBeCloseTo(265 * 300, 4)
  })

  it('has nobody investing when rent costs exactly what owning does', () => {
    const s = still({ rentPerMonth: 0 })
    const payment = amortization(kamppi.loan, s).months[0]
    const r = rentVsBuy(kamppi, still({ rentPerMonth: payment.interest + payment.principal + 265 }))
    for (const m of r.months) expect(m.invested).toBeCloseTo(0, 6)
    const end = r.months[r.months.length - 1]
    expect(end.renterNetWorth).toBeCloseTo(40000, 4)
    expect(end.buyerNetWorth).toBeCloseTo(249000, 4)
    expect(r.renterInvested).toBeCloseTo(40000, 4)
  })

  it('lets the owner invest when rent is the dearer option', () => {
    // 2 000 € rent against ~1 330 € of payment and charges: the owner banks
    // the ~670 € gap, the renter never adds to the closing cash.
    const r = rentVsBuy(kamppi, still({ rentPerMonth: 2000 }))
    expect(r.months[0].invested).toBeLessThan(0)
    const end = r.months[r.months.length - 1]
    expect(end.buyerPortfolio).toBeGreaterThan(0)
    expect(end.renterPortfolio).toBeCloseTo(40000, 4)
    expect(r.renterInvested).toBeCloseTo(40000, 4)
    expect(end.buyerNetWorth).toBeCloseTo(249000 + end.buyerPortfolio, 4)
  })

  it('steps rent and the charges up once a year', () => {
    const r = rentVsBuy(kamppi, situation({ rentGrowthPct: 2 }))
    expect(r.months[11].rent).toBeCloseTo(800, 6)
    expect(r.months[12].rent).toBeCloseTo(816, 6)
    expect(r.months[12].charges).toBeCloseTo(265 * 1.02, 6)
    // The loan payment itself does not move, so the whole rise is the charges.
    expect(r.months[12].buyerPays - r.months[11].buyerPays).toBeCloseTo(265 * 0.02, 6)
  })

  it('compounds the home value monthly to the stated yearly rate', () => {
    const r = rentVsBuy(kamppi, situation({ homeValueGrowthPct: 2 }))
    expect(r.months[11].homeValue).toBeCloseTo(249000 * 1.02, 4)
    expect(r.months[23].homeValue).toBeCloseTo(249000 * 1.02 * 1.02, 4)
  })

  it('taxes only the gains, and only what exceeds the money put in', () => {
    const s = situation({ gainsTaxPct: 30 })
    const r = rentVsBuy(kamppi, s)
    const end = r.months[r.months.length - 1]
    // The renter invested every month here, so what they put in is the closing
    // cash plus every positive monthly gap - which is what renterInvested says.
    const gains = end.renterPortfolio - r.renterInvested
    expect(gains).toBeGreaterThan(0)
    expect(end.renterNetWorth).toBeCloseTo(end.renterPortfolio - 0.3 * gains, 4)
    // The owner had no side portfolio, so their wealth is the home less the loan, untaxed.
    expect(end.buyerNetWorth).toBeCloseTo(end.homeEquity, 4)
  })

  it('names the leader and the month they pulled ahead for good', () => {
    const r = rentVsBuy(kamppi, situation())
    expect(r.leader).not.toBeNull()
    expect(r.leaderFrom).not.toBeNull()
    const sign = (k: number) => Math.sign(r.months[k].buyerNetWorth - r.months[k].renterNetWorth)
    const want = r.leader === 'buy' ? 1 : -1
    for (let k = r.leaderFrom! - 1; k < r.months.length; k++) expect(sign(k)).toBe(want)
    if (r.leaderFrom! > 1) expect(sign(r.leaderFrom! - 2)).not.toBe(want)
  })

  it('finds the return at which both end level', () => {
    // Buying is ahead with the money earning nothing, renting with it earning
    // 30 % a year, so a threshold exists between them - and at that return the
    // two net worths coincide, with renting ahead a point above and buying a
    // point below.
    const s = situation()
    const r = rentVsBuy(kamppi, s)
    expect(r.breakEvenReturnPct).not.toBeNull()
    const pctAt = r.breakEvenReturnPct!
    const end = (returnPct: number) => {
      const months = rentVsBuy(kamppi, { ...s, investmentReturnPct: returnPct }).months
      const last = months[months.length - 1]
      return last.renterNetWorth - last.buyerNetWorth
    }
    expect(end(pctAt)).toBeCloseTo(0, 0)
    expect(end(pctAt + 1)).toBeGreaterThan(0)
    expect(end(pctAt - 1)).toBeLessThan(0)
  })

  it('reports no threshold when one side wins at every return', () => {
    // Rent-free and no growth anywhere: the renter banks every payment, so
    // even money earning nothing ends ahead of the home - no return to find.
    const rentWins = rentVsBuy(kamppi, still({ rentPerMonth: 0 }))
    expect(rentWins.breakEvenReturnPct).toBeNull()
    expect(rentWins.leader).toBe('rent')
    // A home appreciating 40 % a year outruns even a 30 % portfolio.
    const buyWins = rentVsBuy(kamppi, situation({ homeValueGrowthPct: 40 }))
    expect(buyWins.breakEvenReturnPct).toBeNull()
    expect(buyWins.leader).toBe('buy')
  })

  it('sums the rent over the term', () => {
    const r = rentVsBuy(kamppi, still())
    expect(r.totalRent).toBeCloseTo(800 * 300, 4)
  })
})

describe('the rent-or-buy inputs in storage', () => {
  it('seed fresh situations with the defaults', () => {
    const s = normalizeSituation({})
    expect(s.rentPerMonth).toBe(0)
    expect(s.rentGrowthPct).toBe(DEFAULT_HOUSING.rentGrowthPct)
    expect(s.investmentReturnPct).toBe(DEFAULT_HOUSING.investmentReturnPct)
    expect(s.homeValueGrowthPct).toBe(DEFAULT_HOUSING.homeValueGrowthPct)
    expect(s.gainsTaxPct).toBe(DEFAULT_HOUSING.gainsTaxPct)
  })

  it('fill in the fields a situation saved before them lacks', () => {
    const s = normalizeSituation({ netIncomePerMonth: 3400, ratePct: 3.5 })
    expect(s.netIncomePerMonth).toBe(3400)
    expect(s.investmentReturnPct).toBe(DEFAULT_HOUSING.investmentReturnPct)
  })

  it('let rates fall but not past what compounding can take', () => {
    const s = normalizeSituation({
      rentPerMonth: -5,
      rentGrowthPct: -3,
      investmentReturnPct: -500,
      homeValueGrowthPct: '−1',
      gainsTaxPct: 150,
    })
    expect(s.rentPerMonth).toBe(0)
    expect(s.rentGrowthPct).toBe(-3)
    expect(s.investmentReturnPct).toBe(-99)
    // A typographic minus is not a number; the default stands in.
    expect(s.homeValueGrowthPct).toBe(DEFAULT_HOUSING.homeValueGrowthPct)
    expect(s.gainsTaxPct).toBe(100)
  })
})
