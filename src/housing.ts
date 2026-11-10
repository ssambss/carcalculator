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
 *    costs exhausts what you have. The tax depends on what kind of home it
 *    is — real estate pays twice what housing-company shares do — so a
 *    detached house has a ceiling of its own, a little lower.
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
  /** varainsiirtovero on housing-company shares — a flat, a terraced house — % of the price */
  transferTaxPct: number
  /** varainsiirtovero on real estate — a detached house on its own plot — % of the price */
  transferTaxRealEstatePct: number
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
  /** what the owner puts into investments each month on top of the housing costs, € — a fixed figure */
  ownerInvestPerMonth: number
  /** how fast the building cost index rises, %/yr — what an aso payment comes back as on moving out; it never comes back below the payment */
  asoIndexPct: number
  /** waiting in an aso home: 'YYYY-MM-DD' of moving in; '' = the saving plan's purchase day, else today */
  waitMoveIn: string
  /** waiting: the household's cash outside the ASP accounts on moving in, € - what pays the aso payment */
  waitOtherCash: number
  /** waiting: what the household invests a month on top of the ASP deposits while it lives there, € */
  waitInvestPerMonth: number
  /**
   * waiting: the rent paid now, € / month - what staying put is held against;
   * 0 = no comparison. Not `rentPerMonth`, which is what a home comparable to
   * the one being bought would rent for: the place you live in now is a
   * different home at a different rent.
   */
  waitRentPerMonth: number
  /** the year the area price projection runs to; 0 = two years from now */
  projectionYear: number
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
  // The rates since 1.1.2024: shares in a housing company 1.5 %, real estate
  // 3 % (down from 2 and 4; the first-home exemption went the same day).
  // Which one a place pays is not a choice - see transferTaxPctFor.
  transferTaxPct: 1.5,
  transferTaxRealEstatePct: 3,
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
  // Zero until the buyer says otherwise: the renter then invests only what the
  // housing costs leave, and the owner nothing - the conservative reading.
  ownerInvestPerMonth: 0,
  // An aso payment comes back grown by the building cost index
  // (rakennuskustannusindeksi), with no cap on the rise and never below the
  // payment (LAO 393/2021 § 56). The index rose 3.4 % in the year to 9/2026;
  // 2 % is the same modest long-run guess the home's value starts from, so
  // neither side of rent-or-buy is handed a head start by default.
  asoIndexPct: 2,
  // Waiting in an aso home: nothing assumed about money the app has not been
  // told of - no cash outside ASP, no investing beyond the saving plan.
  waitMoveIn: '',
  waitOtherCash: 0,
  waitInvestPerMonth: 0,
  waitRentPerMonth: 0,
  // "Two years from now" until the buyer names the year - the horizon of
  // somebody saving up, and one that moves with the calendar on its own.
  projectionYear: 0,
}

/**
 * What kind of home a listing is, on the axis the price statistics are
 * published along: flats (kerrostalo) by room count, terraced houses
 * (rivitalo) as one series, and detached houses (omakotitalo), which the
 * housing-company statistics do not cover at all. Empty means not said.
 */
export type HomeType = 'flat' | 'terraced' | 'detached'

export const HOME_TYPES: { key: HomeType; label: string; fi: string }[] = [
  { key: 'flat', label: 'Flat', fi: 'kerrostalo' },
  { key: 'terraced', label: 'Terraced house', fi: 'rivitalo' },
  { key: 'detached', label: 'Detached house', fi: 'omakotitalo' },
]

/**
 * The transfer tax rate a place pays. Finland taxes the two ways a home
 * changes hands differently: shares in a housing company — a flat, a
 * terraced house — at one rate, real estate — a detached house on its own
 * plot — at twice that. Which applies is not a choice but follows from what
 * the place is, so it is read off the kind rather than typed per place. A
 * place that has not said what it is is read as shares: the common case,
 * and what the ceiling assumes unless asked about a detached house.
 */
export function transferTaxPctFor(homeType: HomeType | '', s: HousingSituation): number {
  return homeType === 'detached' ? s.transferTaxRealEstatePct : s.transferTaxPct
}

/**
 * How the home would be held. Owned is the purchase every other card is
 * about; `aso` is an asumisoikeusasunto - a right of occupancy bought with a
 * one-off payment that comes back, index-linked, on moving out, and lived in
 * for a monthly käyttövastike. Nothing is bought, so there is no price, no
 * transfer tax, no ASP loan and no home whose value moves.
 */
export type Tenure = 'owned' | 'aso'

/** A flat or house you are actually considering. */
export interface PropertyListing {
  id: string
  name: string
  notes: string
  favorite: boolean
  /** owned (the default) or a right of occupancy - which of the fields below the maths reads */
  tenure: Tenure
  /** asking price, € - owned places only */
  price: number
  /** asumisoikeusmaksu, € - the one-off payment for a right of occupancy; aso places only */
  asoPayment: number
  /** käyttövastike, € / month - what an aso home charges in place of rent; aso places only */
  usageChargePerMonth: number
  sizeM2: number
  /** postal code, e.g. "00730" — ties a place in Helsinki, Espoo, Kauniainen or Vantaa to its area's price history; any other code is kept but read against nothing */
  postalCode: string
  /** which published price series the place is measured against; '' = not said, read as all flats */
  homeType: HomeType | ''
  /** rooms — the 2 of "2h+k", kitchen not counted; 0 = not said */
  rooms: number
  /** hoitovastike — the housing company's upkeep charge, € / month; owned places only */
  maintenancePerMonth: number
  /** rahoitusvastike — the company's own loan, € / month; often optional to pay off; owned places only */
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
 * How high a price the whole situation reaches, and what stops it there —
 * for a home of the given kind, since the tax rate, and with it the ceiling,
 * differs between shares and real estate. Unsaid means shares.
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
export function affordability(s: HousingSituation, homeType: HomeType | '' = ''): Affordability {
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

  const t = transferTaxPctFor(homeType, s) / 100
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
  // An aso home's käyttövastike, in the renting teal of the rent-or-buy card:
  // it is the rent-like part of that way of living. After principal, not
  // beside maintenance, because the two never share a bar (an aso home has
  // no hoitovastike) and the green maintenance slot sits too close to the
  // teal in the dark theme; the bars an aso place draws - interest,
  // principal, usage, other - pass the palette validator in both themes.
  { key: 'usageCharge', label: 'Usage charge (käyttövastike)', series: 3 },
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
  /** varainsiirtovero at the rate for this kind of home */
  transferTax: number
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
 * What buying this particular place would cost, measured against the ceiling
 * for its kind of home.
 *
 * The loan is derived from *your* situation, not entered per property: price
 * plus tax plus costs, minus every euro of savings. That mirrors how people
 * actually buy — savings go in first, the loan covers the rest. The tax is
 * the rate for what the place is (transferTaxPctFor), and so is the ceiling
 * it is held against: a detached house pays more at closing, so the same
 * price can be within reach as a flat and over the ceiling as a house.
 */
export function propertyCost(p: PropertyListing, s: HousingSituation): PropertyCost {
  if (p.tenure === 'aso') return asoCost(p, s)
  const transferTax = (p.price * transferTaxPctFor(p.homeType, s)) / 100
  const loan = Math.max(0, p.price + transferTax + s.buyingCosts - householdSavings(s))
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
    transferTax,
    loanPayment,
    totalPerMonth,
    costPerMonth: totalPerMonth - principal,
    pricePerM2: p.sizeM2 > 0 ? p.price / p.sizeM2 : null,
    fits: p.price <= affordability(s, p.homeType).maxPrice,
    breakdown: {
      interest,
      principal,
      usageCharge: 0,
      maintenance: p.maintenancePerMonth,
      financingCharge: p.financingChargePerMonth,
      other: p.otherPerMonth,
    },
  }
}

/* ---------------------------------------------------- right of occupancy */

/** The situation an aso payment's loan is priced under: a plain bank loan, never ASP. */
const regularOnly = (s: HousingSituation): HousingSituation => ({ ...s, useAspLoan: false })

/** What an aso place's monthly charges are: the käyttövastike and whatever else is fixed. */
export const asoChargesPerMonth = (p: PropertyListing): number =>
  p.usageChargePerMonth + p.otherPerMonth

export interface AsoReach {
  /** € / month left for a loan once the place's own charges are paid; negative = the charges alone overrun the share */
  budget: number
  /** the largest loan that budget carries at your rate and under the stress test */
  maxLoan: number
  /** the largest payment savings plus that loan reach, and the cash share allows */
  maxPayment: number
}

/**
 * How large an aso payment the household reaches with this place's charges.
 *
 * The same rules the ceiling keeps, read for a home whose running cost is a
 * käyttövastike instead of a maintenance guess: housing may take the share of
 * net income, the place's own charges come off it first, and whatever is left
 * carries a loan - at the rate you would pay and under the stress test - for
 * the part of the payment savings do not cover. A käyttövastike that alone
 * overruns the share leaves no reach at all, however much is saved: the
 * payment is a one-off, the charge is every month.
 *
 * The minimum cash share applies to the payment as it does to a price: banks
 * lend against a right of occupancy (it can be pledged, LAO § 58) but want
 * their own-money share of it in cash - Nordea asks 5 % (11/2026). Whether
 * the statutory loan cap itself covers these loans is not settled anywhere
 * public, so this reads the situation's cash share as the bank's practice.
 */
export function asoReach(p: PropertyListing, s: HousingSituation): AsoReach {
  const budget =
    (householdIncome(s) * s.housingSharePct) / 100 - householdOtherLoans(s) - asoChargesPerMonth(p)
  if (budget < 0) return { budget, maxLoan: 0, maxPayment: 0 }
  const byPayment = maxLoanForPayment(budget, s.ratePct, s.termYears * 12)
  const byStress = maxLoanForPayment(budget, s.stressRatePct, Math.min(s.termYears, 25) * 12)
  const maxLoan = Math.min(byPayment, byStress)
  const d = s.minDownPaymentPct / 100
  const savings = householdSavings(s)
  const byCash = d > 0 ? savings / d : Number.POSITIVE_INFINITY
  return { budget, maxLoan, maxPayment: Math.min(savings + maxLoan, byCash) }
}

/**
 * What living in an aso home would cost per month.
 *
 * Savings pay the payment first, as they would a down payment; a loan covers
 * what they do not, as a plain bank loan at your rate and term - ASP loans
 * are not granted for a right of occupancy, and the ASP and state-guarantee
 * laws of 1.6.2026 (339/2025, 340/2025) cover shares and property only. No
 * transfer tax and no buying costs: nothing changes hands but the right. The
 * käyttövastike sits in the bar where an owned home's charges would.
 *
 * `costPerMonth` leaves the loan's principal out exactly as it does for a
 * purchase, and for the same reason: it pays down a loan against something
 * that comes back - here the payment itself, returned on moving out.
 */
function asoCost(p: PropertyListing, s: HousingSituation): PropertyCost {
  const loan = Math.max(0, p.asoPayment - householdSavings(s))
  const split = splitLoan(loan, regularOnly(s))
  const interest = split.firstMonthInterest
  const principal = Math.max(0, split.payment - interest)
  const totalPerMonth = split.payment + asoChargesPerMonth(p)
  const reach = asoReach(p, s)
  return {
    loan,
    aspLoan: 0,
    regularLoan: split.regular,
    downPayment: p.asoPayment - loan,
    transferTax: 0,
    loanPayment: split.payment,
    totalPerMonth,
    costPerMonth: totalPerMonth - principal,
    pricePerM2: null,
    fits: reach.budget >= 0 && p.asoPayment <= reach.maxPayment,
    breakdown: {
      interest,
      principal,
      usageCharge: p.usageChargePerMonth,
      maintenance: 0,
      financingCharge: 0,
      other: p.otherPerMonth,
    },
  }
}

/**
 * The aso payment as it comes back after `years`: the payment plus the change
 * in the building cost index (rakennuskustannusindeksi) since it was paid -
 * never less than the payment itself, which is what the law guarantees when
 * the index has fallen (LAO 393/2021 § 56). Improvements the resident was
 * allowed to make are added on top in real life; not modeled.
 */
export function asoReturned(payment: number, indexPct: number, years: number): number {
  return Math.max(payment, payment * Math.pow(1 + indexPct / 100, years))
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
  /**
   * € the renter pays this month. "The renter" throughout is the household
   * that does not buy: with an aso home as the alternative, this is its
   * käyttövastike and other charges, and the renter's fields are that
   * household's.
   */
  rent: number
  /** € the renter pays on a loan for the aso payment, if the closing cash did not cover it; 0 when renting */
  altLoanPayment: number
  /** € the owner puts into investments this month - the fixed figure from the situation */
  ownerInvests: number
  /** € the renter invests: the owner's whole budget less the rent (and any aso loan), never below zero */
  renterInvests: number
  /** € by which the rent exceeded the owner's whole budget this month, if it did */
  renterShort: number
  homeValue: number
  loanBalance: number
  /** home value less what is still owed */
  homeEquity: number
  /** what the aso payment would come back as if given up this month - 0 when renting */
  asoValue: number
  /** € still owed on the aso payment's loan */
  altLoanBalance: number
  /** the buyer's side portfolio, if rent ever cost more than owning */
  buyerPortfolio: number
  renterPortfolio: number
  /** home equity plus the side portfolio, gains taxed */
  buyerNetWorth: number
  /** the renter's portfolio, gains taxed - plus, in an aso home, the payment as it would come back less its loan */
  renterNetWorth: number
}

export interface RentVsBuy {
  months: RentVsBuyMonth[]
  /** who ends ahead, and from which month they stayed ahead; null if level at the end */
  leader: 'buy' | 'rent' | null
  leaderFrom: number | null
  /** what the renter does instead of buying */
  alternative: Alternative
  /** € the renter put in over the whole term, the closing cash included (less any aso payment) */
  renterInvested: number
  /** € the renter invested on day one: the closing cash, less the aso payment */
  renterStart: number
  /** € borrowed for the aso payment, when the closing cash fell short of it */
  altLoan: number
  /** € of interest on that loan over the term */
  altInterest: number
  /** € the owner put into investments over the whole term */
  ownerInvested: number
  /** months in which the rent outgrew the owner's whole budget, so the renter invested nothing */
  renterShortMonths: number
  totalRent: number
  totalInterest: number
  totalCharges: number
  /**
   * The yearly return at which both end level, %/yr - renting wins above it,
   * buying below. Null when one side is ahead at every return from 0 to 30 %.
   * With a fixed owner figure the gap need not move one way with the return
   * (a higher return also feeds the owner's larger monthly sum), so this is
   * the lowest such point, not necessarily the only one.
   */
  breakEvenReturnPct: number | null
  /**
   * The rent at which both end level, € / month at today's level - renting
   * wins below it, buying above. Rent touches only the renter's side, so this
   * one is clean: higher rent always means less invested. Null when buying
   * wins even rent-free, or renting wins even when rent takes the owner's
   * whole budget (tell them apart by `leader`). Against an aso home it is
   * that home's monthly charges that move, the payment held where it is.
   */
  breakEvenRent: number | null
}

/** A yearly rate as its monthly compounding equivalent. */
const monthlyRate = (pct: number) => Math.pow(1 + pct / 100, 1 / 12) - 1

/** Portfolio value after the gains tax, gains being whatever exceeds the money put in. */
function afterGainsTax(portfolio: number, contributed: number, taxPct: number): number {
  return portfolio - (Math.max(0, portfolio - contributed) * taxPct) / 100
}

/**
 * What the other household does instead of buying: rent at the situation's
 * figure, or live in an aso home - pay its payment in at the start (from the
 * closing cash the buyer would have spent, with a loan for any part that cash
 * does not cover), pay its charges every month, and have the payment back,
 * index-linked and never below what was paid, at the end.
 */
export type Alternative =
  | { kind: 'rent' }
  | {
      kind: 'aso'
      /** the asumisoikeusmaksu, € */
      payment: number
      /** käyttövastike plus the place's other fixed charges, € / month at today's level */
      chargesPerMonth: number
    }

export const RENTING: Alternative = { kind: 'rent' }

/** An aso place as the alternative to buying. */
export const asoAlternative = (p: PropertyListing): Alternative => ({
  kind: 'aso',
  payment: p.asoPayment,
  chargesPerMonth: asoChargesPerMonth(p),
})

/** What the alternative household starts with invested, and borrows, out of the buyer's closing cash. */
function alternativeStart(h: Holding, alt: Alternative): { invested: number; loan: number } {
  if (alt.kind === 'rent') return { invested: h.cashAtClosing, loan: 0 }
  return {
    invested: Math.max(0, h.cashAtClosing - alt.payment),
    loan: Math.max(0, alt.payment - h.cashAtClosing),
  }
}

function simulate(
  h: Holding,
  s: HousingSituation,
  returnPct: number,
  alt: Alternative,
): RentVsBuyMonth[] {
  const schedule = amortization(h.loan, s)
  const horizon = Math.max(1, Math.round(s.termYears * 12))
  const r = monthlyRate(returnPct)
  const g = monthlyRate(s.homeValueGrowthPct)
  const start = alternativeStart(h, alt)
  // The aso payment's loan, when the closing cash falls short of it: a plain
  // bank loan at the regular rate, never ASP - as in asoCost.
  const altSchedule = amortization(start.loan, regularOnly(s))
  const idx = monthlyRate(s.asoIndexPct)

  let renterPortfolio = start.invested
  let renterContributed = start.invested
  let buyerPortfolio = 0
  let buyerContributed = 0
  let homeValue = h.price
  const asoPayment = alt.kind === 'aso' ? alt.payment : 0
  // The payment at the index; what comes back is never less than the payment.
  let asoIndexed = asoPayment
  const out: RentVsBuyMonth[] = []

  for (let m = 1; m <= horizon; m++) {
    // Rent and charges step up once a year, as leases and vastikkeet do - an
    // aso home's käyttövastike with them.
    const uplift = Math.pow(1 + s.rentGrowthPct / 100, Math.floor((m - 1) / 12))
    const rent = (alt.kind === 'rent' ? s.rentPerMonth : alt.chargesPerMonth) * uplift
    const charges = h.chargesPerMonth * uplift
    const payment = schedule.months[m - 1]
    const buyerPays = (payment ? payment.interest + payment.principal : 0) + charges
    const loanBalance = payment ? payment.balance : 0
    const altPayment = altSchedule.months[m - 1]
    const altLoanPayment = altPayment ? altPayment.interest + altPayment.principal : 0
    const altLoanBalance = altPayment ? altPayment.balance : 0

    // Both grow for the month. Then the owner invests the fixed figure, and
    // the renter invests what the same total budget leaves after the rent -
    // nothing, once the rent has outgrown it.
    renterPortfolio *= 1 + r
    buyerPortfolio *= 1 + r
    homeValue *= 1 + g
    asoIndexed *= 1 + idx
    const asoValue = Math.max(asoPayment, asoIndexed)
    const ownerInvests = Math.max(0, s.ownerInvestPerMonth)
    const renterBudget = buyerPays + ownerInvests - rent - altLoanPayment
    const renterInvests = Math.max(0, renterBudget)
    renterPortfolio += renterInvests
    renterContributed += renterInvests
    buyerPortfolio += ownerInvests
    buyerContributed += ownerInvests

    const homeEquity = homeValue - loanBalance
    out.push({
      month: m,
      buyerPays,
      charges,
      rent,
      altLoanPayment,
      ownerInvests,
      renterInvests,
      renterShort: Math.max(0, -renterBudget),
      homeValue,
      loanBalance,
      homeEquity,
      asoValue,
      altLoanBalance,
      buyerPortfolio,
      renterPortfolio,
      buyerNetWorth: homeEquity + afterGainsTax(buyerPortfolio, buyerContributed, s.gainsTaxPct),
      renterNetWorth:
        asoValue - altLoanBalance + afterGainsTax(renterPortfolio, renterContributed, s.gainsTaxPct),
    })
  }
  return out
}

/**
 * Buy this home, or rent one like it and invest the difference?
 *
 * Both households have the same money to spend each month. The owner pays
 * the loan and the charges and puts a fixed sum into investments on top; the
 * renter keeps the closing cash invested from day one and, every month,
 * invests whatever that same total leaves after the rent. Since rent rises
 * while the payment stays put, the renter's investing shrinks over the term
 * and can reach zero; the owner's stays at the figure typed in. The buyer's
 * wealth is the home's value less the loan plus the side portfolio; the
 * renter's is the portfolio. Both are counted after the tax on investment
 * gains, because an own home sells tax-free in Finland and a fund does not -
 * over decades that decides close cases.
 *
 * The owner's figure is fixed on purpose. An earlier version let the owner
 * invest the whole gap once rent had climbed past the payment, which grew
 * into thousands a month by the end of a 40-year term and made the buying
 * line explode; a number the reader sets keeps the expectation theirs. The
 * price of that choice is that when rent outgrows the owner's whole budget,
 * the extra the renter spends is not credited to anyone: the month is counted
 * (`renterShortMonths`) and the card says so.
 *
 * Not modeled, deliberately: selling costs on the home, a rent deposit, the
 * years after the loan is repaid (the horizon is the loan term, when the
 * buyer's outlay drops to the charges alone and the picture only improves
 * for them), and rent-vs-own differences in insurance or utilities. Each is a
 * refinement on a comparison whose answer is dominated by three guesses:
 * the return, the home's growth, and how rents move.
 *
 * **An aso home instead of renting** (`alt`): the same budget rule, with the
 * käyttövastike in the rent's place. The aso household pays the payment out
 * of the closing cash on day one and invests what is left of that cash; if
 * the payment is the larger, it borrows the difference as a plain bank loan
 * and the loan's payments come out of its monthly budget. Its wealth is the
 * portfolio plus the payment as it would come back - grown at the index rate
 * the situation assumes, never below what was paid - less what is still owed
 * on that loan. The returned payment is not taxed: giving up a right of
 * occupancy lived in for two years is tax-free on the same terms as selling
 * an own home (TVL 48 §, Verohallinto's guidance of 9.5.2022).
 *
 * What it does not see: the payment is the aso company's equity, so in a
 * bankruptcy it ranks behind the company's creditors, and a company short of
 * funds may pay it back late (LAO §§ 59-62). The line assumes it comes back.
 */
export function rentVsBuy(
  h: Holding,
  s: HousingSituation,
  alt: Alternative = RENTING,
): RentVsBuy {
  const months = simulate(h, s, s.investmentReturnPct, alt)
  const last = months[months.length - 1]
  const start = alternativeStart(h, alt)

  // Who leads at the end, and how far back they have led without a break.
  const sign = (m: RentVsBuyMonth) => Math.sign(m.buyerNetWorth - m.renterNetWorth)
  const finalSign = sign(last)
  let leaderFrom: number | null = null
  if (finalSign !== 0) {
    let k = months.length - 1
    while (k > 0 && sign(months[k - 1]) === finalSign) k--
    leaderFrom = months[k].month
  }

  // The renter's lead at the horizon, as a function of one input at a time.
  const renterLead = (sit: HousingSituation, a: Alternative, returnPct = sit.investmentReturnPct) => {
    const run = simulate(h, sit, returnPct, a)
    const end = run[run.length - 1]
    return end.renterNetWorth - end.buyerNetWorth
  }
  const breakEvenReturnPct = firstCrossing((pct) => renterLead(s, alt, pct), 0, 30, 60)
  // Rent only ever takes from the renter, so buying's lead rises with it; the
  // scan runs up to the rent that swallows the owner's whole first-month
  // budget - what is left of it after an aso loan's payment, when there is
  // one. Against an aso home the rent is its monthly charges.
  const first = months[0]
  const wholeBudget = first.buyerPays + first.ownerInvests - first.altLoanPayment
  const leadAtRent = (rent: number) =>
    alt.kind === 'rent'
      ? renterLead({ ...s, rentPerMonth: rent }, alt)
      : renterLead(s, { ...alt, chargesPerMonth: rent })
  const breakEvenRent =
    wholeBudget > 0 ? firstCrossing((rent) => -leadAtRent(rent), 0, wholeBudget, 40) : null

  const altSchedule = amortization(start.loan, regularOnly(s))
  return {
    months,
    leader: finalSign > 0 ? 'buy' : finalSign < 0 ? 'rent' : null,
    leaderFrom,
    alternative: alt,
    renterStart: start.invested,
    altLoan: start.loan,
    altInterest: altSchedule.totalInterest,
    renterInvested: start.invested + months.reduce((sum, m) => sum + m.renterInvests, 0),
    ownerInvested: months.reduce((sum, m) => sum + m.ownerInvests, 0),
    renterShortMonths: months.filter((m) => m.renterShort > 0).length,
    totalRent: months.reduce((sum, m) => sum + m.rent, 0),
    totalInterest: amortization(h.loan, s).totalInterest,
    totalCharges: months.reduce((sum, m) => sum + m.charges, 0),
    breakEvenReturnPct,
    breakEvenRent,
  }
}

/**
 * The first x in [lo, hi] where f turns from at most zero to positive: a
 * coarse scan in `steps` slices, then bisection inside the slice that turned.
 * Null when f never turns positive, or starts positive. A scan rather than a
 * bare bisection because the curves here need not be monotonic.
 */
function firstCrossing(f: (x: number) => number, lo: number, hi: number, steps: number): number | null {
  if (f(lo) > 0) return null
  let a = lo
  for (let i = 1; i <= steps; i++) {
    const x = lo + ((hi - lo) * i) / steps
    if (f(x) > 0) {
      let b = x
      for (let k = 0; k < 30; k++) {
        const mid = (a + b) / 2
        if (f(mid) > 0) b = mid
        else a = mid
      }
      return (a + b) / 2
    }
    a = x
  }
  return null
}
