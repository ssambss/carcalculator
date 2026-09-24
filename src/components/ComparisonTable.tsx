import { useState } from 'react'
import type { CarListing, Settings } from '../types'
import { CATEGORIES, calcTco, type TcoResult } from '../calc'
import { fmtEur, fmtEurExact, fmtNum } from '../format'

interface Props {
  cars: CarListing[]
  results: Map<string, TcoResult>
  settings: Settings
}

export function ComparisonTable({ cars, results, settings }: Props) {
  const [samePeriod, setSamePeriod] = useState(false)
  const ownTcos = cars.map((c) => results.get(c.id)!)
  const mixedPeriods = new Set(ownTcos.map((t) => Math.round(t.years * 12))).size > 1
  const minYears = ownTcos.length ? Math.min(...ownTcos.map((t) => t.years)) : 0
  // Same-period view: every car fully recomputed over the shortest window, so
  // totals are apples-to-apples (early-exit depreciation and all)
  const normalized = samePeriod && mixedPeriods
  const tcos = normalized ? cars.map((c) => calcTco(c, settings, minYears)) : ownTcos

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

  const anyFinanced = anyLoan || anyLease
  const anyBalloon = tcos.some((t) => t.loan.balloon > 0)
  // A cash car's monthly outlay is running costs alone - its price left the
  // account on day one - so beside financed cars it would always look cheapest.
  const outOfPocket = tcos.map((t, i) =>
    anyFinanced && cars[i].financing.method === 'cash' ? Infinity : t.outOfPocketPerMonth,
  )
  const upfrontOf = (c: CarListing) =>
    c.financing.method === 'cash'
      ? c.purchasePrice
      : c.financing.method === 'lease'
        ? c.lease.upfront
        : c.financing.downPayment

  // Absolute sums across different periods aren't comparable — no highlight there
  const suppressAbsolute = mixedPeriods && !normalized

  function minClass(values: number[], i: number, absolute = false): string {
    if (!highlight) return ''
    if (absolute && suppressAbsolute) return ''
    return values[i] === Math.min(...values) ? ' min' : ''
  }

  const caption = normalized
    ? `everything over ${fmtNum(minYears)} ${minYears === 1 ? 'year' : 'years'} — as if each car were kept that long`
    : mixedPeriods
      ? 'each car over its own period — compare per month and per kilometre'
      : `over ${fmtNum(ownTcos[0]?.years ?? settings.ownershipYears)} years`

  const totalLabel = normalized
    ? `Total over ${fmtNum(minYears)} ${minYears === 1 ? 'year' : 'years'}`
    : mixedPeriods
      ? 'Total over own period'
      : `Total over ${fmtNum(ownTcos[0]?.years ?? settings.ownershipYears)} years`

  return (
    <div className="card cmp-card">
      <div className="cmp-head">
        <div className="cmp-title display">Side by side</div>
        <div className="cmp-caption">
          {caption}
          {highlight ? ' · lowest in each row highlighted' : ''}
        </div>
        {mixedPeriods && (
          <div className="cmp-toggle">
            <button
              className={`filter-chip${samePeriod ? '' : ' active'}`}
              onClick={() => setSamePeriod(false)}
            >
              Own period
            </button>
            <button
              className={`filter-chip${samePeriod ? ' active' : ''}`}
              onClick={() => setSamePeriod(true)}
            >
              Same period ({fmtNum(minYears)} yrs)
            </button>
          </div>
        )}
      </div>
      <div className="cmp-scroll">
        <table className="cmp">
          <thead>
            <tr>
              <th className="rowhead">Cost</th>
              {cars.map((c, i) => (
                <th key={c.id}>
                  {c.name || 'Unnamed car'}
                  {suppressAbsolute && (
                    <div className="cmp-horizon">over {fmtNum(tcos[i].years)} yrs</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* The monthly outlay leads: it is the budget line, where the costs
                below net out a resale value that is only an estimate. */}
            <tr className="total-row">
              <th className="rowhead">Out of pocket / mo</th>
              {cars.map((c, i) => (
                <td
                  key={c.id}
                  className={`num${
                    anyFinanced && c.financing.method === 'cash'
                      ? ' muted'
                      : minClass(outOfPocket, i)
                  }`}
                >
                  {fmtEur(tcos[i].outOfPocketPerMonth)}
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
              <th className="rowhead">Paid up front</th>
              {cars.map((c) => (
                <td key={c.id} className={`num${upfrontOf(c) > 0 ? '' : ' muted'}`}>
                  {fmtEur(upfrontOf(c))}
                </td>
              ))}
            </tr>
            {anyBalloon && (
              <tr>
                <th className="rowhead">Balloon at the end</th>
                {cars.map((c, i) =>
                  tcos[i].loan.balloon > 0 ? (
                    <td key={c.id} className="num">
                      {fmtEur(tcos[i].loan.balloon)}
                    </td>
                  ) : (
                    <td key={c.id} className="num muted">
                      —
                    </td>
                  ),
                )}
              </tr>
            )}
            <tr className="cmp-group">
              <th colSpan={cars.length + 1}>Cost of ownership, resale netted out</th>
            </tr>
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
              <th className="rowhead">{totalLabel}</th>
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
              <th className="rowhead">Per month after resale</th>
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
          </tbody>
        </table>
      </div>
    </div>
  )
}
