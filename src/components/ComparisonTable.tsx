import type { CarListing } from '../types'
import { CATEGORIES, type TcoResult } from '../calc'
import { fmtEur, fmtEurExact } from '../format'

interface Props {
  cars: CarListing[]
  results: Map<string, TcoResult>
  years: number
}

export function ComparisonTable({ cars, results, years }: Props) {
  const tcos = cars.map((c) => results.get(c.id)!)
  const highlight = cars.length > 1
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

  function minClass(values: number[], i: number): string {
    if (!highlight) return ''
    return values[i] === Math.min(...values) ? ' min' : ''
  }

  return (
    <div className="card cmp-card">
      <div className="cmp-head">
        <div className="cmp-title display">Side by side</div>
        <div className="cmp-caption">
          over {years} years{highlight ? ' · lowest in each row highlighted' : ''}
        </div>
      </div>
      <div className="cmp-scroll">
        <table className="cmp">
          <thead>
            <tr>
              <th className="rowhead">Cost</th>
              {cars.map((c) => (
                <th key={c.id}>{c.name || 'Unnamed car'}</th>
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
                    <td key={c.id} className={`num${minClass(values, i)}`}>
                      {fmtEur(values[i])}
                    </td>
                  ))}
                </tr>
              )
            })}
            <tr className="total-row">
              <th className="rowhead">Total over {years} years</th>
              {cars.map((c, i) => (
                <td
                  key={c.id}
                  className={`num${minClass(
                    tcos.map((t) => t.total),
                    i,
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
