/**
 * Waiting in an aso home: live in a right of occupancy for a few years, keep
 * saving, and buy when the rates suit - what cash does that build?
 *
 * The question is about flexibility, not about aso against owning for good
 * (that is rent-or-buy's): the household had planned to buy on a day, and
 * asks what happens if it moves into an aso home then instead and buys one
 * to five years later. Four things make up the cash on the later day:
 *
 * - **The ASP accounts**, carried on at the saving plan's deposits and the
 *   account's interest, with the bonus the bank pays at the purchase. The
 *   bonus accrues only for the first saving year and five calendar years
 *   after it (see `saving.ts`), so waiting past that keeps the bonus earned
 *   but adds no more.
 * - **The investments**: the cash outside ASP left over once the aso payment
 *   is paid, and a fixed sum a month on top, at the situation's return -
 *   counted after the tax on gains, since they are sold for the purchase.
 * - **The aso payment**, coming back at the building cost index, never below
 *   what was paid (LAO § 56). It is paid out within three months of moving
 *   out, so in real life the purchase may need a short bridge until it lands.
 * - **Less what is still owed** on a loan for the payment, when the cash
 *   outside ASP did not cover it - repaid out of the cash at the purchase.
 *
 * The payment never comes out of the ASP accounts: taking money out of one
 * ends the ASP saving and its bonus, so the payment is paid from the cash
 * outside it, or borrowed.
 *
 * Beside it, the same years **staying where you rent now** (`waitRentPerMonth`
 * - not rent-or-buy's `rentPerMonth`, which prices a home like the one being
 * bought, while the comparison here is the rental you would stay in): the
 * cash outside ASP stays invested whole, and the household has the same
 * money a month - what the aso home costs (charges and the payment's loan)
 * against the rent - so whichever is cheaper invests the difference. The ASP
 * saving is the same either way and cancels out of the comparison.
 *
 * What the cash then buys is the ceiling at today's income and rules: no
 * raises are assumed in the meantime, and the rates are the situation's.
 */

import {
  affordability,
  amortization,
  asoChargesPerMonth,
  asoReturned,
  transferTaxPctFor,
  type HousingSituation,
  type PropertyListing,
} from './housing'
import { addMonths, isoOf } from './mileage'
import { savingStatus, type SavingPlan, type SavingReading } from './saving'

/** How many years of waiting the card looks at: the ASP bonus runs for about as long. */
export const WAIT_YEARS = [1, 2, 3, 4, 5] as const

export interface WaitYear {
  /** years in the aso home; 0 = buying on the move-in day instead, the plan as it was */
  years: number
  /** the purchase day */
  day: number
  /** € in the ASP accounts at the purchase, the bonus paid then included */
  asp: number
  /** € of that which is the bonus */
  aspBonus: number
  /** € the investments come to, after the tax on their gains */
  invested: number
  /** € the aso payment comes back as; 0 on the plan as it was */
  asoBack: number
  /** € still owed on the payment's loan, repaid out of the cash */
  asoLoanLeft: number
  /** everything together: the cash the purchase has */
  cash: number
  /** the same, had the household stayed in its rental for these years; null without a current rent typed */
  rentingCash: number | null
  /** the highest price that cash reaches, at today's income and rules */
  ceiling: number
  /** the highest price whose loan stays inside the ASP cap; null without ASP */
  insideCap: number | null
  /** € a month the aso home cost in the last year of this wait - charges plus the payment's loan; 0 on the plan as it was */
  monthlyCost: number
  /** € a month the current rent had risen to then; null without one typed, and on the plan as it was */
  monthlyRent: number | null
}

export interface Waiting {
  /** the move-in day the figures run from */
  moveIn: number
  /** € borrowed for the payment, when the cash outside ASP fell short of it */
  asoLoan: number
  /** € invested on moving in: the cash outside ASP the payment left */
  investedAtStart: number
  /** the plan as it was, then one row per year of waiting */
  rows: WaitYear[]
  /** months in which renting cost so much more than the aso home that the renter invested nothing */
  renterShortMonths: number
}

/** A yearly rate as its monthly compounding equivalent. */
const monthlyRate = (pct: number) => Math.pow(1 + pct / 100, 1 / 12) - 1

/** Portfolio value after the gains tax, gains being whatever exceeds the money put in. */
const afterGainsTax = (portfolio: number, contributed: number, taxPct: number) =>
  portfolio - (Math.max(0, portfolio - contributed) * taxPct) / 100

/** The ASP accounts on `day`, the bonus included: the saving plan, asked about a later purchase. */
function aspOn(
  day: number,
  plan: SavingPlan,
  s: HousingSituation,
  readings: SavingReading[],
  today: number,
): { asp: number; bonus: number } {
  const status = savingStatus({ ...plan, targetDate: isoOf(day) }, s, readings, today)
  return { asp: status.atTarget, bonus: status.savers.reduce((sum, x) => sum + x.bonus, 0) }
}

/** What a sum of cash reaches: the ceiling, and the price whose loan just fills the ASP cap. */
function reach(cash: number, s: HousingSituation): { ceiling: number; insideCap: number | null } {
  const sit = { ...s, savings: cash, partnerSavings: 0 }
  const ceiling = affordability(sit).maxPrice
  if (!s.useAspLoan) return { ceiling, insideCap: null }
  // loan = price·(1 + t) + costs − cash, held at the cap
  const t = transferTaxPctFor('', s) / 100
  const atCap = (cash + s.aspMaxLoan - s.buyingCosts) / (1 + t)
  return { ceiling, insideCap: Math.max(0, Math.min(ceiling, atCap)) }
}

/**
 * The cash the household has on each of the next five yearly purchase days
 * if it moves into `place` on `moveIn` - and on the move-in day itself, had it
 * bought then as planned.
 */
export function waitInAso(
  place: PropertyListing,
  moveIn: number,
  s: HousingSituation,
  plan: SavingPlan,
  readings: SavingReading[],
  today: number,
): Waiting {
  const payment = place.asoPayment
  const charges = asoChargesPerMonth(place)
  const otherCash = Math.max(0, s.waitOtherCash)
  const invest = Math.max(0, s.waitInvestPerMonth)
  const asoLoan = Math.max(0, payment - otherCash)
  const investedAtStart = Math.max(0, otherCash - payment)
  // The payment's loan: a plain bank loan, never ASP - as in asoCost.
  const loan = amortization(asoLoan, { ...s, useAspLoan: false })
  const r = monthlyRate(s.investmentReturnPct)
  const renting = s.waitRentPerMonth > 0

  // Buying on the move-in day as planned: the accounts then, and the cash
  // outside them - taken as cash, since what it holds in gains is not known.
  const planned = aspOn(moveIn, plan, s, readings, today)
  const plannedCash = planned.asp + otherCash
  const rows: WaitYear[] = [
    {
      years: 0,
      day: moveIn,
      asp: planned.asp,
      aspBonus: planned.bonus,
      invested: otherCash,
      asoBack: 0,
      asoLoanLeft: 0,
      cash: plannedCash,
      rentingCash: renting ? plannedCash : null,
      ...reach(plannedCash, s),
      // Nobody lives in the aso home on the plan as it was.
      monthlyCost: 0,
      monthlyRent: null,
    },
  ]

  let asoPortfolio = investedAtStart
  let asoPut = investedAtStart
  let rentPortfolio = otherCash
  let rentPut = otherCash
  let renterShortMonths = 0
  const lastMonth = WAIT_YEARS[WAIT_YEARS.length - 1] * 12

  for (let m = 1; m <= lastMonth; m++) {
    // Charges and rent step up once a year, as vastikkeet and leases do.
    const uplift = Math.pow(1 + s.rentGrowthPct / 100, Math.floor((m - 1) / 12))
    const row = loan.months[m - 1]
    const asoCost = charges * uplift + (row ? row.interest + row.principal : 0)
    const rent = s.waitRentPerMonth * uplift

    asoPortfolio = asoPortfolio * (1 + r) + invest
    asoPut += invest
    // The same money a month: what the aso home would have cost, less the rent.
    const renterBudget = invest + asoCost - rent
    if (renting && renterBudget < 0) renterShortMonths++
    const renterInvests = Math.max(0, renterBudget)
    rentPortfolio = rentPortfolio * (1 + r) + renterInvests
    rentPut += renterInvests

    if (m % 12 !== 0) continue
    const years = m / 12
    const day = addMonths(moveIn, m)
    const { asp, bonus } = aspOn(day, plan, s, readings, today)
    const invested = afterGainsTax(asoPortfolio, asoPut, s.gainsTaxPct)
    const asoBack = asoReturned(payment, s.asoIndexPct, years)
    const asoLoanLeft = row ? row.balance : 0
    const cash = asp + invested + asoBack - asoLoanLeft
    // What living there cost in this last year of the wait: its first month.
    const first = loan.months[m - 12]
    const yearUplift = Math.pow(1 + s.rentGrowthPct / 100, years - 1)
    rows.push({
      years,
      day,
      asp,
      aspBonus: bonus,
      invested,
      asoBack,
      asoLoanLeft,
      cash,
      rentingCash: renting ? asp + afterGainsTax(rentPortfolio, rentPut, s.gainsTaxPct) : null,
      ...reach(cash, s),
      monthlyCost: charges * yearUplift + (first ? first.interest + first.principal : 0),
      monthlyRent: renting ? s.waitRentPerMonth * yearUplift : null,
    })
  }

  return { moveIn, asoLoan, investedAtStart, rows, renterShortMonths }
}
