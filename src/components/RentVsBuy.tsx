import { useState } from 'react'
import { rentVsBuy, type HousingSituation, type RentVsBuy as Comparison } from '../housing'
import { fmtEur, fmtNum } from '../format'
import { pct, tableYears, yearOf } from './chartHelpers'
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
 * Buying wears the ownership blue the principal line already uses; renting
 * gets the teal slot, which passes the palette checks against it in both
 * themes.
 */

const BUY_COLOR = 'var(--series-1)'
const RENT_COLOR = 'var(--series-3)'

export function RentVsBuy({
  situation,
  subjects,
  subjectId,
  onSelectSubject,
  onChange,
}: {
  situation: HousingSituation
  subjects: AnalysisSubject[]
  subjectId: string | null
  onSelectSubject: (id: string) => void
  onChange: (s: HousingSituation) => void
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const usable = subjects.filter((s) => s.price > 0)
  const subject = usable.find((s) => s.id === subjectId) ?? usable[0]
  if (!subject) return null

  const set = (patch: Partial<HousingSituation>) => onChange({ ...situation, ...patch })
  const asked = situation.rentPerMonth > 0
  const result = asked ? rentVsBuy(subject, situation) : null

  return (
    <div className="card schedule-card">
      <div className="schedule-head">
        <div className="cmp-title display">Rent instead, and invest the difference</div>
        <div className="cmp-caption">the same money, two ways: a mortgage, or rent plus a portfolio</div>
        {result && <ViewToggle view={view} onChange={setView} />}
      </div>

      <SubjectChips
        subjects={usable}
        selected={subject}
        onSelect={onSelectSubject}
        note={(s) => fmtEur(s.price)}
      />

      <div className="analysis-fields">
        <NumberField
          compact
          label="Rent instead"
          value={situation.rentPerMonth}
          onChange={(n) => set({ rentPerMonth: Math.max(0, n) })}
          unit="€/mo"
        />
        <NumberField
          compact
          label="Rent rises"
          value={situation.rentGrowthPct}
          onChange={(n) => set({ rentGrowthPct: Math.max(-99, n) })}
          unit="%/yr"
          hint="the charges rise with it"
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
          Type the rent a comparable place would cost. The renter keeps the{' '}
          {fmtEur(subject.cashAtClosing)} that closing would take and invests it from day one;
          after that, whoever pays less each month invests the difference.
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
            The home sells tax-free and investment gains are taxed at {fmtNum(situation.gainsTaxPct)}{' '}
            % at the end. Not counted: selling costs, a rent deposit, and the years after the loan
            is repaid, when owning gets cheaper still.
          </p>
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------- chart */

function ComparisonChart({ result }: { result: Comparison }) {
  const { months, leader, leaderFrom } = result
  const marker =
    leader !== null && leaderFrom !== null && leaderFrom > 1
      ? {
          month: leaderFrom,
          text: `${leader === 'buy' ? 'Buying' : 'Renting'} ahead from ${
            leaderFrom <= 12 ? `month ${leaderFrom}` : `year ${yearOf(leaderFrom)}`
          }`,
        }
      : null
  return (
    <TwoLineChart
      a={{
        label: 'Buying — home equity plus any side investments',
        short: 'Buying',
        color: BUY_COLOR,
        values: months.map((m) => m.buyerNetWorth),
      }}
      b={{
        label: 'Renting — the portfolio, after tax on gains',
        short: 'Renting',
        color: RENT_COLOR,
        values: months.map((m) => m.renterNetWorth),
      }}
      marker={marker}
      yCaption="€ net worth"
      ariaLabel="Net worth of buying against renting and investing, month by month. Arrow keys step a year, with Shift a month; the Table view lists the same figures."
      tooltip={(month) => {
        const r = months[month - 1]
        return (
          <>
            <TipRow color={BUY_COLOR} value={fmtEur(r.buyerNetWorth)} label="buying" />
            <TipRow color={RENT_COLOR} value={fmtEur(r.renterNetWorth)} label="renting" />
            <TipRule />
            <TipRow value={fmtEur(r.buyerPays)} label="the owner pays this month" />
            <TipRow value={fmtEur(r.rent)} label="rent" />
            <TipRow
              value={fmtEur(Math.abs(r.invested))}
              label={r.invested >= 0 ? 'the renter invests' : 'the owner invests'}
            />
            <TipRow value={fmtEur(r.homeEquity)} label="home equity" />
          </>
        )
      }}
    />
  )
}

/* -------------------------------------------------------------------- table */

function ComparisonTable({ result }: { result: Comparison }) {
  const { months } = result
  const n = months.length
  const rows = tableYears(n).map((y) => ({
    y: Math.min(y, n / 12),
    r: months[Math.min(n, y * 12) - 1],
  }))
  return (
    <div className="cmp-scroll">
      <table className="cmp schedule-table">
        <thead>
          <tr>
            <th className="rowhead">After</th>
            <th>Owner pays / mo</th>
            <th>Rent / mo</th>
            <th>Invested / mo</th>
            <th>Home equity</th>
            <th>Buying</th>
            <th>Renting</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ y, r }) => (
            <tr key={r.month}>
              <th className="rowhead">
                {fmtNum(y)} {y === 1 ? 'year' : 'years'}
              </th>
              <td className="num">{fmtEur(r.buyerPays)}</td>
              <td className="num">{fmtEur(r.rent)}</td>
              <td className="num">
                {fmtEur(Math.abs(r.invested))}
                <span className="cell-note"> {r.invested >= 0 ? 'renter' : 'owner'}</span>
              </td>
              <td className="num">{fmtEur(r.homeEquity)}</td>
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
  const { months, leader, breakEvenReturnPct, renterInvested, totalRent, totalInterest, totalCharges } =
    result
  const last = months[months.length - 1]
  const gap = last.buyerNetWorth - last.renterNetWorth
  const years = fmtNum(months.length / 12)

  let breakEven: string
  let breakEvenNote: string
  if (breakEvenReturnPct !== null) {
    breakEven = `${fmtNum(Math.round(breakEvenReturnPct * 10) / 10)} %/yr`
    breakEvenNote = 'renting wins if investments earn more than this, buying if less'
  } else if (leader === 'rent') {
    breakEven = 'Renting, at any return'
    breakEvenNote = 'even money under the mattress ends ahead of buying here'
  } else {
    breakEven = 'Buying, up to 30 %/yr'
    breakEvenNote = 'no realistic return catches the home'
  }

  return (
    <div className="stat-row">
      <div className="stat">
        <span className="stat-label">After {years} years</span>
        <span className="stat-value">
          {leader === 'buy'
            ? `Buying ahead by ${fmtEur(gap)}`
            : leader === 'rent'
              ? `Renting ahead by ${fmtEur(-gap)}`
              : 'Level'}
        </span>
        <span className="stat-sub">
          buying {fmtEur(last.buyerNetWorth)} · renting {fmtEur(last.renterNetWorth)}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">Break-even return</span>
        <span className="stat-value">{breakEven}</span>
        <span className="stat-sub">{breakEvenNote}</span>
      </div>
      <div className="stat">
        <span className="stat-label">The renter puts in</span>
        <span className="stat-value">{fmtEur(renterInvested)}</span>
        <span className="stat-sub">
          {fmtEur(subject.cashAtClosing)} at closing, then the monthly difference ·{' '}
          {pct(renterInvested, last.renterPortfolio)} % of the final portfolio
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">Rent over the term</span>
        <span className="stat-value">{fmtEur(totalRent)}</span>
        <span className="stat-sub">
          against {fmtEur(totalInterest)} of interest and {fmtEur(totalCharges)} of charges for the
          owner
        </span>
      </div>
    </div>
  )
}
