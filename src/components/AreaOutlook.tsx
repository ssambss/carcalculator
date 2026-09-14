import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  HORIZON_OFFSETS,
  HOUSE_TYPES,
  ZONE_LABELS,
  areaSeries,
  band,
  citySeries,
  findArea,
  indexStats,
  kindLabel,
  outlook,
  project,
  resolveProjectionYear,
  type AreaOutlook as Outlook,
  type AreaRecord,
  type Growth,
  type IndexKey,
  type PriceData,
  type SeriesKind,
  type Zone,
} from '../areas'
import { HELSINKI_PRICES } from '../data/helsinkiPrices'
import type { HousingSituation, PropertyListing } from '../housing'
import { fmtEur, fmtNum, fmtPct } from '../format'
import { niceTicks } from './chartHelpers'
import { NumberField } from './NumberField'
import { TipRow } from './TwoLineChart'
import { useWidth } from './useWidth'

/**
 * Helsinki by area: what homes have sold for per square metre in each
 * postal-code area, and what continuing the trend implies - at the purchase,
 * and ten and twenty years after it.
 *
 * The rent-or-buy card takes the home's growth as one typed guess; this card
 * is where such a guess can come from. It leads with one area (a candidate's,
 * when a place carries a postal code) drawn against the city, continues its
 * trend as a dashed line with a band for how much the area has swung, and
 * puts two more lines beside it: the reader's own guess, and the long-run
 * rate of the area's whole price zone since 1988 - the steadier yardstick
 * once the horizon is decades, when a ten-year window in one postal code is
 * a thin base to compound from. Lines that disagree are the point. Under it,
 * every area in one sortable table with the candidates marked; then the long
 * run itself, because a series that starts in 2009 has never seen the 1990s.
 *
 * The area wears the ownership blue (slot 1); the reader's guess the teal
 * (slot 3) the renting line already uses against it. Helsinki as a whole and
 * the zone's long run are references, so they are drawn in the muted ink the
 * axes use - solid for what happened, dashed for what is continued.
 */

const AREA_COLOR = 'var(--series-1)'
const GUESS_COLOR = 'var(--series-3)'
const REF_COLOR = 'var(--ink-3)'
const CITY_CODE = 'city'
const CITY_SUBJECT = { code: CITY_CODE, name: 'Helsinki, all areas', zone: null }
const ZONES: Zone[] = [1, 2, 3, 4]

const perYear = (g: Growth | null): string => (g ? `${fmtPct(g.pct)}/yr` : '—')
const perM2 = (v: number): string => `${fmtEur(v)}/m²`
const horizonLabel = (i: number): string =>
  i === 0 ? 'At purchase' : `+${HORIZON_OFFSETS[i]} years`
/** the zone's name for the long-run line: "zone 3" for an area, "Helsinki" for the city */
const longRunName = (o: Outlook): string => (o.zone === null ? 'Helsinki' : `zone ${o.zone}`)

interface Props {
  situation: HousingSituation
  properties: PropertyListing[]
  onChange: (s: HousingSituation) => void
}

/** The kind with the most sales in the area's latest year - what the area actually trades. */
function busiestKind(area: AreaRecord | undefined): SeriesKind {
  if (!area) return 'two'
  let best: SeriesKind = 'two'
  let most = -1
  for (const t of HOUSE_TYPES) {
    if (t.key === 'flats') continue
    const counts = area.count[t.key]
    for (let k = counts.length - 1; k >= 0; k--) {
      const c = counts[k]
      if (c === null) continue
      if (c > most) {
        most = c
        best = t.key
      }
      break
    }
  }
  return best
}

export function AreaOutlook({ situation, properties, onChange }: Props) {
  const data: PriceData = HELSINKI_PRICES
  const latestYear = data.years[data.years.length - 1]
  const targetYear = resolveProjectionYear(situation.projectionYear, latestYear)
  const guess = situation.homeValueGrowthPct
  const set = (patch: Partial<HousingSituation>) => onChange({ ...situation, ...patch })

  // The places that carry a postal code the data knows.
  const candidates = useMemo(
    () =>
      properties.flatMap((p) => {
        const area = findArea(data, p.postalCode)
        return area ? [{ p, area }] : []
      }),
    [properties, data],
  )
  const [kind, setKind] = useState<SeriesKind>(() => busiestKind(candidates[0]?.area))
  const [selected, setSelected] = useState<string>(() => candidates[0]?.area.code ?? CITY_CODE)
  const [horizon, setHorizon] = useState(0)
  const [sort, setSort] = useState<Sort>({ key: 'name', dir: 'asc' })

  // The long-run rates: the whole index for Helsinki and each zone, 1988 on.
  const longRun = useMemo(() => {
    const idx = data.index
    const rate = (key: IndexKey) => indexStats(idx.years, idx.series[key].nominal).sinceStart?.pct ?? null
    const zones: Record<Zone, number | null> = {
      1: rate('zone1'),
      2: rate('zone2'),
      3: rate('zone3'),
      4: rate('zone4'),
    }
    return { city: rate('helsinki'), zones, since: idx.years[0] }
  }, [data])

  const city = useMemo(() => {
    const s = citySeries(data, kind)
    return outlook(CITY_SUBJECT, data.years, s, s.values, null, targetYear, guess, longRun.city)
  }, [data, kind, targetYear, guess, longRun])

  const rows = useMemo(
    () =>
      data.areas
        .map((a) =>
          outlook(
            { code: a.code, name: a.name, zone: a.zone },
            data.years,
            areaSeries(a, kind),
            city.values,
            city.summary.volatilityPct,
            targetYear,
            guess,
            longRun.zones[a.zone],
          ),
        )
        .filter((o) => o.summary.latest !== null),
    [data, kind, city, targetYear, guess, longRun],
  )
  const byCode = useMemo(() => new Map(rows.map((r) => [r.code, r])), [rows])
  const pickedArea =
    selected === CITY_CODE ? null : (data.areas.find((a) => a.code === selected) ?? null)
  const picked = pickedArea ? byCode.get(pickedArea.code) : undefined
  const current = picked ?? city
  const candidateCodes = useMemo(() => new Set(candidates.map((c) => c.area.code)), [candidates])
  const yearsFromNow = Math.max(0, targetYear - new Date().getFullYear())
  // The chips come from the city, which always has figures to the last year -
  // a stale area has no horizons of its own and shows its history alone.
  const horizons = city.projection?.horizons ?? []

  return (
    <div className="card schedule-card">
      <div className="schedule-head">
        <div className="cmp-title display">Helsinki by area</div>
        <div className="cmp-caption">
          what homes have sold for per square metre, and what continuing the trend implies
        </div>
      </div>

      <div className="schedule-subjects" role="tablist" aria-label="Which homes">
        {HOUSE_TYPES.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={kind === t.key}
            className={`filter-chip${kind === t.key ? ' active' : ''}`}
            onClick={() => setKind(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="analysis-fields">
        <label className="field field-compact field-wide">
          <span className="field-label">Area</span>
          <span className="field-input-wrap">
            <select
              className="area-select"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value={CITY_CODE}>{CITY_SUBJECT.name}</option>
              {ZONES.map((z) => (
                <optgroup key={z} label={`Zone ${z} · ${ZONE_LABELS[z]}`}>
                  {data.areas
                    .filter((a) => a.zone === z)
                    .map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} {a.name}
                        {byCode.has(a.code) ? '' : ' · no sales published'}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </span>
        </label>
        <NumberField
          compact
          label="Buying in"
          value={targetYear}
          onChange={(n) => set({ projectionYear: Math.max(0, Math.round(n)) })}
          unit="year"
          hint={`data runs to ${latestYear}`}
        />
        <NumberField
          compact
          label="Home value"
          value={guess}
          onChange={(n) => set({ homeValueGrowthPct: Math.max(-99, n) })}
          unit="%/yr"
          hint="your guess, shared with rent-or-buy"
        />
      </div>

      {horizons.length > 0 && (
        <div className="schedule-subjects" role="tablist" aria-label="How far ahead">
          {horizons.map((h, i) => (
            <button
              key={h.year}
              role="tab"
              aria-selected={horizon === i}
              className={`filter-chip${horizon === i ? ' active' : ''}`}
              onClick={() => setHorizon(i)}
            >
              {horizonLabel(i)}
              <span className="chip-note">{h.year}</span>
            </button>
          ))}
        </div>
      )}

      {pickedArea && !picked && (
        <p className="chart-note">
          No {kindLabel(kind).toLowerCase()} sales published for {pickedArea.code}{' '}
          {pickedArea.name} — Statistics Finland withholds an area’s figure when too few homes
          changed hands. Showing Helsinki as a whole; try another type above.
        </p>
      )}

      <AreaChart area={current} city={city} showCity={current !== city} horizon={horizon} since={longRun.since} />
      <Tiles o={current} />
      <Horizons o={current} horizon={horizon} since={longRun.since} />

      {candidates.length > 0 && (
        <Candidates
          candidates={candidates}
          byCode={byCode}
          kind={kind}
          yearsFromNow={yearsFromNow}
          targetYear={targetYear}
          guess={guess}
          onUse={(pct) => set({ homeValueGrowthPct: Math.round(pct * 10) / 10 })}
        />
      )}
      {properties.some((p) => !findArea(data, p.postalCode)) && (
        <p className="chart-note">
          Give a place its postal code (Edit → Postal code) and it is marked in the table below
          and priced forward at its own area’s trend.
        </p>
      )}

      <AreaTable
        rows={rows}
        kind={kind}
        latestYear={latestYear}
        horizon={horizon}
        sort={sort}
        onSort={setSort}
        selected={selected}
        onSelect={setSelected}
        candidateCodes={candidateCodes}
      />

      <LongRun data={data} />

      <p className="chart-note">
        Averages of realised sales of old flats and terraced houses per postal-code area, from
        Statistics Finland ({data.source.split(',')[0]}, tables {data.tables.join(', ')}; yearly
        figures to {latestYear}, updated {data.updated}). The trend continues the last ten years’
        average yearly change; the likely range is one standard deviation of the area’s own yearly
        moves (Helsinki’s where the area has too few years), widening with the square root of the
        years — roughly two years in three, if the future is as unruly as the past. The zone’s long
        run is the average yearly change of Statistics Finland’s price index for the area’s whole
        price zone since {longRun.since}: over ten and twenty years it is the steadier yardstick, and
        the gap between it and the area’s trend is worth more thought than either figure. None of it
        is a forecast: a €/m² average mixes buildings, floors and renovations, a small area swings
        on a handful of sales, and the 2022–2025 fall sits inside every ten-year figure here. All
        figures are nominal — the long-run table below shows what inflation did to them.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------- chart */

const HEIGHT = 244
const TOP = 26
const BOTTOM = HEIGHT - 40

interface XY {
  year: number
  value: number | null
}

/**
 * Direct labels at the right edge for the continued lines: each wants to sit
 * beside its end; where two would overlap they are pushed apart, and the
 * whole stack is lifted if it would run into the tick band.
 */
function stackLabels(items: { text: string; v: number; y: number }[]): { text: string; y: number }[] {
  const sorted = [...items].sort((a, b) => a.y - b.y)
  const out: { text: string; y: number }[] = []
  for (const it of sorted) {
    const prev = out[out.length - 1]
    const y = prev ? Math.max(prev.y + 13, it.y + 4) : Math.max(12, it.y + 4)
    out.push({ text: it.text, y })
  }
  const overflow = out.length ? out[out.length - 1].y - (BOTTOM - 4) : 0
  if (overflow > 0) for (const o of out) o.y -= overflow
  return out
}

function AreaChart({
  area,
  city,
  showCity,
  horizon,
  since,
}: {
  area: Outlook
  city: Outlook
  showCity: boolean
  horizon: number
  since: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const latest = area.summary.latest
  const proj = area.projection
  if (!latest || !proj) return null

  // A stale area has no horizons: the chart then shows its history alone,
  // ending where the data does.
  const end = proj.horizons.length ? proj.horizons[Math.min(horizon, proj.horizons.length - 1)] : null
  const firstYear = area.years[0]
  const lastYear = end ? end.year : area.years[area.years.length - 1]
  const span = Math.max(1, lastYear - firstYear)
  const trendPct = end?.atTrend && proj.trend ? proj.trend.pct : null

  const actual: XY[] = area.years.map((y, k) => ({ year: y, value: area.values[k] }))
  const cityPts: XY[] = showCity ? area.years.map((y, k) => ({ year: y, value: city.values[k] })) : []
  const trendPts: XY[] = []
  const guessPts: XY[] = []
  const longPts: XY[] = []
  const lowPts: XY[] = []
  const highPts: XY[] = []
  for (let k = 0; end && k <= end.years; k++) {
    const year = latest.year + k
    guessPts.push({ year, value: project(latest.value, proj.guessPct, k) })
    if (proj.longRunPct !== null) longPts.push({ year, value: project(latest.value, proj.longRunPct, k) })
    if (trendPct !== null) {
      trendPts.push({ year, value: project(latest.value, trendPct, k) })
      if (proj.volatilityUsedPct !== null) {
        const b =
          k === 0
            ? { low: latest.value, high: latest.value }
            : band(latest.value, trendPct, proj.volatilityUsedPct, k)
        lowPts.push({ year, value: b.low })
        highPts.push({ year, value: b.high })
      }
    }
  }

  let hi = 0
  for (const s of [actual, cityPts, trendPts, guessPts, longPts, highPts]) {
    for (const p of s) if (p.value !== null) hi = Math.max(hi, p.value)
  }
  const ticks = niceTicks(0, hi)
  const yMax = ticks[ticks.length - 1]
  const left = 12 + 7 * Math.max(...ticks.map((t) => fmtEur(t).length))
  const right = Math.max(left + 1, width - 12)
  const plotW = right - left
  const plotH = BOTTOM - TOP
  const x = (year: number) => left + ((year - firstYear) / span) * plotW
  const y = (v: number) => BOTTOM - (v / yMax) * plotH

  // A gap in the data lifts the pen: the line restarts at the next figure.
  const linePath = (pts: XY[]) => {
    let d = ''
    let pen = false
    for (const p of pts) {
      if (p.value === null) {
        pen = false
        continue
      }
      d += `${pen ? 'L' : 'M'}${x(p.year).toFixed(1)} ${y(p.value).toFixed(1)}`
      pen = true
    }
    return d
  }
  const bandPath =
    lowPts.length > 1
      ? `${linePath(highPts)}${[...lowPts]
          .reverse()
          .map((p) => `L${x(p.year).toFixed(1)} ${y(p.value!).toFixed(1)}`)
          .join('')}Z`
      : ''
  // A figure with no published neighbour would vanish in a line - dot it.
  const isolated = actual.filter(
    (p, k) =>
      p.value !== null &&
      (actual[k - 1]?.value ?? null) === null &&
      (actual[k + 1]?.value ?? null) === null,
  )

  const step = [1, 2, 5, 10].find((s) => span / s <= 8) ?? 10
  const yearTicks: number[] = []
  for (let yr = firstYear; yr <= lastYear; yr += step) yearTicks.push(yr)
  const lastTick = yearTicks[yearTicks.length - 1]
  if (lastTick !== lastYear) {
    if (lastYear - lastTick >= step / 2) yearTicks.push(lastYear)
    else yearTicks[yearTicks.length - 1] = lastYear
  }

  // Direct labels: the last published figure above its point, the continued
  // lines beside their ends.
  const endOf = (pts: XY[]) => (pts.length > 1 ? pts[pts.length - 1].value : null)
  const endItems: { text: string; v: number; y: number }[] = []
  const trendEnd = endOf(trendPts)
  const guessEnd = endOf(guessPts)
  const longEnd = endOf(longPts)
  if (trendEnd !== null) endItems.push({ text: `trend ${fmtEur(trendEnd)}`, v: trendEnd, y: y(trendEnd) })
  if (guessEnd !== null) endItems.push({ text: `your guess ${fmtEur(guessEnd)}`, v: guessEnd, y: y(guessEnd) })
  if (longEnd !== null)
    endItems.push({ text: `${longRunName(area)} long run ${fmtEur(longEnd)}`, v: longEnd, y: y(longEnd) })
  const endLabels = stackLabels(endItems)
  const latestX = x(latest.year)
  const latestY = Math.max(12, y(latest.value) - 8)
  const latestNearEnd = latestX > right - 150
  const latestLabel =
    latestNearEnd && endLabels.some((l) => Math.abs(l.y - latestY) < 13)
      ? null
      : `${fmtEur(latest.value)} · ${latest.year}`

  function yearAt(e: PointerEvent<SVGRectElement>): number {
    const r = e.currentTarget.getBoundingClientRect()
    const rel = r.width > 0 ? (e.clientX - r.left) / r.width : 0
    return Math.min(lastYear, Math.max(firstYear, Math.round(rel * span) + firstYear))
  }

  // An arrow, not a declaration: a hoisted function would not see `latest` narrowed.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = active ?? latest.year
    const stride = e.shiftKey ? 1 : span > 20 ? 5 : 1
    let next: number | null = null
    if (e.key === 'ArrowRight') next = Math.min(lastYear, cur + stride)
    else if (e.key === 'ArrowLeft') next = Math.max(firstYear, cur - stride)
    else if (e.key === 'Home') next = firstYear
    else if (e.key === 'End') next = lastYear
    else if (e.key === 'Escape') next = null
    else return
    e.preventDefault()
    setActive(next)
  }

  const at = (pts: XY[], year: number): number | null =>
    pts.find((p) => p.year === year)?.value ?? null
  const activeX = active !== null ? x(active) : 0
  const tipOnRight = activeX < left + plotW * 0.55

  return (
    <>
      <div className="legend chart-legend">
        <span className="legend-item">
          <span className="swatch swatch-line" style={{ background: AREA_COLOR }} />
          {area.name} — €/m² sold
        </span>
        {showCity && (
          <span className="legend-item">
            <span className="swatch swatch-line" style={{ background: REF_COLOR }} />
            Helsinki, all areas
          </span>
        )}
        {trendPct !== null && proj.trend && (
          <span className="legend-item">
            <span className="swatch swatch-line swatch-dash" style={{ borderColor: AREA_COLOR }} />
            continuing the {proj.trend.years}-year trend, {fmtPct(trendPct)}/yr
            {bandPath ? ', with its likely range' : ''}
          </span>
        )}
        {end && (
          <span className="legend-item">
            <span className="swatch swatch-line swatch-dash" style={{ borderColor: GUESS_COLOR }} />
            at your guess, {fmtPct(proj.guessPct)}/yr
          </span>
        )}
        {end && proj.longRunPct !== null && (
          <span className="legend-item">
            <span className="swatch swatch-line swatch-dash" style={{ borderColor: REF_COLOR }} />
            at {longRunName(area)}’s long run since {since}, {fmtPct(proj.longRunPct)}/yr
          </span>
        )}
      </div>
      <div
        ref={ref}
        className="chart"
        style={{ height: HEIGHT }}
        tabIndex={0}
        role="group"
        aria-label={`${area.name}: price per square metre by year, with the trend, your guess and the zone's long run continued to ${lastYear}. Arrow keys step through the years; the table below lists every area.`}
        onKeyDown={onKey}
        onFocus={() => setActive((cur) => cur ?? latest.year)}
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
                  {fmtEur(t)}
                </text>
              ))}
              <text x={0} y={12} textAnchor="start">
                € per m²
              </text>
              {yearTicks.map((yr) => (
                <text key={yr} x={x(yr)} y={BOTTOM + 16} textAnchor="middle">
                  {yr}
                </text>
              ))}
              <text x={left} y={HEIGHT - 4} textAnchor="start">
                {end
                  ? `sold prices to ${latest.year}, continued after`
                  : `sold prices to ${latest.year} — figures stop there, so nothing is continued`}
              </text>
            </g>

            {/* where the data ends and the arithmetic begins */}
            <line x1={latestX} x2={latestX} y1={TOP} y2={BOTTOM} className="chart-divider" />

            {bandPath && <path d={bandPath} fill={AREA_COLOR} className="chart-band" />}
            {showCity && <path d={linePath(cityPts)} className="chart-line reference" />}
            <path d={linePath(actual)} className="chart-line" stroke={AREA_COLOR} />
            {isolated.map((p) => (
              <circle key={p.year} cx={x(p.year)} cy={y(p.value!)} r={3} fill={AREA_COLOR} />
            ))}
            {longPts.length > 1 && <path d={linePath(longPts)} className="chart-line reference dashed" />}
            {trendPts.length > 1 && (
              <path d={linePath(trendPts)} className="chart-line dashed" stroke={AREA_COLOR} />
            )}
            {guessPts.length > 1 && (
              <path d={linePath(guessPts)} className="chart-line dashed" stroke={GUESS_COLOR} />
            )}

            {latestLabel && (
              <text
                x={latestX}
                y={latestY}
                textAnchor={latestNearEnd ? 'end' : 'middle'}
                className="chart-label"
              >
                {latestLabel}
              </text>
            )}
            {endLabels.map((l) => (
              <text key={l.text} x={right - 2} y={l.y} textAnchor="end" className="chart-label">
                {l.text}
              </text>
            ))}

            {active !== null && (
              <g className="chart-crosshair">
                <line x1={activeX} x2={activeX} y1={TOP} y2={BOTTOM} />
                {[
                  { pts: actual, color: AREA_COLOR },
                  { pts: cityPts, color: REF_COLOR },
                  { pts: trendPts, color: AREA_COLOR },
                  { pts: guessPts, color: GUESS_COLOR },
                  { pts: longPts, color: REF_COLOR },
                ].map(({ pts, color }, i) => {
                  const v = at(pts, active)
                  return v === null ? null : (
                    <circle key={i} cx={activeX} cy={y(v)} r={4} fill={color} />
                  )
                })}
              </g>
            )}

            <rect
              x={left}
              y={TOP}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={(e) => setActive(yearAt(e))}
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
            <div className="chart-tip-head">
              {active}
              {active > latest.year ? ` · continued, ${active - latest.year} yrs on` : ''}
            </div>
            {active <= latest.year &&
              (() => {
                const v = at(actual, active)
                const k = area.years.indexOf(active)
                const n = k >= 0 ? area.counts[k] : null
                const c = at(cityPts, active)
                return (
                  <>
                    <TipRow
                      color={AREA_COLOR}
                      value={v === null ? 'not published' : perM2(v)}
                      label={v !== null && n !== null ? `${area.name} · ${fmtNum(n)} sales` : area.name}
                    />
                    {c !== null && <TipRow color={REF_COLOR} value={perM2(c)} label="Helsinki" />}
                  </>
                )
              })()}
            {active > latest.year &&
              (() => {
                const t = at(trendPts, active)
                const g = at(guessPts, active)
                const l = at(longPts, active)
                const lo = at(lowPts, active)
                const hiV = at(highPts, active)
                return (
                  <>
                    {t !== null && (
                      <TipRow
                        color={AREA_COLOR}
                        value={perM2(t)}
                        label={
                          lo !== null && hiV !== null
                            ? `at the trend · likely ${fmtEur(lo)}–${fmtEur(hiV)}`
                            : 'at the trend'
                        }
                      />
                    )}
                    {g !== null && (
                      <TipRow
                        color={GUESS_COLOR}
                        value={perM2(g)}
                        label={`at your guess, ${fmtPct(proj.guessPct)}/yr`}
                      />
                    )}
                    {l !== null && proj.longRunPct !== null && (
                      <TipRow
                        color={REF_COLOR}
                        value={perM2(l)}
                        label={`at ${longRunName(area)}’s long run, ${fmtPct(proj.longRunPct)}/yr`}
                      />
                    )}
                  </>
                )
              })()}
          </div>
        )}
      </div>
    </>
  )
}

/* -------------------------------------------------------------------- tiles */

function Tiles({ o }: { o: Outlook }) {
  const { summary: s, projection: p, vsCity } = o
  if (!s.latest || !p) return null
  const above = (pct: number) => `${fmtNum(Math.round(Math.abs(pct)))} % ${pct > 0 ? 'above' : 'below'}`
  return (
    <div className="stat-row">
      <div className="stat">
        <span className="stat-label">€/m² in {s.latest.year}</span>
        <span className="stat-value">{fmtEur(s.latest.value)}</span>
        <span className="stat-sub">
          {o.latestCount !== null ? `${fmtNum(o.latestCount)} sales` : 'sales not published'}
          {s.points < o.years.length ? ` · ${s.points} of ${o.years.length} years published` : ''}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">{p.trend ? `${p.trend.years}-year trend` : 'Trend'}</span>
        <span className="stat-value">{perYear(p.trend)}</span>
        <span className="stat-sub">
          {p.trend
            ? `${p.trend.fromYear}–${p.trend.toYear}${
                s.growth5 && s.growth5.years !== p.trend.years
                  ? ` · last ${s.growth5.years}: ${perYear(s.growth5)}`
                  : ''
              }${p.stale ? ' · figures stop there' : ''}`
            : 'too few years published'}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">From the peak</span>
        <span className="stat-value">
          {s.fromPeakPct !== null && s.fromPeakPct < -0.05 ? fmtPct(s.fromPeakPct) : 'At the peak'}
        </span>
        <span className="stat-sub">{s.peak ? `${s.peak.year}: ${perM2(s.peak.value)}` : ''}</span>
      </div>
      {p.longRunPct !== null && (
        <div className="stat">
          <span className="stat-label">{longRunName(o)}’s long run</span>
          <span className="stat-value">{fmtPct(p.longRunPct)}/yr</span>
          <span className="stat-sub">
            {o.zone === null ? 'the whole index since 1988' : `zone ${o.zone} · ${ZONE_LABELS[o.zone]} · since 1988`}
          </span>
        </div>
      )}
      {vsCity && o.code !== CITY_CODE && (
        <div className="stat">
          <span className="stat-label">Against Helsinki</span>
          <span className="stat-value">
            {Math.abs(vsCity.nowPct) < 0.5 ? 'At the average' : above(vsCity.nowPct)}
          </span>
          <span className="stat-sub">
            {vsCity.thenPct !== null
              ? `was ${above(vsCity.thenPct)} in ${vsCity.thenYear}`
              : 'same class of home, same year'}
          </span>
        </div>
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- horizons */

/** The selected area continued to each horizon, three ways, side by side. */
function Horizons({ o, horizon, since }: { o: Outlook; horizon: number; since: number }) {
  const p = o.projection
  if (!p || !o.summary.latest) return null
  const startYear = o.summary.latest.year
  return (
    <div className="cmp-scroll">
      <table className="cmp schedule-table">
        <thead>
          <tr>
            <th className="rowhead">Continued to</th>
            <th>At the trend</th>
            <th>Likely range</th>
            <th>At your guess</th>
            <th>At {longRunName(o)}’s long run</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th className="rowhead">
              {startYear}
              <span className="zone-badge">last figure</span>
            </th>
            <td className="num">{perM2(o.summary.latest.value)}</td>
            <td className="num muted">—</td>
            <td className="num">{perM2(o.summary.latest.value)}</td>
            <td className="num">{perM2(o.summary.latest.value)}</td>
          </tr>
          {p.horizons.map((h, i) => (
            <tr key={h.year} className={i === horizon ? 'marked' : undefined}>
              <th className="rowhead">
                {h.year}
                <span className="zone-badge">{i === 0 ? 'purchase' : `+${HORIZON_OFFSETS[i]} yrs`}</span>
              </th>
              <td className="num">{h.atTrend ? perM2(h.atTrend.value) : '—'}</td>
              <td className="num">
                {h.atTrend && h.atTrend.low !== null && h.atTrend.high !== null
                  ? `${fmtEur(h.atTrend.low)}–${fmtEur(h.atTrend.high)}`
                  : '—'}
              </td>
              <td className="num">{perM2(h.atGuess)}</td>
              <td className="num">{h.atLongRun !== null ? perM2(h.atLongRun) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="chart-note">
        {p.stale
          ? `The figures for this area stop at ${startYear}, so nothing is continued from them - a line compounded for decades from a number the market left behind would be a headline, not an estimate. The trend above is still what those years showed.`
          : `The trend is the area’s own ${p.trend ? `${p.trend.years}-year` : ''} figure; the long run is the price index of ${o.zone === null ? 'all Helsinki' : `the whole zone ${o.zone}`} since ${since}. Where the three disagree, the disagreement is the finding.`}
      </p>
    </div>
  )
}

/* --------------------------------------------------------------- candidates */

function Candidates({
  candidates,
  byCode,
  kind,
  yearsFromNow,
  targetYear,
  guess,
  onUse,
}: {
  candidates: { p: PropertyListing; area: AreaRecord }[]
  byCode: Map<string, Outlook>
  kind: SeriesKind
  /** years from today to the purchase - asking prices are today's, not the data's last year */
  yearsFromNow: number
  targetYear: number
  guess: number
  onUse: (pct: number) => void
}) {
  const years = HORIZON_OFFSETS.map((offset) => yearsFromNow + offset)
  return (
    <div className="cmp-scroll">
      <div className="cmp-head">
        <div className="schedule-subtitle">Your places, priced forward</div>
        <div className="cmp-caption">
          from today’s asking price · top figure at the area’s trend, under it at your guess (
          {fmtPct(guess)}/yr)
        </div>
      </div>
      <table className="cmp schedule-table">
        <thead>
          <tr>
            <th className="rowhead">Place</th>
            <th>Asking</th>
            {HORIZON_OFFSETS.map((offset, i) => (
              <th key={offset}>
                {targetYear + offset}
                <span className="cmp-horizon"> {i === 0 ? 'purchase' : `+${offset} yrs`}</span>
              </th>
            ))}
            <th>Area’s trend</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map(({ p, area }) => {
            const o = byCode.get(area.code)
            const projection = o?.projection
            // Only a trend that is actually continued (recent enough) prices a place forward.
            const trend = projection?.horizons[0]?.atTrend ? projection.trend : null
            return (
              <tr key={p.id}>
                <th className="rowhead">
                  {p.name || 'Unnamed place'}
                  <span className="zone-badge">
                    {area.code} {area.name} · z{area.zone}
                  </span>
                </th>
                <td className="num">{fmtEur(p.price)}</td>
                {years.map((n, i) => (
                  <td key={i} className="num">
                    {trend ? fmtEur(project(p.price, trend.pct, n)) : '—'}
                    {projection && !projection.stale && (
                      <>
                        <br />
                        <span className="cell-note">{fmtEur(project(p.price, guess, n))}</span>
                      </>
                    )}
                  </td>
                ))}
                <td className="num">
                  {trend ? (
                    <button className="link-btn" onClick={() => onUse(trend.pct)}>
                      Use {fmtPct(trend.pct)}/yr
                    </button>
                  ) : projection?.stale ? (
                    <span className="cell-note">stops at {o?.summary.latest?.year}</span>
                  ) : (
                    <span className="cell-note">no {kindLabel(kind).toLowerCase()} sales</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* -------------------------------------------------------------------- table */

type SortKey = 'name' | 'latest' | 'sales' | 'g10' | 'g5' | 'peak' | 'trend' | 'guess' | 'long'
interface Sort {
  key: SortKey
  dir: 'asc' | 'desc'
}

interface Column {
  key: SortKey
  label: string
  value: (o: Outlook) => number | null
  cell: (o: Outlook) => string
}

function columns(latestYear: number, horizon: number, horizonYear: number | null): Column[] {
  const h = (o: Outlook) => o.projection?.horizons[horizon] ?? null
  const year = horizonYear ?? ''
  return [
    {
      key: 'latest',
      label: `€/m² · ${latestYear}`,
      value: (o) => o.summary.latest?.value ?? null,
      cell: (o) =>
        o.summary.latest
          ? `${fmtEur(o.summary.latest.value)}${
              o.summary.latest.year !== latestYear ? ` (${o.summary.latest.year})` : ''
            }`
          : '—',
    },
    {
      key: 'sales',
      label: 'Sales',
      value: (o) => o.latestCount,
      cell: (o) => (o.latestCount !== null ? fmtNum(o.latestCount) : '—'),
    },
    {
      key: 'g10',
      label: '10 yrs',
      value: (o) => o.summary.growth10?.pct ?? null,
      cell: (o) => perYear(o.summary.growth10),
    },
    {
      key: 'g5',
      label: '5 yrs',
      value: (o) => o.summary.growth5?.pct ?? null,
      cell: (o) => perYear(o.summary.growth5),
    },
    {
      key: 'peak',
      label: 'From peak',
      value: (o) => o.summary.fromPeakPct,
      cell: (o) =>
        o.summary.fromPeakPct !== null && o.summary.fromPeakPct < -0.05
          ? fmtPct(o.summary.fromPeakPct)
          : 'at peak',
    },
    {
      key: 'trend',
      label: `${year} at trend`,
      value: (o) => h(o)?.atTrend?.value ?? null,
      cell: (o) => {
        const hz = h(o)
        return hz?.atTrend ? fmtEur(hz.atTrend.value) : '—'
      },
    },
    {
      key: 'guess',
      label: `${year} at your guess`,
      value: (o) => h(o)?.atGuess ?? null,
      cell: (o) => {
        const hz = h(o)
        return hz ? fmtEur(hz.atGuess) : '—'
      },
    },
    {
      key: 'long',
      label: `${year} at zone’s long run`,
      value: (o) => h(o)?.atLongRun ?? null,
      cell: (o) => {
        const hz = h(o)
        return hz?.atLongRun !== null && hz?.atLongRun !== undefined ? fmtEur(hz.atLongRun) : '—'
      },
    },
  ]
}

function sortRows(rows: Outlook[], sort: Sort, cols: Column[]): Outlook[] {
  const dir = sort.dir === 'asc' ? 1 : -1
  const col = cols.find((c) => c.key === sort.key)
  return [...rows].sort((a, b) => {
    if (!col) return dir * a.code.localeCompare(b.code)
    const va = col.value(a)
    const vb = col.value(b)
    if (va === null && vb === null) return a.code.localeCompare(b.code)
    if (va === null) return 1
    if (vb === null) return -1
    return dir * (va - vb) || a.code.localeCompare(b.code)
  })
}

function AreaTable({
  rows,
  kind,
  latestYear,
  horizon,
  sort,
  onSort,
  selected,
  onSelect,
  candidateCodes,
}: {
  rows: Outlook[]
  kind: SeriesKind
  latestYear: number
  horizon: number
  sort: Sort
  onSort: (s: Sort) => void
  selected: string
  onSelect: (code: string) => void
  candidateCodes: Set<string>
}) {
  // Horizon years are the same for every area whose figures run to the data's
  // last year; a stale area's are earlier, and its cells say so with a dash.
  const horizonYear = rows.find((r) => r.projection && !r.projection.stale)?.projection?.horizons[horizon]?.year ?? null
  const cols = columns(latestYear, horizon, horizonYear)
  const sorted = sortRows(rows, sort, cols)
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '')
  const toggle = (key: SortKey) =>
    onSort(
      sort.key === key
        ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    )
  const ariaSort = (key: SortKey) =>
    sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined

  return (
    <div>
      <div className="cmp-head">
        <div className="schedule-subtitle">Every area, {kindLabel(kind).toLowerCase()}</div>
        <div className="cmp-caption">
          {rows.length} areas with published sales · sort by a column, pick an area to chart it
          {candidateCodes.size > 0 ? ' · your places marked' : ''}
        </div>
      </div>
      <div className="cmp-scroll area-table-scroll">
        <table className="cmp area-table">
          <thead>
            <tr>
              <th className="rowhead" aria-sort={ariaSort('name')}>
                <button className="sort-btn" onClick={() => toggle('name')}>
                  Area{arrow('name')}
                </button>
              </th>
              {cols.map((c) => (
                <th key={c.key} aria-sort={ariaSort(c.key)}>
                  <button className="sort-btn" onClick={() => toggle(c.key)}>
                    {c.label}
                    {arrow(c.key)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => (
              <tr
                key={o.code}
                className={`${candidateCodes.has(o.code) ? 'marked' : ''}${
                  o.code === selected ? ' selected' : ''
                }`}
              >
                <th className="rowhead">
                  <button
                    className="row-pick"
                    onClick={() => onSelect(o.code)}
                    aria-pressed={o.code === selected}
                  >
                    {o.code} {o.name}
                  </button>
                  <span className="zone-badge">z{o.zone}</span>
                </th>
                {cols.map((c) => (
                  <td key={c.key} className="num">
                    {c.cell(o)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- long run */

const ZONE_ROWS: { key: IndexKey; label: string }[] = [
  { key: 'helsinki', label: 'Helsinki' },
  { key: 'zone1', label: `Zone 1 · ${ZONE_LABELS[1]}` },
  { key: 'zone2', label: `Zone 2 · ${ZONE_LABELS[2]}` },
  { key: 'zone3', label: `Zone 3 · ${ZONE_LABELS[3]}` },
  { key: 'zone4', label: `Zone 4 · ${ZONE_LABELS[4]}` },
]

function LongRun({ data }: { data: PriceData }) {
  const idx = data.index
  const first = idx.years[0]
  const hel = indexStats(idx.years, idx.series.helsinki.nominal)
  const helReal = indexStats(idx.years, idx.series.helsinki.real)
  const { latest } = data
  return (
    <>
      <div className="cmp-head">
        <div className="schedule-subtitle">The long run: Helsinki since {first}</div>
        <div className="cmp-caption">
          the price index, all old dwellings — the range a projection from 2009 has never seen
        </div>
      </div>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Since {first}</span>
          <span className="stat-value">{perYear(hel.sinceStart)}</span>
          <span className="stat-sub">{perYear(helReal.sinceStart)} after inflation</span>
        </div>
        <div className="stat">
          <span className="stat-label">Worst fall</span>
          <span className="stat-value">{hel.worst ? fmtPct(hel.worst.pct) : '—'}</span>
          <span className="stat-sub">
            {hel.worst ? `${hel.worst.fromYear}–${hel.worst.toYear}` : ''}
            {helReal.worst ? ` · ${fmtPct(helReal.worst.pct)} in real terms` : ''}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">From the {hel.peak?.year} peak</span>
          <span className="stat-value">
            {hel.fromPeakPct !== null ? fmtPct(hel.fromPeakPct) : '—'}
          </span>
          <span className="stat-sub">
            {helReal.fromPeakPct !== null && helReal.peak
              ? `${fmtPct(helReal.fromPeakPct)} in real terms since ${helReal.peak.year}`
              : ''}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Down years</span>
          <span className="stat-value">
            {hel.downYears} of {idx.years.length - 1}
          </span>
          <span className="stat-sub">years that ended below the year before</span>
        </div>
        <div className="stat">
          <span className="stat-label">Latest quarter · {latest.quarter}</span>
          <span className="stat-value">
            {latest.yearChangePct !== null ? fmtPct(latest.yearChangePct) : '—'}
          </span>
          <span className="stat-sub">
            on a year earlier
            {latest.realYearChangePct !== null ? ` · ${fmtPct(latest.realYearChangePct)} real` : ''}
            {latest.preliminary ? ' · preliminary' : ''}
          </span>
        </div>
      </div>
      <div className="cmp-scroll">
        <table className="cmp schedule-table">
          <thead>
            <tr>
              <th className="rowhead">Price zone</th>
              <th>Since {first} /yr</th>
              <th>Real /yr</th>
              <th>Since 2015 /yr</th>
              <th>From peak</th>
              <th>Worst fall</th>
            </tr>
          </thead>
          <tbody>
            {ZONE_ROWS.map(({ key, label }) => {
              const n = indexStats(idx.years, idx.series[key].nominal)
              const r = indexStats(idx.years, idx.series[key].real)
              return (
                <tr key={key} className={key === 'helsinki' ? 'marked' : undefined}>
                  <th className="rowhead">{label}</th>
                  <td className="num">{perYear(n.sinceStart)}</td>
                  <td className="num">{perYear(r.sinceStart)}</td>
                  <td className="num">{perYear(n.since2015)}</td>
                  <td className="num">
                    {n.fromPeakPct !== null && n.fromPeakPct < -0.05
                      ? `${fmtPct(n.fromPeakPct)} (${n.peak?.year})`
                      : 'at peak'}
                  </td>
                  <td className="num">
                    {n.worst ? `${fmtPct(n.worst.pct)} (${n.worst.fromYear}–${n.worst.toYear})` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
