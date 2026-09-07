import { useMemo, useState } from 'react'
import {
  HOUSING_CATEGORIES,
  amortization,
  shiftRates,
  splitLoan,
  type Holding,
  type HousingSituation,
  type Schedule,
} from '../housing'
import { fmtEur, fmtEurExact, fmtNum } from '../format'
import { pct, tableYears, yearOf } from './chartHelpers'
import { TipRow, TipRule, TwoLineChart } from './TwoLineChart'

/**
 * How a loan repays over its life: interest against principal, payment by
 * payment.
 *
 * The breakdown bar states the first bill; this card is about how that bill
 * changes underneath a payment that stays put. Two lines - interest falling,
 * principal rising - and the month they cross, which is the one date most
 * people never get told about their own mortgage. The rate table under it
 * answers the follow-up question: how much does that date move if rates do.
 *
 * Colors are the housing categories' own (interest and principal wear the same
 * hues here as in the bars and the table), so the card reads as part of the
 * mode rather than as a chart pasted into it.
 */

/** A home the analysis cards can look at: the ceiling, or a candidate. */
export interface AnalysisSubject extends Holding {
  id: string
  label: string
}

interface SubjectProps {
  subjects: AnalysisSubject[]
  /** the chosen subject, shared between the analysis cards */
  subjectId: string | null
  onSelectSubject: (id: string) => void
}

/** The chip row that picks the subject - the same in every analysis card. */
export function SubjectChips({
  subjects,
  selected,
  onSelect,
  note,
}: {
  subjects: AnalysisSubject[]
  selected: AnalysisSubject
  onSelect: (id: string) => void
  /** the figure shown beside each name */
  note: (s: AnalysisSubject) => string
}) {
  if (subjects.length < 2) return null
  return (
    <div className="schedule-subjects" role="tablist" aria-label="Which home">
      {subjects.map((s) => (
        <button
          key={s.id}
          role="tab"
          aria-selected={s.id === selected.id}
          className={`filter-chip${s.id === selected.id ? ' active' : ''}`}
          onClick={() => onSelect(s.id)}
        >
          {s.label}
          <span className="chip-note">{note(s)}</span>
        </button>
      ))}
    </div>
  )
}

/** The Chart / Table switch every analysis card carries in its head. */
export function ViewToggle({
  view,
  onChange,
}: {
  view: 'chart' | 'table'
  onChange: (v: 'chart' | 'table') => void
}) {
  return (
    <div className="cmp-toggle">
      <button
        className={`filter-chip${view === 'chart' ? ' active' : ''}`}
        onClick={() => onChange('chart')}
        aria-pressed={view === 'chart'}
      >
        Chart
      </button>
      <button
        className={`filter-chip${view === 'table' ? ' active' : ''}`}
        onClick={() => onChange('table')}
        aria-pressed={view === 'table'}
      >
        Table
      </button>
    </div>
  )
}

const seriesColor = (key: 'interest' | 'principal') =>
  `var(--series-${HOUSING_CATEGORIES.find((c) => c.key === key)!.series})`
const INTEREST_COLOR = seriesColor('interest')
const PRINCIPAL_COLOR = seriesColor('principal')

export function LoanSchedule({
  situation,
  subjects,
  subjectId,
  onSelectSubject,
}: { situation: HousingSituation } & SubjectProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart')

  // A place cheap enough to buy outright has nothing to chart; leave it off
  // the row rather than showing an empty plot for it.
  const chartable = subjects.filter((s) => s.loan > 0)
  const subject = chartable.find((s) => s.id === subjectId) ?? chartable[0]
  const loan = subject?.loan ?? 0
  // A few hundred months of arithmetic - cheaper to redo than to memoize.
  const schedule = amortization(loan, situation)

  if (!subject || schedule.months.length === 0) return null

  return (
    <div className="card schedule-card">
      <div className="schedule-head">
        <div className="cmp-title display">Over the loan’s life</div>
        <div className="cmp-caption">how each payment splits between interest and what you own</div>
        <ViewToggle view={view} onChange={setView} />
      </div>

      <SubjectChips
        subjects={chartable}
        selected={subject}
        onSelect={onSelectSubject}
        note={(s) => fmtEur(s.loan)}
      />

      {view === 'chart' ? (
        <ScheduleChart schedule={schedule} />
      ) : (
        <ScheduleTable schedule={schedule} />
      )}

      <Milestones schedule={schedule} />

      <RateTable loan={loan} situation={situation} />
    </div>
  )
}

/* -------------------------------------------------------------------- chart */

function ScheduleChart({ schedule }: { schedule: Schedule }) {
  const { months, crossoverMonth, loan } = schedule
  const c = crossoverMonth
  return (
    <TwoLineChart
      a={{
        label: 'Interest',
        color: INTEREST_COLOR,
        values: months.map((m) => m.interest),
      }}
      b={{
        label: 'Principal — what you own',
        short: 'Principal',
        color: PRINCIPAL_COLOR,
        values: months.map((m) => m.principal),
      }}
      marker={
        c === null
          ? null
          : {
              month: c,
              text: c === 1 ? 'Half and half from the start' : `Half and half · year ${yearOf(c)}`,
            }
      }
      yCaption="€ per month"
      ariaLabel="Interest and principal per month over the loan. Arrow keys step a year, with Shift a month; the Table view lists the same figures."
      tooltip={(month) => {
        const r = months[month - 1]
        return (
          <>
            <TipRow color={INTEREST_COLOR} value={fmtEurExact(r.interest)} label="interest" />
            <TipRow color={PRINCIPAL_COLOR} value={fmtEurExact(r.principal)} label="principal" />
            <TipRule />
            <TipRow value={fmtEur(r.interestToDate)} label="interest paid so far" />
            <TipRow
              value={fmtEur(r.principalToDate)}
              label={`owned · ${pct(r.principalToDate, loan)} %`}
            />
            <TipRow value={fmtEur(r.balance)} label="still owed" />
          </>
        )
      }}
    />
  )
}

/* -------------------------------------------------------------------- table */

/** The chart's twin: the same figures at year ends, readable without a pointer. */
function ScheduleTable({ schedule }: { schedule: Schedule }) {
  const { months, loan } = schedule
  const n = months.length
  const rows = tableYears(n).map((y) => ({
    y: Math.min(y, n / 12),
    r: months[Math.min(n, y * 12) - 1],
  }))

  return (
    <div className="cmp-scroll">
      <table className="cmp schedule-table">
        <thead>
          <tr>
            <th className="rowhead">After</th>
            <th>Interest / mo</th>
            <th>Principal / mo</th>
            <th>Interest paid</th>
            <th>Owned</th>
            <th>Still owed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ y, r }) => (
            <tr key={r.month}>
              <th className="rowhead">
                {fmtNum(y)} {y === 1 ? 'year' : 'years'}
              </th>
              <td className="num">{fmtEurExact(r.interest)}</td>
              <td className="num">{fmtEurExact(r.principal)}</td>
              <td className="num">{fmtEur(r.interestToDate)}</td>
              <td className="num">
                {fmtEur(r.principalToDate)}
                <span className="cell-note"> {pct(r.principalToDate, loan)} %</span>
              </td>
              <td className="num">{fmtEur(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* --------------------------------------------------------------- milestones */

function Milestones({ schedule }: { schedule: Schedule }) {
  const { months, crossoverMonth, totalInterest, loan } = schedule
  const n = months.length
  const atTen = n >= 120 ? months[119] : null
  return (
    <div className="stat-row">
      {crossoverMonth !== null && (
        <div className="stat">
          <span className="stat-label">Half and half</span>
          <span className="stat-value">
            {crossoverMonth === 1 ? 'From the start' : `Year ${yearOf(crossoverMonth)}`}
          </span>
          <span className="stat-sub">
            {crossoverMonth === 1
              ? 'no interest to speak of'
              : `payment ${crossoverMonth} of ${n}: principal overtakes interest`}
          </span>
        </div>
      )}
      <div className="stat">
        <span className="stat-label">Interest over the term</span>
        <span className="stat-value">{fmtEur(totalInterest)}</span>
        <span className="stat-sub">{pct(totalInterest, loan)} % on top of the loan</span>
      </div>
      {atTen && (
        <div className="stat">
          <span className="stat-label">Owned after 10 years</span>
          <span className="stat-value">{fmtEur(atTen.principalToDate)}</span>
          <span className="stat-sub">
            {pct(atTen.principalToDate, loan)} % of the loan · {fmtEur(atTen.interestToDate)} paid
            in interest
          </span>
        </div>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- other rates */

interface RateRow {
  key: string
  pp: number
  tag: string
  payment: number
  crossoverMonth: number | null
  totalInterest: number
  ownedAtTen: number | null
}

/**
 * The same loan under a parallel shift of both rates, plus one row with
 * everything at the stress rate - that is the scenario the bank has already
 * priced in, so if it looks unlivable, the ceiling is optimistic. The stress
 * row is not a shift: the test rate applies to the whole debt, ASP or not,
 * as `affordability` stresses it - but over the borrower's own term, so the
 * columns stay comparable. The bank's figure on the ceiling card also caps
 * the term at 25 years, which is why it is higher; the caption says so.
 */
function RateTable({ loan, situation }: { loan: number; situation: HousingSituation }) {
  const rows = useMemo(() => {
    const scenarios = [-2, -1, 0, 1, 2].map((pp) => ({
      pp,
      tag: pp === 0 ? 'as set' : '',
      s: shiftRates(situation, pp),
    }))
    scenarios.push({
      pp: situation.stressRatePct - situation.ratePct,
      tag: 'stress rate',
      s: { ...situation, ratePct: situation.stressRatePct, aspRatePct: situation.stressRatePct },
    })
    const out: RateRow[] = []
    for (const { pp, tag, s } of scenarios) {
      const split = splitLoan(loan, s)
      const key =
        split.asp > 0 && split.regular > 0 && s.aspRatePct !== s.ratePct
          ? `${fmtNum(s.aspRatePct)} % ASP + ${fmtNum(s.ratePct)} %`
          : `${fmtNum(split.asp > 0 ? s.aspRatePct : s.ratePct)} %`
      // Two shifts that floor to the same rates are one row, wearing both tags.
      const dup = out.find((r) => r.key === key)
      if (dup) {
        if (tag && !dup.tag) dup.tag = tag
        else if (tag && dup.tag !== tag) dup.tag = `${dup.tag} · ${tag}`
        continue
      }
      const sched = amortization(loan, s)
      const first = sched.months[0]
      out.push({
        key,
        pp,
        tag,
        payment: first.interest + first.principal,
        crossoverMonth: sched.crossoverMonth,
        totalInterest: sched.totalInterest,
        ownedAtTen: sched.months.length >= 120 ? sched.months[119].principalToDate : null,
      })
    }
    return out.sort((a, b) => a.pp - b.pp)
  }, [loan, situation])

  const anyTen = rows.some((r) => r.ownedAtTen !== null)

  return (
    <div className="rate-table">
      <div className="schedule-head">
        <div className="schedule-subtitle">At other rates</div>
        <div className="cmp-caption">
          the same loan and term with both rates moved together · the stress-rate row keeps your
          term, where the bank’s own test also caps it at 25 years
        </div>
      </div>
      <div className="cmp-scroll">
        <table className="cmp schedule-table">
          <thead>
            <tr>
              <th className="rowhead">Rate</th>
              <th>Payment / mo</th>
              <th>Half and half</th>
              <th>Interest over the term</th>
              {anyTen && <th>Owned after 10 yrs</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.pp === 0 ? 'marked' : undefined}>
                <th className="rowhead">
                  {r.key}
                  {r.tag && <span className="cell-note"> {r.tag}</span>}
                </th>
                <td className="num">{fmtEurExact(r.payment)}</td>
                <td className="num">
                  {r.crossoverMonth === null
                    ? '—'
                    : r.crossoverMonth === 1
                      ? 'from the start'
                      : `year ${yearOf(r.crossoverMonth)}`}
                </td>
                <td className="num">
                  {fmtEur(r.totalInterest)}
                  <span className="cell-note"> {pct(r.totalInterest, loan)} %</span>
                </td>
                {anyTen && (
                  <td className="num">{r.ownedAtTen === null ? '—' : fmtEur(r.ownedAtTen)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
