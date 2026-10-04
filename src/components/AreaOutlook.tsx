import { useCallback, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  HORIZON_OFFSETS,
  HOUSE_TYPES,
  areaSeries,
  band,
  citySeries,
  coverage,
  findPlace,
  indexFrom,
  indexStats,
  kindLabel,
  kindShort,
  longRunRate,
  outlook,
  project,
  readTrend,
  resolveProjectionYear,
  seriesKindFor,
  zoneLabel,
  type AreaOutlook as Outlook,
  type AreaRecord,
  type Growth,
  type IndexSeries,
  type Place,
  type PriceData,
  type SeriesKind,
  type TrendRead,
} from '../areas'
import { AREA_PRICES } from '../data/areaPrices'
import type { HousingSituation, PropertyListing } from '../housing'
import { fmtEur, fmtNum, fmtPct } from '../format'
import { niceTicks } from './chartHelpers'
import { Fold, FoldCard } from './Fold'
import { NumberField } from './NumberField'
import { TipRow } from './TwoLineChart'
import { useWidth } from './useWidth'

/**
 * Prices by area: what homes have sold for per square metre in each
 * postal-code area of Helsinki, Espoo and Vantaa, and what continuing the
 * trend implies - at the purchase, and ten and twenty years after it.
 *
 * The rent-or-buy card takes the home's growth as one typed guess; this card
 * is where such a guess can come from. It reads one city at a time - the
 * first candidate's, else Helsinki - since every figure in it (the city line,
 * the zones, the long run) is that city's. It leads with one area (a
 * candidate's, when a place carries a postal code) drawn against the city, continues its
 * trend as a dashed line with a band for how much the area has swung, and
 * puts two more lines beside it: the reader's own guess, and the long-run
 * rate of the area's whole price zone since 1988 - the steadier yardstick
 * once the horizon is decades, when a ten-year window in one postal code is
 * a thin base to compound from. Lines that disagree are the point. Under it,
 * every area in one sortable table with the candidates marked; then the long
 * run itself, because a series that starts in 2009 has never seen the 1990s.
 *
 * The area wears the ownership blue (slot 1); the reader's guess the teal
 * (slot 3) the renting line already uses against it. The city as a whole and
 * the zone's long run are references, so they are drawn in the muted ink the
 * axes use - solid for what happened, dashed for what is continued.
 */

const AREA_COLOR = 'var(--series-1)'
const GUESS_COLOR = 'var(--series-3)'
const REF_COLOR = 'var(--ink-3)'
const CITY_CODE = 'city'
const citySubject = (data: PriceData) => ({ code: CITY_CODE, name: `${data.name}, all areas`, zone: null })

const perYear = (g: Growth | null): string => (g ? `${fmtPct(g.pct)}/yr` : '—')
const perM2 = (v: number): string => `${fmtEur(v)}/m²`
const horizonLabel = (i: number): string =>
  i === 0 ? 'At purchase' : `+${HORIZON_OFFSETS[i]} years`
/** the zone's name for the long-run line: "zone 3" for an area, "Espoo-Kauniainen" for the city */
const longRunName = (o: Outlook, data: PriceData): string => (o.zone === null ? data.indexName : `zone ${o.zone}`)

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

/** A city as a whole, for one kind of home. */
function cityOutlook(data: PriceData, kind: SeriesKind, targetYear: number, guess: number): Outlook {
  const s = citySeries(data, kind)
  const longRun = longRunRate(data.index, data.index.city)
  return outlook(citySubject(data), data.years, s, s.values, null, targetYear, guess, longRun)
}

/** One area for one kind of home, against its own city's outlook for the same kind. */
function areaOutlook(
  data: PriceData,
  area: AreaRecord,
  kind: SeriesKind,
  city: Outlook,
  targetYear: number,
  guess: number,
): Outlook {
  return outlook(
    { code: area.code, name: area.name, zone: area.zone },
    data.years,
    areaSeries(area, kind),
    city.values,
    city.summary.volatilityPct,
    targetYear,
    guess,
    longRunRate(data.index, data.index.zones[area.zone]),
  )
}

/** A candidate: one of the reader's places, and the city and area its postal code puts it in. */
type Candidate = Place & { p: PropertyListing }

export function AreaOutlook({ situation, properties, onChange }: Props) {
  const cities = AREA_PRICES
  // The cities share their years: one fetch, one set of tables.
  const latestYear = cities[0].years[cities[0].years.length - 1]
  const targetYear = resolveProjectionYear(situation.projectionYear, latestYear)
  const guess = situation.homeValueGrowthPct
  const set = (patch: Partial<HousingSituation>) => onChange({ ...situation, ...patch })

  // The places that carry a postal code the data knows, in whichever city.
  const candidates = useMemo<Candidate[]>(
    () =>
      properties.flatMap((p) => {
        const place = findPlace(cities, p.postalCode)
        return place ? [{ p, ...place }] : []
      }),
    [properties, cities],
  )
  // The card opens on the first place's city, the chips on what that place
  // says it is, else on what its area mostly trades - a card that opens on
  // studios for a terraced house is a card that opens wrong.
  const [cityKey, setCityKey] = useState<string>(() => candidates[0]?.data.key ?? cities[0].key)
  const data = cities.find((c) => c.key === cityKey) ?? cities[0]
  const [kind, setKind] = useState<SeriesKind>(() => {
    const first = candidates[0]
    const own = first?.p.homeType ? seriesKindFor(first.p.homeType, first.p.rooms) : null
    return own ?? busiestKind(first?.area)
  })
  const [selected, setSelected] = useState<string>(() => candidates[0]?.area.code ?? CITY_CODE)
  const [horizon, setHorizon] = useState(0)
  const [sort, setSort] = useState<Sort>({ key: 'name', dir: 'asc' })

  // Another city opens on a place of yours there, if there is one, read as
  // what it says it is - the same rule the card opens by; else on the city
  // as a whole, since an area picked in the last city is not in this one.
  function pickCity(key: string) {
    const mine = candidates.find((c) => c.data.key === key)
    setCityKey(key)
    setSelected(mine?.area.code ?? CITY_CODE)
    const own = mine?.p.homeType ? seriesKindFor(mine.p.homeType, mine.p.rooms) : null
    if (own) setKind(own)
  }

  const since = data.index.years[0]
  const city = useMemo(() => cityOutlook(data, kind, targetYear, guess), [data, kind, targetYear, guess])

  const rows = useMemo(
    () =>
      data.areas
        .map((a) => areaOutlook(data, a, kind, city, targetYear, guess))
        .filter((o) => o.summary.latest !== null),
    [data, kind, city, targetYear, guess],
  )
  const byCode = useMemo(() => new Map(rows.map((r) => [r.code, r])), [rows])

  // One place at one kind, on demand, against its own city: a place that has
  // said what it is is priced at its own kind's trend, which need not be the
  // kind the chips are on, and a place in Vantaa is read against Vantaa
  // whichever city the card is showing.
  const outlookFor = useCallback(
    (place: Place, k: SeriesKind): Outlook => {
      const c = place.data === data && k === kind ? city : cityOutlook(place.data, k, targetYear, guess)
      return areaOutlook(place.data, place.area, k, c, targetYear, guess)
    },
    [data, kind, city, targetYear, guess],
  )
  const pickedArea =
    selected === CITY_CODE ? null : (data.areas.find((a) => a.code === selected) ?? null)
  const picked = pickedArea ? byCode.get(pickedArea.code) : undefined
  const current = picked ?? city
  const candidateCodes = useMemo(() => new Set(candidates.map((c) => c.area.code)), [candidates])
  const yearsFromNow = Math.max(0, targetYear - new Date().getFullYear())
  // The chips come from the city, which always has figures to the last year -
  // a stale area has no horizons of its own and shows its history alone.
  const horizons = city.projection?.horizons ?? []

  // Why the selected area's trend reads as it does - only for an area, since
  // the checks measure it against the city and its zone.
  const read = useMemo<TrendRead | null>(() => {
    if (!picked || picked.zone === null) return null
    const zone = data.index.zones[picked.zone]
    return readTrend(
      data.years,
      picked.values,
      picked.counts,
      city.values,
      zone ? { years: data.index.years, values: zone.nominal } : null,
    )
  }, [picked, city, data])

  // Folded, the card says where it is and what that area has done.
  const shown = current.summary.latest
  const trend = current.projection?.trend ?? null
  const longRunPct = current.projection?.longRunPct ?? null
  const summary = [
    `${current === city ? data.name : `${current.code} ${current.name}`}, ${kindLabel(kind).toLowerCase()}`,
    shown ? `${perM2(shown.value)} in ${shown.year}` : '',
    trend ? `trend ${perYear(trend)}` : '',
    longRunPct !== null ? `${longRunName(current, data)}’s long run ${fmtPct(longRunPct)}/yr` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  // The zones whose index starts too late for a long run, for the note at the end.
  const lateZones = cities.flatMap((c) =>
    c.zones.flatMap((z) => {
      const from = indexFrom(c.index, c.index.zones[z])
      return from !== null && from > c.index.years[0] ? [`${c.name} ${z}, from ${from}`] : []
    }),
  )

  return (
    <FoldCard
      id="housing.area"
      title="Prices by area"
      caption={`what homes have sold for per square metre in ${coverage(cities)}, and what continuing the trend implies`}
      summary={summary}
    >
      {cities.length > 1 && (
        <div className="schedule-subjects" role="tablist" aria-label="Which city">
          {cities.map((c) => {
            const mine = candidates.filter((x) => x.data === c).length
            return (
              <button
                key={c.key}
                role="tab"
                aria-selected={c === data}
                className={`filter-chip${c === data ? ' active' : ''}`}
                onClick={() => pickCity(c.key)}
              >
                {c.name}
                {mine > 0 && <span className="chip-note">{mine === 1 ? '1 place' : `${mine} places`}</span>}
              </button>
            )
          })}
        </div>
      )}

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
              <option value={CITY_CODE}>{citySubject(data).name}</option>
              {data.zones.map((z) => (
                <optgroup key={z} label={`Zone ${z} · ${zoneLabel(data, z)}`}>
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
          changed hands. Showing {data.name} as a whole; try another type above.
        </p>
      )}

      <AreaChart
        data={data}
        area={current}
        city={city}
        showCity={current !== city}
        horizon={horizon}
        since={since}
      />
      <Tiles o={current} data={data} since={since} />
      <Horizons o={current} data={data} horizon={horizon} since={since} />
      {read && picked && (
        <Reading
          o={picked}
          read={read}
          kind={kind}
          cityName={data.name}
          longRunPct={picked.projection?.longRunPct ?? null}
        />
      )}

      {candidates.length > 0 && (
        <Candidates
          candidates={candidates}
          outlookFor={outlookFor}
          kind={kind}
          yearsFromNow={yearsFromNow}
          targetYear={targetYear}
          guess={guess}
          onUse={(pct) => set({ homeValueGrowthPct: Math.round(pct * 10) / 10 })}
        />
      )}
      {properties.some((p) => !findPlace(cities, p.postalCode)) && (
        <p className="chart-note">
          Give a place its postal code (Edit → Postal code) and it is marked in the table below
          and priced forward at its own area’s trend.
        </p>
      )}

      <AreaTable
        rows={rows}
        cityName={data.name}
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

      <Fold
        id="housing.area.about"
        title="About these figures"
        caption="where they come from, and what they cannot say"
      >
        <p className="chart-note">
          Averages of realised sales of old flats and terraced houses per postal-code area of{' '}
          {coverage(cities)}, from Statistics Finland ({data.source.split(',')[0]}, tables{' '}
          {data.tables.join(', ')}; yearly figures to {latestYear}, updated {data.updated}). Each
          area is read against its own city, and the price zones are Statistics Finland’s own
          division of each city by price level and location.
          {cities
            .filter((c) => c.municipalities.length > 1)
            .map(
              (c) =>
                ` ${c.municipalities.filter((m) => m !== c.name).join(' and ')} goes with ${c.name}, as in Statistics Finland’s index; the city line beside it is ${c.name}’s alone.`,
            )}{' '}
          The trend
          continues the last ten years’ average yearly change; the likely range is one standard
          deviation of the area’s own yearly moves (the city’s where the area has too few years),
          widening with the square root of the years — roughly two years in three, if the future is
          as unruly as the past. The zone’s long run is the average yearly change of Statistics
          Finland’s price index for the area’s whole price zone since {since}: over ten and twenty
          years it is the steadier yardstick, and the gap between it and the area’s trend is worth
          more thought than either figure.
          {lateZones.length > 0 &&
            ` A zone whose index starts later (${lateZones.join('; ')}) has no long run: its few years are not that kind of figure.`}{' '}
          None of it
          is a forecast: a €/m² average mixes buildings, floors and renovations, a small area swings
          on a handful of sales, and the 2022–2025 fall sits inside every ten-year figure here. All
          figures are nominal — “The long run” above shows what inflation did to them.
        </p>
      </Fold>
    </FoldCard>
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
  data,
  area,
  city,
  showCity,
  horizon,
  since,
}: {
  data: PriceData
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
    endItems.push({ text: `${longRunName(area, data)} long run ${fmtEur(longEnd)}`, v: longEnd, y: y(longEnd) })
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
            {city.name}
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
            at {longRunName(area, data)}’s long run since {since}, {fmtPct(proj.longRunPct)}/yr
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
                    {c !== null && <TipRow color={REF_COLOR} value={perM2(c)} label={data.name} />}
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
                        label={`at ${longRunName(area, data)}’s long run, ${fmtPct(proj.longRunPct)}/yr`}
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

function Tiles({ o, data, since }: { o: Outlook; data: PriceData; since: number }) {
  const { summary: s, projection: p, vsCity } = o
  if (!s.latest || !p) return null
  const above = (pct: number) => `${fmtNum(Math.round(Math.abs(pct)))} % ${pct > 0 ? 'above' : 'below'}`
  // A zone whose index starts too late for a long run still has a few years
  // to show - said with their dates, and not called a long run.
  const zoneIndex = o.zone !== null && p.longRunPct === null ? data.index.zones[o.zone] : undefined
  const shortRun = zoneIndex ? indexStats(data.index.years, zoneIndex.nominal).sinceStart : null
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
          <span className="stat-label">{longRunName(o, data)}’s long run</span>
          <span className="stat-value">{fmtPct(p.longRunPct)}/yr</span>
          <span className="stat-sub">
            {o.zone === null
              ? `the whole index since ${since}`
              : `zone ${o.zone} · ${zoneLabel(data, o.zone)} · since ${since}`}
          </span>
        </div>
      )}
      {o.zone !== null && shortRun && (
        <div className="stat">
          <span className="stat-label">Zone {o.zone}’s index</span>
          <span className="stat-value">{perYear(shortRun)}</span>
          <span className="stat-sub">
            {shortRun.fromYear}–{shortRun.toYear} only · too short for a long run
          </span>
        </div>
      )}
      {vsCity && o.code !== CITY_CODE && (
        <div className="stat">
          <span className="stat-label">Against {data.name}</span>
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
function Horizons({
  o,
  data,
  horizon,
  since,
}: {
  o: Outlook
  data: PriceData
  horizon: number
  since: number
}) {
  const p = o.projection
  if (!p || !o.summary.latest) return null
  const startYear = o.summary.latest.year
  const zoneFrom = o.zone !== null ? indexFrom(data.index, data.index.zones[o.zone]) : null
  const trendText = `The trend is the area’s own ${p.trend ? `${p.trend.years}-year` : ''} figure`
  return (
    <div className="cmp-scroll">
      <table className="cmp schedule-table">
        <thead>
          <tr>
            <th className="rowhead">Continued to</th>
            <th>At the trend</th>
            <th>Likely range</th>
            <th>At your guess</th>
            <th>At {longRunName(o, data)}’s long run</th>
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
            <td className={`num${p.longRunPct === null ? ' muted' : ''}`}>
              {p.longRunPct === null ? '—' : perM2(o.summary.latest.value)}
            </td>
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
          : p.longRunPct === null && o.zone !== null
            ? `${trendText}. ${data.name} zone ${o.zone} has no long run: Statistics Finland’s index for it starts only in ${zoneFrom ?? 'recent years'}, and a decade that holds the 2022–2025 fall is not a rate to compound for twenty years. “The long run” below shows what it has done since.`
            : `${trendText}; the long run is the price index of ${o.zone === null ? `all ${data.indexName}` : `the whole zone ${o.zone}`} since ${since}. Where the three disagree, the disagreement is the finding.`}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ reading */

/** "18 sales a year" / "1 sale a year" */
const salesAYear = (n: number) => `${fmtNum(n)} ${n === 1 ? 'sale' : 'sales'} a year`
/** "2,1 points a year" / "1 point a year" - the difference between two rates */
const pp = (v: number) => {
  const r = Math.round(Math.abs(v) * 10) / 10
  return `${fmtNum(r)} ${r === 1 ? 'point' : 'points'} a year`
}
/** "2023 (+16,4 % against Helsinki’s −5,1 %)" */
const divergenceText = (cityName: string) => (d: { year: number; areaPct: number; cityPct: number }) =>
  `${d.year} (${fmtPct(d.areaPct)} against ${cityName}’s ${fmtPct(d.cityPct)})`

/**
 * Why the area's trend reads the way it does, in the order a careful reader
 * would check: is the figure an artefact of the window, of a thin sample, of
 * one or two odd years; how does it sit against the city and its own zone;
 * and what has it given back since its peak. Then a verdict on how much of
 * it to believe.
 */
function Reading({
  o,
  read,
  kind,
  cityName,
  longRunPct,
}: {
  o: Outlook
  read: TrendRead
  kind: SeriesKind
  cityName: string
  longRunPct: number | null
}) {
  const { trend, windows, sample, city, excessPct, divergences, divergenceShare, fromPeak, zone, zoneExcessPct } = read
  const aligned = divergences.filter((d) => d.aligned)
  const against = divergences.filter((d) => !d.aligned)
  const concentrated = aligned.length > 0 && (divergenceShare ?? 0) >= 0.5
  const flagged = windows.fragile || (sample?.thin ?? false) || concentrated
  const zoneName = `zone ${o.zone}`
  const yearText = divergenceText(cityName)

  return (
    <div className="reading">
      <div className="cmp-head">
        <div className="schedule-subtitle">Reading the trend</div>
        <div className="cmp-caption">
          how much of {o.name}’s {trend.years}-year figure to believe, and why
        </div>
      </div>
      <ul className="reading-list">
        <li className={windows.fragile ? 'flag' : undefined}>
          <b>The window.</b> {trend.fromYear}–{trend.toYear}: {fmtPct(trend.pct)}/yr. Start or end a
          year earlier or later and it reads {fmtPct(windows.low)} to {fmtPct(windows.high)}/yr —{' '}
          {windows.fragile
            ? 'fragile: the figure depends on the year you start from.'
            : 'steady whichever year you start from.'}
        </li>
        {sample && (
          <li className={sample.thin ? 'flag' : undefined}>
            <b>The sample.</b> {salesAYear(sample.median)} in the window, as few as {fmtNum(sample.min)} —{' '}
            {sample.thin
              ? 'thin: a handful of homes decides each year’s figure.'
              : 'a solid base for a yearly average.'}
          </li>
        )}
        {city && excessPct !== null && (
          <li className={concentrated ? 'flag' : undefined}>
            <b>Against {cityName}.</b> {kindLabel(kind)} across the city over the same years:{' '}
            {fmtPct(city.pct)}/yr, so this area ran {excessPct >= 0 ? 'ahead' : 'behind'} by {pp(excessPct)}.{' '}
            {divergences.length === 0
              ? 'The gap built a little each year, with no single year out of step.'
              : concentrated
                ? `${fmtNum(Math.round(divergenceShare! * 100))} % of that gap came in ${
                    aligned.length === 1 ? 'one year' : 'two years'
                  } when the area moved against the city: ${aligned.map(yearText).join(' and ')}.${
                    against.length ? ` ${against.map((d) => `${d.year} cut the other way (${fmtPct(d.areaPct)} against ${fmtPct(d.cityPct)})`).join('; ')}.` : ''
                  }`
                : `The years out of step — ${divergences.map(yearText).join(' and ')} — ${
                    aligned.length === 0 ? 'cut against the gap' : 'explain little of it'
                  }; it built in the years between.`}
          </li>
        )}
        {zone && zoneExcessPct !== null && (
          <li>
            <b>Against its zone.</b> {zoneName}’s price index over the same years: {fmtPct(zone.pct)}/yr —{' '}
            {Math.abs(zoneExcessPct) < 1
              ? 'the area moved with its zone.'
              : `the area ${zoneExcessPct > 0 ? 'outran' : 'lagged'} its own zone by ${pp(zoneExcessPct)}, so this is a story about the area, not the zone.`}
          </li>
        )}
        {fromPeak.area !== null && fromPeak.areaPeakYear !== null && (
          <li>
            <b>Since the peak.</b>{' '}
            {fromPeak.area < -0.05
              ? `${fmtPct(fromPeak.area)} since ${fromPeak.areaPeakYear}`
              : `at its peak in ${fromPeak.areaPeakYear}`}
            {fromPeak.city !== null && fromPeak.cityPeakYear !== null
              ? `; ${cityName} ${fromPeak.city < -0.05 ? `${fmtPct(fromPeak.city)} since ${fromPeak.cityPeakYear}` : 'at its peak'}${
                  fromPeak.area < -0.05 && fromPeak.city < -0.05
                    ? fromPeak.area < fromPeak.city - 2
                      ? ' — the area has given back more than the city.'
                      : fromPeak.area > fromPeak.city + 2
                        ? ' — the area has held up better than the city.'
                        : ' — about in step.'
                    : '.'
                }`
              : '.'}
          </li>
        )}
      </ul>
      <p className="reading-verdict">
        {concentrated
          ? 'A gap that arrives in one or two years, while the rest of the time the area keeps the city’s pace, is the signature of a change in what sold — newer or renovated homes reaching the resale market, a different corner of the area trading — rather than of the same homes gaining value. The data cannot say which; a trend line assumes the latter. '
          : flagged
            ? `Read it as ${fmtPct(windows.low)} to ${fmtPct(windows.high)}/yr at best${
                sample?.thin ? `: with ${salesAYear(sample.median)}, the yearly figures wobble more than the homes do` : ''
              }. `
            : `Steady across windows${sample && !sample.thin ? ', on a solid sample' : ''}, built a little each year: as good as a postal-code trend gets. It still contains the 2022–2025 fall, and should not be pushed past the zone’s long run without a reason of its own. `}
        {flagged &&
          (longRunPct !== null
            ? `For the years ahead, lean on ${zoneName}’s long run (${fmtPct(longRunPct)}/yr) and treat the area’s own trend as a range of what it might be, not a rate.`
            : 'For the years ahead, treat the area’s own trend as a range of what it might be, not a rate.')}
      </p>
    </div>
  )
}

/* --------------------------------------------------------------- candidates */

function Candidates({
  candidates,
  outlookFor,
  kind,
  yearsFromNow,
  targetYear,
  guess,
  onUse,
}: {
  candidates: Candidate[]
  outlookFor: (place: Place, kind: SeriesKind) => Outlook
  /** the chips' kind - what a place that has not said what it is is priced at */
  kind: SeriesKind
  /** years from today to the purchase - asking prices are today's, not the data's last year */
  yearsFromNow: number
  targetYear: number
  guess: number
  onUse: (pct: number) => void
}) {
  const years = HORIZON_OFFSETS.map((offset) => yearsFromNow + offset)
  const anySaid = candidates.some(({ p }) => p.homeType)
  return (
    <div className="cmp-scroll">
      <div className="cmp-head">
        <div className="schedule-subtitle">Your places, priced forward</div>
        <div className="cmp-caption">
          from today’s asking price · top figure at the area’s trend
          {anySaid ? ' for what the place says it is' : ''}, under it at your guess (
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
          {candidates.map(({ p, data, area }) => {
            // Its own kind when it has said; the chips' when not; none for a
            // detached house, which these statistics do not cover.
            const k: SeriesKind | null = p.homeType ? seriesKindFor(p.homeType, p.rooms) : kind
            const o = k === null ? null : outlookFor({ data, area }, k)
            const projection = o?.projection
            // Only a trend that is actually continued (recent enough) prices a place forward.
            const trend = projection?.horizons[0]?.atTrend ? projection.trend : null
            return (
              <tr key={p.id}>
                <th className="rowhead">
                  {p.name || 'Unnamed place'}
                  <span className="zone-badge">
                    {area.code} {area.name} · {data.name} z{area.zone}
                    {p.homeType ? ` · ${k === null ? 'detached' : kindShort(k)}` : ''}
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
                  ) : k === null ? (
                    <span className="cell-note">not in the data</span>
                  ) : projection?.stale ? (
                    <span className="cell-note">stops at {o?.summary.latest?.year}</span>
                  ) : (
                    <span className="cell-note">no {kindLabel(k).toLowerCase()} sales</span>
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
  cityName,
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
  cityName: string
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

  // Folded until asked for: eighty rows are a reference, and the picker above
  // reaches every area without them.
  return (
    <Fold
      id="housing.area.every"
      title={`Every area in ${cityName}, ${kindLabel(kind).toLowerCase()}`}
      caption={`${rows.length} areas with published sales · sort by a column, pick an area to chart it${
        candidateCodes.size > 0 ? ' · your places marked' : ''
      }`}
    >
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
    </Fold>
  )
}

/* ----------------------------------------------------------------- long run */

function LongRun({ data }: { data: PriceData }) {
  const idx = data.index
  const first = idx.years[0]
  const whole = indexStats(idx.years, idx.city.nominal)
  const wholeReal = indexStats(idx.years, idx.city.real)
  const { latest } = data
  // The city, then its zones. A zone whose index starts late gets its own
  // figures, from its own first year - but no "since 1988", which it is not.
  const rows: { key: string; label: string; series: IndexSeries }[] = [
    { key: 'city', label: data.indexName, series: idx.city },
    ...data.zones.flatMap((z) => {
      const series = idx.zones[z]
      if (!series) return []
      const from = indexFrom(idx, series)
      const late = from !== null && from > first ? ` · from ${from}` : ''
      return [{ key: `zone${z}`, label: `Zone ${z} · ${zoneLabel(data, z)}${late}`, series }]
    }),
  ]
  const sinceFirst = (g: Growth | null) => (g && g.fromYear === first ? perYear(g) : '—')
  return (
    <Fold
      id="housing.area.longRun"
      title={`The long run: ${data.indexName} since ${first}`}
      caption="the price index, all old dwellings — the range a projection from 2009 has never seen"
    >
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Since {first}</span>
          <span className="stat-value">{perYear(whole.sinceStart)}</span>
          <span className="stat-sub">{perYear(wholeReal.sinceStart)} after inflation</span>
        </div>
        <div className="stat">
          <span className="stat-label">Worst fall</span>
          <span className="stat-value">{whole.worst ? fmtPct(whole.worst.pct) : '—'}</span>
          <span className="stat-sub">
            {whole.worst ? `${whole.worst.fromYear}–${whole.worst.toYear}` : ''}
            {wholeReal.worst ? ` · ${fmtPct(wholeReal.worst.pct)} in real terms` : ''}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">From the {whole.peak?.year} peak</span>
          <span className="stat-value">
            {whole.fromPeakPct !== null ? fmtPct(whole.fromPeakPct) : '—'}
          </span>
          <span className="stat-sub">
            {wholeReal.fromPeakPct !== null && wholeReal.peak
              ? `${fmtPct(wholeReal.fromPeakPct)} in real terms since ${wholeReal.peak.year}`
              : ''}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Down years</span>
          <span className="stat-value">
            {whole.downYears} of {idx.years.length - 1}
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
            {rows.map(({ key, label, series }) => {
              const n = indexStats(idx.years, series.nominal)
              const r = indexStats(idx.years, series.real)
              return (
                <tr key={key} className={key === 'city' ? 'marked' : undefined}>
                  <th className="rowhead">{label}</th>
                  <td className="num">{sinceFirst(n.sinceStart)}</td>
                  <td className="num">{sinceFirst(r.sinceStart)}</td>
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
    </Fold>
  )
}
