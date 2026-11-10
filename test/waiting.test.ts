// Waiting in an aso home: what the cash comes to one to five years after the
// day the household had meant to buy. The tests pin the decisions - where the
// aso payment comes from, what comes back, that renting is held to the same
// monthly money, that the ASP bonus stops growing when its window closes -
// against identities worked out by hand in a world where nothing grows.

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_HOUSING,
  affordability,
  amortization,
  type HousingSituation,
  type PropertyListing,
} from '../src/housing'
import { newProperty } from '../src/housingStorage'
import { dayOf } from '../src/mileage'
import {
  DAYS_PER_MONTH,
  DEFAULT_PLAN,
  bonusLastYears,
  savingStatus,
  type SavingPlan,
} from '../src/saving'
import { waitInAso } from '../src/waiting'

const today = dayOf('2026-11-10')!
const moveIn = dayOf('2028-06-01')!

/** A couple buying together, everything still: no returns, no index, no rises, no tax. */
const still = (over: Partial<HousingSituation> = {}): HousingSituation => ({
  ...DEFAULT_HOUSING,
  netIncomePerMonth: 3300,
  otherLoanPaymentsPerMonth: 150,
  buyingTogether: true,
  partnerNetIncomePerMonth: 3000,
  partnerOtherLoanPaymentsPerMonth: 170,
  housingSharePct: 40,
  ratePct: 3.5,
  termYears: 25,
  rentPerMonth: 1400,
  investmentReturnPct: 0,
  homeValueGrowthPct: 0,
  rentGrowthPct: 0,
  asoIndexPct: 0,
  gainsTaxPct: 0,
  waitOtherCash: 40000,
  waitInvestPerMonth: 500,
  ...over,
})

/** 700 € a month each into accounts that pay nothing - no bonus unless asked. */
const plan = (over: Partial<SavingPlan> = {}): SavingPlan => ({
  ...DEFAULT_PLAN,
  targetDate: '2028-06-01',
  monthlyDeposit: 700,
  partnerMonthlyDeposit: 700,
  interestPct: 0,
  bonusPct: 0,
  ...over,
})

// 36 000 € in, 1 180 € käyttövastike and 40 € other: 1 220 € a month.
const kivisto: PropertyListing = {
  ...newProperty(),
  name: 'Kivistö ASO 3h+k',
  tenure: 'aso',
  asoPayment: 36000,
  usageChargePerMonth: 1180,
  otherPerMonth: 40,
}

describe('waiting in an aso home', () => {
  it('starts from the plan as it was: the accounts on the move-in day, plus the cash outside them', () => {
    const s = still()
    const w = waitInAso(kivisto, moveIn, s, plan(), [], today)
    const planned = savingStatus(plan(), s, [], today).atTarget
    expect(w.rows[0].years).toBe(0)
    expect(w.rows[0].asp).toBeCloseTo(planned, 6)
    expect(w.rows[0].cash).toBeCloseTo(planned + 40000, 6)
    expect(w.rows[0].asoBack).toBe(0)
    expect(w.rows).toHaveLength(6)
  })

  it('pays the payment from the cash outside ASP and gets it back, so nothing is lost while still', () => {
    // 40 000 € outside ASP pays the 36 000 € and leaves 4 000 € invested;
    // the payment comes back whole, so the cash is the accounts, the cash
    // outside them and every month's 500 € - the payment just parked.
    const s = still()
    const w = waitInAso(kivisto, moveIn, s, plan(), [], today)
    expect(w.asoLoan).toBe(0)
    expect(w.investedAtStart).toBe(4000)
    for (const row of w.rows.slice(1)) {
      expect(row.asoBack).toBe(36000)
      expect(row.asoLoanLeft).toBe(0)
      expect(row.cash).toBeCloseTo(row.asp + 40000 + 500 * 12 * row.years, 4)
    }
  })

  it('keeps the ASP deposits going while the household waits', () => {
    const w = waitInAso(kivisto, moveIn, still(), plan(), [], today)
    // 1 400 € a month together, at 0 %, for every month the wait lasts - the
    // plan's months are average ones (365.25 / 12 days), so a calendar year
    // from 1.6.2028, 365 days, is a hair under twelve of them.
    for (const row of w.rows.slice(1)) {
      const months = (row.day - moveIn) / DAYS_PER_MONTH
      expect(row.asp - w.rows[0].asp).toBeCloseTo(1400 * months, 6)
    }
  })

  it('holds renting to the same money a month: the gap is what the two homes cost apart', () => {
    // The aso home costs 1 220 €, the rent 1 400 €: renting invests 180 € a
    // month less, and the payment's parking costs nothing in a still world.
    const w = waitInAso(kivisto, moveIn, still(), plan(), [], today)
    expect(w.renterShortMonths).toBe(0)
    for (const row of w.rows.slice(1)) {
      expect(row.rentingCash! - row.cash).toBeCloseTo((1220 - 1400) * 12 * row.years, 4)
    }
  })

  it('borrows what the cash outside ASP does not cover, and repays it out of the cash', () => {
    // 20 000 € outside ASP against a 36 000 € payment: 16 000 € borrowed as a
    // plain loan. Against renting, the aso side is then behind by its
    // homes' difference plus the interest it paid - the principal it repaid
    // comes back with the payment.
    const s = still({ waitOtherCash: 20000, useAspLoan: true, aspRatePct: 1 })
    const w = waitInAso(kivisto, moveIn, s, plan(), [], today)
    const loan = amortization(16000, { ...s, useAspLoan: false })
    expect(w.asoLoan).toBe(16000)
    expect(w.investedAtStart).toBe(0)
    for (const row of w.rows.slice(1)) {
      const k = row.years * 12 - 1
      expect(row.asoLoanLeft).toBeCloseTo(loan.months[k].balance, 6)
      expect(row.rentingCash! - row.cash).toBeCloseTo(
        (1220 - 1400) * 12 * row.years + loan.months[k].interestToDate,
        4,
      )
    }
    // In what living there costs: the charges plus the loan's payment.
    expect(w.rows[1].monthlyCost).toBeCloseTo(
      1220 + loan.months[0].interest + loan.months[0].principal,
      6,
    )
  })

  it('brings the payment back at the index, never below what was paid', () => {
    const up = waitInAso(kivisto, moveIn, still({ asoIndexPct: 3 }), plan(), [], today)
    expect(up.rows[5].asoBack).toBeCloseTo(36000 * Math.pow(1.03, 5), 6)
    const down = waitInAso(kivisto, moveIn, still({ asoIndexPct: -2 }), plan(), [], today)
    expect(down.rows.slice(1).every((row) => row.asoBack === 36000)).toBe(true)
  })

  it('taxes only the investments’ gains, and only when they are sold for the purchase', () => {
    const s = still({ investmentReturnPct: 7, gainsTaxPct: 30, waitOtherCash: 36000 })
    const w = waitInAso(kivisto, moveIn, s, plan(), [], today)
    // Nothing left over on moving in: the portfolio is the 500 € a month alone.
    const put = 500 * 60
    const r = Math.pow(1.07, 1 / 12)
    const grown = (500 * (Math.pow(r, 60) - 1)) / (r - 1)
    expect(w.rows[5].invested).toBeCloseTo(grown - (grown - put) * 0.3, 4)
  })

  it('stops growing the ASP bonus when its window closes, and keeps what it earned', () => {
    // A first deposit in 9/2026: the bonus runs through 2031. 6/2031 is
    // inside the window, 6/2032 and 6/2033 past it - the same bonus both.
    const p = plan({ bonusPct: 2, aspFirstMonth: '2026-09', partnerAspFirstMonth: '2026-09' })
    const s = still({ useAspLoan: true })
    const w = waitInAso(kivisto, moveIn, s, p, [], today)
    expect(bonusLastYears(p, s)).toEqual([
      { saver: 'self', year: 2031 },
      { saver: 'partner', year: 2031 },
    ])
    expect(w.rows[3].aspBonus).toBeLessThan(w.rows[4].aspBonus)
    expect(w.rows[5].aspBonus).toBeCloseTo(w.rows[4].aspBonus, 6)
    expect(w.rows[5].asp).toBeGreaterThan(w.rows[4].asp) // the deposits still land
  })

  it('reads what the cash buys off the ceiling, and inside the ASP cap', () => {
    const s = still({ useAspLoan: true, aspMaxLoan: 345000 })
    const w = waitInAso(kivisto, moveIn, s, plan(), [], today)
    for (const row of w.rows) {
      const a = affordability({ ...s, savings: row.cash, partnerSavings: 0 })
      expect(row.ceiling).toBeCloseTo(a.maxPrice, 4)
      expect(row.insideCap!).toBeLessThanOrEqual(row.ceiling + 1e-6)
      if (row.insideCap! < row.ceiling) {
        // At that price the loan is exactly the cap: price × 1.015 − cash.
        expect(row.insideCap! * 1.015 - row.cash).toBeCloseTo(345000, 4)
      }
    }
    // More cash, more home - every year of waiting.
    for (let k = 1; k < w.rows.length; k++) {
      expect(w.rows[k].ceiling).toBeGreaterThan(w.rows[k - 1].ceiling)
    }
  })

  it('leaves the renting column out when no rent is typed', () => {
    const w = waitInAso(kivisto, moveIn, still({ rentPerMonth: 0 }), plan(), [], today)
    expect(w.rows.every((row) => row.rentingCash === null && row.monthlyRent === null)).toBe(true)
  })
})
