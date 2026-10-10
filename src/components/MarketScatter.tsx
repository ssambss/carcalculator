import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { type PriceCheck, predict } from '../market'
import { fmtEur, fmtNum } from '../format'
import { TipRow } from './TwoLineChart'
import { useWidth } from './useWidth'

const HEIGHT = 210
const TOP = 22
const BOTTOM = HEIGHT - 30
/** The pointer finds the nearest listing within this - nobody lands on a dot dead-centre. */
const REACH = 24

/** Clean ticks spanning lo..hi in four or five steps - not from zero: prices are a band, not bars. */
function rangeTicks(lo: number, hi: number): number[] {
  const range = Math.max(hi - lo, 1)
  const mag = Math.pow(10, Math.floor(Math.log10(range / 4)))
  let step = mag
  for (const f of [1, 2, 2.5, 5, 10]) {
    step = f * mag
    if (range / step <= 5) break
  }
  const ticks: number[] = []
  for (let t = Math.floor(lo / step) * step; t <= Math.ceil(hi / step) * step + 1e-9; t += step) {
    ticks.push(Math.round(t))
  }
  return ticks
}

const kmLabel = (km: number) => (km === 0 ? '0' : `${fmtNum(km / 1000)}k`)
const fmtDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return `${d}.${m}.${y}`
}

/**
 * Every similar listing, price against mileage, with this car among them.
 *
 * Prices are adjusted to this car's age - by the same per-year rate the check
 * found - so a 2021 and a 2024 sit on one scale and the line through them is
 * the typical price by mileage for a car this old. The band is the middle half.
 * Ink tones only: the series colours belong to the cost categories.
 */
export function MarketScatter({ check }: { check: PriceCheck }) {
  const id = useId()
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)

  const points = useMemo(
    () =>
      check.points
        .map((p) => ({ ...p, adjusted: p.price * Math.exp(check.fit.bAge * (check.age - p.age)) }))
        .sort((a, b) => a.km - b.km),
    [check],
  )

  const maxKm = Math.max(check.km, ...points.map((p) => p.km))
  const kmTicks = rangeTicks(0, maxKm)
  const xMax = kmTicks[kmTicks.length - 1]
  const prices = [check.asking, check.low, check.high, ...points.map((p) => p.adjusted)]
  const ticks = rangeTicks(Math.min(...prices), Math.max(...prices))
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]

  const left = 12 + 7 * Math.max(...ticks.map((t) => fmtEur(t).length))
  const right = Math.max(left + 1, width - 10)
  const x = (km: number) => left + (km / xMax) * (right - left)
  const y = (v: number) => BOTTOM - ((v - yMin) / (yMax - yMin)) * (BOTTOM - TOP)

  // The typical price and the middle half, at this car's age, across the mileages.
  const lowShift = Math.log(check.low / check.typical)
  const highShift = Math.log(check.high / check.typical)
  const steps = 24
  const curve = Array.from({ length: steps + 1 }, (_, i) => {
    const km = (xMax * i) / steps
    const center = predict(check.fit, check.age, km)
    return { km, mid: Math.exp(center), lo: Math.exp(center + lowShift), hi: Math.exp(center + highShift) }
  })
  const line = curve.map((c, i) => `${i ? 'L' : 'M'}${x(c.km).toFixed(1)} ${y(c.mid).toFixed(1)}`).join('')
  const band =
    curve.map((c, i) => `${i ? 'L' : 'M'}${x(c.km).toFixed(1)} ${y(c.hi).toFixed(1)}`).join('') +
    [...curve].reverse().map((c) => `L${x(c.km).toFixed(1)} ${y(c.lo).toFixed(1)}`).join('') +
    'Z'

  function nearest(e: PointerEvent<SVGRectElement>) {
    const svg = e.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!svg) return
    const px = e.clientX - svg.left
    const py = e.clientY - svg.top
    let best: number | null = null
    let bestD = REACH * REACH
    points.forEach((p, i) => {
      const d = (x(p.km) - px) ** 2 + (y(p.adjusted) - py) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    setActive(best)
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (points.length === 0) return
    let next: number | null = active
    if (e.key === 'ArrowRight') next = active === null ? 0 : Math.min(points.length - 1, active + 1)
    else if (e.key === 'ArrowLeft') next = active === null ? 0 : Math.max(0, active - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = points.length - 1
    else if (e.key === 'Escape') next = null
    else return
    e.preventDefault()
    setActive(next)
  }

  const tip = active !== null ? points[active] : null
  const tipX = tip ? x(tip.km) : 0
  const tipOnRight = tipX < left + (right - left) * 0.55

  return (
    <>
      <div className="legend chart-legend">
        <span className="legend-item">
          <span className="market-key on-sale" />
          On sale
        </span>
        {check.goneKnown && check.gone > 0 && (
          <span className="legend-item">
            <span className="market-key gone" />
            Left the site
          </span>
        )}
        <span className="legend-item">
          <span className="market-key this-car" />
          This car
        </span>
        <span className="legend-item">
          <span className="swatch swatch-line market-key-line" />
          Typical, middle half shaded
        </span>
      </div>
      <div
        ref={ref}
        className="chart market-chart"
        style={{ height: HEIGHT }}
        tabIndex={0}
        role="group"
        aria-label={`${check.count} similar listings by mileage, prices adjusted to a ${check.year}. This car asks ${fmtEur(check.asking)} at ${fmtNum(check.km)} km; typical is ${fmtEur(check.typical)}. Arrow keys step through the listings.`}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
            <defs>
              <clipPath id={`${id}-plot`}>
                <rect x={left} y={TOP - 6} width={right - left} height={BOTTOM - TOP + 6} />
              </clipPath>
            </defs>
            <g className="chart-grid">
              {ticks.map((t) => (
                <line key={t} x1={left} x2={right} y1={y(t)} y2={y(t)} />
              ))}
            </g>
            <g className="chart-axis">
              {ticks.map((t) => (
                <text key={t} x={left - 8} y={y(t) + 4} textAnchor="end">
                  {fmtEur(t)}
                </text>
              ))}
              {kmTicks.map((t) => (
                <text key={t} x={x(t)} y={BOTTOM + 16} textAnchor="middle">
                  {kmLabel(t)}
                </text>
              ))}
              <text x={right} y={BOTTOM + 28} textAnchor="end">
                km
              </text>
            </g>
            <g clipPath={`url(#${id}-plot)`}>
              <path className="market-band" d={band} />
            </g>
            <g>
              {points.map((p, i) => (
                <circle
                  key={p.id}
                  className={`market-dot${p.gone ? ' gone' : ''}${i === active ? ' active' : ''}`}
                  cx={x(p.km)}
                  cy={y(p.adjusted)}
                  r={i === active ? 5 : 4}
                />
              ))}
            </g>
            {/* Over the dots, with a surface halo: the line is what the dots are read against. */}
            <g clipPath={`url(#${id}-plot)`}>
              <path className="market-line-halo" d={line} />
              <path className="chart-line market-line" d={line} />
            </g>
            <circle className="market-dot this-car" cx={x(check.km)} cy={y(check.asking)} r={6} />
            <rect
              x={left}
              y={TOP}
              width={right - left}
              height={BOTTOM - TOP}
              fill="transparent"
              onPointerMove={nearest}
              onPointerDown={nearest}
              onPointerLeave={() => setActive(null)}
            />
          </svg>
        )}
        {tip && (
          <div
            className="chart-tip"
            style={{
              top: Math.max(0, y(tip.adjusted) - 70),
              ...(tipOnRight
                ? { left: tipX + 14 }
                : { right: Math.max(0, width - tipX + 14) }),
            }}
          >
            <div className="chart-tip-head">
              {tip.year} · {fmtNum(tip.km)} km
            </div>
            <TipRow value={fmtEur(tip.price)} label={tip.gone ? 'last asked' : 'asking'} />
            <TipRow value={fmtEur(tip.adjusted)} label={`as a ${check.year}`} />
            <TipRow
              value={tip.gone ? 'left the site' : 'on sale'}
              label={tip.gone ? fmtDay(tip.last) : `since ${fmtDay(tip.first)}`}
            />
          </div>
        )}
      </div>
    </>
  )
}
