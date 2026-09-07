import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { fmtEur } from '../format'
import { niceTicks, yearOf, yearTicks } from './chartHelpers'

/**
 * Two series over the months of a loan, and the gap between them.
 *
 * The form both housing analyses share: interest against principal, buying
 * against renting. Two 2px lines, a wash between them in the color of
 * whichever is on top, one optional marker (the month the story turns), a
 * legend, direct labels at the line ends, and a crosshair readout that works
 * from the pointer and from the keyboard. The table twin is the caller's job.
 *
 * Text never wears a series color: labels are ink, and identity comes from
 * the line they sit on or the short key beside them.
 */

export interface ChartSeries {
  /** the legend text */
  label: string
  /** a shorter name for the line-end label; defaults to the legend text */
  short?: string
  /** a CSS color, normally a --series-N variable */
  color: string
  /** one value per month, index 0 = month 1 */
  values: number[]
}

export interface ChartMarker {
  month: number
  text: string
}

interface Props {
  a: ChartSeries
  b: ChartSeries
  marker?: ChartMarker | null
  /** the unit caption above the y axis, e.g. "€ per month" */
  yCaption: string
  ariaLabel: string
  /** the rows of the readout for a month; the chart adds the "Year · month" head */
  tooltip: (month: number) => ReactNode
}

/** A readout row: value first, then what it is, keyed by a short stroke when it is a series. */
export function TipRow({ color, value, label }: { color?: string; value: string; label: string }) {
  return (
    <div className="chart-tip-row">
      <span className="chart-tip-key" style={color ? { background: color } : undefined} />
      <span className="chart-tip-value">{value}</span>
      <span className="chart-tip-label">{label}</span>
    </div>
  )
}

export function TipRule() {
  return <div className="chart-tip-rule" />
}

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

const HEIGHT = 244
const TOP = 26
const BOTTOM = HEIGHT - 40

export function TwoLineChart({ a, b, marker = null, yCaption, ariaLabel, tooltip }: Props) {
  const id = useId()
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const n = Math.min(a.values.length, b.values.length)
  if (n === 0) return null

  let lo = 0
  let hi = 0
  for (let k = 0; k < n; k++) {
    lo = Math.min(lo, a.values[k], b.values[k])
    hi = Math.max(hi, a.values[k], b.values[k])
  }
  const ticks = niceTicks(lo, hi)
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const left = 12 + 7 * Math.max(...ticks.map((t) => fmtEur(t).length))
  const right = Math.max(left + 1, width - 12)
  const plotW = right - left
  const plotH = BOTTOM - TOP
  const x = (m: number) => left + ((m - 1) / Math.max(1, n - 1)) * plotW
  const y = (v: number) => BOTTOM - ((v - yMin) / (yMax - yMin)) * plotH

  const path = (values: number[]) =>
    values
      .slice(0, n)
      .map((v, k) => `${k === 0 ? 'M' : 'L'}${x(k + 1).toFixed(1)} ${y(v).toFixed(1)}`)
      .join('')
  const aPath = path(a.values)
  const bPath = path(b.values)
  const toBottom = (p: string) => `${p}L${x(n).toFixed(1)} ${BOTTOM}L${x(1).toFixed(1)} ${BOTTOM}Z`
  const toTop = (p: string) => `${p}L${x(n).toFixed(1)} ${TOP}L${x(1).toFixed(1)} ${TOP}Z`

  // Direct labels at the line ends: the higher line labeled above its end,
  // the lower below - unless that would run into the tick band, in which case
  // it too goes above; and if the two would then collide, the lower one is
  // left to the legend and the readout.
  const aEnd = a.values[n - 1]
  const bEnd = b.values[n - 1]
  const [high, low] =
    aEnd >= bEnd
      ? [{ s: a, v: aEnd }, { s: b, v: bEnd }]
      : [{ s: b, v: bEnd }, { s: a, v: aEnd }]
  const highY = Math.max(12, y(high.v) - 6)
  let lowY: number | null = y(low.v) + 14
  if (lowY > BOTTOM - 2) lowY = y(low.v) - 6
  if (Math.abs(lowY - highY) < 13) lowY = null
  const endLabel = (s: ChartSeries, v: number) => `${s.short ?? s.label} ${fmtEur(v)}`

  const mk = marker && marker.month >= 1 && marker.month <= n ? marker : null
  const mkX = mk ? x(mk.month) : 0
  const mkY = mk ? y((a.values[mk.month - 1] + b.values[mk.month - 1]) / 2) : 0
  const mkAnchor: 'start' | 'middle' | 'end' =
    mkX < left + 80 ? 'start' : mkX > right - 80 ? 'end' : 'middle'
  const mkLabelY = mkY - 10 < 12 ? mkY + 18 : mkY - 10

  function monthAt(e: PointerEvent<SVGRectElement>): number {
    const r = e.currentTarget.getBoundingClientRect()
    const rel = r.width > 0 ? (e.clientX - r.left) / r.width : 0
    return Math.min(n, Math.max(1, Math.round(rel * (n - 1)) + 1))
  }

  const home = mk?.month ?? 1

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const current = active ?? home
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

  const activeX = active !== null ? x(active) : 0
  const tipOnRight = activeX < left + plotW * 0.55

  return (
    <>
      <div className="legend chart-legend">
        {[a, b].map((s) => (
          <span key={s.label} className="legend-item">
            <span className="swatch swatch-line" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div
        ref={ref}
        className="chart"
        style={{ height: HEIGHT }}
        tabIndex={0}
        role="group"
        aria-label={ariaLabel}
        onKeyDown={onKey}
        onFocus={() => setActive((cur) => cur ?? home)}
        onBlur={() => setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
            <defs>
              <clipPath id={`${id}-under-a`}>
                <path d={toBottom(aPath)} />
              </clipPath>
              <clipPath id={`${id}-under-b`}>
                <path d={toBottom(bPath)} />
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
                {yCaption}
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

            {/* The gap between the lines, in the color of whichever is on top. */}
            <path
              d={toTop(bPath)}
              clipPath={`url(#${id}-under-a)`}
              fill={a.color}
              fillOpacity={0.14}
            />
            <path
              d={toTop(aPath)}
              clipPath={`url(#${id}-under-b)`}
              fill={b.color}
              fillOpacity={0.14}
            />

            <path d={aPath} className="chart-line" stroke={a.color} />
            <path d={bPath} className="chart-line" stroke={b.color} />

            <text x={right - 2} y={highY} textAnchor="end" className="chart-label">
              {endLabel(high.s, high.v)}
            </text>
            {lowY !== null && (
              <text x={right - 2} y={lowY} textAnchor="end" className="chart-label">
                {endLabel(low.s, low.v)}
              </text>
            )}

            {mk && (
              <g>
                <circle cx={mkX} cy={mkY} r={4.5} className="chart-marker" />
                <text x={mkX} y={mkLabelY} textAnchor={mkAnchor} className="chart-label">
                  {mk.text}
                </text>
              </g>
            )}

            {active !== null && (
              <g className="chart-crosshair">
                <line x1={activeX} x2={activeX} y1={TOP} y2={BOTTOM} />
                <circle cx={activeX} cy={y(a.values[active - 1])} r={4} fill={a.color} />
                <circle cx={activeX} cy={y(b.values[active - 1])} r={4} fill={b.color} />
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
              Year {yearOf(active)} · month {((active - 1) % 12) + 1}
            </div>
            {tooltip(active)}
          </div>
        )}
      </div>
    </>
  )
}
