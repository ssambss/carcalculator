/**
 * Housing: how much you could afford, and what each candidate would cost.
 *
 * A different question from the car side, and deliberately not the same model
 * with new labels. Cars ask *"given this price, what does it cost per month?"*
 * Housing asks that too — per candidate — but it leads with the inverse:
 * *"given my income and savings, what price can I reach at all?"* That ceiling
 * is what every candidate is then measured against.
 *
 * ## What limits an affordable price
 *
 * Four constraints, and naming the binding one is the useful part — "your
 * savings are the limit, not your income" changes what somebody does next:
 *
 * 1. **Income** — the monthly payment the housing budget can carry, at the rate
 *    you expect to actually pay.
 * 2. **The stress test** — banks in Finland size the loan at a test rate
 *    (~6 %) over at most 25 years, whatever rate they offer you. This is
 *    usually the one that binds.
 * 3. **Savings** — the price where the down payment plus transfer tax plus
 *    costs exhausts what you have.
 * 4. **The loan-to-value rule** — a mortgage may only cover part of the price
 *    (90 % is the common cap), so cash has to bridge the rest no matter how
 *    strong the income is.
 *
 * Financing can be a regular mortgage or an **ASP loan** (the first-home
 * scheme): cheaper money, but capped per municipality — a home under the cap
 * is bought fully on ASP, a dearer one on ASP plus a regular loan on top.
 * See `splitLoan` for what is and is not modeled.
 *
 * The regulatory numbers — stress rate, LTV cap, transfer tax, the ASP cap —
 * are **inputs with defaults, not facts baked in**. They change with the law
 * and with the buyer (first homes have had different rules over the years), so
 * the form says "check the current rules" rather than this file pretending to
 * know.
 */

/* -------------------------------------------------------------------- types */

/** Your side of the question: income, savings, and the rules to assume. */
export interface HousingSituation {
  /** € per month, after tax */
  netIncomePerMonth: number
  /** existing obligations: car loans, student loans — € per month */
  otherLoanPaymentsPerMonth: number
  /** cash available for the down payment, tax and fees */
  savings: number
  /** how much of net income housing may take, % — payment plus charges */
  housingSharePct: number
  /** the rate you expect to actually pay (reference + margin), %/yr */
  ratePct: number
  termYears: number
  /** what the bank sizes the loan at, %/yr — check the current practice */
  stressRatePct: number
  /** cash share of the price the loan may not cover, % — the LTV rule */
  minDownPaymentPct: number
  /** varainsiirtovero, % of the price — check the current rate */
  transferTaxPct: number
  /** valuation, notary, arrangement fees — flat € */
  buyingCosts: number
  /** hoitovastike guess used for the ceiling; candidates carry their own */
  maintenanceEstimatePerMonth: number
  /** finance with an ASP loan — first-home scheme, cheaper but capped */
  useAspLoan: boolean
  /** the ASP loan's rate, %/yr — banks price these below a regular mortgage */
  aspRatePct: number
  /** the municipal cap on the ASP loan, € — anything above becomes a regular loan */
  aspMaxLoan: number
}

export const DEFAULT_HOUSING: HousingSituation = {
  netIncomePerMonth: 0,
  otherLoanPaymentsPerMonth: 0,
  savings: 0,
  housingSharePct: 35,
  ratePct: 3.5,
  termYears: 25,
  stressRatePct: 6,
  minDownPaymentPct: 10,
  transferTaxPct: 1.5,
  buyingCosts: 0,
  maintenanceEstimatePerMonth: 250,
  useAspLoan: false,
  aspRatePct: 3.0,
  // Helsinki's cap; Espoo/Vantaa/Kauniainen, Tampere/Turku and the rest are
  // lower. An input like the other rules - check your municipality's figure.
  aspMaxLoan: 230000,
}

/** A flat or house you are actually considering. */
export interface PropertyListing {
  id: string
  name: string
  notes: string
  favorite: boolean
  /** asking price, € */
  price: number
  sizeM2: number
  /** hoitovastike — the housing company's upkeep charge, € / month */
  maintenancePerMonth: number
  /** rahoitusvastike — the company's own loan, € / month; often optional to pay off */
  financingChargePerMonth: number
  /** parking, sauna, broadband, whatever else is fixed — € / month */
  otherPerMonth: number
  createdAt: string
  updatedAt: string
}

export type Constraint = 'income' | 'stress' | 'savings'

export interface Affordability {
  /** the ceiling: the highest price every constraint allows */
  maxPrice: number
  /** the loan and cash split at that ceiling */
  loan: number
  /** how the ceiling loan packages: the ASP part and the regular part on top */
  aspLoan: number
  regularLoan: number
  downPayment: number
  transferTax: number
  /** € / month the budget allows for the payment, after other loans and charges */
  paymentBudget: number
  /** what the ceiling loan costs monthly at your own rate */
  paymentAtRate: number
  /** ...and at the stress rate, which is what the bank sized it on */
  paymentAtStress: number
  /** the largest loan income allows at your rate / at the stress rate */
  maxLoanByPayment: number
  maxLoanByStress: number
  /** which constraint set the ceiling */
  limitedBy: Constraint
}

/* -------------------------------------------------------------------- maths */

/**
 * The largest principal a monthly payment can carry: the annuity inverted.
 *
 *   P = A · (1 − (1+i)^−n) / i
 *
 * with i the monthly rate and n the months. At 0 % it degenerates to A·n.
 */
export function maxLoanForPayment(payment: number, ratePct: number, termMonths: number): number {
  if (payment <= 0 || termMonths <= 0) return 0
  const i = ratePct / 100 / 12
  if (i === 0) return payment * termMonths
  return (payment * (1 - Math.pow(1 + i, -termMonths))) / i
}

/** The annuity itself, for showing what a given loan costs per month. */
export function paymentForLoan(loan: number, ratePct: number, termMonths: number): number {
  if (loan <= 0 || termMonths <= 0) return 0
  const i = ratePct / 100 / 12
  if (i === 0) return loan / termMonths
  return (loan * i) / (1 - Math.pow(1 + i, -termMonths))
}

/* ---------------------------------------------------------------- ASP split */

/** An ASP loan runs at most 25 years, whatever term the regular loan gets. */
const aspTermMonths = (s: HousingSituation): number => Math.min(s.termYears, 25) * 12

export interface LoanSplit {
  /** the ASP part, up to the municipal cap */
  asp: number
  /** whatever the cap could not cover, as a regular mortgage on top */
  regular: number
  aspPayment: number
  regularPayment: number
  /** both annuities together, € / month */
  payment: number
  /** first-month interest across both parts */
  firstMonthInterest: number
}

/**
 * How a loan packages under the chosen financing.
 *
 * With ASP on, the cheap money goes in first: the ASP loan takes as much as
 * the municipal cap allows, and only the remainder becomes a regular mortgage
 * — a home under the cap is bought fully on ASP, a dearer one on the
 * combination. With ASP off, everything is one regular loan and the split
 * degenerates to what the maths did before it existed.
 *
 * The ASP interest subsidy (the state pays 70 % of the rate above 3.8 % for
 * the first ten years) is deliberately NOT modeled: at today's rates it is
 * worth zero, it expires mid-loan, and a bank does not count it when sizing.
 * If rates climb past the threshold, fold it into the ASP rate by hand.
 */
export function splitLoan(loan: number, s: HousingSituation): LoanSplit {
  const asp = s.useAspLoan ? Math.min(Math.max(0, loan), Math.max(0, s.aspMaxLoan)) : 0
  const regular = Math.max(0, loan - asp)
  const aspPayment = paymentForLoan(asp, s.aspRatePct, aspTermMonths(s))
  const regularPayment = paymentForLoan(regular, s.ratePct, s.termYears * 12)
  return {
    asp,
    regular,
    aspPayment,
    regularPayment,
    payment: aspPayment + regularPayment,
    firstMonthInterest: (asp * s.aspRatePct + regular * s.ratePct) / 100 / 12,
  }
}

/**
 * The largest total loan the budget carries at the offered rates: with ASP on,
 * the budget buys the ASP loan first (the cheaper money, so every euro of
 * budget carries more of it), and whatever budget remains carries a regular
 * loan on top.
 */
function maxLoanForBudget(budget: number, s: HousingSituation): number {
  if (!s.useAspLoan) return maxLoanForPayment(budget, s.ratePct, s.termYears * 12)
  const asp = Math.min(
    Math.max(0, s.aspMaxLoan),
    maxLoanForPayment(budget, s.aspRatePct, aspTermMonths(s)),
  )
  const budgetLeft = budget - paymentForLoan(asp, s.aspRatePct, aspTermMonths(s))
  return asp + maxLoanForPayment(budgetLeft, s.ratePct, s.termYears * 12)
}

/**
 * How high a price the whole situation reaches, and what stops it there.
 *
 * The closed forms, with L the largest permissible loan, S savings, c flat
 * costs, t transfer tax and d the minimum cash share:
 *
 *   cash-limited price:  price·(1+t) + c = S + L      (all savings + all loan)
 *   LTV-limited price:   price·(d+t) + c = S          (savings must cover the
 *                                                      cash share and the tax)
 *
 * The ceiling is the lower of the two, and the loan actually used at that
 * price is whatever the cash equation needs — never more than L, never more
 * than the LTV cap allows.
 */
export function affordability(s: HousingSituation): Affordability {
  const budget = Math.max(
    0,
    (s.netIncomePerMonth * s.housingSharePct) / 100 -
      s.otherLoanPaymentsPerMonth -
      s.maintenanceEstimatePerMonth,
  )

  const maxLoanByPayment = maxLoanForBudget(budget, s)
  // The stress test uses the test rate over at most 25 years, whatever the
  // offered term - a 30-year loan is not allowed to look cheaper under stress.
  // It tests the whole debt, however it is packaged: an ASP loan is stressed
  // exactly like a regular one, so ASP never moves a stress-limited ceiling.
  const stressMonths = Math.min(s.termYears, 25) * 12
  const maxLoanByStress = maxLoanForPayment(budget, s.stressRatePct, stressMonths)
  const loanCap = Math.min(maxLoanByPayment, maxLoanByStress)

  const t = s.transferTaxPct / 100
  const d = s.minDownPaymentPct / 100
  const cashForPrice = Math.max(0, s.savings - s.buyingCosts)

  const priceByCash = (cashForPrice + loanCap) / (1 + t)
  // d + t can be 0 if somebody sets both to zero; then savings never bind.
  const priceByLtv = d + t > 0 ? cashForPrice / (d + t) : Number.POSITIVE_INFINITY

  const maxPrice = Math.max(0, Math.min(priceByCash, priceByLtv))
  const transferTax = maxPrice * t
  // The cash equation decides the split at the ceiling; the clamps only matter
  // away from it, but keep the numbers honest against rounding.
  const loan = Math.min(loanCap, Math.max(0, maxPrice + transferTax + s.buyingCosts - s.savings))
  const downPayment = Math.max(0, maxPrice - loan)
  const split = splitLoan(loan, s)

  const limitedBy: Constraint =
    priceByLtv < priceByCash
      ? 'savings'
      : maxLoanByStress < maxLoanByPayment
        ? 'stress'
        : 'income'

  return {
    maxPrice,
    loan,
    aspLoan: split.asp,
    regularLoan: split.regular,
    downPayment,
    transferTax,
    paymentBudget: budget,
    paymentAtRate: split.payment,
    paymentAtStress: paymentForLoan(loan, s.stressRatePct, stressMonths),
    maxLoanByPayment,
    maxLoanByStress,
    limitedBy,
  }
}

/* ---------------------------------------------------------- property costs */

/**
 * Housing cost categories, in display order.
 *
 * `series` maps to the same --series-N palette the car breakdown uses, so the
 * two modes read as one app. Principal is in the bar on purpose: it leaves
 * your account every month, but it is the one segment that is *buying* you
 * something, and the split between it and interest is the honest heart of a
 * mortgage.
 */
export const HOUSING_CATEGORIES = [
  { key: 'interest', label: 'Loan interest', series: 2 },
  { key: 'principal', label: 'Loan principal (equity)', series: 8 },
  { key: 'maintenance', label: 'Maintenance charge', series: 6 },
  { key: 'financingCharge', label: 'Financing charge', series: 5 },
  { key: 'other', label: 'Other', series: 7 },
] as const

export type HousingCategoryKey = (typeof HOUSING_CATEGORIES)[number]['key']
export type HousingBreakdown = Record<HousingCategoryKey, number>

export interface PropertyCost {
  /** what this price would have you borrow, given your savings */
  loan: number
  /** how that loan packages — all ASP, ASP + regular on top, or all regular */
  aspLoan: number
  regularLoan: number
  downPayment: number
  /** € / month: the annuity at your own rate and term */
  loanPayment: number
  /** € / month: everything that leaves the account */
  totalPerMonth: number
  /** € / month excluding principal — the part you never get back */
  costPerMonth: number
  pricePerM2: number | null
  /** under the ceiling, or not */
  fits: boolean
  /**
   * First-month split of the payment. Stated as first-month rather than some
   * average because that is a real number the first bill will show; the split
   * drifts towards principal as the loan shrinks.
   */
  breakdown: HousingBreakdown
}

/**
 * What buying this particular place would cost, measured against the ceiling.
 *
 * The loan is derived from *your* situation, not entered per property: price
 * plus tax plus costs, minus every euro of savings. That mirrors how people
 * actually buy — savings go in first, the loan covers the rest.
 */
export function propertyCost(p: PropertyListing, s: HousingSituation, ceiling: number): PropertyCost {
  const t = s.transferTaxPct / 100
  const loan = Math.max(0, p.price * (1 + t) + s.buyingCosts - s.savings)
  const downPayment = Math.max(0, p.price - loan)
  const split = splitLoan(loan, s)
  const loanPayment = split.payment

  // First-month split: interest is simply each part's monthly rate on its
  // principal; everything else in the payment reduces the loan.
  const interest = split.firstMonthInterest
  const principal = Math.max(0, loanPayment - interest)

  const charges = p.maintenancePerMonth + p.financingChargePerMonth + p.otherPerMonth
  const totalPerMonth = loanPayment + charges

  return {
    loan,
    aspLoan: split.asp,
    regularLoan: split.regular,
    downPayment,
    loanPayment,
    totalPerMonth,
    costPerMonth: totalPerMonth - principal,
    pricePerM2: p.sizeM2 > 0 ? p.price / p.sizeM2 : null,
    fits: p.price <= ceiling,
    breakdown: {
      interest,
      principal,
      maintenance: p.maintenancePerMonth,
      financingCharge: p.financingChargePerMonth,
      other: p.otherPerMonth,
    },
  }
}
