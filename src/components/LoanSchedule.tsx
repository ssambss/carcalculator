import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import {
  HOUSING_CATEGORIES,
  amortization,
  shiftRates,
  splitLoan,
  type HousingSituation,
  type Schedule,
  type ScheduleMonth,
} from '../housing'
import { fmtEur, fmtEurExact, fmtNum } from '../format'

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

/** A loan worth charting: the ceiling's, or a candidate's. */
export interface ScheduleSubject {
  id: string
  label: string
  loan: number
}

const seriesColor = (key: 'interest' | 'principal') =>
  `var(--series-${HOUSING_CATEGORIES.find((c) => c.key === key)!.series})`
const INTEREST_COLOR = seriesColor('interest')
const PRINCIPAL_COLOR = seriesColor('principal')

const yearOf = (month: number) => Math.ceil(month / 12)
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

export function LoanSchedule({
  situation,
  subjects,
}: {
  situation: HousingSituation
  subjects: ScheduleSubject[]
}) {
  const [subjectId, setSubjectId] = useState<string | null>(null)
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
        <div className="cmp-toggle">
          <button
            className={`filter-chip${view === 'chart' ? ' active' : ''}`}
            onClick={() => setView('chart')}
            aria-pressed={view === 'chart'}
          >
            Chart
          </button>
          <button
            className={`filter-chip${view === 'table' ? ' active' : ''}`}
            onClick={() => setView('table')}
            aria-pressed={view === 'table'}
          >
            Table
          </button>
        </div>
      </div>

      {chartable.length > 1 && (
        <div className="schedule-subjects" role="tablist" aria-label="Which loan">
          {chartable.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={s.id === subject.id}
              className={`filter-chip${s.id === subject.id ? ' active' : ''}`}
              onClick={() => setSubjectId(s.id)}
            >
              {s.label}
              <span className="chip-note">{fmtEur(s.loan)}</span>
            </button>
          ))}
        </div>
      )}

      {view === 'chart' ? (
        <>
          <div className="legend chart-legend">
            <span className="legend-item">
              <span className="swatch swatch-line" style={{ background: INTEREST_COLOR }} />
              Interest
            </span>
            <span className="legend-item">
              <span className="swatch swatch-line" style={{ background: PRINCIPAL_COLOR }} />
              Principal — what you own
            </span>
          </div>
          <ScheduleChart schedule={schedule} />
        </>
      ) : (
        <ScheduleTable schedule={schedule} />
      )}

      <Milestones schedule={schedule} />

      <RateTable loan={loan} situation={situation} />
    </div>
  )
}

/* -------------------------------------------------------------------- chart */

/** The rendered width of an element, so SVG text stays at CSS pixel size. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // ResizeObserver reports once on observe, so the first size arrives
    // without a synchronous read here.
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** 0 … a clean ceiling above `peak`, in four or five steps. */
function niceTicks(peak: number): number[] {
  if (peak <= 0) return [0, 1]
  const mag = Math.pow(10, Math.floor(Math.log10(peak / 4)))
  let step = mag
  for (const f of [1, 2, 2.5, 5, 10]) {
    step = f * mag
    if (peak / step <= 5) break
  }
  const ticks: number[] = []
  for (let t = 0; t < peak + step; t += step) ticks.push(t)
  return ticks
}

/** Year ticks: whole years at a spacing that leaves at most eight labels. */
function yearTicks(months: number): number[] {
  const years = months / 12
  const step = [1, 2, 5, 10, 20].find((s) => years / s <= 8) ?? 20
  const ticks: number[] = []
  for (let y = step; y * 12 <= months; y += step) ticks.push(y)
  return ticks
}

const HEIGHT = 244
const TOP = 26
const BOTTOM = HEIGHT - 40

function ScheduleChart({ schedule }: { schedule: Schedule }) {
  const id = useId()
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const { months, crossoverMonth, loan } = schedule
  const n = months.length

  const peak = months.reduce((m, r) => Math.max(m, r.interest, r.principal), 0)
  const ticks = niceTicks(peak)
  const yMax = ticks[ticks.length - 1]
  const left = 12 + 7 * Math.max(...ticks.map((t) => fmtEur(t).length))
  const right = Math.max(left + 1, width - 12)
  const plotW = right - left
  const plotH = BOTTOM - TOP
  const x = (m: number) => left + ((m - 1) / Math.max(1, n - 1)) * plotW
  const y = (v: number) => BOTTOM - (v / yMax) * plotH

  const line = (get: (m: ScheduleMonth) => number) =>
    months
      .map((m, k) => `${k === 0 ? 'M' : 'L'}${x(m.month).toFixed(1)} ${y(get(m)).toFixed(1)}`)
      .join('')
  const interestLine = line((m) => m.interest)
  const principalLine = line((m) => m.principal)
  const toBaseline = (path: string) =>
    `${path}L${x(n).toFixed(1)} ${BOTTOM}L${x(1).toFixed(1)} ${BOTTOM}Z`
  const toTop = (path: string) => `${path}L${x(n).toFixed(1)} ${TOP}L${x(1).toFixed(1)} ${TOP}Z`

  const last = months[n - 1]
  const yPrincipalEnd = y(last.principal)
  const yInterestEnd = y(last.interest)
  // The interest label sits just above the baseline, the principal label just
  // under its line; when a short loan leaves them no room, the tooltip and the
  // table still carry the interest figure.
  const interestLabelFits = yInterestEnd - 6 - (yPrincipalEnd + 14) > 14

  const cross = crossoverMonth !== null ? months[crossoverMonth - 1] : null
  const crossX = cross ? x(cross.month) : 0
  const crossAnchor: 'start' | 'middle' | 'end' =
    crossX < left + 80 ? 'start' : crossX > right - 80 ? 'end' : 'middle'

  function monthAt(e: PointerEvent<SVGRectElement>): number {
    const r = e.currentTarget.getBoundingClientRect()
    const rel = r.width > 0 ? (e.clientX - r.left) / r.width : 0
    return Math.min(n, Math.max(1, Math.round(rel * (n - 1)) + 1))
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const current = active ?? crossoverMonth ?? 1
    const step = e.shiftKey ? 1 : 12
    let next: number | null = null
    if (e.key === 'ArrowRight') next = Math.min(n, current + step)
    else if (e.key === 'ArrowLeft') next = Math.max(1, current - step)
    else if (e.key === 'Home') next = 1
    else if (e.key === 'End') next = n
    else if (e.key === 'Escape') next = null
    else return
    e.preventDefault()
    setActive(next)
  }

  const row = active !== null ? months[active - 1] : null
  const activeX = active !== null ? x(active) : 0
  const tipOnRight = activeX < left + plotW * 0.55

  return (
    <div
      ref={ref}
      className="chart"
      style={{ height: HEIGHT }}
      tabIndex={0}
      role="group"
      aria-label="Interest and principal per month over the loan. Arrow keys step a year, with Shift a month; the Table view lists the same figures."
      onKeyDown={onKey}
      onFocus={() => setActive((a) => a ?? crossoverMonth ?? 1)}
      onBlur={() => setActive(null)}
    >
      {width > 0 && (
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
          <defs>
            <clipPath id={`${id}-under-interest`}>
              <path d={toBaseline(interestLine)} />
            </clipPath>
            <clipPath id={`${id}-under-principal`}>
              <path d={toBaseline(principalLine)} />
            </clipPath>
          </defs>

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
                {fmtEur(t)}
              </text>
            ))}
            <text x={0} y={12} textAnchor="start">
              € per month
            </text>
            {yearTicks(n).map((yr) => (
              <text key={yr} x={x(yr * 12)} y={BOTTOM + 16} textAnchor="middle">
                {yr}
              </text>
            ))}
            <text x={left} y={HEIGHT - 4} textAnchor="start">
              years into the loan
            </text>
          </g>

          {/* The gap between the lines, in the color of whichever is on top:
              interest while the payment is mostly cost, principal once it is
              mostly ownership. */}
          <path
            d={toTop(principalLine)}
            clipPath={`url(#${id}-under-interest)`}
            fill={INTEREST_COLOR}
            fillOpacity={0.14}
          />
          <path
            d={toTop(interestLine)}
            clipPath={`url(#${id}-under-principal)`}
            fill={PRINCIPAL_COLOR}
            fillOpacity={0.14}
          />

          <path d={interestLine} className="chart-line" stroke={INTEREST_COLOR} />
          <path d={principalLine} className="chart-line" stroke={PRINCIPAL_COLOR} />

          <text x={right - 2} y={yPrincipalEnd + 14} textAnchor="end" className="chart-label">
            Principal {fmtEur(last.principal)}
          </text>
          {interestLabelFits && (
            <text x={right - 2} y={yInterestEnd - 6} textAnchor="end" className="chart-label">
              Interest {fmtEur(last.interest)}
            </text>
          )}

          {cross && (
            <g>
              <circle cx={crossX} cy={y(cross.principal)} r={4.5} className="chart-marker" />
              <text
                x={crossX}
                y={y(cross.principal) - 10}
                textAnchor={crossAnchor}
                className="chart-label"
              >
                {cross.month === 1
                  ? 'Half and half from the start'
                  : `Half and half · year ${yearOf(cross.month)}`}
              </text>
            </g>
          )}

          {row && (
            <g className="chart-crosshair">
              <line x1={activeX} x2={activeX} y1={TOP} y2={BOTTOM} />
              <circle cx={activeX} cy={y(row.interest)} r={4} fill={INTEREST_COLOR} />
              <circle cx={activeX} cy={y(row.principal)} r={4} fill={PRINCIPAL_COLOR} />
            </g>
          )}

          <rect
            x={left}
            y={TOP}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={(e) => setActive(monthAt(e))}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}

      {row && (
        <div
          className="chart-tip"
          style={
            tipOnRight ? { left: activeX + 12, top: TOP } : { right: width - activeX + 12, top: TOP }
          }
        >
          <div className="chart-tip-head">
            Year {yearOf(row.month)} · month {((row.month - 1) % 12) + 1}
          </div>
          <div className="chart-tip-row">
            <span className="chart-tip-key" style={{ background: INTEREST_COLOR }} />
            <span className="chart-tip-value">{fmtEurExact(row.interest)}</span>
            <span className="chart-tip-label">interest</span>
          </div>
          <div className="chart-tip-row">
            <span className="chart-tip-key" style={{ background: PRINCIPAL_COLOR }} />
            <span className="chart-tip-value">{fmtEurExact(row.principal)}</span>
            <span className="chart-tip-label">principal</span>
          </div>
          <div className="chart-tip-rule" />
          <div className="chart-tip-row">
            <span className="chart-tip-key" />
            <span className="chart-tip-value">{fmtEur(row.interestToDate)}</span>
            <span className="chart-tip-label">interest paid so far</span>
          </div>
          <div className="chart-tip-row">
            <span className="chart-tip-key" />
            <span className="chart-tip-value">{fmtEur(row.principalToDate)}</span>
            <span className="chart-tip-label">owned · {pct(row.principalToDate, loan)} %</span>
          </div>
          <div className="chart-tip-row">
            <span className="chart-tip-key" />
            <span className="chart-tip-value">{fmtEur(row.balance)}</span>
            <span className="chart-tip-label">still owed</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------- table */

/** The chart's twin: the same figures at year ends, readable without a pointer. */
function ScheduleTable({ schedule }: { schedule: Schedule }) {
  const { months, loan } = schedule
  const n = months.length
  const years = new Set<number>([1])
  for (let y = 5; y * 12 <= n; y += 5) years.add(y)
  years.add(yearOf(n))
  const rows = [...years]
    .sort((a, b) => a - b)
    .map((y) => ({ y: Math.min(y, n / 12), r: months[Math.min(n, y * 12) - 1] }))

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
