/**
 * A leased car's kilometre allowance, and how the driving sits against it.
 *
 * The contract allows so many km over so many months. The question the numbers
 * answer is the one asked before a long trip: how far ahead of the line am I,
 * and what is left for everyday driving once the trips already planned are
 * set aside?
 *
 * The allowance is spread evenly over the days of the contract - a straight
 * line from hand-over to return. That is also how an overage is settled: only
 * the total at the return counts, so there is no monthly cap to break, only a
 * pace to keep. A heavy month is fine if the months around it are light.
 *
 * Time is counted in whole days (UTC day numbers, so no daylight-saving hour
 * ever makes a day 23 hours long). The hand-over odometer is the clock at the
 * START of the first day; a reading is the clock at the END of its day. Between
 * two readings the km are spread evenly over the days - which is what a week's
 * figure means when the readings happen to be ten days apart.
 */

export interface MileageLease {
  /** 'YYYY-MM-DD', the day the car was handed over; '' until it is set */
  startDate: string
  termMonths: number
  /** km the whole contract allows - not per year */
  allowanceKm: number
  /** km on the clock at hand-over */
  startOdometerKm: number
  /** € per km past the allowance; 0 when the contract has not been checked */
  excessFeePerKm: number
}

/**
 * The contract this was built for - 21 months, 26 250 km, which is 15 000 a
 * year. Any other contract is two fields away; the start date and the
 * odometer are nobody's default.
 */
export const DEFAULT_LEASE: MileageLease = {
  startDate: '',
  termMonths: 21,
  allowanceKm: 26_250,
  startOdometerKm: 0,
  excessFeePerKm: 0,
}

/** What the odometer said on a day. */
export interface OdometerReading {
  id: string
  /** 'YYYY-MM-DD' */
  date: string
  /** km on the clock - the whole odometer, not the km since hand-over */
  km: number
  createdAt: string
  updatedAt: string
}

/** A long drive still ahead, set aside from the everyday budget. */
export interface PlannedTrip {
  id: string
  name: string
  /** 'YYYY-MM-DD', the day it starts */
  date: string
  /** the whole trip, there and back */
  km: number
  createdAt: string
  updatedAt: string
}

/* -------------------------------------------------------------------- days */

const DAY_MS = 86_400_000

/** The UTC day number of a 'YYYY-MM-DD' date, or null when it is not a real date. */
export function dayOf(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]
  const t = Date.UTC(y, mo, d)
  const back = new Date(t)
  // 2026-02-30 is not a day, and Date would quietly make it 2.3.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo || back.getUTCDate() !== d) {
    return null
  }
  return Math.round(t / DAY_MS)
}

export function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

/** The same day of the month `months` later - clamped to the month's end, so 31.1. + 1 is 28.2. */
export function addMonths(day: number, months: number): number {
  const d = new Date(day * DAY_MS)
  const month = d.getUTCMonth() + months
  const last = new Date(Date.UTC(d.getUTCFullYear(), month + 1, 0)).getUTCDate()
  return Math.round(Date.UTC(d.getUTCFullYear(), month, Math.min(d.getUTCDate(), last)) / DAY_MS)
}

/** Today on this device's own calendar - the local date, not the UTC one. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** The Monday of the week a day falls in. Day 0, 1.1.1970, was a Thursday. */
export function mondayOf(day: number): number {
  return day - ((((day + 3) % 7) + 7) % 7)
}

/** The ISO week number: the week belongs to the year its Thursday is in. */
export function isoWeek(day: number): number {
  const thursday = mondayOf(day) + 3
  const jan1 = dayOf(`${isoOf(thursday).slice(0, 4)}-01-01`)!
  return Math.floor((thursday - jan1) / 7) + 1
}

/* -------------------------------------------------------------- the lease */

export interface LeaseSpan {
  /** the first day of the contract */
  start: number
  /** the day the car goes back: the first day NOT in the contract */
  end: number
  days: number
  /** the allowance, per day */
  perDay: number
}

/** When the contract runs, or null until it has a start date. */
export function leaseSpan(lease: MileageLease): LeaseSpan | null {
  const start = dayOf(lease.startDate)
  if (start === null) return null
  const end = addMonths(start, Math.max(1, Math.round(lease.termMonths)))
  const days = end - start
  return { start, end, days, perDay: Math.max(0, lease.allowanceKm) / days }
}

/* --------------------------------------------------------------- readings */

/**
 * Why a reading is left out of the maths. The reading stays in the log, marked,
 * because the fix is the person's to make - most often a digit typed wrong.
 */
export type ReadingFlag = 'before-start' | 'after-end' | 'lower'

/** A point on the driven-km line: `km` driven since hand-over by the start of day `t`. */
export interface Point {
  t: number
  km: number
}

export interface Timeline {
  span: LeaseSpan
  /** from (start, 0), one per day that has a reading, in order */
  points: Point[]
  flags: Map<string, ReadingFlag>
}

/**
 * The readings as a line of km driven since hand-over.
 *
 * Two readings on one day: the higher one, since the car only drove between
 * them. A reading lower than one before it cannot be true of an odometer, so
 * it is flagged rather than bending the line down. A reading on the return day
 * itself counts - that is when the final one is taken.
 */
export function timeline(
  lease: MileageLease,
  readings: OdometerReading[],
): Timeline | null {
  const span = leaseSpan(lease)
  if (!span) return null
  const flags = new Map<string, ReadingFlag>()
  const points: Point[] = [{ t: span.start, km: 0 }]
  const dated = readings
    .map((r) => ({ r, day: dayOf(r.date) }))
    .filter((x): x is { r: OdometerReading; day: number } => x.day !== null)
    .sort((a, b) => a.day - b.day || a.r.km - b.r.km)
  for (const { r, day } of dated) {
    if (day < span.start) {
      flags.set(r.id, 'before-start')
      continue
    }
    if (day > span.end) {
      flags.set(r.id, 'after-end')
      continue
    }
    const km = r.km - Math.max(0, lease.startOdometerKm)
    const last = points[points.length - 1]
    if (km < last.km) {
      flags.set(r.id, 'lower')
      continue
    }
    const t = Math.min(day + 1, span.end)
    if (t === last.t) last.km = km
    else points.push({ t, km })
  }
  return { span, points, flags }
}

/** Km driven since hand-over by the start of day `t`; null past the last reading. */
export function drivenAt(points: Point[], t: number): number | null {
  if (t <= points[0].t) return 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (t <= b.t) return a.km + ((b.km - a.km) * (t - a.t)) / (b.t - a.t)
  }
  return null
}

/* ----------------------------------------------------------------- status */

/** A pace from fewer days than this is mostly the one trip in it. */
export const MIN_PACE_DAYS = 14
/**
 * The "lately" window: shown once there is twice that much to compare it
 * with, and a reading near its start - one reading after six months would
 * otherwise "measure" the last four weeks as the six-month average.
 */
export const RECENT_DAYS = 28

export interface MileageStatus {
  span: LeaseSpan
  /** the start of the day after the last reading - what everything is measured to */
  asOf: number
  hasReadings: boolean
  /** km driven since hand-over, by `asOf` */
  driven: number
  /** where the straight line is at `asOf` */
  allowedSoFar: number
  /** allowedSoFar − driven: positive is km in hand, negative is over the line */
  balance: number
  /** the allowance still to drive, negative once it is spent */
  remaining: number
  daysLeft: number
  /** trips dated after the last reading and before the return */
  upcoming: PlannedTrip[]
  plannedKm: number
  /** km a day left for everyday driving, planned trips set aside; null once the lease is over */
  budgetPerDay: number | null
  /** listed trips dated before the last reading - already on the odometer */
  pastTripsKm: number
  /**
   * Everyday km a day since hand-over: the driving with the listed trips taken
   * out, so it compares with the budget - which sets the trips aside too - and
   * the projection does not count a trip twice. Null until MIN_PACE_DAYS are
   * measured.
   */
  pacePerDay: number | null
  /** the same over the last RECENT_DAYS; null until readings measure that window */
  recentPerDay: number | null
  /**
   * The odometer's km since hand-over at the return, driving on at the
   * everyday pace and taking the planned trips on top. Chosen so it always
   * agrees with the budget: over the allowance exactly when the pace is above
   * the budget.
   */
  projected: number | null
  /** projected − allowance: positive is the overage the fee applies to */
  projectedOver: number | null
}

export function mileageStatus(
  lease: MileageLease,
  readings: OdometerReading[],
  trips: PlannedTrip[],
): MileageStatus | null {
  const line = timeline(lease, readings)
  if (!line) return null
  const { span, points } = line
  const last = points[points.length - 1]
  const asOf = last.t
  const driven = last.km
  const allowance = Math.max(0, lease.allowanceKm)
  const allowedSoFar = span.perDay * (asOf - span.start)
  const daysLeft = span.end - asOf
  const remaining = allowance - driven

  const upcoming = trips
    .filter((trip) => {
      const day = dayOf(trip.date)
      return day !== null && day >= asOf && day < span.end
    })
    .sort((a, b) => a.date.localeCompare(b.date))
  const plannedKm = upcoming.reduce((sum, trip) => sum + Math.max(0, trip.km), 0)

  // Listed trips between two days, for taking them out of the everyday pace.
  // More trip than driving (a trip listed that never happened) floors at zero.
  const listed = (from: number, to: number) =>
    trips.reduce((sum, trip) => {
      const day = dayOf(trip.date)
      return day !== null && day >= from && day < to ? sum + Math.max(0, trip.km) : sum
    }, 0)
  const pastTripsKm = listed(span.start, asOf)

  const measured = asOf - span.start
  const pacePerDay =
    measured >= MIN_PACE_DAYS ? Math.max(0, driven - pastTripsKm) / measured : null
  const recentFrom = asOf - RECENT_DAYS
  const anchor = points.findLast((p) => p.t <= recentFrom)
  const recentPerDay =
    measured >= 2 * RECENT_DAYS && anchor !== undefined && anchor.t >= asOf - 2 * RECENT_DAYS
      ? Math.max(0, driven - drivenAt(points, recentFrom)! - listed(recentFrom, asOf)) /
        RECENT_DAYS
      : null

  const budgetPerDay = daysLeft > 0 ? (remaining - plannedKm) / daysLeft : null
  const projected = pacePerDay === null ? null : driven + pacePerDay * daysLeft + plannedKm

  return {
    span,
    asOf,
    hasReadings: points.length > 1,
    driven,
    allowedSoFar,
    balance: allowedSoFar - driven,
    remaining,
    daysLeft,
    upcoming,
    plannedKm,
    budgetPerDay,
    pastTripsKm,
    pacePerDay,
    recentPerDay,
    projected,
    projectedOver: projected === null ? null : projected - allowance,
  }
}

/**
 * The projection as a line: on from the last reading at the pace so far, a
 * step up on each planned trip's day. Its last point is `projected`.
 */
export function projectionPoints(status: MileageStatus): Point[] {
  const pace = status.pacePerDay
  if (pace === null || status.daysLeft <= 0) return []
  let trips = 0
  const at = (t: number) => status.driven + pace * (t - status.asOf) + trips
  const pts: Point[] = [{ t: status.asOf, km: status.driven }]
  for (const trip of status.upcoming) {
    const t = dayOf(trip.date)!
    pts.push({ t, km: at(t) })
    trips += Math.max(0, trip.km)
    pts.push({ t, km: at(t) })
  }
  pts.push({ t: status.span.end, km: at(status.span.end) })
  return pts
}

/** A line's value at `t`, reading a step at the top - after the trip, not before. */
export function valueOn(points: Point[], t: number): number | null {
  let value: number | null = null
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (a.t === b.t || t < a.t || t > b.t) continue
    value = a.km + ((b.km - a.km) * (t - a.t)) / (b.t - a.t)
  }
  return value
}

/**
 * Where the odometer should read at the end of `day` to be exactly on the
 * line - the figure to hold the dashboard against, no reading needed.
 */
export function odometerOnTheLine(lease: MileageLease, day: number): number | null {
  const span = leaseSpan(lease)
  if (!span) return null
  const elapsed = Math.min(span.days, Math.max(0, day + 1 - span.start))
  return Math.max(0, lease.startOdometerKm) + span.perDay * elapsed
}

/* ---------------------------------------------------------------- periods */

export type PeriodKind = 'week' | 'month' | 'year'

export interface PeriodRow {
  /** the period's own bounds - a calendar week or month, or a lease year */
  periodStart: number
  periodEnd: number
  /** the part of it inside the lease: the first and last periods are cut short */
  from: number
  to: number
  /** the allowance for the part inside the lease */
  allowance: number
  /** km driven in the measured part; null while none of it is measured */
  driven: number | null
  /** days of it measured - fewer than to − from while the readings stop inside it */
  measuredDays: number
  /** the allowance for the measured days minus the km driven in them: + is under */
  diff: number | null
  /** the running balance at the end of the measured part, as in the status */
  balance: number | null
  /** planned trips dated in it, counting only those still ahead */
  planned: number
}

/** The first day of the period after the one starting on `day`. */
function nextPeriod(kind: PeriodKind, day: number): number {
  if (kind === 'week') return day + 7
  if (kind === 'month') return addMonths(day, 1)
  return addMonths(day, 12)
}

function firstPeriod(kind: PeriodKind, start: number): number {
  if (kind === 'week') return mondayOf(start)
  if (kind === 'month') return dayOf(`${isoOf(start).slice(0, 7)}-01`)!
  return start
}

/**
 * The lease cut into weeks (Monday to Sunday), calendar months, or lease years
 * - years from the hand-over rather than calendar years, because that is how
 * a contract's "15 000 km a year" is meant, and a calendar year would split a
 * 21-month lease into three uneven pieces.
 */
export function periods(
  kind: PeriodKind,
  lease: MileageLease,
  readings: OdometerReading[],
  trips: PlannedTrip[],
): PeriodRow[] {
  const line = timeline(lease, readings)
  const status = mileageStatus(lease, readings, trips)
  if (!line || !status) return []
  const { span, points } = line
  const upcoming = status.upcoming.map((trip) => ({ day: dayOf(trip.date)!, km: trip.km }))

  const rows: PeriodRow[] = []
  for (let p = firstPeriod(kind, span.start); p < span.end; p = nextPeriod(kind, p)) {
    const periodEnd = nextPeriod(kind, p)
    const from = Math.max(p, span.start)
    const to = Math.min(periodEnd, span.end)
    const measuredTo = Math.min(to, status.asOf)
    const measuredDays = Math.max(0, measuredTo - from)
    const atEnd = measuredDays > 0 ? drivenAt(points, measuredTo)! : null
    const driven = atEnd === null ? null : atEnd - drivenAt(points, from)!
    rows.push({
      periodStart: p,
      periodEnd,
      from,
      to,
      allowance: span.perDay * (to - from),
      driven,
      measuredDays,
      diff: driven === null ? null : span.perDay * measuredDays - driven,
      balance: atEnd === null ? null : span.perDay * (measuredTo - span.start) - atEnd,
      planned: upcoming
        .filter((trip) => trip.day >= from && trip.day < to)
        .reduce((sum, trip) => sum + Math.max(0, trip.km), 0),
    })
  }
  return rows
}
