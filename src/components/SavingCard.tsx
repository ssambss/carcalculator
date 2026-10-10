import { useMemo, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import {
  HOME_TYPES,
  householdSavings,
  type HomeType,
  type HousingSituation,
  type PropertyListing,
} from '../housing'
import { addMonths, dayOf, isoOf, todayIso } from '../mileage'
import {
  ASP_DEPOSIT_MONTHS,
  ASP_MAX_DEPOSIT,
  ASP_MIN_DEPOSIT,
  DAYS_PER_MONTH,
  cashNeeded,
  grow,
  householdAt,
  monthlyFor,
  planAt,
  reachedOn,
  savingStatus,
  type CashNeed,
  type SavingPlan,
  type SavingReading,
  type SavingStatus,
  type Saver,
  type SaverStatus,
} from '../saving'
import { newSavingReading } from '../savingStorage'
import type { SavingStore } from '../useSaving'
import { useUndo } from '../undo'
import { fmtEur, fmtNum } from '../format'
import { niceTicks } from './chartHelpers'
import { DateField } from './DateField'
import { Fold, FoldCard } from './Fold'
import { NumberField } from './NumberField'
import { TipRow } from './TwoLineChart'
import { useWidth } from './useWidth'

/**
 * Saving up: what the purchase takes in cash, and the way there.
 *
 * The ceiling card asks what the savings reach; this one asks the other way
 * round - what a price takes - and then watches the accounts on their way to
 * it, the way the mileage side watches an odometer: a balance logged now and
 * then, a plan line from the first one, and the plan carried on to the day of
 * the purchase. Its last figure is the one the situation's Savings field
 * wants, so the card can put it there.
 *
 * The saved money wears the ownership blue: at the purchase it becomes the
 * down payment, the first euros of the home.
 */

const SAVED = 'var(--series-1)'

/* ------------------------------------------------------------ formatting */

const DAY_MS = 86_400_000
const dateFmt = new Intl.DateTimeFormat('fi-FI', { timeZone: 'UTC' })
const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' })
const tickFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' })

/** "1.6.2028" */
const fmtDay = (day: number) => dateFmt.format(new Date(day * DAY_MS))
/** "Mar 2028" */
const fmtMonth = (day: number) => monthFmt.format(new Date(day * DAY_MS))
/** a difference in euros, signed with a real minus; a hair under zero reads "0 €" */
const signedEur = (v: number) => {
  const r = Math.round(v)
  return r === 0 ? fmtEur(0) : `${r > 0 ? '+' : '−'}${fmtEur(Math.abs(r))}`
}
/** "one deposit", "3 deposits" */
const deposits = (n: number) => (n === 1 ? 'one deposit' : `${fmtNum(n)} deposits`)

/** Euros out of a text box the way a person types them: "2 400", "2400,50". */
function parseEur(text: string): number | null {
  const n = Number(text.replace(/[\s  €]/g, '').replace(',', '.'))
  return text.trim() && Number.isFinite(n) && n >= 0 ? n : null
}

/** Within this of the plan line is on it: the account credits its interest once a year. */
const onPlanWithin = (monthly: number) => Math.max(50, monthly / 4)

/* ------------------------------------------------------------------ goals */

/** Something to save for: the typed target, or a place. */
interface Goal {
  id: string
  /** as a chip and a row head */
  label: string
  /** mid-sentence: "your target", "Tapanila 3h+k" */
  phrase: string
  /** the price, and the kind when it is said */
  note: string
  need: CashNeed
}

function goalNote(price: number, kind: HomeType | ''): string {
  const label = HOME_TYPES.find((t) => t.key === kind)?.label
  return label ? `${fmtEur(price)} · ${label.toLowerCase()}` : fmtEur(price)
}

function goalsOf(plan: SavingPlan, places: PropertyListing[], s: HousingSituation): Goal[] {
  const out: Goal[] = []
  if (plan.goalPrice > 0) {
    out.push({
      id: 'target',
      label: 'Your target',
      phrase: 'your target',
      note: goalNote(plan.goalPrice, plan.goalHomeType),
      need: cashNeeded(plan.goalPrice, plan.goalHomeType, s),
    })
  }
  for (const p of places) {
    if (p.price <= 0) continue
    const name = p.name || 'Unnamed place'
    out.push({
      id: p.id,
      label: name,
      phrase: name,
      note: goalNote(p.price, p.homeType),
      need: cashNeeded(p.price, p.homeType, s),
    })
  }
  return out
}

/** Whether anyone has two check-ins - one is a starting point, not yet a pace. */
const hasHistory = (status: SavingStatus) => status.savers.some((x) => x.points.length > 1)

function planWord(status: SavingStatus): string {
  const v = status.vsPlan ?? 0
  if (Math.abs(v) < onPlanWithin(status.monthlyTotal)) return 'on the plan'
  return v < 0 ? `${fmtEur(-v)} behind the plan` : `${fmtEur(v)} ahead of the plan`
}

/* ------------------------------------------------------------------- card */

export function SavingCard({
  store,
  situation,
  places,
  onChangeSituation,
}: {
  store: SavingStore
  situation: HousingSituation
  /** the places, in the order the housing view shows them */
  places: PropertyListing[]
  onChangeSituation: (s: HousingSituation) => void
}) {
  const { plan, readings } = store.data
  const today = dayOf(todayIso())!
  const status = useMemo(
    () => savingStatus(plan, situation, readings, today),
    [plan, situation, readings, today],
  )
  const goals = useMemo(() => goalsOf(plan, places, situation), [plan, places, situation])
  // Which goal the figures and the chart are read against - a view choice,
  // like the analysis cards' subject, so it is not synced.
  const [goalId, setGoalId] = useState<string | null>(null)
  const goal = goals.find((g) => g.id === goalId) ?? goals[0] ?? null
  const set = (patch: Partial<SavingPlan>) => store.savePlan({ ...plan, ...patch })

  let summary = 'set the purchase day and the monthly saving, and it counts the way there'
  if (status.target !== null) {
    const margin = goal ? status.atTarget - goal.need.needed : 0
    summary = [
      `${fmtEur(status.atTarget)} by ${fmtDay(status.target)}`,
      goal
        ? margin >= 0
          ? `${fmtEur(margin)} more than ${goal.phrase} takes`
          : `${fmtEur(-margin)} short of what ${goal.phrase} takes`
        : '',
      status.vsPlan !== null && hasHistory(status) ? planWord(status) : '',
    ]
      .filter(Boolean)
      .join(' · ')
  }

  return (
    <FoldCard
      id="housing.saving"
      title="Saving up"
      caption="what the purchase takes in cash, and the way there"
      summary={summary}
    >
      <PlanFields plan={plan} situation={situation} status={status} onChange={set} />

      {store.status === 'error' && (
        <p className="field-hint field-error">Saving sync: {store.error}</p>
      )}

      {status.target === null ? (
        <p className="chart-note">
          Set the day you plan to buy and what goes in each month: the card then carries the
          balance on to that day and holds it against what each place takes.
        </p>
      ) : (
        <>
          <GoalChips goals={goals} selected={goal} onSelect={setGoalId} />
          <Standing status={status} plan={plan} situation={situation} goal={goal} />
        </>
      )}

      <CheckIns store={store} status={status} situation={situation} today={today} />

      {status.target !== null && status.asOf !== null && (
        <SavingChart status={status} plan={plan} goal={goal} />
      )}

      {status.target !== null && goals.length > 0 && (
        <GoalsTable goals={goals} status={status} plan={plan} selected={goal} />
      )}

      {status.target !== null && (
        <UseInSituation status={status} situation={situation} onChange={onChangeSituation} />
      )}

      <Fold id="housing.saving.method" title="How it counts">
        <p className="chart-note">
          Between two check-ins the balance is read as a straight line; after the last one it
          carries on at the planned deposit, spread evenly over each month, with the account’s
          interest compounding. The plan line starts at each saver’s first check-in, so a skipped
          deposit shows as a month’s deposit behind it. What a place takes is the ceiling asked
          backwards: the minimum cash share ({fmtNum(situation.minDownPaymentPct)} %), the
          transfer tax for its kind ({fmtNum(situation.transferTaxPct)} % on shares,{' '}
          {fmtNum(situation.transferTaxRealEstatePct)} % on a detached house) and the buying
          costs — and, where the budget cannot carry the rest of the price as a loan, the cash
          to bridge it.
          {situation.useAspLoan &&
            ` The ASP rules are the ones in force since 1.6.2026: ${ASP_DEPOSIT_MONTHS} deposit months, not necessarily in a row, of ${fmtNum(ASP_MIN_DEPOSIT)}–${fmtNum(ASP_MAX_DEPOSIT)} € each, and 1 % interest. A saver from before 1.6.2026 may keep to quarters, and a quarter's deposit counts as three months. The bank's bonus interest (lisäkorko, 2–4 %) runs for the first saving year and five calendar years after it, and is paid only at a purchase made with an ASP loan — so it is added at the purchase, never to the balance on the way. Both are tax-free, the bonus as much as the 1 %, so neither is taxed here, and both count towards the cash share. Check the current rules.`}
        </p>
      </Fold>
    </FoldCard>
  )
}

/* ------------------------------------------------------------------- plan */

function MonthField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: string
  onChange: (ym: string) => void
  hint?: string
}) {
  return (
    <label className="field field-compact field-date">
      <span className="field-label">{label}</span>
      <span className="field-input-wrap">
        {/* A browser without a month picker shows a text box: the placeholder says the shape. */}
        <input
          type="month"
          value={value}
          placeholder="2026-08"
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

function PlanFields({
  plan,
  situation: s,
  status,
  onChange: set,
}: {
  plan: SavingPlan
  situation: HousingSituation
  status: SavingStatus
  onChange: (patch: Partial<SavingPlan>) => void
}) {
  const together = s.buyingTogether
  const asp = s.useAspLoan
  const depositHint = (n: number) =>
    !asp
      ? undefined
      : n > ASP_MAX_DEPOSIT
        ? `over the ASP’s ${fmtNum(ASP_MAX_DEPOSIT)} € a month — the rest is not ASP saving`
        : `an ASP account takes ${fmtNum(ASP_MIN_DEPOSIT)}–${fmtNum(ASP_MAX_DEPOSIT)} € a month`
  const targetHint =
    status.target === null
      ? 'the day of the deal'
      : status.target <= status.today
        ? 'that day has passed'
        : `in ${fmtNum(Math.round(status.monthsLeft))} months`
  const readyHint = (x: SaverStatus | undefined) =>
    x?.aspReadyMonth
      ? `${ASP_DEPOSIT_MONTHS}th deposit month: ${fmtMonth(dayOf(`${x.aspReadyMonth}-01`)!)}`
      : `for the ${ASP_DEPOSIT_MONTHS}-month rule`

  return (
    <>
      <div className="analysis-fields">
        <DateField
          label="Buy on"
          value={plan.targetDate}
          onChange={(targetDate) => set({ targetDate })}
          hint={targetHint}
        />
        <NumberField
          compact
          label={together ? 'You save' : 'Saving'}
          value={plan.monthlyDeposit}
          onChange={(n) => set({ monthlyDeposit: Math.max(0, n) })}
          unit="€/mo"
          hint={depositHint(plan.monthlyDeposit)}
        />
        {together && (
          <NumberField
            compact
            label="They save"
            value={plan.partnerMonthlyDeposit}
            onChange={(n) => set({ partnerMonthlyDeposit: Math.max(0, n) })}
            unit="€/mo"
            hint={depositHint(plan.partnerMonthlyDeposit)}
          />
        )}
        <NumberField
          compact
          label="Interest"
          value={plan.interestPct}
          onChange={(n) => set({ interestPct: Math.max(0, n) })}
          unit="%/yr"
          hint={asp ? 'an ASP account pays 1 %, tax-free' : 'what the account pays'}
        />
        {asp && (
          <NumberField
            compact
            label="Bonus interest"
            value={plan.bonusPct}
            onChange={(n) => set({ bonusPct: Math.max(0, n) })}
            unit="%/yr"
            hint="lisäkorko, 2–4 % by the bank, tax-free — paid at the purchase"
          />
        )}
      </div>
      <div className="analysis-fields">
        <NumberField
          compact
          label="Target price"
          value={plan.goalPrice}
          onChange={(n) => set({ goalPrice: Math.max(0, n) })}
          unit="€"
          hint="optional — every place is a goal too"
        />
        <label className="field field-compact field-kind">
          <span className="field-label">Kind</span>
          <span className="field-input-wrap">
            <select
              value={plan.goalHomeType}
              onChange={(e) => set({ goalHomeType: e.target.value as HomeType | '' })}
            >
              <option value="">Not said</option>
              {HOME_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </span>
          <span className="field-hint">a detached house pays the higher tax</span>
        </label>
        {asp && (
          <MonthField
            label={together ? 'Your first ASP month' : 'First ASP month'}
            value={plan.aspFirstMonth}
            onChange={(aspFirstMonth) => set({ aspFirstMonth })}
            hint={readyHint(status.savers[0])}
          />
        )}
        {asp && together && (
          <MonthField
            label="Their first ASP month"
            value={plan.partnerAspFirstMonth}
            onChange={(partnerAspFirstMonth) => set({ partnerAspFirstMonth })}
            hint={readyHint(status.savers[1])}
          />
        )}
      </div>
    </>
  )
}

function GoalChips({
  goals,
  selected,
  onSelect,
}: {
  goals: Goal[]
  selected: Goal | null
  onSelect: (id: string) => void
}) {
  if (goals.length < 2 || !selected) return null
  return (
    <div className="schedule-subjects" role="tablist" aria-label="Saving for">
      {goals.map((g) => (
        <button
          key={g.id}
          role="tab"
          aria-selected={g.id === selected.id}
          className={`filter-chip${g.id === selected.id ? ' active' : ''}`}
          onClick={() => onSelect(g.id)}
        >
          {g.label}
          <span className="chip-note">{fmtEur(g.need.needed)}</span>
        </button>
      ))}
    </div>
  )
}

/* --------------------------------------------------------------- standing */

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}

/** The 20th deposit month against the purchase day, saver by saver. */
function aspClock(status: SavingStatus): string | null {
  const target = status.target!
  const parts = status.savers
    .filter((x) => x.aspReadyMonth !== null)
    .map((x) => {
      const ready = dayOf(`${x.aspReadyMonth}-01`)!
      const when = target < ready ? 'late' : target < addMonths(ready, 1) ? 'tight' : 'ok'
      const whose = x.saver === 'self' ? (status.savers.length > 1 ? 'your' : 'the') : 'their'
      return { text: `${whose} ${ASP_DEPOSIT_MONTHS}th deposit month is ${fmtMonth(ready)}`, when }
    })
  if (!parts.length) return null
  const worst = parts.some((p) => p.when === 'late')
    ? 'late'
    : parts.some((p) => p.when === 'tight')
      ? 'tight'
      : 'ok'
  const sentence = `ASP: ${parts.map((p) => p.text).join(', ')}`
  if (worst === 'late') {
    return `${sentence} — after the purchase day, and the ASP loan is not open before it. Move the day, or check whether quarters saved before 6/2026 count for more.`
  }
  if (worst === 'tight') {
    return `${sentence} — the month of the purchase, so that month’s deposit has to be in before the deal.`
  }
  return `${sentence} — before the purchase, with a deposit every month. A month without one moves it a month later.`
}

function Standing({
  status,
  plan,
  situation: s,
  goal,
}: {
  status: SavingStatus
  plan: SavingPlan
  situation: HousingSituation
  goal: Goal | null
}) {
  const target = status.target!
  const together = status.savers.length > 1
  const bonus = status.savers.reduce((sum, x) => sum + x.bonus, 0)
  const need = goal?.need ?? null
  const margin = need ? status.atTarget - need.needed : 0
  const reached = need ? reachedOn(status, plan, need.needed) : null
  const monthly = need && margin < 0 ? monthlyFor(status, plan, s, need.needed) : null

  const staleDays = status.asOf === null ? 0 : status.today - status.asOf
  const missing = together ? status.savers.filter((x) => x.last === null) : []
  const clock = s.useAspLoan ? aspClock(status) : null

  // With the goal's cash in hand, the loan is what is left of the price and
  // the costs - held against the ASP cap, for a household that keeps to it.
  const loanAtTarget = need
    ? Math.max(0, need.price + need.transferTax + need.costs - status.atTarget)
    : 0
  const overCap = loanAtTarget - s.aspMaxLoan

  let goalSentence = null
  if (need && goal) {
    if (margin >= 0) {
      goalSentence =
        reached !== null && reached <= status.today ? (
          <p>
            The <b>{fmtEur(need.needed)}</b> {goal.phrase} takes is already in the accounts —
            what comes in from here is margin, or a smaller loan.
          </p>
        ) : reached !== null && reached <= target ? (
          <p>
            On this plan the accounts hold the <b>{fmtEur(need.needed)}</b> {goal.phrase} takes
            by <b>{fmtMonth(reached)}</b>, and {fmtEur(margin)} more by the purchase.
          </p>
        ) : (
          <p>
            On this plan the purchase has the <b>{fmtEur(need.needed)}</b> {goal.phrase} takes
            only with the bonus interest paid at the deal — {fmtEur(margin)} to spare.
          </p>
        )
    } else {
      goalSentence = (
        <p>
          By {fmtDay(target)} this plan is <b>{fmtEur(-margin)} short</b> of the{' '}
          {fmtEur(need.needed)} {goal.phrase} takes.
          {monthly !== null && (
            <>
              {' '}
              <b>{fmtEur(monthly)} a month</b>
              {together ? ' together' : ''} from now closes it —{' '}
              {fmtEur(monthly - status.monthlyTotal)} more than the plan
            </>
          )}
          {reached !== null ? `; at the plan it is there by ${fmtMonth(reached)}.` : '.'}
        </p>
      )
    }
  }

  return (
    <>
      <div className="stat-row">
        <Stat
          label="Saved now"
          value={status.asOf === null ? '—' : fmtEur(status.savedNow)}
          sub={status.asOf === null ? 'log a balance below' : `at ${fmtDay(status.asOf)}`}
        />
        <Stat
          label={`By ${fmtDay(target)}`}
          value={fmtEur(status.atTarget)}
          sub={`${fmtEur(status.monthlyTotal)}/mo · ${fmtNum(Math.round(status.monthsLeft))} months${
            bonus >= 1 ? ` · ${fmtEur(bonus)} of it bonus` : ''
          }`}
        />
        {need && goal && (
          <Stat
            label={`${goal.label} takes`}
            value={fmtEur(need.needed)}
            sub={
              need.limitedBy === 'income'
                ? `${fmtEur(need.bridge)} of it past the loan the budget carries`
                : `${fmtNum(s.minDownPaymentPct)} % cash share, the tax${need.costs > 0 ? ', the costs' : ''}`
            }
          />
        )}
        {need && (
          <Stat
            label={margin >= 0 ? 'To spare' : 'Short'}
            value={fmtEur(Math.abs(margin))}
            sub={
              margin >= 0
                ? reached !== null && reached <= status.today
                  ? 'already saved'
                  : reached !== null && reached <= target
                    ? `there by ${fmtMonth(reached)}`
                    : 'with the bonus, at the deal'
                : monthly !== null
                  ? `${fmtEur(monthly)}/mo from now closes it`
                  : undefined
            }
          />
        )}
      </div>

      <div className="mileage-verdict">
        {goalSentence}
        {need && need.limitedBy === 'income' && (
          <p>
            Of that, {fmtEur(need.bridge)} is there because the budget carries a loan of only{' '}
            {fmtEur(need.maxLoan)}: the rules alone would ask {fmtEur(need.needed - need.bridge)}.
          </p>
        )}
        {need && s.useAspLoan && margin >= 0 && loanAtTarget > 0 && (
          <p>
            {overCap > 0 ? (
              <>
                With that saved the loan is {fmtEur(loanAtTarget)}:{' '}
                <b>{fmtEur(overCap)} past the ASP cap</b>, as a regular loan on top —{' '}
                {fmtEur(overCap)} more saved keeps it all ASP.
              </>
            ) : (
              <>
                With that saved the loan is {fmtEur(loanAtTarget)} — inside the ASP cap of{' '}
                {fmtEur(s.aspMaxLoan)}.
              </>
            )}
          </p>
        )}

        {status.asOf === null ? (
          <p>Log a balance below to measure the saving against the plan.</p>
        ) : !hasHistory(status) ? (
          <p>
            The plan line starts at the first check-in; the next one shows whether the deposits
            keep to it.
          </p>
        ) : (
          <PlanWatch status={status} aspOn={s.useAspLoan} />
        )}
        {missing.length > 0 && status.asOf !== null && (
          <p>
            No balance logged for {missing[0].saver === 'self' ? 'you' : 'them'} yet —{' '}
            {missing[0].saver === 'self' ? 'yours' : 'theirs'} counts from zero today.
          </p>
        )}
        {clock && <p>{clock}</p>}
        {staleDays > 35 && (
          <p className="field-hint">
            The last check-in is {fmtNum(staleDays)} days old — log today’s balance to bring this
            up to date.
          </p>
        )}
      </div>
    </>
  )
}

function PlanWatch({ status, aspOn }: { status: SavingStatus; aspOn: boolean }) {
  const v = status.vsPlan ?? 0
  const when = `At the last check-in, ${fmtDay(status.asOf!)},`
  if (Math.abs(v) < onPlanWithin(status.monthlyTotal)) {
    return (
      <p>
        {when} the saving is <b>on the plan</b>: the first check-in, and the monthly deposits
        since.
      </p>
    )
  }
  const n = status.monthlyTotal > 0 ? Math.round(Math.abs(v) / status.monthlyTotal) : 0
  if (v > 0) {
    return (
      <p>
        {when} <b>{fmtEur(v)} ahead of the plan</b>
        {n >= 1 ? ` — about ${deposits(n)} to the good` : ''}.
      </p>
    )
  }
  return (
    <p>
      {when} <b>{fmtEur(-v)} behind the plan</b>
      {n >= 1 ? ` — about ${deposits(n)}` : ''}.
      {aspOn && n >= 1 && ' A month with no deposit also moves the ASP clock a month.'}
    </p>
  )
}

/* ---------------------------------------------------------------- the log */

const LOG_SHOWN = 6

function CheckIns({
  store,
  status,
  situation: s,
  today,
}: {
  store: SavingStore
  status: SavingStatus
  situation: HousingSituation
  today: number
}) {
  const together = s.buyingTogether
  const { plan, readings } = store.data
  const offerUndo = useUndo()
  const [date, setDate] = useState(() => isoOf(today))
  const [mine, setMine] = useState('')
  const [theirs, setTheirs] = useState('')
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)

  // The placeholder is what the plan expects on the chosen day: a figure to
  // hold the bank's against, typed over when it differs.
  const expected = (x: SaverStatus | undefined) => {
    if (!x?.last) return '2 400'
    const on = dayOf(date) ?? today
    const months = Math.max(0, on - x.last.day) / DAYS_PER_MONTH
    return fmtNum(Math.round(grow(x.last.amount, x.deposit, plan.interestPct, months)))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const a = parseEur(mine)
    const b = parseEur(theirs)
    const typedA = mine.trim() !== ''
    const typedB = together && theirs.trim() !== ''
    if (
      dayOf(date) === null ||
      (!typedA && !typedB) ||
      (typedA && a === null) ||
      (typedB && b === null)
    ) {
      setError(
        together
          ? 'A day and at least one balance, e.g. 2 400.'
          : 'A day and the balance, e.g. 2 400.',
      )
      return
    }
    const out: SavingReading[] = []
    if (typedA) out.push(newSavingReading(date, 'self', a!))
    if (typedB) out.push(newSavingReading(date, 'partner', b!))
    store.saveReadings(out)
    setMine('')
    setTheirs('')
    setError('')
  }

  // Newest first, each with the change since the same saver's check-in
  // before it. One a day counts - the last typed - and the second borrower's
  // wait until there is one; neither is hidden, both say why they are out.
  const rows = useMemo(() => {
    const kept = new Map<string, SavingReading>()
    for (const r of readings) {
      const key = `${r.saver} ${r.date}`
      const k = kept.get(key)
      if (dayOf(r.date) !== null && (!k || r.updatedAt >= k.updatedAt)) kept.set(key, r)
    }
    const sorted = [...readings].sort(
      (a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt),
    )
    const prev: Partial<Record<Saver, SavingReading>> = {}
    const out = sorted.map((r) => {
      const other = r.saver === 'partner' && !together
      const replaced = kept.get(`${r.saver} ${r.date}`)?.id !== r.id
      let note = ''
      if (other) note = 'the second borrower’s — counted when buying together'
      else if (replaced) note = 'a later figure for the same day replaces this one'
      else {
        const p = prev[r.saver]
        if (p) {
          const days = dayOf(r.date)! - dayOf(p.date)!
          note = `${signedEur(r.amount - p.amount)} in ${fmtNum(days)} ${days === 1 ? 'day' : 'days'}`
        }
        prev[r.saver] = r
      }
      return { r, note, flagged: other || replaced }
    })
    return out.reverse()
  }, [readings, together])

  const shown = showAll ? rows : rows.slice(0, LOG_SHOWN)
  const noteOf = (r: SavingReading, note: string) =>
    [together ? (r.saver === 'self' ? 'yours' : 'theirs') : '', note].filter(Boolean).join(' · ')

  return (
    <>
      <div className="schedule-subtitle">Log a balance</div>
      <form className="log-form" onSubmit={submit}>
        <DateField label="Day" value={date} onChange={setDate} />
        <label className="field field-compact">
          <span className="field-label">{together ? 'Yours' : 'Balance'}</span>
          <span className="field-input-wrap">
            <input
              type="text"
              inputMode="decimal"
              value={mine}
              placeholder={expected(status.savers[0])}
              onChange={(e) => setMine(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
            <span className="field-unit">€</span>
          </span>
        </label>
        {together && (
          <label className="field field-compact">
            <span className="field-label">Theirs</span>
            <span className="field-input-wrap">
              <input
                type="text"
                inputMode="decimal"
                value={theirs}
                placeholder={expected(status.savers[1])}
                onChange={(e) => setTheirs(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
              <span className="field-unit">€</span>
            </span>
          </label>
        )}
        <button className="btn btn-primary" type="submit">
          Log
        </button>
      </form>
      {error && <p className="field-hint field-error">{error}</p>}

      {rows.length > 0 && (
        <ul className="mileage-list">
          {shown.map(({ r, note, flagged }) => (
            <li key={r.id} className={flagged ? 'flagged' : undefined}>
              <span className="mileage-list-main">
                <span className="mileage-list-name">{fmtEur(r.amount)}</span>
                <span className="mileage-list-date">{fmtDay(dayOf(r.date)!)}</span>
              </span>
              <span className="mileage-list-note">{noteOf(r, note)}</span>
              <button
                className="link-btn danger"
                onClick={() => {
                  store.removeReading(r.id)
                  offerUndo({
                    message: `Deleted the balance of ${fmtDay(dayOf(r.date)!)}`,
                    undo: () => store.saveReadings([r]),
                  })
                }}
                aria-label={`Delete the balance of ${fmtDay(dayOf(r.date)!)}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > LOG_SHOWN && (
        <button className="link-btn mileage-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${rows.length} balances`}
        </button>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ chart */

const HEIGHT = 244
const TOP = 26
const BOTTOM = HEIGHT - 40

interface P {
  t: number
  v: number
}

/**
 * The household's balance against the plan line, the plan carried on to the
 * purchase - dashed, as a continuation always is here - and the goal as a
 * level to reach. The plan and the goal are references, drawn in the axis
 * inks; there is one series, the money.
 */
function SavingChart({
  status: s,
  plan,
  goal,
}: {
  status: SavingStatus
  plan: SavingPlan
  goal: Goal | null
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const target = s.target!
  const firsts = s.savers.filter((x) => x.first).map((x) => x.first!.day)
  const start = Math.min(...firsts)
  // The household line starts when every saver who has checked in has.
  const from = Math.max(...firsts)
  const asOf = s.asOf!
  const end = Math.max(target, asOf)
  const span = end - start

  const series = useMemo(() => {
    const sample = (a: number, b: number, f: (t: number) => number | null, extra: number[] = []) => {
      const days = new Set<number>(extra)
      const n = Math.max(1, Math.round((b - a) / 7))
      for (let k = 0; k <= n; k++) days.add(Math.round(a + ((b - a) * k) / n))
      return [...days]
        .filter((t) => t >= a && t <= b)
        .sort((x, y) => x - y)
        .map((t) => ({ t, v: f(t) }))
        .filter((p): p is P => p.v !== null)
    }
    const checkDays = s.savers.flatMap((x) => x.points.map((p) => p.day))
    return {
      saved: sample(from, asOf, (t) => householdAt(s, plan, t), checkDays),
      ahead: asOf < end ? sample(asOf, end, (t) => householdAt(s, plan, t)) : [],
      plan: sample(from, end, (t) => planAt(s, plan, t)),
    }
  }, [s, plan, from, asOf, end])

  if (span <= 0) return null

  const needed = goal?.need.needed ?? 0
  const all = [...series.saved, ...series.ahead, ...series.plan].map((p) => p.v)
  const ticks = niceTicks(0, Math.max(needed, ...all))
  const yMax = ticks[ticks.length - 1]
  const left = 12 + 7 * Math.max(...ticks.map((t) => fmtNum(t).length))
  const right = Math.max(left + 1, width - 12)
  const plotW = right - left
  const plotH = BOTTOM - TOP
  const x = (t: number) => left + ((t - start) / span) * plotW
  const y = (v: number) => BOTTOM - (v / yMax) * plotH
  const path = (pts: P[]) =>
    pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join('')

  // Month ticks, as many as fit, on the calendar's own months.
  const monthStarts: number[] = []
  for (let m = dayOf(`${isoOf(start).slice(0, 7)}-01`)!; m <= end; m = addMonths(m, 1)) {
    if (m >= start) monthStarts.push(m)
  }
  const maxLabels = Math.max(3, Math.floor(plotW / 52))
  const step = [1, 2, 3, 6, 12].find((k) => monthStarts.length / k <= maxLabels) ?? 12
  const xTicks = monthStarts.filter((m) => new Date(m * DAY_MS).getUTCMonth() % step === 0)
  const tickLabel = (m: number) => {
    const d = new Date(m * DAY_MS)
    const label = tickFmt.format(d)
    return d.getUTCMonth() === 0 ? `${label} ’${String(d.getUTCFullYear()).slice(2)}` : label
  }

  const last = series.ahead.length ? series.ahead[series.ahead.length - 1] : null

  function dayAt(e: PointerEvent<SVGRectElement>): number {
    const r = e.currentTarget.getBoundingClientRect()
    const rel = r.width > 0 ? (e.clientX - r.left) / r.width : 0
    return Math.min(end, Math.max(start, Math.round(start + rel * span)))
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const current = active ?? asOf
    let next: number | null = null
    if (e.key === 'ArrowRight') next = Math.min(end, e.shiftKey ? current + 7 : addMonths(current, 1))
    else if (e.key === 'ArrowLeft') next = Math.max(start, e.shiftKey ? current - 7 : addMonths(current, -1))
    else if (e.key === 'Home') next = start
    else if (e.key === 'End') next = end
    else if (e.key === 'Escape') next = null
    else return
    e.preventDefault()
    setActive(next)
  }

  const activeX = active !== null ? x(active) : 0
  const activeValue = active !== null ? householdAt(s, plan, active) : null
  const activePlan = active !== null ? planAt(s, plan, active) : null
  const projected = active !== null && active > asOf
  const tipOnRight = activeX < left + plotW * 0.55

  return (
    <>
      <div className="legend chart-legend">
        <span className="legend-item">
          <span className="swatch swatch-line" style={{ background: 'var(--ink-3)' }} />
          The plan
        </span>
        <span className="legend-item">
          <span className="swatch swatch-line" style={{ background: SAVED }} />
          Saved
        </span>
        {series.ahead.length > 0 && (
          <span className="legend-item">
            <span className="swatch swatch-line swatch-dash" style={{ color: SAVED }} />
            At the plan, to the purchase
          </span>
        )}
      </div>
      <div
        ref={ref}
        className="chart"
        style={{ height: HEIGHT }}
        tabIndex={0}
        role="group"
        aria-label={`Savings against the plan. ${fmtEur(s.savedNow)} saved by ${fmtDay(asOf)}; ${fmtEur(s.atTarget)} by the purchase on ${fmtDay(target)}. Arrow keys step a month, with Shift a week.`}
        onKeyDown={onKey}
        onFocus={() => setActive((cur) => cur ?? asOf)}
        onBlur={() => setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
            <g className="chart-grid">
              {ticks.map((t) => (
                <line
                  key={t}
                  x1={left}
                  x2={right}
                  y1={y(t)}
                  y2={y(t)}
                  className={t === 0 ? 'baseline' : undefined}
                />
              ))}
            </g>
            <g className="chart-axis">
              {ticks.map((t) => (
                <text key={t} x={left - 8} y={y(t) + 4} textAnchor="end">
                  {fmtNum(t)}
                </text>
              ))}
              <text x={0} y={12} textAnchor="start">
                €
              </text>
              {xTicks.map((m) => (
                <text key={m} x={x(m)} y={BOTTOM + 16} textAnchor="middle">
                  {tickLabel(m)}
                </text>
              ))}
            </g>

            {target < end && (
              <line x1={x(target)} x2={x(target)} y1={TOP} y2={BOTTOM} className="chart-divider" />
            )}
            {goal && needed > 0 && (
              <>
                <line x1={left} x2={right} y1={y(needed)} y2={y(needed)} className="chart-goal" />
                <text x={left + 4} y={Math.max(12, y(needed) - 6)} className="chart-label">
                  {goal.label} takes {fmtNum(Math.round(needed))}
                </text>
              </>
            )}
            {series.plan.length > 1 && <path d={path(series.plan)} className="chart-line reference" />}
            {series.ahead.length > 1 && (
              <path d={path(series.ahead)} className="chart-line dashed" stroke={SAVED} />
            )}
            {series.saved.length > 1 && (
              <path d={path(series.saved)} className="chart-line" stroke={SAVED} />
            )}
            {series.saved.length > 0 && (
              <circle
                cx={x(asOf)}
                cy={y(series.saved[series.saved.length - 1].v)}
                r={4.5}
                className="chart-marker"
              />
            )}
            {last && Math.abs(y(last.v) - y(needed)) >= 13 && (
              <text
                x={right - 2}
                y={last.v > needed ? Math.max(12, y(last.v) - 8) : y(last.v) + 16}
                textAnchor="end"
                className="chart-label"
              >
                ~{fmtNum(Math.round(last.v))}
              </text>
            )}

            {active !== null && (
              <g className="chart-crosshair">
                <line x1={activeX} x2={activeX} y1={TOP} y2={BOTTOM} />
                {activePlan !== null && (
                  <circle cx={activeX} cy={y(activePlan)} r={4} fill="var(--ink-3)" />
                )}
                {activeValue !== null && (
                  <circle cx={activeX} cy={y(activeValue)} r={4} fill={SAVED} />
                )}
              </g>
            )}

            <rect
              x={left}
              y={TOP}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={(e) => setActive(dayAt(e))}
              onPointerLeave={() => setActive(null)}
            />
          </svg>
        )}

        {active !== null && (
          <div
            className="chart-tip"
            style={
              tipOnRight
                ? { left: activeX + 12, top: TOP }
                : { right: width - activeX + 12, top: TOP }
            }
          >
            <div className="chart-tip-head">{fmtDay(active)}</div>
            {activePlan !== null && (
              <TipRow color="var(--ink-3)" value={fmtEur(activePlan)} label="the plan" />
            )}
            {activeValue !== null && (
              <TipRow
                color={SAVED}
                value={fmtEur(activeValue)}
                label={projected ? 'at the plan' : 'saved'}
              />
            )}
            {activeValue !== null && activePlan !== null && !projected && (
              <TipRow
                value={signedEur(activeValue - activePlan)}
                label={activeValue - activePlan < 0 ? 'behind' : 'ahead'}
              />
            )}
            {goal && needed > 0 && activeValue !== null && (
              <TipRow
                value={signedEur(activeValue - needed)}
                label={`against what ${goal.phrase} takes`}
              />
            )}
          </div>
        )}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ table */

function GoalsTable({
  goals,
  status,
  plan,
  selected,
}: {
  goals: Goal[]
  status: SavingStatus
  plan: SavingPlan
  selected: Goal | null
}) {
  const target = status.target!
  return (
    <div className="cmp-scroll">
      <table className="cmp schedule-table saving-table">
        <thead>
          <tr>
            <th className="rowhead">What it takes</th>
            <th>Cash</th>
            <th title={`To spare (+) or short (−) on ${fmtDay(target)}`}>± {fmtDay(target)}</th>
          </tr>
        </thead>
        <tbody>
          {goals.map((g) => {
            const margin = status.atTarget - g.need.needed
            const on = reachedOn(status, plan, g.need.needed)
            // When the sum is in the accounts, under the margin rather than a
            // column of its own: a phone has room for three columns here.
            const when =
              on === null
                ? 'not within 40 years'
                : on <= status.today
                  ? 'already saved'
                  : on <= target || margin < 0
                    ? `there by ${fmtMonth(on)}`
                    : 'at the deal, with the bonus'
            return (
              <tr key={g.id} className={g.id === selected?.id && goals.length > 1 ? 'marked' : undefined}>
                <th className="rowhead">
                  {g.label}
                  <span className="cell-note">{g.note}</span>
                </th>
                <td className="num">
                  {fmtEur(g.need.needed)}
                  {g.need.limitedBy === 'income' && (
                    <span className="cell-note">past the loan limit</span>
                  )}
                </td>
                <td className={`num${Math.round(margin) < 0 ? ' over-ceiling' : ''}`}>
                  {signedEur(margin)}
                  <span className="cell-note">{when}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------------------------------------------- into the situation */

/**
 * The situation's Savings is the cash at the purchase, and the plan has just
 * worked it out - so it offers to put it there, saver by saver, rounded to
 * ten euros. Never on its own: the field is the person's, and a plan is a
 * guess about two years of deposits.
 */
function UseInSituation({
  status,
  situation: s,
  onChange,
}: {
  status: SavingStatus
  situation: HousingSituation
  onChange: (s: HousingSituation) => void
}) {
  const round = (v: number) => Math.round(v / 10) * 10
  const together = s.buyingTogether
  const mine = round(status.savers[0].total)
  const theirs = together ? round(status.savers[1].total) : s.partnerSavings
  const same = mine === s.savings && theirs === s.partnerSavings
  return (
    <div className="saving-use">
      <p className="chart-note">
        {same
          ? 'The situation above counts these figures as the savings, so the ceiling is the one at the purchase.'
          : `The situation above counts ${fmtEur(householdSavings(s))} as the savings; this plan brings ${fmtEur(
              together ? mine + theirs : mine,
            )} to the purchase${together ? ` — ${fmtEur(mine)} yours, ${fmtEur(theirs)} theirs` : ''}.`}
      </p>
      {!same && (
        <button
          className="btn"
          onClick={() => onChange({ ...s, savings: mine, partnerSavings: theirs })}
        >
          Use the plan’s figures
        </button>
      )}
    </div>
  )
}
