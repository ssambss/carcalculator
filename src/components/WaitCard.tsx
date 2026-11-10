import { useMemo, useState } from 'react'
import { asoChargesPerMonth, type HousingSituation, type PropertyListing } from '../housing'
import { fmtEur, fmtNum } from '../format'
import { dayOf, todayIso } from '../mileage'
import { bonusLastYears, saversOf } from '../saving'
import type { SavingStore } from '../useSaving'
import { WAIT_YEARS, waitInAso, type WaitYear } from '../waiting'
import { DateField } from './DateField'
import { FoldCard } from './Fold'
import { NumberField } from './NumberField'

/**
 * Wait in an aso home, buy later: the flexibility the household is after.
 *
 * If the rates are wrong on the day it meant to buy, it can move into an aso
 * home it is happy in and keep saving, then buy one to five years on - the
 * ASP bonus keeps accruing for the first saving year and five calendar years
 * after it. This card counts the cash that builds on each of those later
 * days, what that cash reaches, and how the same years would have gone
 * renting instead. The maths is `waiting.ts`; the saving plan's deposits and
 * check-ins are read, never written.
 */

const dateFmt = new Intl.DateTimeFormat('fi-FI', { timeZone: 'UTC' })
const fmtDay = (day: number) => dateFmt.format(new Date(day * 86_400_000))
const signedEur = (v: number) => {
  const r = Math.round(v)
  return r === 0 ? fmtEur(0) : `${r > 0 ? '+' : '−'}${fmtEur(Math.abs(r))}`
}

/** What a row's cash reaches, said the way the household shops: inside the ASP cap when it keeps to one. */
const buys = (row: WaitYear) => row.insideCap ?? row.ceiling

export function WaitCard({
  situation: s,
  saving,
  asoPlaces,
  onChange,
}: {
  situation: HousingSituation
  saving: SavingStore
  /** the aso places, in the order the housing view shows them */
  asoPlaces: PropertyListing[]
  onChange: (s: HousingSituation) => void
}) {
  const { plan, readings } = saving.data
  const [placeId, setPlaceId] = useState<string | null>(null)
  const [years, setYears] = useState<number>(3)
  const today = dayOf(todayIso())!
  const place = asoPlaces.find((p) => p.id === placeId) ?? asoPlaces[0]
  // The day the household had meant to buy, until it names another.
  const moveInIso = s.waitMoveIn || plan.targetDate || todayIso()
  const moveIn = dayOf(moveInIso) ?? today

  const result = useMemo(
    () => (place ? waitInAso(place, moveIn, s, plan, readings, today) : null),
    [place, moveIn, s, plan, readings, today],
  )
  if (!place || !result) return null

  const set = (patch: Partial<HousingSituation>) => onChange({ ...s, ...patch })
  const planned = result.rows[0]
  const row = result.rows.find((r) => r.years === years) ?? result.rows[result.rows.length - 1]
  const deposits =
    Math.max(0, plan.monthlyDeposit) + (s.buyingTogether ? Math.max(0, plan.partnerMonthlyDeposit) : 0)
  const bonusYears = s.useAspLoan && plan.bonusPct > 0 ? bonusLastYears(plan, s) : []
  const bonusUntil = bonusYears.length ? Math.min(...bonusYears.map((b) => b.year)) : null
  const together = saversOf(s).length > 1
  const anyLoanLeft = result.rows.some((r) => r.asoLoanLeft > 0)
  const renting = planned.rentingCash !== null
  const capped = row.insideCap !== null

  const summary = `${asoPlaces.length > 1 ? `${place.name || 'Unnamed place'} · ` : ''}${fmtEur(row.cash)} in cash after ${years} ${
    years === 1 ? 'year' : 'years'
  } (${fmtEur(planned.cash)} as planned) · reaches ${fmtEur(buys(row))}${capped ? ' inside the ASP cap' : ''}`

  return (
    <FoldCard
      id="housing.wait"
      title="Wait in an aso home, buy later"
      caption="keep saving in a home you like, and buy when the rates suit — the cash it builds"
      summary={summary}
    >
      {asoPlaces.length > 1 && (
        <div className="schedule-subjects" role="tablist" aria-label="Which aso home">
          {asoPlaces.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={p.id === place.id}
              className={`filter-chip${p.id === place.id ? ' active' : ''}`}
              onClick={() => setPlaceId(p.id)}
            >
              {p.name || 'Unnamed place'}
              <span className="chip-note">
                {fmtEur(p.asoPayment)} · {fmtEur(asoChargesPerMonth(p))}/mo
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="analysis-fields">
        <DateField
          label="Move in"
          value={moveInIso}
          onChange={(iso) => set({ waitMoveIn: iso })}
          hint={
            s.waitMoveIn
              ? 'the day you move in instead of buying'
              : plan.targetDate
                ? 'the saving plan’s purchase day, until you pick another'
                : 'today, until you pick a day or the saving plan has one'
          }
        />
        <NumberField
          compact
          label="Cash outside ASP"
          value={s.waitOtherCash}
          onChange={(n) => set({ waitOtherCash: Math.max(0, n) })}
          unit="€"
          hint="on moving in — funds, an ordinary account; it pays the aso payment, the ASP accounts stay untouched"
        />
        <NumberField
          compact
          label="Invest a month"
          value={s.waitInvestPerMonth}
          onChange={(n) => set({ waitInvestPerMonth: Math.max(0, n) })}
          unit="€/mo"
          hint={`on top of the saving plan’s ASP deposits (${fmtEur(deposits)}/mo${together ? ' together' : ''}), which carry on`}
        />
      </div>

      <div className="schedule-subjects" role="tablist" aria-label="Buy after">
        {WAIT_YEARS.map((n) => (
          <button
            key={n}
            role="tab"
            aria-selected={n === row.years}
            className={`filter-chip${n === row.years ? ' active' : ''}`}
            onClick={() => setYears(n)}
          >
            Buy after {n} {n === 1 ? 'year' : 'years'}
            <span className="chip-note">{fmtDay(result.rows[n].day)}</span>
          </button>
        ))}
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Cash on {fmtDay(row.day)}</span>
          <span className="stat-value">{fmtEur(row.cash)}</span>
          <span className="stat-sub">
            {signedEur(row.cash - planned.cash)} on buying as planned ({fmtEur(planned.cash)} on{' '}
            {fmtDay(planned.day)})
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{capped ? 'Buys, inside the ASP cap' : 'Buys'}</span>
          <span className="stat-value">{fmtEur(buys(row))}</span>
          <span className="stat-sub">
            {fmtEur(buys(planned))} as planned
            {capped && row.ceiling > row.insideCap! + 1 && ` · the ceiling ${fmtEur(row.ceiling)}`} ·
            today’s income and rules
          </span>
        </div>
        {renting && (
          <div className="stat">
            <span className="stat-label">Against renting</span>
            <span className="stat-value">{signedEur(row.cash - row.rentingCash!)}</span>
            <span className="stat-sub">
              renting the same years at {fmtEur(s.rentPerMonth)}/mo would leave{' '}
              {fmtEur(row.rentingCash!)} — the same money a month either way
            </span>
          </div>
        )}
        <div className="stat">
          <span className="stat-label">Living there</span>
          <span className="stat-value">{fmtEur(row.monthlyCost)}/mo</span>
          <span className="stat-sub">
            in year {row.years}: the käyttövastike and other, rising {fmtNum(s.rentGrowthPct)} %/yr
            {result.asoLoan > 0 && ', and the payment’s loan'}
          </span>
        </div>
        {s.useAspLoan && plan.bonusPct > 0 && (
          <div className="stat">
            <span className="stat-label">ASP bonus in it</span>
            <span className="stat-value">{fmtEur(row.aspBonus)}</span>
            <span className="stat-sub">
              {bonusUntil !== null
                ? row.day > Date.UTC(bonusUntil + 1, 0, 1) / 86_400_000
                  ? `stopped growing at the end of ${bonusUntil} — what it earned is still paid at the purchase`
                  : `keeps accruing through ${bonusUntil}, paid at the purchase`
                : 'paid at the purchase — say when the first deposits were in “Saving up” to see when it stops'}
            </span>
          </div>
        )}
      </div>

      <div className="cmp-scroll">
        <table className="cmp schedule-table">
          <thead>
            {/* The answer first - the cash and what it buys - then what it is
                made of: on a phone the table scrolls, and the first columns
                are the ones read. */}
            <tr>
              <th className="rowhead">Buy</th>
              <th>Cash</th>
              <th>{capped ? 'Buys, inside the cap' : 'Buys'}</th>
              <th>ASP accounts</th>
              <th>Investments</th>
              <th>ASO payment back</th>
              {anyLoanLeft && <th>Its loan left</th>}
              {renting && <th>Renting instead</th>}
              <th>Living there / mo</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.years} className={r.years === row.years ? 'total-row' : undefined}>
                <th className="rowhead">
                  {r.years === 0 ? 'As planned' : `After ${r.years} ${r.years === 1 ? 'year' : 'years'}`}
                  <br />
                  <span className="cell-note">{fmtDay(r.day)}</span>
                </th>
                <td className="num">{fmtEur(r.cash)}</td>
                <td className="num">{fmtEur(buys(r))}</td>
                <td className="num">
                  {fmtEur(r.asp)}
                  {r.aspBonus > 0 && (
                    <>
                      <br />
                      <span className="cell-note">bonus {fmtEur(r.aspBonus)}</span>
                    </>
                  )}
                </td>
                <td className="num">{fmtEur(r.invested)}</td>
                <td className={`num${r.years === 0 ? ' muted' : ''}`}>
                  {r.years === 0 ? '—' : fmtEur(r.asoBack)}
                </td>
                {anyLoanLeft && (
                  <td className={`num${r.asoLoanLeft > 0 ? '' : ' muted'}`}>
                    {r.asoLoanLeft > 0 ? `−${fmtEur(r.asoLoanLeft)}` : '—'}
                  </td>
                )}
                {renting && <td className="num">{fmtEur(r.rentingCash!)}</td>}
                <td className={`num${r.years === 0 ? ' muted' : ''}`}>
                  {r.years === 0 ? '—' : fmtEur(r.monthlyCost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="chart-note">
        On moving in, the {fmtEur(place.asoPayment)} payment comes out of the cash outside ASP
        {result.asoLoan > 0
          ? ` — ${fmtEur(result.asoLoan)} of it borrowed, since that cash is short, as a plain loan at your ${fmtNum(s.ratePct)} % and repaid out of the cash at the purchase`
          : ` and ${fmtEur(result.investedAtStart)} of that cash is left invested`}
        ; taking it from an ASP account would end the ASP saving and its bonus. The ASP deposits carry
        on as the saving plan has them, at {fmtNum(plan.interestPct)} %
        {s.useAspLoan && plan.bonusPct > 0 ? ` plus the ${fmtNum(plan.bonusPct)} % bonus paid at the purchase` : ''}
        . The investments earn {fmtNum(s.investmentReturnPct)} %/yr and are counted after{' '}
        {fmtNum(s.gainsTaxPct)} % tax on their gains, since they are sold for the purchase. The
        payment comes back at {fmtNum(s.asoIndexPct)} %/yr (never below what was paid) — but only
        within three months of moving out, so the purchase may need a short bridge until it lands,
        and later still if the aso company is short of funds.
        {renting &&
          ` Renting instead keeps all the cash outside ASP invested and has the same money a month: whichever home costs less invests the difference${
            result.renterShortMonths > 0
              ? `; in ${result.renterShortMonths} months the rent cost more than the aso home and everything set aside, so the renter invested nothing then`
              : ''
          }.`}{' '}
        What the cash buys is today’s ceiling with that cash: no raises are assumed, and the rates
        are your situation’s — which is the point of waiting, since a better rate lowers the
        payment more than it moves a stress-tested ceiling. Under 55, getting the aso home takes
        Varke’s asset test on the day you apply: nothing that could pay half the price of a
        comparable home.
      </p>
    </FoldCard>
  )
}
