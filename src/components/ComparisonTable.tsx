import type { CarListing } from '../types'
import { CATEGORIES, type TcoResult } from '../calc'
import { fmtEur, fmtEurExact, fmtNum } from '../format'

interface Props {
  cars: CarListing[]
  results: Map<string, TcoResult>
  years: number
}

export function ComparisonTable({ cars, results, years }: Props) {
  const tcos = cars.map((c) => results.get(c.id)!)
  const highlight = cars.length > 1
  // Cars costed over different periods: absolute sums aren't comparable across
  // columns, so highlighting stays on the normalized per-month/per-km rows only
  const mixedPeriods = new Set(tcos.map((t) => Math.round(t.years * 12))).size > 1
  const visibleCategories = CATEGORIES.filter((cat) =>
    tcos.some((t) => t.breakdown[cat.key] > 0),
  )
  const anyLoan = cars.some((c) => c.financing.method === 'loan')
  const anyLease = cars.some((c) => c.financing.method === 'lease')
  const financedLabel =
    anyLoan && anyLease
      ? 'Loan / lease per mo'
      : anyLease
        ? 'Lease payment / mo'
        : 'Loan payment / mo'

  function minClass(values: number[], i: number, absolute = false): string {
    if (!highlight) return ''
    if (absolute && mixedPeriods) return ''
    return values[i] === Math.min(...values) ? ' min' : ''
  }

  return (
    <div className="card cmp-card">
      <div className="cmp-head">
        <div className="cmp-title display">Side by side</div>
        <div className="cmp-caption">
          {mixedPeriods
            ? 'each car over its own period — compare per month and per kilometre'
            : `over ${fmtNum(years)} years`}
          {highlight ? ' · lowest in each row highlighted' : ''}
        </div>
      </div>
      <div className="cmp-scroll">
        <table className="cmp">
          <thead>
            <tr>
              <th className="rowhead">Cost</th>
              {cars.map((c, i) => (
                <th key={c.id}>
                  {c.name || 'Unnamed car'}
                  {mixedPeriods && (
                    <div className="cmp-horizon">over {fmtNum(tcos[i].years)} yrs</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleCategories.map((cat) => {
              const values = tcos.map((t) => t.breakdown[cat.key])
              return (
                <tr key={cat.key}>
                  <th className="rowhead">
                    <span
                      className="swatch"
                      style={{ background: `var(--series-${cat.series})` }}
                    />
                    {cat.label}
                  </th>
                  {cars.map((c, i) => (
                    <td key={c.id} className={`num${minClass(values, i, true)}`}>
                      {fmtEur(values[i])}
                    </td>
                  ))}
                </tr>
              )
            })}
            <tr className="total-row">
              <th className="rowhead">
                {mixedPeriods ? 'Total over own period' : `Total over ${fmtNum(years)} years`}
              </th>
              {cars.map((c, i) => (
                <td
                  key={c.id}
                  className={`num${minClass(
                    tcos.map((t) => t.total),
                    i,
                    true,
                  )}`}
                >
                  {fmtEur(tcos[i].total)}
                </td>
              ))}
            </tr>
            <tr>
              <th className="rowhead">Per month</th>
              {cars.map((c, i) => (
                <td
                  key={c.id}
                  className={`num${minClass(
                    tcos.map((t) => t.perMonth),
                    i,
                  )}`}
                >
                  {fmtEur(tcos[i].perMonth)}
                </td>
              ))}
            </tr>
            <tr>
              <th className="rowhead">Running costs / mo</th>
              {cars.map((c, i) => (
                <td
                  key={c.id}
                  className={`num${minClass(
                    tcos.map((t) => t.runningPerMonth),
                    i,
                  )}`}
                >
                  {fmtEur(tcos[i].runningPerMonth)}
                </td>
              ))}
            </tr>
            <tr>
              <th className="rowhead">Per kilometre</th>
              {cars.map((c, i) => (
                <td
                  key={c.id}
                  className={`num${minClass(
                    tcos.map((t) => t.perKm),
                    i,
                  )}`}
                >
                  {fmtEurExact(tcos[i].perKm)}
                </td>
              ))}
            </tr>
            {(anyLoan || anyLease) && (
              <tr>
                <th className="rowhead">{financedLabel}</th>
                {cars.map((c, i) =>
                  c.financing.method === 'cash' ? (
                    <td key={c.id} className="num muted">
                      —
                    </td>
                  ) : (
                    <td key={c.id} className="num">
                      {fmtEurExact(
                        c.financing.method === 'lease'
                          ? tcos[i].lease.monthlyPayment
                          : tcos[i].loan.monthlyPayment,
                      )}
                    </td>
                  ),
                )}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
