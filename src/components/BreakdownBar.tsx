import { CATEGORIES, type Breakdown } from '../calc'
import { fmtEur } from '../format'

interface Props {
  breakdown: Breakdown
  total: number
}

export function BreakdownBar({ breakdown, total }: Props) {
  if (total <= 0) return null
  const parts = CATEGORIES.map((c) => ({ ...c, value: breakdown[c.key] })).filter(
    (p) => p.value > 0,
  )
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

export function Legend({ breakdowns }: { breakdowns: Breakdown[] }) {
  const visible = CATEGORIES.filter((c) => breakdowns.some((b) => b[c.key] > 0))
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
