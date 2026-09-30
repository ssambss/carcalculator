/**
 * Saving up for the home: how much has to be in the account by the purchase,
 * and whether the saving is on its way there.
 *
 * Two questions, answered from the same few numbers. The first is the one the
 * ceiling asks backwards: *what does this price take in cash?* The second is
 * the watcher's, the one the mileage side asks of an odometer: *where does the
 * balance stand against the plan, and where does the plan land by the day of
 * the purchase?*
 *
 * The balance is logged the way the bank's app shows it - a check-in, not a
 * ledger of deposits - because that is one number to type, and a standing
 * order's deposits happen whether or not anyone writes them down. Between two
 * check-ins the balance is read as a straight line; after the last one it
 * carries on at the planned deposit, with the account's interest.
 *
 * ## ASP, as the 1.6.2026 rules have it
 *
 * - The saving counts in **deposit months**: at least 20 of them, not
 *   necessarily in a row, each 50–1 500 €. A saver who started before
 *   1.6.2026 may keep to quarters, and a quarter's deposit counts as three
 *   months - so either way, one deposit a month from the first reaches the
 *   20th month nineteen months later.
 * - The account pays **1 %** a year, and the bank adds a **bonus
 *   interest** of 2–4 % (lisäkorko) for the first saving year and at most
 *   five calendar years after it - paid only at the purchase, and only with
 *   an ASP loan. All of it is tax-free, the bonus as much as the 1 % - so
 *   nothing here is taxed - and both count towards the cash share.
 * - The cash share itself is the situation's minimum cash share - the model
 *   runs the decided reform's 5 %, the law in force still says 10 %.
 *
 * These are inputs with defaults, like every rule on the housing side - check
 * the current ones.
 */

import {
  affordability,
  transferTaxPctFor,
  type HomeType,
  type HousingSituation,
} from './housing'
import { addMonths, dayOf, isoOf } from './mileage'

/* -------------------------------------------------------------------- types */

export type Saver = 'self' | 'partner'

/** The plan: when, how much a month, and what the account pays. */
export interface SavingPlan {
  /** 'YYYY-MM-DD', the day the purchase is planned for; '' until it is set */
  targetDate: string
  /** € you put in each month */
  monthlyDeposit: number
  /** € the second borrower puts in each month - counted only when buying together */
  partnerMonthlyDeposit: number
  /** what the account pays, %/yr - an ASP account pays 1 % */
  interestPct: number
  /** ASP bonus interest, %/yr - paid at the purchase, with an ASP loan only */
  bonusPct: number
  /** a price to save for, €; 0 = none typed, the places are the goals */
  goalPrice: number
  goalHomeType: HomeType | ''
  /** 'YYYY-MM', the month of your first ASP deposit; '' = not said */
  aspFirstMonth: string
  partnerAspFirstMonth: string
}

export const DEFAULT_PLAN: SavingPlan = {
  targetDate: '',
  monthlyDeposit: 0,
  partnerMonthlyDeposit: 0,
  // The ASP account's statutory rate, and the bonus's floor: every bank pays
  // at least 2 %, some up to 4. Both are nothing unless the account is ASP -
  // an ordinary one is a figure to type.
  interestPct: 1,
  bonusPct: 2,
  goalPrice: 0,
  goalHomeType: '',
  aspFirstMonth: '',
  partnerAspFirstMonth: '',
}

/** What the account said on a day - the whole balance, as the bank shows it. */
export interface SavingReading {
  id: string
  /** 'YYYY-MM-DD' */
  date: string
  saver: Saver
  /** € in the account */
  amount: number
  createdAt: string
  updatedAt: string
}

/** ASP: the deposit months needed before the loan, 1.6.2026 on. */
export const ASP_DEPOSIT_MONTHS = 20
/** ASP: what one month's deposit may be, €. */
export const ASP_MIN_DEPOSIT = 50
export const ASP_MAX_DEPOSIT = 1500
/** ASP: the bonus runs for the first saving year and at most this many calendar years after it. */
const BONUS_YEARS_AFTER_FIRST = 5

/** The months a day count is: a month is an average one, 365.25 / 12 days. */
export const DAYS_PER_MONTH = 365.25 / 12
const monthsBetween = (from: number, to: number) => (to - from) / DAYS_PER_MONTH

/* ------------------------------------------------------------- the growth */

/**
 * One saver's balance `m` months on: the balance compounding at the account's
 * rate, and a deposit a month on top - spread evenly over the month, the way
 * the mileage side spreads the km, so a check-in mid-month is not a whole
 * deposit off either way.
 *
 *   B(m) = B₀·gᵐ + D·(gᵐ − 1)/(g − 1),   g = (1 + r)^(1/12)
 *
 * At 0 % it degenerates to B₀ + D·m.
 */
export function grow(balance: number, deposit: number, ratePct: number, months: number): number {
  if (months <= 0) return balance
  const g = Math.pow(1 + ratePct / 100, 1 / 12)
  if (g === 1) return balance + deposit * months
  const gm = Math.pow(g, months)
  return balance * gm + (deposit * (gm - 1)) / (g - 1)
}

/**
 * The balance above integrated over the `m` months - € × months - which is
 * what a simple bonus interest accrues on: the bonus is (b / 12) times it.
 *
 *   ∫₀ᵐ B(u) du = B₀·(gᵐ − 1)/ln g + D·((gᵐ − 1)/ln g − m)/(g − 1)
 *
 * and B₀·m + D·m²/2 at 0 %.
 */
export function balanceMonths(
  balance: number,
  deposit: number,
  ratePct: number,
  months: number,
): number {
  if (months <= 0) return 0
  const g = Math.pow(1 + ratePct / 100, 1 / 12)
  if (g === 1) return balance * months + (deposit * months * months) / 2
  const gm = Math.pow(g, months)
  const lnG = Math.log(g)
  return (balance * (gm - 1)) / lnG + (deposit * ((gm - 1) / lnG - months)) / (g - 1)
}

/* --------------------------------------------------------------- the goal */

export interface CashNeed {
  price: number
  homeType: HomeType | ''
  /** the minimum cash share of the price - the part no loan may cover */
  cashShare: number
  /** varainsiirtovero at the rate for this kind of home */
  transferTax: number
  costs: number
  /**
   * Cash on top of the minimum because income cannot carry the rest as a
   * loan: zero unless the loan the budget allows is short of the price.
   */
  bridge: number
  /** everything together: the savings that reach this price */
  needed: number
  /** what sets it: the rules' minimum, or the loan the income can carry */
  limitedBy: 'rules' | 'income'
  /** the largest loan income and the stress test allow, whatever the savings */
  maxLoan: number
}

/**
 * The cash a price takes: the ceiling asked the other way round.
 *
 * The ceiling is the lower of two prices (see `affordability`): the one where
 * savings plus the largest loan run out, and the one where savings cover the
 * cash share and the tax. Solved for the savings instead, a price P needs
 *
 *   S = max( P·(d + t) + c,  P·(1 + t) + c − L )
 *
 * with d the cash share, t the transfer tax, c the flat costs and L the loan
 * the budget carries - which depends on income alone, not on savings. So
 * `affordability` with S as the savings lands exactly on P, which the tests
 * hold it to.
 */
export function cashNeeded(
  price: number,
  homeType: HomeType | '',
  s: HousingSituation,
): CashNeed {
  const p = Math.max(0, price)
  const t = transferTaxPctFor(homeType, s) / 100
  const d = s.minDownPaymentPct / 100
  const a = affordability(s, homeType)
  const maxLoan = Math.min(a.maxLoanByPayment, a.maxLoanByStress)
  const cashShare = p * d
  const transferTax = p * t
  const costs = s.buyingCosts
  const byRules = cashShare + transferTax + costs
  const byIncome = p * (1 + t) + costs - maxLoan
  const needed = Math.max(byRules, byIncome)
  return {
    price: p,
    homeType,
    cashShare,
    transferTax,
    costs,
    bridge: Math.max(0, byIncome - byRules),
    needed,
    limitedBy: byIncome > byRules ? 'income' : 'rules',
    maxLoan,
  }
}

/* ----------------------------------------------------------- the watcher */

/** A check-in as a point: `amount` € at the end of day `day`. */
export interface BalancePoint {
  day: number
  amount: number
}

export interface SaverStatus {
  saver: Saver
  /** the planned deposit, € / month */
  deposit: number
  /** the check-ins that count, in day order - one a day, the last one typed */
  points: BalancePoint[]
  first: BalancePoint | null
  last: BalancePoint | null
  /** where the plan says the balance should be at the last check-in, from the first */
  planAtLast: number | null
  /** last − planAtLast: positive is ahead of the plan */
  vsPlan: number | null
  /** the balance at the purchase: from the last check-in, or from zero today without one */
  atTarget: number
  /** the ASP bonus interest paid at the purchase - over the check-ins so far and the months ahead */
  bonus: number
  /** atTarget + bonus: what this saver brings */
  total: number
  /** the month of the 20th ASP deposit, one a month from the first; null when the first is not said */
  aspReadyMonth: string | null
}

export interface SavingStatus {
  /** the purchase day; null until the plan has one */
  target: number | null
  today: number
  savers: SaverStatus[]
  /** Σ of the savers' last check-ins */
  savedNow: number
  /** the latest check-in of anyone; null before the first */
  asOf: number | null
  /** Σ of vsPlan over the savers who have checked in; null before anyone has */
  vsPlan: number | null
  /** the household's deposits, € / month */
  monthlyTotal: number
  /** months from today to the purchase, never below zero */
  monthsLeft: number
  /** Σ of what every saver brings to the purchase */
  atTarget: number
  /** whether the bonus is counted: an ASP loan is planned */
  bonusCounted: boolean
}

/** The savers the plan follows: you, and the second borrower when there is one. */
export function saversOf(s: HousingSituation): Saver[] {
  return s.buyingTogether ? ['self', 'partner'] : ['self']
}

/** A saver's check-ins as points: dated ones only, the last typed winning a day. */
export function pointsOf(readings: SavingReading[], saver: Saver): BalancePoint[] {
  const byDay = new Map<number, SavingReading>()
  for (const r of readings) {
    if (r.saver !== saver) continue
    const day = dayOf(r.date)
    if (day === null) continue
    const kept = byDay.get(day)
    // Two on one day is a correction: the later one is what the bank said.
    if (!kept || r.updatedAt >= kept.updatedAt) byDay.set(day, r)
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, r]) => ({ day, amount: Math.max(0, r.amount) }))
}

/** The first day of a 'YYYY-MM' month, or null. */
function monthStart(month: string): number | null {
  return /^\d{4}-\d{2}$/.test(month) ? dayOf(`${month}-01`) : null
}

/** 'YYYY-MM' of the month the 20th deposit falls in, one deposit a month from the first. */
export function aspReadyMonth(firstMonth: string): string | null {
  const start = monthStart(firstMonth)
  return start === null ? null : isoOf(addMonths(start, ASP_DEPOSIT_MONTHS - 1)).slice(0, 7)
}

/**
 * The last day the bonus accrues: the end of the fifth calendar year after
 * the first saving year. Unbounded when the first deposit month is not said.
 */
function bonusEnd(firstMonth: string): number {
  const start = monthStart(firstMonth)
  if (start === null) return Number.POSITIVE_INFINITY
  const year = Number(firstMonth.slice(0, 4)) + BONUS_YEARS_AFTER_FIRST + 1
  return dayOf(`${year}-01-01`)!
}

/** € × months of balance between two check-ins, read as the straight line between them. */
function lineMonths(a: BalancePoint, b: BalancePoint, until: number): number {
  const to = Math.min(b.day, until)
  if (to <= a.day) return 0
  const atTo = a.amount + ((b.amount - a.amount) * (to - a.day)) / (b.day - a.day)
  return ((a.amount + atTo) / 2) * monthsBetween(a.day, to)
}

function saverStatus(
  saver: Saver,
  plan: SavingPlan,
  s: HousingSituation,
  readings: SavingReading[],
  target: number | null,
  today: number,
): SaverStatus {
  const deposit = Math.max(0, saver === 'self' ? plan.monthlyDeposit : plan.partnerMonthlyDeposit)
  const firstMonth = saver === 'self' ? plan.aspFirstMonth : plan.partnerAspFirstMonth
  const points = pointsOf(readings, saver)
  const first = points[0] ?? null
  const last = points[points.length - 1] ?? null
  const rate = plan.interestPct

  const planAtLast =
    first && last ? grow(first.amount, deposit, rate, monthsBetween(first.day, last.day)) : null

  // From the last check-in on - or, before there is one, from nothing today:
  // the deposits still to come are all the plan can promise.
  const from = last ?? { day: today, amount: 0 }
  const ahead = target === null ? 0 : Math.max(0, monthsBetween(from.day, target))
  const atTarget = target === null ? from.amount : grow(from.amount, deposit, rate, ahead)

  let bonus = 0
  if (s.useAspLoan && target !== null && plan.bonusPct > 0) {
    const end = Math.min(target, bonusEnd(firstMonth))
    let accrued = 0
    for (let k = 1; k < points.length; k++) accrued += lineMonths(points[k - 1], points[k], end)
    if (end > from.day) {
      accrued += balanceMonths(from.amount, deposit, rate, monthsBetween(from.day, end))
    }
    bonus = (accrued * plan.bonusPct) / 100 / 12
  }

  return {
    saver,
    deposit,
    points,
    first,
    last,
    planAtLast,
    vsPlan: planAtLast === null || !last ? null : last.amount - planAtLast,
    atTarget,
    bonus,
    total: atTarget + bonus,
    aspReadyMonth: aspReadyMonth(firstMonth),
  }
}

/** Where the household's saving stands, and where the plan takes it by the purchase. */
export function savingStatus(
  plan: SavingPlan,
  s: HousingSituation,
  readings: SavingReading[],
  today: number,
): SavingStatus {
  const target = dayOf(plan.targetDate)
  const savers = saversOf(s).map((who) => saverStatus(who, plan, s, readings, target, today))
  const checked = savers.filter((x) => x.last !== null)
  return {
    target,
    today,
    savers,
    savedNow: checked.reduce((sum, x) => sum + x.last!.amount, 0),
    asOf: checked.length ? Math.max(...checked.map((x) => x.last!.day)) : null,
    vsPlan: checked.length ? checked.reduce((sum, x) => sum + (x.vsPlan ?? 0), 0) : null,
    monthlyTotal: savers.reduce((sum, x) => sum + x.deposit, 0),
    monthsLeft: target === null ? 0 : Math.max(0, monthsBetween(today, target)),
    atTarget: savers.reduce((sum, x) => sum + x.total, 0),
    bonusCounted: s.useAspLoan && plan.bonusPct > 0,
  }
}

/* ------------------------------------------------------------ the answers */

/**
 * The household's balance at day `t`: each saver's check-ins as a line, the
 * plan after the last one, nothing before the first. Null when a saver who
 * has checked in has not yet by `t` - the household line starts when all of
 * them have. A saver who has never checked in counts from zero today.
 *
 * No bonus in it: that is paid at the purchase, not seen in the account.
 */
export function householdAt(status: SavingStatus, plan: SavingPlan, t: number): number | null {
  let sum = 0
  for (const x of status.savers) {
    const pts = x.points
    if (!pts.length) {
      if (t > status.today) sum += grow(0, x.deposit, plan.interestPct, monthsBetween(status.today, t))
      continue
    }
    if (t < pts[0].day) return null
    const last = pts[pts.length - 1]
    if (t >= last.day) {
      sum += grow(last.amount, x.deposit, plan.interestPct, monthsBetween(last.day, t))
      continue
    }
    const k = pts.findIndex((p) => p.day > t)
    const a = pts[k - 1]
    const b = pts[k]
    sum += a.amount + ((b.amount - a.amount) * (t - a.day)) / (b.day - a.day)
  }
  return sum
}

/** The plan's line for the household: each saver from their first check-in at the planned deposit. */
export function planAt(status: SavingStatus, plan: SavingPlan, t: number): number | null {
  let sum = 0
  for (const x of status.savers) {
    if (!x.first) continue
    if (t < x.first.day) return null
    sum += grow(x.first.amount, x.deposit, plan.interestPct, monthsBetween(x.first.day, t))
  }
  return sum
}

/**
 * The first day on which the household, carrying on at the plan, has
 * `needed` in the accounts - today when it already has, null when it never
 * gets there within `horizonYears`. Found on whole days by bisection: the
 * balance only grows once every saver is past their last check-in.
 *
 * Without the bonus - it is paid at the purchase, whenever that is, and so
 * cannot be counted towards a day before it.
 */
export function reachedOn(
  status: SavingStatus,
  plan: SavingPlan,
  needed: number,
  horizonYears = 40,
): number | null {
  const from = Math.max(status.today, status.asOf ?? status.today)
  const at = (t: number) => householdAt(status, plan, t) ?? 0
  if (at(from) >= needed) return from
  let hi = from + Math.round(horizonYears * 365.25)
  if (at(hi) < needed) return null
  let lo = from
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (at(mid) >= needed) hi = mid
    else lo = mid
  }
  return hi
}

/**
 * What 1 € a month more, from today to the purchase, adds at the purchase -
 * with the interest, and the bonus when it is counted. The projection is
 * linear in the deposit, so a shortfall divided by this is exactly the
 * monthly sum that closes it.
 */
export function perEuroMonthly(plan: SavingPlan, s: HousingSituation, today: number): number {
  const target = dayOf(plan.targetDate)
  if (target === null || target <= today) return 0
  const months = monthsBetween(today, target)
  const grown = grow(0, 1, plan.interestPct, months)
  if (!(s.useAspLoan && plan.bonusPct > 0)) return grown
  // The bonus window closes for everyone at once here: the earlier of the
  // two savers' ends, which is the cautious reading of an extra shared sum.
  const ends = saversOf(s).map((who) =>
    bonusEnd(who === 'self' ? plan.aspFirstMonth : plan.partnerAspFirstMonth),
  )
  const end = Math.min(target, ...ends)
  const bonusMonths = end > today ? monthsBetween(today, end) : 0
  return grown + (balanceMonths(0, 1, plan.interestPct, bonusMonths) * plan.bonusPct) / 100 / 12
}

/**
 * The household's deposit, € / month from today, that lands exactly on
 * `needed` at the purchase. Null without a purchase day ahead.
 */
export function monthlyFor(
  status: SavingStatus,
  plan: SavingPlan,
  s: HousingSituation,
  needed: number,
): number | null {
  const k = perEuroMonthly(plan, s, status.today)
  if (k <= 0) return null
  return Math.max(0, status.monthlyTotal + (needed - status.atTarget) / k)
}
