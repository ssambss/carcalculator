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
    for (const m of r.months) {
      expect(m.renterInvests).toBeCloseTo(0, 6)
      expect(m.ownerInvests).toBe(0)
    }
    const end = r.months[r.months.length - 1]
    expect(end.renterNetWorth).toBeCloseTo(40000, 4)
    expect(end.buyerNetWorth).toBeCloseTo(249000, 4)
    expect(r.renterInvested).toBeCloseTo(40000, 4)
    expect(r.renterShortMonths).toBe(0)
  })

  it('gives the owner a fixed sum to invest, and the renter the same total budget', () => {
    // Owner: ~1 330 € of payment and charges plus 500 € invested = ~1 830 € a
    // month. Renter at 1 230 € rent: the same 1 830 € less the rent is 600 €
    // invested, every month, since nothing here rises. The owner's 500 € is
    // the typed figure, not a gap that grows.
    const s = still({ rentPerMonth: 0, ownerInvestPerMonth: 500 })
    const payment = amortization(kamppi.loan, s).months[0]
    const owning = payment.interest + payment.principal + 265
    const r = rentVsBuy(kamppi, { ...s, rentPerMonth: owning - 100 })
    for (const m of r.months) {
      expect(m.ownerInvests).toBe(500)
      expect(m.renterInvests).toBeCloseTo(600, 6)
    }
    const end = r.months[r.months.length - 1]
    expect(end.buyerPortfolio).toBeCloseTo(500 * 300, 4)
    expect(end.renterPortfolio).toBeCloseTo(40000 + 600 * 300, 4)
    expect(r.ownerInvested).toBeCloseTo(500 * 300, 4)
    expect(r.renterInvested).toBeCloseTo(40000 + 600 * 300, 4)
    expect(end.buyerNetWorth).toBeCloseTo(249000 + 500 * 300, 4)
  })

  it('credits nobody with the extra when rent outgrows the whole budget, and counts the months', () => {
    // 2 000 € rent against ~1 330 € of owning and nothing set aside: the
    // renter cannot invest, the owner does not inherit the gap, and every
    // month is a short one.
    const r = rentVsBuy(kamppi, still({ rentPerMonth: 2000 }))
    for (const m of r.months) {
      expect(m.renterInvests).toBe(0)
      expect(m.ownerInvests).toBe(0)
      expect(m.renterShort).toBeGreaterThan(0)
    }
    expect(r.renterShortMonths).toBe(300)
    const end = r.months[r.months.length - 1]
    expect(end.buyerPortfolio).toBe(0)
    expect(end.renterPortfolio).toBeCloseTo(40000, 4)
    expect(end.buyerNetWorth).toBeCloseTo(249000, 4)
  })

  it('lets rising rent eat the renter’s investing while the owner’s stays put', () => {
    // Rent starts 200 € under the owner's total budget and rises 2 % a year
    // against a flat payment: the renter invests less each year and, by the
    // end of 25 years, nothing - the owner's 300 € never moves.
    const r = rentVsBuy(kamppi, still({ rentPerMonth: 1400, rentGrowthPct: 2, ownerInvestPerMonth: 300 }))
    const first = r.months[0]
    const last = r.months[r.months.length - 1]
    expect(first.renterInvests).toBeGreaterThan(0)
    expect(last.renterInvests).toBeLessThan(first.renterInvests)
    expect(first.ownerInvests).toBe(300)
    expect(last.ownerInvests).toBe(300)
    // Year over year the renter's figure never rises.
    for (let y = 1; y < 25; y++) {
      expect(r.months[y * 12].renterInvests).toBeLessThanOrEqual(r.months[(y - 1) * 12].renterInvests)
    }
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

  it('finds the rent at which both end level', () => {
    // Rent only takes from the renter, so buying's lead grows with it: at the
    // threshold the two coincide, 50 € below renting is ahead, 50 € above buying.
    const s = situation({ ownerInvestPerMonth: 300 })
    const r = rentVsBuy(kamppi, s)
    expect(r.breakEvenRent).not.toBeNull()
    const rent = r.breakEvenRent!
    const lead = (rentPerMonth: number) => {
      const months = rentVsBuy(kamppi, { ...s, rentPerMonth }).months
      const last = months[months.length - 1]
      return last.renterNetWorth - last.buyerNetWorth
    }
    expect(lead(rent)).toBeCloseTo(0, -1)
    expect(lead(rent - 50)).toBeGreaterThan(0)
    expect(lead(rent + 50)).toBeLessThan(0)
  })

  it('finds the lowest return crossing even when the gap is not monotonic', () => {
    // A large fixed owner sum makes a higher return help the owner first:
    // buying's lead widens for a while before the renter's early cash wins.
    // The search must still land on a real crossing, with renting ahead just
    // above it and buying just below.
    const s = situation({ rentPerMonth: 1400, ownerInvestPerMonth: 1000, termYears: 40 })
    const r = rentVsBuy(kamppi, s)
    expect(r.breakEvenReturnPct).not.toBeNull()
    const pct = r.breakEvenReturnPct!
    const lead = (investmentReturnPct: number) => {
      const months = rentVsBuy(kamppi, { ...s, investmentReturnPct }).months
      const last = months[months.length - 1]
      return last.renterNetWorth - last.buyerNetWorth
    }
    expect(lead(pct + 0.5)).toBeGreaterThan(0)
    expect(lead(pct - 0.5)).toBeLessThan(0)
    // ...and everything below it is buying's, or the point would not be the first.
    for (let p = 0; p < pct - 0.5; p += 1) expect(lead(p)).toBeLessThan(0)
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
    expect(s.ownerInvestPerMonth).toBe(0)
  })

  it('keep the owner’s investing at zero or above', () => {
    expect(normalizeSituation({ ownerInvestPerMonth: -200 }).ownerInvestPerMonth).toBe(0)
    expect(normalizeSituation({ ownerInvestPerMonth: '1 000' }).ownerInvestPerMonth).toBe(1000)
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
