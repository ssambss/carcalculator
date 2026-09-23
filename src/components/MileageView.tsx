import { useMemo, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import {
  addMonths,
  dayOf,
  drivenAt,
  isoOf,
  isoWeek,
  leaseSpan,
  mileageStatus,
  odometerOnTheLine,
  periods,
  projectionPoints,
  timeline,
  todayIso,
  valueOn,
  type MileageLease,
  type MileageStatus,
  type PeriodKind,
  type PeriodRow,
  type Point,
  type Timeline,
} from '../mileage'
import { newReading, newTrip } from '../mileageStorage'
import type { MileageStore } from '../useMileage'
import { fmtEur, fmtNum } from '../format'
import { niceTicks } from './chartHelpers'
import { NumberField } from './NumberField'
import { TipRow } from './TwoLineChart'
import { useWidth } from './useWidth'

/* ------------------------------------------------------------ formatting */

const DAY_MS = 86_400_000
const dateFmt = new Intl.DateTimeFormat('fi-FI', { timeZone: 'UTC' })
const shortFmt = new Intl.DateTimeFormat('fi-FI', { timeZone: 'UTC', day: 'numeric', month: 'numeric' })
const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' })
const tickFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' })

/** "14.9.2026" */
const fmtDay = (day: number) => dateFmt.format(new Date(day * DAY_MS))
/** "14.9." */
const fmtShort = (day: number) => shortFmt.format(new Date(day * DAY_MS))
/** whole km, fi grouping: "26 250 km" */
const km = (v: number) => `${fmtNum(Math.round(v))} km`
/** a difference, signed with a real minus: "+620" / "−380"; a hair under zero reads "0" */
const signed = (v: number) => {
  const r = Math.round(v)
  return r === 0 ? '0' : `${r > 0 ? '+' : '−'}${fmtNum(Math.abs(r))}`
}
const perWeek = (perDay: number) => perDay * 7
const perMonth = (perDay: number) => (perDay * 365.25) / 12

/** Km out of a text box the way a person types them: "45 210", "45210,5". */
function parseKm(text: string): number | null {
  const n = Number(text.replace(/[\s  ]/g, '').replace(',', '.'))
  return text.trim() && Number.isFinite(n) && n >= 0 ? n : null
}

/* ------------------------------------------------------------------ view */

export function MileageView({ store }: { store: MileageStore }) {
  const { data } = store
  const today = dayOf(todayIso())!

  const line = useMemo(() => timeline(data.lease, data.readings), [data.lease, data.readings])
  const status = useMemo(
    () => mileageStatus(data.lease, data.readings, data.trips),
    [data.lease, data.readings, data.trips],
  )

  return (
    <>
      <LeasePanel lease={data.lease} onChange={store.saveLease} />

      {store.status === 'error' && (
        <p className="field-hint field-error">Mileage sync: {store.error}</p>
      )}

      {!status || !line ? (
        <div className="card empty-state">
          <div className="empty-title display">When did the lease start?</div>
          <p className="empty-text">
            Set the hand-over day and the odometer at hand-over under Lease terms — every
            figure here is measured from those two.
          </p>
        </div>
      ) : (
        <>
          <StatusCard status={status} lease={data.lease} today={today} />
          <LogCard store={store} line={line} today={today} />
          <TripsCard store={store} status={status} />
          {/* With no reading there is only the straight line to draw. */}
          {status.hasReadings && <ChartCard status={status} line={line} lease={data.lease} />}
          <PeriodsCard store={store} status={status} today={today} />
        </>
      )}
    </>
  )
}

/* ----------------------------------------------------------- lease terms */

function DateField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: string
  onChange: (iso: string) => void
  hint?: string
}) {
  return (
    <label className="field field-compact field-date">
      <span className="field-label">{label}</span>
      <span className="field-input-wrap">
        <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

function LeasePanel({
  lease,
  onChange,
}: {
  lease: MileageLease
  onChange: (l: MileageLease) => void
}) {
  // Open until the contract has a start: nothing below means anything without it.
  const [expanded, setExpanded] = useState(() => !lease.startDate)
  const set = (patch: Partial<MileageLease>) => onChange({ ...lease, ...patch })
  const span = leaseSpan(lease)
  const perYear = (Math.max(0, lease.allowanceKm) / Math.max(1, lease.termMonths)) * 12

  const summary = span
    ? `${fmtNum(lease.allowanceKm)} km · ${fmtNum(lease.termMonths)} months · ${fmtDay(span.start)}–${fmtDay(span.end - 1)}`
    : 'No hand-over day yet'

  return (
    <div className={`card assumptions mileage-panel${expanded ? ' expanded' : ''}`}>
      <div className="assumptions-heading">
        <div className="assumptions-title">Lease terms</div>
        <div className="assumptions-caption">from the contract</div>
      </div>
      <div className="assumptions-summary">
        <span className="assumptions-summary-text">{summary}</span>
        <button className="assumptions-toggle" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Done' : 'Edit'}
        </button>
      </div>
      <div className="assumptions-fields">
        <DateField
          label="Hand-over"
          value={lease.startDate}
          onChange={(startDate) => set({ startDate })}
          hint={span ? `back on ${fmtDay(span.end)}` : 'the day you got the car'}
        />
        <NumberField
          compact
          label="Term"
          value={lease.termMonths}
          onChange={(n) => set({ termMonths: Math.max(1, Math.round(n)) })}
          unit="months"
        />
        <NumberField
          compact
          label="Allowance"
          value={lease.allowanceKm}
          onChange={(n) => set({ allowanceKm: Math.max(0, n) })}
          unit="km"
          hint={`the whole term — ${fmtNum(Math.round(perYear))} km a year`}
        />
        <NumberField
          compact
          label="Odometer then"
          value={lease.startOdometerKm}
          onChange={(n) => set({ startOdometerKm: Math.max(0, n) })}
          unit="km"
          hint="on the clock at hand-over"
        />
        <NumberField
          compact
          label="Excess fee"
          value={lease.excessFeePerKm}
          onChange={(n) => set({ excessFeePerKm: Math.max(0, n) })}
          unit="€/km"
          hint="per km over — 0 if not known"
        />
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- status */

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}

function StatusCard({
  status: s,
  lease,
  today,
}: {
  status: MileageStatus
  lease: MileageLease
  today: number
}) {
  const lastReading = s.asOf - 1
  const staleDays = s.hasReadings ? today - lastReading : 0
  const onLine = odometerOnTheLine(lease, today)
  const over = s.balance < 0
  const fee = Math.max(0, lease.excessFeePerKm)

  return (
    <div className="card ceiling-card mileage-status">
      {s.hasReadings ? (
        <>
          <div className="ceiling-label">At your last reading, {fmtDay(lastReading)}</div>
          <div className="hero-row">
            <span className="hero-value display">{fmtNum(Math.abs(Math.round(s.balance)))}</span>
            <span className="hero-unit">{over ? 'km over the line' : 'km in hand'}</span>
          </div>
          <p className="ceiling-note">
            {over
              ? 'You have driven more than the allowance spread evenly would have by now — lighter weeks ahead bring it back.'
              : 'You have driven less than the allowance spread evenly would have by now — that is room for a longer trip.'}
          </p>
        </>
      ) : (
        <>
          <div className="ceiling-label">The pace that lands on the limit</div>
          <div className="hero-row">
            <span className="hero-value display">{fmtNum(Math.round(perWeek(s.span.perDay)))}</span>
            <span className="hero-unit">km a week</span>
          </div>
          <p className="ceiling-note">
            {fmtNum(Math.round(perMonth(s.span.perDay)))} km a month, spread evenly. Log the
            odometer below to see where you stand against it.
          </p>
        </>
      )}

      <div className="stat-row">
        <Stat label="Driven" value={km(s.driven)} sub={`of ${km(lease.allowanceKm)}`} />
        <Stat
          label={s.remaining < 0 ? 'Over the limit' : 'Left'}
          value={km(Math.abs(s.remaining))}
          sub={`${fmtNum(s.daysLeft)} days to go`}
        />
        {onLine !== null && (
          <Stat label="On the line today" value={km(onLine)} sub="on the odometer" />
        )}
      </div>

      <div className="mileage-verdict">
        {s.budgetPerDay === null ? (
          <p>The lease has ended.</p>
        ) : s.remaining < 0 ? (
          <p>
            The allowance is spent: <b>{km(-s.remaining)} past the limit</b> already, and every
            km from here is charged.
          </p>
        ) : s.budgetPerDay < 0 ? (
          <p>
            The planned trips take more than is left:{' '}
            <b>{km(s.plannedKm - s.remaining)} over</b> even with no everyday driving at all.
          </p>
        ) : !s.hasReadings && s.plannedKm === 0 ? null : (
          <p>
            From here, everyday driving can take{' '}
            <b>{fmtNum(Math.round(perWeek(s.budgetPerDay)))} km a week</b> (
            {fmtNum(Math.round(perMonth(s.budgetPerDay)))} a month) and still land on the limit
            {s.plannedKm > 0
              ? ` — with the ${km(s.plannedKm)} of planned trips already set aside.`
              : '.'}
          </p>
        )}

        {s.pacePerDay === null ? (
          s.hasReadings && <p>A pace needs two weeks of readings — too early to project.</p>
        ) : (
          <p>
            Your everyday driving has averaged{' '}
            <b>{fmtNum(Math.round(perWeek(s.pacePerDay)))} km a week</b>
            {s.pastTripsKm > 0 && ', the trips you listed taken out'}
            {s.recentPerDay !== null &&
              ` (the last four weeks: ${fmtNum(Math.round(perWeek(s.recentPerDay)))})`}
            . At that pace{s.plannedKm > 0 ? ', with the planned trips on top' : ''}, the car
            goes back{' '}
            {s.projectedOver! > 0 ? (
              <>
                about <b>{km(s.projectedOver!)} over</b> the limit
                {fee > 0 && ` — ${fmtEur(s.projectedOver! * fee)} at ${fmtNum(fee)} €/km`}.
              </>
            ) : (
              <>
                about <b>{km(-s.projectedOver!)} under</b> it.
              </>
            )}
          </p>
        )}

        {staleDays > 7 && (
          <p className="field-hint">
            The last reading is {fmtNum(staleDays)} days old — log today’s to bring this up to
            date.
          </p>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- log */

const LOG_SHOWN = 6

function LogCard({ store, line, today }: { store: MileageStore; line: Timeline; today: number }) {
  const [date, setDate] = useState(() => isoOf(today))
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)
  const { lease, readings } = store.data
  const last = line.points[line.points.length - 1]

  function submit(e: FormEvent) {
    e.preventDefault()
    const value = parseKm(text)
    if (value === null || dayOf(date) === null) {
      setError('A day and the km on the clock, e.g. 45 210.')
      return
    }
    store.saveReading(newReading(date, value))
    setText('')
    setError('')
  }

  // Newest first, each with the km since the reading before it that counted.
  const rows = useMemo(() => {
    const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km)
    let prev = { day: line.span.start - 1, km: Math.max(0, lease.startOdometerKm) }
    const out = []
    for (const r of sorted) {
      const flag = line.flags.get(r.id)
      const day = dayOf(r.date)!
      const delta = flag ? null : { km: r.km - prev.km, days: day - prev.day }
      if (!flag) prev = { day, km: r.km }
      out.push({ r, flag, delta })
    }
    return out.reverse()
  }, [readings, line, lease.startOdometerKm])

  const shown = showAll ? rows : rows.slice(0, LOG_SHOWN)

  return (
    <div className="card schedule-card">
      <div className="schedule-head">
        <span className="cmp-title display">Log a reading</span>
        <span className="cmp-caption">the whole odometer, as the dashboard shows it</span>
      </div>
      <form className="log-form" onSubmit={submit}>
        <DateField label="Day" value={date} onChange={setDate} />
        <label className="field field-compact">
          <span className="field-label">Odometer</span>
          <span className="field-input-wrap">
            <input
              type="text"
              inputMode="numeric"
              value={text}
              placeholder={fmtNum(Math.round(last.km + Math.max(0, lease.startOdometerKm)))}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
            <span className="field-unit">km</span>
          </span>
        </label>
        <button className="btn btn-primary" type="submit">
          Log
        </button>
      </form>
      {error && <p className="field-hint field-error">{error}</p>}

      {rows.length > 0 && (
        <ul className="mileage-list">
          {shown.map(({ r, flag, delta }) => (
            <li key={r.id} className={flag ? 'flagged' : undefined}>
              <span className="mileage-list-main">
                <span className="mileage-list-name">{km(r.km)}</span>
                <span className="mileage-list-date">{fmtDay(dayOf(r.date)!)}</span>
              </span>
              <span className="mileage-list-note">
                {flag === 'lower'
                  ? 'lower than an earlier reading — one of them is mistyped; left out'
                  : flag === 'before-start'
                    ? 'before the hand-over — left out'
                    : flag === 'after-end'
                      ? 'after the return — left out'
                      : delta && delta.days > 0
                        ? `+${fmtNum(Math.round(delta.km))} km in ${fmtNum(delta.days)} ${delta.days === 1 ? 'day' : 'days'}`
                        : ''}
              </span>
              <button
                className="link-btn danger"
                onClick={() => {
                  if (window.confirm(`Delete the reading of ${fmtDay(dayOf(r.date)!)}?`)) {
                    store.removeReading(r.id)
                  }
                }}
                aria-label={`Delete the reading of ${fmtDay(dayOf(r.date)!)}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > LOG_SHOWN && (
        <button className="link-btn mileage-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${rows.length} readings`}
        </button>
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- trips */

function TripsCard({ store, status }: { store: MileageStore; status: MileageStatus }) {
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const { trips } = store.data
  const upcomingIds = new Set(status.upcoming.map((t) => t.id))
  const weekOfAllowance = perWeek(status.span.perDay)

  function submit(e: FormEvent) {
    e.preventDefault()
    const value = parseKm(text)
    if (value === null || value === 0 || dayOf(date) === null) {
      setError('A day and the whole trip in km, there and back.')
      return
    }
    store.saveTrip(newTrip(name.trim() || 'Trip', date, value))
    setName('')
    setDate('')
    setText('')
    setError('')
  }

  const sorted = [...trips].sort((a, b) => a.date.localeCompare(b.date))

  return (
    <div className="card schedule-card">
      <div className="schedule-head">
        <span className="cmp-title display">Planned trips</span>
        <span className="cmp-caption">set aside before the everyday budget is worked out</span>
      </div>
      <form className="log-form" onSubmit={submit}>
        <label className="field field-compact field-wide">
          <span className="field-label">Trip</span>
          <span className="field-input-wrap">
            <input
              type="text"
              value={name}
              placeholder="Levi at Christmas"
              onChange={(e) => setName(e.target.value)}
            />
          </span>
        </label>
        <DateField label="Leaving" value={date} onChange={setDate} />
        <label className="field field-compact">
          <span className="field-label">Distance</span>
          <span className="field-input-wrap">
            <input
              type="text"
              inputMode="numeric"
              value={text}
              placeholder="1 700"
              onChange={(e) => setText(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
            <span className="field-unit">km</span>
          </span>
        </label>
        <button className="btn btn-primary" type="submit">
          Add
        </button>
      </form>
      {error && <p className="field-hint field-error">{error}</p>}

      {sorted.length > 0 && (
        <ul className="mileage-list">
          {sorted.map((t) => {
            const ahead = upcomingIds.has(t.id)
            return (
              <li key={t.id} className={ahead ? undefined : 'past'}>
                <span className="mileage-list-main">
                  <span className="mileage-list-name">{t.name || 'Trip'}</span>
                  <span className="mileage-list-date">{fmtDay(dayOf(t.date)!)}</span>
                </span>
                <span className="mileage-list-note">
                  {km(t.km)}
                  {ahead
                    ? weekOfAllowance > 0 &&
                      ` · ${fmtNum(Math.round((t.km / weekOfAllowance) * 10) / 10)} weeks of allowance`
                    : ' · already on the odometer, and taken out of the everyday pace'}
                </span>
                <button
                  className="link-btn danger"
                  onClick={() => {
                    if (window.confirm(`Delete "${t.name || 'this trip'}"?`)) store.removeTrip(t.id)
                  }}
                  aria-label={`Delete ${t.name || 'the trip'}`}
                >
                  Delete
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- chart */

const HEIGHT = 244
const TOP = 26
const BOTTOM = HEIGHT - 40
const DRIVEN = 'var(--series-1)'

/**
 * Km since hand-over against the allowance's straight line, with the pace so
 * far carried on to the return - dashed, and stepping up on each planned trip.
 *
 * The line is a reference, drawn in the axis ink, not a series: there is one
 * series here, the driving, and its continuation wears the same color.
 */
function ChartCard({
  status: s,
  line,
  lease,
}: {
  status: MileageStatus
  line: Timeline
  lease: MileageLease
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const { span, points } = line
  const allowance = Math.max(0, lease.allowanceKm)
  const projection = useMemo(() => projectionPoints(s), [s])

  const ticks = niceTicks(0, Math.max(allowance, s.projected ?? 0, s.driven))
  const yMax = ticks[ticks.length - 1]
  const left = 12 + 7 * Math.max(...ticks.map((t) => fmtNum(t).length))
  const right = Math.max(left + 1, width - 12)
  const plotW = right - left
  const plotH = BOTTOM - TOP
  const x = (t: number) => left + ((t - span.start) / span.days) * plotW
  const y = (v: number) => BOTTOM - (v / yMax) * plotH
  const path = (pts: Point[]) =>
    pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.km).toFixed(1)}`).join('')

  // Month ticks, as many as fit - quarters on a phone, every month on a wide
  // screen - and on the calendar's own months, so a quarter is Jan/Apr/Jul/Oct.
  const monthStarts: number[] = []
  for (let m = dayOf(`${isoOf(span.start).slice(0, 7)}-01`)!; m <= span.end; m = addMonths(m, 1)) {
    if (m >= span.start) monthStarts.push(m)
  }
  const maxLabels = Math.max(3, Math.floor(plotW / 52))
  const step = [1, 2, 3, 6, 12].find((k) => monthStarts.length / k <= maxLabels) ?? 12
  const xTicks = monthStarts.filter((m) => new Date(m * DAY_MS).getUTCMonth() % step === 0)
  const tickLabel = (m: number) => {
    const d = new Date(m * DAY_MS)
    const label = tickFmt.format(d)
    return d.getUTCMonth() === 0 ? `${label} ’${String(d.getUTCFullYear()).slice(2)}` : label
  }

  const lineAt = (t: number) => span.perDay * (t - span.start)
  const end = projection.length ? projection[projection.length - 1] : null

  function dayAt(e: PointerEvent<SVGRectElement>): number {
    const r = e.currentTarget.getBoundingClientRect()
    const rel = r.width > 0 ? (e.clientX - r.left) / r.width : 0
    return Math.min(span.end, Math.max(span.start, Math.round(span.start + rel * span.days)))
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const current = active ?? s.asOf
    const stepDays = e.shiftKey ? 1 : 7
    let next: number | null = null
    if (e.key === 'ArrowRight') next = Math.min(span.end, current + stepDays)
    else if (e.key === 'ArrowLeft') next = Math.max(span.start, current - stepDays)
    else if (e.key === 'Home') next = span.start
    else if (e.key === 'End') next = span.end
    else if (e.key === 'Escape') next = null
    else return
    e.preventDefault()
    setActive(next)
  }

  const activeX = active !== null ? x(active) : 0
  const activeDriven = active !== null ? drivenAt(points, active) : null
  const activeProjected =
    active !== null && activeDriven === null ? valueOn(projection, active) : null
  const tipOnRight = activeX < left + plotW * 0.55

  return (
    <div className="card schedule-card">
      <div className="schedule-head">
        <span className="cmp-title display">Against the line</span>
        <span className="cmp-caption">km since hand-over, and where the pace so far leads</span>
      </div>
      <div className="legend chart-legend">
        <span className="legend-item">
          <span className="swatch swatch-line" style={{ background: 'var(--ink-3)' }} />
          The allowance, spread evenly
        </span>
        <span className="legend-item">
          <span className="swatch swatch-line" style={{ background: DRIVEN }} />
          Driven
        </span>
        {projection.length > 0 && (
          <span className="legend-item">
            <span className="swatch swatch-line swatch-dash" style={{ color: DRIVEN }} />
            {s.upcoming.length ? 'At that pace, with the trips' : 'At that pace'}
          </span>
        )}
      </div>
      <div
        ref={ref}
        className="chart"
        style={{ height: HEIGHT }}
        tabIndex={0}
        role="group"
        aria-label={`Km driven against the allowance. ${km(s.driven)} driven by ${fmtDay(s.asOf - 1)}, where the line is at ${km(s.allowedSoFar)}.`}
        onKeyDown={onKey}
        onFocus={() => setActive((cur) => cur ?? s.asOf)}
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
                km
              </text>
              {xTicks.map((m) => (
                <text key={m} x={x(m)} y={BOTTOM + 16} textAnchor="middle">
                  {tickLabel(m)}
                </text>
              ))}
            </g>

            <path
              d={path([
                { t: span.start, km: 0 },
                { t: span.end, km: allowance },
              ])}
              className="chart-line reference"
            />
            {projection.length > 0 && (
              <path d={path(projection)} className="chart-line dashed" stroke={DRIVEN} />
            )}
            {points.length > 1 && <path d={path(points)} className="chart-line" stroke={DRIVEN} />}
            {points.length > 1 && (
              <circle cx={x(s.asOf)} cy={y(s.driven)} r={4.5} className="chart-marker" />
            )}

            <text x={right - 2} y={Math.max(12, y(allowance) - 6)} textAnchor="end" className="chart-label">
              limit {fmtNum(allowance)}
            </text>
            {end && Math.abs(y(end.km) - y(allowance)) >= 13 && (
              <text
                x={right - 2}
                y={end.km > allowance ? Math.max(12, y(end.km) - 6) : y(end.km) + 14}
                textAnchor="end"
                className="chart-label"
              >
                ~{fmtNum(Math.round(end.km))}
              </text>
            )}

            {active !== null && (
              <g className="chart-crosshair">
                <line x1={activeX} x2={activeX} y1={TOP} y2={BOTTOM} />
                <circle cx={activeX} cy={y(lineAt(active))} r={4} fill="var(--ink-3)" />
                {activeDriven !== null && (
                  <circle cx={activeX} cy={y(activeDriven)} r={4} fill={DRIVEN} />
                )}
                {activeProjected !== null && (
                  <circle cx={activeX} cy={y(activeProjected)} r={4} fill={DRIVEN} />
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
            <div className="chart-tip-head">{fmtDay(Math.max(span.start, active - 1))}</div>
            <TipRow color="var(--ink-3)" value={km(lineAt(active))} label="the line" />
            {activeDriven !== null && (
              <>
                <TipRow color={DRIVEN} value={km(activeDriven)} label="driven" />
                <TipRow
                  value={signed(lineAt(active) - activeDriven)}
                  label={lineAt(active) - activeDriven < 0 ? 'km over' : 'km in hand'}
                />
              </>
            )}
            {activeProjected !== null && (
              <>
                <TipRow color={DRIVEN} value={km(activeProjected)} label="at that pace" />
                <TipRow
                  value={signed(lineAt(active) - activeProjected)}
                  label={lineAt(active) - activeProjected < 0 ? 'km over' : 'km in hand'}
                />
              </>
            )}
          </div>
        )}
      </div>
      <p className="chart-note">
        The dot is the last reading. Between two readings the km are spread evenly over the
        days; after the last one the dashed line carries on at the average so far.
      </p>
    </div>
  )
}

/* --------------------------------------------------------------- periods */

const KINDS: { key: PeriodKind; label: string; title: string }[] = [
  { key: 'week', label: 'Week', title: 'Week by week' },
  { key: 'month', label: 'Month', title: 'Month by month' },
  { key: 'year', label: 'Year', title: 'Lease year by year' },
]

/** Weeks are many: around today, unless all of them are asked for. */
const WEEKS_BEFORE = 8
const WEEKS_AFTER = 4

function periodLabel(kind: PeriodKind, row: PeriodRow, index: number): [string, string] {
  const cut = row.from > row.periodStart || row.to < row.periodEnd
  if (kind === 'week') {
    return [`Week ${isoWeek(row.periodStart)}`, `${fmtShort(row.from)}–${fmtShort(row.to - 1)}`]
  }
  if (kind === 'month') {
    const name = monthFmt.format(new Date(row.periodStart * DAY_MS))
    return [name, cut ? `${fmtShort(row.from)}–${fmtShort(row.to - 1)}` : '']
  }
  return [`Year ${index + 1}`, `${fmtDay(row.from)}–${fmtDay(row.to - 1)}`]
}

function PeriodsCard({
  store,
  status,
  today,
}: {
  store: MileageStore
  status: MileageStatus
  today: number
}) {
  const [kind, setKind] = useState<PeriodKind>('month')
  const [allWeeks, setAllWeeks] = useState(false)
  const { lease, readings, trips } = store.data
  const rows = useMemo(
    () => periods(kind, lease, readings, trips),
    [kind, lease, readings, trips],
  )
  const perDay = status.span.perDay

  // The period today falls in - or the nearest one, before the start or after the return.
  const anchor = Math.min(status.span.end - 1, Math.max(status.span.start, today))
  const current = rows.findIndex((r) => anchor >= r.from && anchor < r.to)
  const windowed = kind === 'week' && !allWeeks
  const first = windowed ? Math.max(0, current - WEEKS_BEFORE) : 0
  const last = windowed ? Math.min(rows.length, current + WEEKS_AFTER + 1) : rows.length
  const shown = rows.slice(first, last)
  const title = KINDS.find((k) => k.key === kind)!.title

  return (
    <div className="card schedule-card">
      <div className="schedule-head">
        <span className="cmp-title display">{title}</span>
        <span className="cmp-caption">
          allowance {fmtNum(Math.round(perWeek(perDay)))} km a week,{' '}
          {fmtNum(Math.round(perMonth(perDay)))} a month
        </span>
        <div className="cmp-toggle" role="tablist" aria-label="Period">
          {KINDS.map((k) => (
            <button
              key={k.key}
              className={`filter-chip${kind === k.key ? ' active' : ''}`}
              role="tab"
              aria-selected={kind === k.key}
              onClick={() => setKind(k.key)}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cmp-scroll">
        <table className="cmp schedule-table mileage-table">
          <thead>
            <tr>
              <th className="rowhead">{KINDS.find((k) => k.key === kind)!.label}</th>
              <th>Driven</th>
              <th>Allowed</th>
              <th title="Against the allowance" aria-label="Against the allowance">
                ±
              </th>
              <th>In hand</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, k) => {
              const index = first + k
              const [name, dates] = periodLabel(kind, row, index)
              const partial = row.driven !== null && row.measuredDays < row.to - row.from
              // Under the name, not in the figures' cells: a phone has room
              // for five narrow columns, not for notes that widen them.
              const notes = [
                dates,
                partial ? `${fmtNum(row.measuredDays)} of ${fmtNum(row.to - row.from)} days so far` : '',
                row.planned > 0 ? `${km(row.planned)} planned` : '',
              ].filter(Boolean)
              return (
                <tr key={row.periodStart} className={index === current ? 'marked' : undefined}>
                  <th className="rowhead">
                    {name}
                    {notes.map((n) => (
                      <span key={n} className="cell-note">
                        {n}
                      </span>
                    ))}
                  </th>
                  <td className="num">
                    {row.driven === null ? '—' : fmtNum(Math.round(row.driven))}
                  </td>
                  <td className="num">{fmtNum(Math.round(row.allowance))}</td>
                  <td className={`num${row.diff !== null && Math.round(row.diff) < 0 ? ' over-ceiling' : ''}`}>
                    {row.diff === null ? '' : signed(row.diff)}
                  </td>
                  <td className={`num${row.balance !== null && Math.round(row.balance) < 0 ? ' over-ceiling' : ''}`}>
                    {row.balance === null ? '' : signed(row.balance)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {kind === 'week' && rows.length > WEEKS_BEFORE + WEEKS_AFTER + 1 && (
        <button className="link-btn mileage-more" onClick={() => setAllWeeks((v) => !v)}>
          {allWeeks ? 'Around today only' : `Show all ${rows.length} weeks`}
        </button>
      )}
      <p className="chart-note">
        ± is the period’s allowance minus what was driven in it — plus is under, minus is
        over. In hand is the running total, the figure at the top. A period the readings
        stop inside is compared for the days measured.
      </p>
    </div>
  )
}
