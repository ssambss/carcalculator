import { CATEGORIES } from '../calc'
import { fmtEur } from '../format'

/** What both calculators' category lists share; each declares its own keys. */
export interface Category {
  key: string
  label: string
  series: number
}

interface Props {
  breakdown: Record<string, number>
  total: number
  /** which categories to draw — defaults to the car set */
  categories?: readonly Category[]
}

export function BreakdownBar({ breakdown, total, categories = CATEGORIES }: Props) {
  if (total <= 0) return null
  const parts = categories
    .map((c) => ({ ...c, value: breakdown[c.key] ?? 0 }))
    .filter((p) => p.value > 0)
  return (
    <div className="breakdown-bar" aria-label="Cost breakdown">
      {parts.map((p) => (
        <div
          key={p.key}
          className="breakdown-seg"
          style={{
            width: `${(p.value / total) * 100}%`,
            background: `var(--series-${p.series})`,
          }}
        >
          <span className="seg-tip">
            {p.label} · {fmtEur(p.value)} ({Math.round((p.value / total) * 100)} %)
          </span>
        </div>
      ))}
    </div>
  )
}

export function Legend({
  breakdowns,
  categories = CATEGORIES,
}: {
  breakdowns: Record<string, number>[]
  categories?: readonly Category[]
}) {
  const visible = categories.filter((c) => breakdowns.some((b) => (b[c.key] ?? 0) > 0))
  if (visible.length === 0) return null
  return (
    <div className="legend">
      {visible.map((c) => (
        <span key={c.key} className="legend-item">
          <span className="swatch" style={{ background: `var(--series-${c.series})` }} />
          {c.label}
        </span>
      ))}
    </div>
  )
}
