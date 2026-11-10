import { useState } from 'react'
import {
  RENTING,
  asoAlternative,
  asoChargesPerMonth,
  rentVsBuy,
  type Alternative,
  type HousingSituation,
  type PropertyListing,
  type RentVsBuy as Comparison,
} from '../housing'
import { fmtEur, fmtNum } from '../format'
import { pct, tableYears, yearOf } from './chartHelpers'
import { FoldCard } from './Fold'
import { SubjectChips, ViewToggle, type AnalysisSubject } from './LoanSchedule'
import { NumberField } from './NumberField'
import { TipRow, TipRule, TwoLineChart } from './TwoLineChart'

/**
 * Buy this home, or rent one like it and invest the difference?
 *
 * The other half of the mortgage question. The schedule card shows what the
 * payment buys; this one asks whether a portfolio would have bought more. The
 * renter starts with the closing cash invested, then every month whoever pays
 * less invests the gap; both net worths are drawn over the term, gains taxed,
 * with the month one side pulled ahead for good marked. The break-even return
 * is the single most useful number here: it turns a stack of guesses into one
 * threshold the reader can hold against their own expectations.
 *
 * The other side need not be renting: any aso place in the list can stand in
 * for it, its payment taken out of the closing cash and coming back at the
 * index, its käyttövastike in the rent's place. Which one is a choice of this
 * card alone - the subject chips are shared with the schedule card, the
 * alternative is not.
 *
 * Buying wears the ownership blue the principal line already uses; renting
 * - and an aso home, the same kind of line - gets the teal slot, which passes
 * the palette checks against it in both themes.
 */

const BUY_COLOR = 'var(--series-1)'
const RENT_COLOR = 'var(--series-3)'

/** The words for the side that does not buy, so every sentence below is said once. */
interface Side {
  /** "Renting" / "ASO" - the line's short name, in the chart and the tiles */
  short: string
  /** "renting" / "the aso home" - mid-sentence */
  lower: string
  /** "the renter" / "the aso household" */
  who: string
  /** "rent" / "käyttövastike" - what it pays each month */
  charge: string
}

const RENTER: Side = { short: 'Renting', lower: 'renting', who: 'the renter', charge: 'rent' }
const ASO_SIDE: Side = {
  short: 'ASO',
  lower: 'the aso home',
  who: 'the aso household',
  charge: 'käyttövastike',
}
const sideOf = (alt: Alternative): Side => (alt.kind === 'aso' ? ASO_SIDE : RENTER)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function RentVsBuy({
  situation,
  subjects,
  subjectId,
  onSelectSubject,
  asoPlaces,
  onChange,
}: {
  situation: HousingSituation
  subjects: AnalysisSubject[]
  subjectId: string | null
  onSelectSubject: (id: string) => void
  /** the aso places, in the order the housing view shows them - each one an alternative to buying */
  asoPlaces: PropertyListing[]
  onChange: (s: HousingSituation) => void
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  // 'rent', or the id of the aso place buying is weighed against.
  const [altId, setAltId] = useState<string>('rent')
  const usable = subjects.filter((s) => s.price > 0)
  const subject = usable.find((s) => s.id === subjectId) ?? usable[0]
  if (!subject) return null

  const set = (patch: Partial<HousingSituation>) => onChange({ ...situation, ...patch })
  // A place deleted or turned into a purchase falls back to renting.
  const asoPlace = asoPlaces.find((p) => p.id === altId) ?? null
  const alt: Alternative = asoPlace ? asoAlternative(asoPlace) : RENTING
  const side = sideOf(alt)
  const asked =
    alt.kind === 'aso' ? alt.payment > 0 || alt.chargesPerMonth > 0 : situation.rentPerMonth > 0
  const result = asked ? rentVsBuy(subject, situation, alt) : null

  const summary = result
    ? [
        usable.length > 1 ? subject.label : '',
        asoPlace ? `against ${asoPlace.name || 'an aso place'}` : '',
        `${leadText(result).toLowerCase()} after ${fmtNum(result.months.length / 12)} years`,
        result.breakEvenReturnPct !== null
          ? `break-even return ${fmtNum(Math.round(result.breakEvenReturnPct * 10) / 10)} %/yr`
          : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : 'type the rent a comparable place would cost, and it weighs the two'

  return (
    <FoldCard
      id="housing.rentVsBuy"
      title="Rent instead, and invest the difference"
      caption={
        asoPlaces.length > 0
          ? 'the same money, two ways: a mortgage, or rent or an aso home plus a portfolio'
          : 'the same money, two ways: a mortgage, or rent plus a portfolio'
      }
      summary={summary}
      actions={result && <ViewToggle view={view} onChange={setView} />}
    >
      <SubjectChips
        subjects={usable}
        selected={subject}
        onSelect={onSelectSubject}
        note={(s) => fmtEur(s.price)}
      />

      {asoPlaces.length > 0 && (
        <div className="schedule-subjects" role="tablist" aria-label="Instead of buying">
          <button
            role="tab"
            aria-selected={!asoPlace}
            className={`filter-chip${!asoPlace ? ' active' : ''}`}
            onClick={() => setAltId('rent')}
          >
            Rent
            <span className="chip-note">
              {situation.rentPerMonth > 0 ? `${fmtEur(situation.rentPerMonth)}/mo` : 'not typed'}
            </span>
          </button>
          {asoPlaces.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={p.id === asoPlace?.id}
              className={`filter-chip${p.id === asoPlace?.id ? ' active' : ''}`}
              onClick={() => setAltId(p.id)}
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
        {alt.kind === 'rent' ? (
          <NumberField
            compact
            label="Rent instead"
            value={situation.rentPerMonth}
            onChange={(n) => set({ rentPerMonth: Math.max(0, n) })}
            unit="€/mo"
          />
        ) : (
          <NumberField
            compact
            label="ASO index"
            value={situation.asoIndexPct}
            onChange={(n) => set({ asoIndexPct: Math.max(-99, n) })}
            unit="%/yr"
            hint="the building cost index the payment comes back at — +3.4 % in the year to 9/2026; never back below the payment"
          />
        )}
        <NumberField
          compact
          label="Owner invests"
          value={situation.ownerInvestPerMonth}
          onChange={(n) => set({ ownerInvestPerMonth: Math.max(0, n) })}
          unit="€/mo"
          hint={`on top of the loan and charges; ${side.who} gets the same total to spend`}
        />
        <NumberField
          compact
          label={alt.kind === 'aso' ? 'Charges rise' : 'Rent rises'}
          value={situation.rentGrowthPct}
          onChange={(n) => set({ rentGrowthPct: Math.max(-99, n) })}
          unit="%/yr"
          hint={
            alt.kind === 'aso'
              ? 'the käyttövastike, and the owner’s charges with it'
              : 'the charges rise with it'
          }
        />
        <NumberField
          compact
          label="Investments earn"
          value={situation.investmentReturnPct}
          onChange={(n) => set({ investmentReturnPct: Math.max(-99, n) })}
          unit="%/yr"
        />
        <NumberField
          compact
          label="Home value"
          value={situation.homeValueGrowthPct}
          onChange={(n) => set({ homeValueGrowthPct: Math.max(-99, n) })}
          unit="%/yr"
        />
        <NumberField
          compact
          label="Tax on gains"
          value={situation.gainsTaxPct}
          onChange={(n) => set({ gainsTaxPct: Math.min(100, Math.max(0, n)) })}
          unit="%"
          hint="an own home sells tax-free"
        />
      </div>

      {!result ? (
        <p className="chart-note">
          {alt.kind === 'aso' ? (
            <>
              Give the aso place its payment and käyttövastike (Edit) and it is weighed against
              buying here.
            </>
          ) : (
            <>
              Type the rent a comparable place would cost. The renter keeps the{' '}
              {fmtEur(subject.cashAtClosing)} that closing would take and invests it from day one.
              After that both sides have the same monthly budget: the owner pays the loan and the
              charges and invests the fixed sum above, the renter invests what the rent leaves of
              it.
            </>
          )}
        </p>
      ) : (
        <>
          {view === 'chart' ? (
            <ComparisonChart result={result} />
          ) : (
            <ComparisonTable result={result} />
          )}
          <Outcome result={result} subject={subject} />
          <p className="chart-note">
            {alt.kind === 'aso' ? (
              <>
                The aso household pays the {fmtEur(alt.payment)} payment out of the{' '}
                {fmtEur(subject.cashAtClosing)} closing would take
                {result.altLoan > 0
                  ? `, borrowing the ${fmtEur(result.altLoan)} it does not cover at your regular rate`
                  : ` and invests the ${fmtEur(result.renterStart)} left`}
                ; its line counts the payment as it would come back, grown at{' '}
                {fmtNum(situation.asoIndexPct)} %/yr and never below what was paid, less anything
                still owed on it. Neither that (after two years’ residence) nor the home’s sale is
                taxed; investment gains are, at {fmtNum(situation.gainsTaxPct)} % at the end. Not
                counted: selling costs, the years after the loan is repaid, and the aso company’s
                own standing — the payment is its equity, so it ranks behind the company’s
                creditors and can come back late if the company is short of funds.
              </>
            ) : (
              <>
                The home sells tax-free and investment gains are taxed at{' '}
                {fmtNum(situation.gainsTaxPct)} % at the end. Not counted: selling costs, a rent
                deposit, and the years after the loan is repaid, when owning gets cheaper still.
              </>
            )}
            {result.renterShortMonths > 0 &&
              ` In ${result.renterShortMonths} of ${result.months.length} months the ${side.charge}${
                result.altLoan > 0 ? ' and its loan' : ''
              } exceeded the owner’s whole budget, so ${side.who} invested nothing then and paid the rest from elsewhere.`}
          </p>
        </>
      )}
    </FoldCard>
  )
}

/** "Buying ahead by 212 573 €" - said the same in the folded head and in the tiles. */
function leadText(result: Comparison): string {
  const last = result.months[result.months.length - 1]
  const gap = last.buyerNetWorth - last.renterNetWorth
  return result.leader === 'buy'
    ? `Buying ahead by ${fmtEur(gap)}`
    : result.leader === 'rent'
      ? `${sideOf(result.alternative).short} ahead by ${fmtEur(-gap)}`
      : 'Level'
}

/* -------------------------------------------------------------------- chart */

function ComparisonChart({ result }: { result: Comparison }) {
  const { months, leader, leaderFrom } = result
  const side = sideOf(result.alternative)
  const aso = result.alternative.kind === 'aso'
  const marker =
    leader !== null && leaderFrom !== null && leaderFrom > 1
      ? {
          month: leaderFrom,
          text: `${leader === 'buy' ? 'Buying' : side.short} ahead from ${
            leaderFrom <= 12 ? `month ${leaderFrom}` : `year ${yearOf(leaderFrom)}`
          }`,
        }
      : null
  return (
    <TwoLineChart
      a={{
        label: 'Buying — home equity plus the owner’s investments',
        short: 'Buying',
        color: BUY_COLOR,
        values: months.map((m) => m.buyerNetWorth),
      }}
      b={{
        label: aso
          ? 'ASO — the payment as it would come back, plus the portfolio after tax on gains'
          : 'Renting — the portfolio, after tax on gains',
        short: side.short,
        color: RENT_COLOR,
        values: months.map((m) => m.renterNetWorth),
      }}
      marker={marker}
      yCaption="€ net worth"
      ariaLabel={`Net worth of buying against ${aso ? 'an aso home' : 'renting'} and investing, month by month. Arrow keys step a year, with Shift a month; the Table view lists the same figures.`}
      tooltip={(month) => {
        const r = months[month - 1]
        return (
          <>
            <TipRow color={BUY_COLOR} value={fmtEur(r.buyerNetWorth)} label="buying" />
            <TipRow color={RENT_COLOR} value={fmtEur(r.renterNetWorth)} label={side.lower} />
            <TipRule />
            <TipRow value={fmtEur(r.buyerPays)} label="the owner pays this month" />
            <TipRow value={fmtEur(r.rent)} label={side.charge} />
            {r.altLoanPayment > 0 && (
              <TipRow value={fmtEur(r.altLoanPayment)} label="on the payment’s loan" />
            )}
            <TipRow
              value={fmtEur(r.renterInvests)}
              label={
                r.renterShort > 0
                  ? `${side.who} invests · ${fmtEur(r.renterShort)} short`
                  : `${side.who} invests`
              }
            />
            {r.ownerInvests > 0 && <TipRow value={fmtEur(r.ownerInvests)} label="the owner invests" />}
            <TipRow value={fmtEur(r.homeEquity)} label="home equity" />
            {aso && <TipRow value={fmtEur(r.asoValue)} label="the payment, if given up now" />}
          </>
        )
      }}
    />
  )
}

/* -------------------------------------------------------------------- table */

function ComparisonTable({ result }: { result: Comparison }) {
  const { months, ownerInvested } = result
  const side = sideOf(result.alternative)
  const aso = result.alternative.kind === 'aso'
  const n = months.length
  const rows = tableYears(n).map((y) => ({
    y: Math.min(y, n / 12),
    r: months[Math.min(n, y * 12) - 1],
  }))
  const ownerColumn = ownerInvested > 0
  return (
    <div className="cmp-scroll">
      <table className="cmp schedule-table">
        <thead>
          <tr>
            <th className="rowhead">After</th>
            <th>Owner pays / mo</th>
            <th>{cap(side.charge)} / mo</th>
            <th>{aso ? 'ASO household' : 'Renter'} invests / mo</th>
            {ownerColumn && <th>Owner invests / mo</th>}
            <th>Home equity</th>
            {aso && <th>Payment back</th>}
            <th>Buying</th>
            <th>{side.short}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ y, r }) => (
            <tr key={r.month}>
              <th className="rowhead">
                {fmtNum(y)} {y === 1 ? 'year' : 'years'}
              </th>
              <td className="num">{fmtEur(r.buyerPays)}</td>
              <td className="num">
                {fmtEur(r.rent)}
                {r.altLoanPayment > 0 && (
                  <span className="cell-note"> + {fmtEur(r.altLoanPayment)} loan</span>
                )}
              </td>
              <td className="num">
                {fmtEur(r.renterInvests)}
                {r.renterShort > 0 && (
                  <span className="cell-note"> {fmtEur(r.renterShort)} short</span>
                )}
              </td>
              {ownerColumn && <td className="num">{fmtEur(r.ownerInvests)}</td>}
              <td className="num">{fmtEur(r.homeEquity)}</td>
              {aso && <td className="num">{fmtEur(r.asoValue)}</td>}
              <td className="num">{fmtEur(r.buyerNetWorth)}</td>
              <td className="num">{fmtEur(r.renterNetWorth)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ outcome */

function Outcome({ result, subject }: { result: Comparison; subject: AnalysisSubject }) {
  const {
    months,
    leader,
    breakEvenReturnPct,
    breakEvenRent,
    renterInvested,
    renterStart,
    altLoan,
    altInterest,
    ownerInvested,
    totalRent,
    totalInterest,
    totalCharges,
  } = result
  const side = sideOf(result.alternative)
  const aso = result.alternative.kind === 'aso'
  const last = months[months.length - 1]
  const years = fmtNum(months.length / 12)

  let breakEven: string
  let breakEvenNote: string
  if (breakEvenReturnPct !== null) {
    breakEven = `${fmtNum(Math.round(breakEvenReturnPct * 10) / 10)} %/yr`
    breakEvenNote = `${side.lower} wins if investments earn more than this, buying if less`
  } else if (leader === 'rent') {
    breakEven = `${side.short}, at any return`
    breakEvenNote = `even money under the mattress ends ahead of buying here`
  } else {
    breakEven = 'Buying, up to 30 %/yr'
    breakEvenNote = 'no realistic return catches the home'
  }

  let rentEdge: string
  let rentEdgeNote: string
  if (breakEvenRent !== null) {
    rentEdge = `${fmtEur(breakEvenRent)}/mo`
    rentEdgeNote = aso
      ? 'at the set return: the aso home wins below these charges, buying above — the payment held'
      : 'at the set return: renting wins below this rent, buying above'
  } else if (leader === 'rent') {
    rentEdge = aso ? 'ASO, at any charge' : 'Renting, at any rent'
    rentEdgeNote = aso
      ? 'the payment and the cash left outgrow the home at this return'
      : 'the closing cash alone outgrows the home at this return'
  } else {
    rentEdge = aso ? 'Buying, even charge-free' : 'Buying, even rent-free'
    rentEdgeNote = `${side.who} investing the owner’s whole budget still ends behind`
  }

  const startNote = aso
    ? altLoan > 0
      ? `nothing at the start — the payment takes all ${fmtEur(subject.cashAtClosing)} and a ${fmtEur(altLoan)} loan (${fmtEur(altInterest)} of interest) · then what the charges leave`
      : `${fmtEur(renterStart)} at the start, what the payment leaves of the closing cash · then what the charges leave`
    : `${fmtEur(subject.cashAtClosing)} at closing, then what the rent leaves`

  return (
    <div className="stat-row">
      <div className="stat">
        <span className="stat-label">After {years} years</span>
        <span className="stat-value">{leadText(result)}</span>
        <span className="stat-sub">
          buying {fmtEur(last.buyerNetWorth)} · {side.lower} {fmtEur(last.renterNetWorth)}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">Break-even {side.charge}</span>
        <span className="stat-value">{rentEdge}</span>
        <span className="stat-sub">{rentEdgeNote}</span>
      </div>
      <div className="stat">
        <span className="stat-label">Break-even return</span>
        <span className="stat-value">{breakEven}</span>
        <span className="stat-sub">{breakEvenNote}</span>
      </div>
      <div className="stat">
        <span className="stat-label">{cap(side.who)} puts in</span>
        <span className="stat-value">{fmtEur(renterInvested)}</span>
        <span className="stat-sub">
          {startNote}
          {last.renterPortfolio > 0 &&
            ` · ${pct(renterInvested, last.renterPortfolio)} % of the final portfolio`}
          {ownerInvested > 0 && ` · the owner puts in ${fmtEur(ownerInvested)}`}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">{cap(side.charge)} over the term</span>
        <span className="stat-value">{fmtEur(totalRent)}</span>
        <span className="stat-sub">
          against {fmtEur(totalInterest)} of interest and {fmtEur(totalCharges)} of charges for the
          owner
          {aso && ` · the payment comes back as ${fmtEur(last.asoValue)}`}
        </span>
      </div>
    </div>
  )
}
