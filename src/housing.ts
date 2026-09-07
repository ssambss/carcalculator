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
 *    (95 % under the 2026 loan cap and the decided ASP reform), so cash has to
 *    bridge the rest no matter how strong the income is.
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
  /** a second borrower on the same loan — a couple buying together */
  buyingTogether: boolean
  partnerNetIncomePerMonth: number
  partnerOtherLoanPaymentsPerMonth: number
  partnerSavings: number
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
  /** what renting a comparable home would cost instead, € / month; 0 = not asked */
  rentPerMonth: number
  /** how fast rent and the housing charges rise, %/yr */
  rentGrowthPct: number
  /** what invested money earns, %/yr nominal */
  investmentReturnPct: number
  /** how the home's value moves, %/yr nominal */
  homeValueGrowthPct: number
  /** tax on investment gains when they are finally sold, % — an own home sells tax-free */
  gainsTaxPct: number
}

export const DEFAULT_HOUSING: HousingSituation = {
  netIncomePerMonth: 0,
  otherLoanPaymentsPerMonth: 0,
  savings: 0,
  buyingTogether: false,
  partnerNetIncomePerMonth: 0,
  partnerOtherLoanPaymentsPerMonth: 0,
  partnerSavings: 0,
  housingSharePct: 35,
  ratePct: 3.5,
  termYears: 25,
  stressRatePct: 6,
  // The April 2026 reform's figure (ASP loan to 95 % of the price), modeled
  // as in force because the purchase this plans for happens after it lands;
  // the rule banks apply in 2026 is still 10. The general loan cap has
  // allowed 5 % for everyone since 30.6.2026 anyway.
  minDownPaymentPct: 5,
  transferTaxPct: 1.5,
  buyingCosts: 0,
  maintenanceEstimatePerMonth: 250,
  useAspLoan: false,
  aspRatePct: 3.0,
  // The single-borrower cap in the big cities (Helsinki, Espoo, Vantaa,
  // Kauniainen, Tampere, Turku, Oulu — the 1.6.2026 tiers; elsewhere
  // 160 000 €). Two ASP savers buying together get half as much again
  // (345 000 € / 240 000 €) - typed in here, not multiplied by the code,
  // because it depends on BOTH buyers being ASP savers, which this model
  // does not know. An input like the other rules - check the current figure.
  aspMaxLoan: 230000,
  rentPerMonth: 0,
  rentGrowthPct: 2,
  // A broad equity index's long-run nominal return, before the tax below; the
  // home's growth is the modest long-run figure for Finnish cities, where
  // prices have lately trailed inflation. Both are guesses to argue with.
  investmentReturnPct: 7,
  homeValueGrowthPct: 2,
  // Finland taxes capital gains at 30 % (34 % above 30 000 € a year); the
  // gain on a home you lived in for two years is exempt. That asymmetry is
  // real money over decades, which is why it is modeled and not footnoted.
  gainsTaxPct: 30,
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

/* ---------------------------------------------------------- the household */

/**
 * Both borrowers' figures together — the bank sizes one household, so with the
 * toggle on, a partner's income, obligations and savings simply count in full.
 * Everything downstream reads only these totals: the partner fields are inert
 * until the toggle says otherwise.
 */
export function householdIncome(s: HousingSituation): number {
  return s.netIncomePerMonth + (s.buyingTogether ? s.partnerNetIncomePerMonth : 0)
}

export function householdOtherLoans(s: HousingSituation): number {
  return s.otherLoanPaymentsPerMonth + (s.buyingTogether ? s.partnerOtherLoanPaymentsPerMonth : 0)
}

export function householdSavings(s: HousingSituation): number {
  return s.savings + (s.buyingTogether ? s.partnerSavings : 0)
}

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

/**
 * The ASP term cap, taken from the April 2026 reform (40 years) rather than
 * the 25 of the rules in force — this models a purchase made after the reform
 * lands. The stress test keeps its own 25-year cap: that is supervisory
 * practice, not part of the ASP reform.
 */
const aspTermMonths = (s: HousingSituation): number => Math.min(s.termYears, 40) * 12

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
    (householdIncome(s) * s.housingSharePct) / 100 -
      householdOtherLoans(s) -
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
  const cashForPrice = Math.max(0, householdSavings(s) - s.buyingCosts)

  const priceByCash = (cashForPrice + loanCap) / (1 + t)
  // d + t can be 0 if somebody sets both to zero; then savings never bind.
  const priceByLtv = d + t > 0 ? cashForPrice / (d + t) : Number.POSITIVE_INFINITY

  const maxPrice = Math.max(0, Math.min(priceByCash, priceByLtv))
  const transferTax = maxPrice * t
  // The cash equation decides the split at the ceiling; the clamps only matter
  // away from it, but keep the numbers honest against rounding.
  const loan = Math.min(
    loanCap,
    Math.max(0, maxPrice + transferTax + s.buyingCosts - householdSavings(s)),
  )
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
  // Slot 1, not the otherwise-free slot 8: red next to orange fails the palette
  // validator for everyone (ΔE 7 - hard to tell apart even with full color
  // vision), and interest and principal are the two series that touch in
  // every housing chart. Blue against orange passes every check in both themes.
  { key: 'principal', label: 'Loan principal (equity)', series: 1 },
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
  const loan = Math.max(0, p.price * (1 + t) + s.buyingCosts - householdSavings(s))
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

/* ------------------------------------------------------------ over the years */

/**
 * One payment of the loan, and where the loan stands after it.
 *
 * The whole point of an annuity is that the payment stays put while what it
 * buys changes underneath: the first payments are mostly interest, the last
 * ones almost entirely principal. A monthly row is the honest resolution for
 * that - the crossover is a particular month, not "somewhere in year 17".
 */
export interface ScheduleMonth {
  /** 1-based month of the loan */
  month: number
  /** € of this payment that is interest */
  interest: number
  /** € of this payment that repays the loan - what you own afterwards */
  principal: number
  /** € still owed after this payment */
  balance: number
  /** € paid since the start, this payment included */
  interestToDate: number
  principalToDate: number
}

export interface Schedule {
  loan: number
  months: ScheduleMonth[]
  /**
   * The first payment in which principal reaches interest - the month the
   * payment turns from mostly cost into mostly ownership. Null without a loan.
   */
  crossoverMonth: number | null
  /** € of interest over the whole term */
  totalInterest: number
}

/**
 * Month by month, how a loan repays under the chosen financing.
 *
 * Each part - the ASP loan and the regular one on top - runs its own annuity
 * at its own rate and term (the ASP part stops at the 40-year cap, so a longer
 * term makes the payment step down when it ends). The rows add the parts
 * together: this is the bill as the borrower sees it, not two ledgers.
 *
 * The maths is the plain recurrence rather than the closed form, so the last
 * payment clears whatever rounding left behind and the balance ends at exactly
 * zero. Fractional terms are rounded to whole months.
 */
export function amortization(loan: number, s: HousingSituation): Schedule {
  const split = splitLoan(loan, s)
  const parts = [
    { balance: split.asp, ratePct: s.aspRatePct, months: Math.round(aspTermMonths(s)) },
    { balance: split.regular, ratePct: s.ratePct, months: Math.round(s.termYears * 12) },
  ]
    .filter((p) => p.balance > 0 && p.months > 0)
    .map((p) => ({
      ...p,
      i: p.ratePct / 100 / 12,
      payment: paymentForLoan(p.balance, p.ratePct, p.months),
    }))

  const months: ScheduleMonth[] = []
  const last = Math.max(0, ...parts.map((p) => p.months))
  let interestToDate = 0
  let principalToDate = 0
  let crossoverMonth: number | null = null

  for (let m = 1; m <= last; m++) {
    let interest = 0
    let principal = 0
    for (const p of parts) {
      if (m > p.months || p.balance <= 0) continue
      const int = p.balance * p.i
      // The last payment repays what is left, not what the formula says; the
      // two differ by rounding only, but "-0.00 € owed" is not a number to show.
      const repaid = m === p.months ? p.balance : Math.min(p.balance, p.payment - int)
      p.balance = Math.max(0, p.balance - repaid)
      interest += int
      principal += repaid
    }
    interestToDate += interest
    principalToDate += principal
    if (crossoverMonth === null && principal >= interest) crossoverMonth = m
    months.push({
      month: m,
      interest,
      principal,
      balance: parts.reduce((sum, p) => sum + p.balance, 0),
      interestToDate,
      principalToDate,
    })
  }

  return { loan: split.asp + split.regular, months, crossoverMonth, totalInterest: interestToDate }
}

/**
 * The same situation with both rates moved by `pp` percentage points, floored
 * at zero. Finnish mortgages float on the reference rate, so "what if rates
 * were higher" is a parallel shift of the ASP and the regular rate together -
 * not a new number for one of them.
 */
export function shiftRates(s: HousingSituation, pp: number): HousingSituation {
  return {
    ...s,
    ratePct: Math.max(0, s.ratePct + pp),
    aspRatePct: Math.max(0, s.aspRatePct + pp),
  }
}

/* ------------------------------------------------------------ rent or buy */

/**
 * What a home costs to hold, for the rent-or-buy question: the price and the
 * loan the buyer would take, the cash that leaves at closing, and the monthly
 * charges that come with owning it. Either the ceiling or a candidate fits.
 */
export interface Holding {
  price: number
  loan: number
  /** down payment plus transfer tax plus buying costs — what the renter keeps */
  cashAtClosing: number
  /** hoitovastike, rahoitusvastike, other — what the buyer pays on top of the loan */
  chargesPerMonth: number
}

export interface RentVsBuyMonth {
  month: number
  /** € the buyer pays this month: loan payment plus charges */
  buyerPays: number
  /** € of that which is the housing charges */
  charges: number
  /** € the renter pays this month */
  rent: number
  /** € invested this month: positive by the renter, negative by the buyer */
  invested: number
  homeValue: number
  loanBalance: number
  /** home value less what is still owed */
  homeEquity: number
  /** the buyer's side portfolio, if rent ever cost more than owning */
  buyerPortfolio: number
  renterPortfolio: number
  /** home equity plus the side portfolio, gains taxed */
  buyerNetWorth: number
  /** the renter's portfolio, gains taxed */
  renterNetWorth: number
}

export interface RentVsBuy {
  months: RentVsBuyMonth[]
  /** who ends ahead, and from which month they stayed ahead; null if level at the end */
  leader: 'buy' | 'rent' | null
  leaderFrom: number | null
  /** € the renter put in over the whole term, the closing cash included */
  renterInvested: number
  totalRent: number
  totalInterest: number
  totalCharges: number
  /**
   * The yearly return at which both end level, %/yr - renting wins above it,
   * buying below. Null when one side is ahead at every return from 0 to 30 %.
   */
  breakEvenReturnPct: number | null
}

/** A yearly rate as its monthly compounding equivalent. */
const monthlyRate = (pct: number) => Math.pow(1 + pct / 100, 1 / 12) - 1

/** Portfolio value after the gains tax, gains being whatever exceeds the money put in. */
function afterGainsTax(portfolio: number, contributed: number, taxPct: number): number {
  return portfolio - (Math.max(0, portfolio - contributed) * taxPct) / 100
}

function simulate(h: Holding, s: HousingSituation, returnPct: number): RentVsBuyMonth[] {
  const schedule = amortization(h.loan, s)
  const horizon = Math.max(1, Math.round(s.termYears * 12))
  const r = monthlyRate(returnPct)
  const g = monthlyRate(s.homeValueGrowthPct)

  let renterPortfolio = h.cashAtClosing
  let renterContributed = h.cashAtClosing
  let buyerPortfolio = 0
  let buyerContributed = 0
  let homeValue = h.price
  const out: RentVsBuyMonth[] = []

  for (let m = 1; m <= horizon; m++) {
    // Rent and charges step up once a year, as leases and vastikkeet do.
    const uplift = Math.pow(1 + s.rentGrowthPct / 100, Math.floor((m - 1) / 12))
    const rent = s.rentPerMonth * uplift
    const charges = h.chargesPerMonth * uplift
    const payment = schedule.months[m - 1]
    const buyerPays = (payment ? payment.interest + payment.principal : 0) + charges
    const loanBalance = payment ? payment.balance : 0

    // Both grow for the month, then whoever paid less invests the difference.
    renterPortfolio *= 1 + r
    buyerPortfolio *= 1 + r
    homeValue *= 1 + g
    const invested = buyerPays - rent
    if (invested > 0) {
      renterPortfolio += invested
      renterContributed += invested
    } else {
      buyerPortfolio -= invested
      buyerContributed -= invested
    }

    const homeEquity = homeValue - loanBalance
    out.push({
      month: m,
      buyerPays,
      charges,
      rent,
      invested,
      homeValue,
      loanBalance,
      homeEquity,
      buyerPortfolio,
      renterPortfolio,
      buyerNetWorth: homeEquity + afterGainsTax(buyerPortfolio, buyerContributed, s.gainsTaxPct),
      renterNetWorth: afterGainsTax(renterPortfolio, renterContributed, s.gainsTaxPct),
    })
  }
  return out
}

/**
 * Buy this home, or rent one like it and invest the difference?
 *
 * The renter keeps the closing cash and invests it on day one; every month
 * after, whoever pays less puts the difference into the same investments -
 * usually the renter, since a payment plus charges tends to exceed rent, but
 * the other way round when it does not. The buyer's wealth is the home's
 * value less the loan; the renter's is the portfolio. Both are counted after
 * the tax on investment gains, because an own home sells tax-free in Finland
 * and a fund does not - over decades that decides close cases.
 *
 * Not modeled, deliberately: selling costs on the home, a rent deposit, the
 * years after the loan is repaid (the horizon is the loan term, when the
 * buyer's outlay drops to the charges alone and the picture only improves
 * for them), and rent-vs-own differences in insurance or utilities. Each is a
 * refinement on a comparison whose answer is dominated by three guesses:
 * the return, the home's growth, and how rents move.
 */
export function rentVsBuy(h: Holding, s: HousingSituation): RentVsBuy {
  const months = simulate(h, s, s.investmentReturnPct)
  const last = months[months.length - 1]

  // Who leads at the end, and how far back they have led without a break.
  const sign = (m: RentVsBuyMonth) => Math.sign(m.buyerNetWorth - m.renterNetWorth)
  const finalSign = sign(last)
  let leaderFrom: number | null = null
  if (finalSign !== 0) {
    let k = months.length - 1
    while (k > 0 && sign(months[k - 1]) === finalSign) k--
    leaderFrom = months[k].month
  }

  // Bisection on the return: the gap at the horizon rises with it, because the
  // renter holds more invested money than the buyer at every return.
  const gapAt = (pct: number) => {
    const end = simulate(h, s, pct)[months.length - 1]
    return end.renterNetWorth - end.buyerNetWorth
  }
  let breakEvenReturnPct: number | null = null
  let lo = 0
  let hi = 30
  if (gapAt(lo) < 0 && gapAt(hi) > 0) {
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (gapAt(mid) < 0) lo = mid
      else hi = mid
    }
    breakEvenReturnPct = (lo + hi) / 2
  }

  return {
    months,
    leader: finalSign > 0 ? 'buy' : finalSign < 0 ? 'rent' : null,
    leaderFrom,
    renterInvested: h.cashAtClosing + months.reduce((sum, m) => sum + Math.max(0, m.invested), 0),
    totalRent: months.reduce((sum, m) => sum + m.rent, 0),
    totalInterest: amortization(h.loan, s).totalInterest,
    totalCharges: months.reduce((sum, m) => sum + m.charges, 0),
    breakEvenReturnPct,
  }
}
