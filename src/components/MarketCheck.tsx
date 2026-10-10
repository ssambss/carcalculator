import { useState } from 'react'
import type { PriceCheckResult } from '../market'
import { fmtEur, fmtNum } from '../format'
import { MarketScatter } from './MarketScatter'

/** Within this of typical, a price is in line with the market rather than a deal or a stretch. */
const IN_LINE = 0.03

const fmtDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return `${d}.${m}.${y}`
}

/** The check is a fit through asking prices: figures to the nearest hundred are as exact as it is. */
const fmtRound = (v: number) => fmtEur(Math.round(v / 100) * 100)

const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000))

/**
 * The asking price against similar listings - a supporting line on the card,
 * with the reasoning and the listings behind it a tap away.
 */
export function MarketCheck({ result, onEdit }: { result: PriceCheckResult; onEdit?: () => void }) {
  const [open, setOpen] = useState(false)

  if (!result.ok) {
    return (
      <div className="market-check quiet">
        {result.reason === 'year' ? (
          <>
            Add the model year to check the price against similar listings.
            {onEdit && (
              <>
                {' '}
                <button className="inline-link" onClick={onEdit}>
                  Edit
                </button>
              </>
            )}
          </>
        ) : (
          `Too few similar listings to check the price against yet${result.count ? ` (${result.count})` : ''}.`
        )}
      </div>
    )
  }

  const share = result.diff / result.typical
  const tone = Math.abs(share) < IN_LINE ? 'in-line' : share < 0 ? 'under' : 'over'
  const verdict =
    tone === 'in-line'
      ? 'In line with the market'
      : `${fmtRound(Math.abs(result.diff))} ${tone === 'under' ? 'under' : 'over'} the market`
  const pct = Math.round(result.pricierShare * 100)
  const own = result.listing
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="market-check">
      <div className="market-row">
        <span className={`market-verdict ${tone}`}>
          {tone !== 'in-line' && (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d={tone === 'under' ? 'M1 3h8L5 8.5z' : 'M1 7h8L5 1.5z'} fill="currentColor" />
            </svg>
          )}
          {verdict}
        </span>
        <span className="market-meta">
          typical {fmtRound(result.typical)} · {fmtNum(result.count)} similar
        </span>
        <button className="inline-link market-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Less' : 'Details'}
        </button>
      </div>

      {open && (
        <div className="market-details">
          <p>
            Typical for a {result.year} with {fmtNum(result.km)} km is <strong>{fmtRound(result.typical)}</strong>;
            the middle half of similar listings ask {fmtRound(result.low)}–{fmtRound(result.high)} for one like it.
          </p>
          <p>
            {pct >= 50
              ? `Cheaper than ${pct} % of them, for their age and mileage.`
              : `Dearer than ${100 - pct} % of them, for their age and mileage.`}{' '}
            Similar means {result.criteria.join(' · ')}: {fmtNum(result.count)} listings seen since{' '}
            {fmtDay(result.since)}
            {result.goneKnown ? `, ${fmtNum(result.gone)} of which have left the site` : ''}.
          </p>
          {own && (
            <p>
              {own.first === result.recordSince
                ? // The record began that day; the advert may well be older.
                  `On sale since at least ${fmtDay(own.first)}, when the record begins`
                : `On sale since ${fmtDay(own.first)}`}
              {own.gone
                ? `, until ${fmtDay(own.last)}, then gone from the site. `
                : ` (${fmtNum(daysBetween(own.first, today))}${own.first === result.recordSince ? '+' : ''} days). `}
              {own.prices.length > 1
                ? `First asked ${fmtEur(own.prices[0][1])}, now ${fmtEur(own.prices[own.prices.length - 1][1])}, after ${own.prices.length - 1} price ${own.prices.length === 2 ? 'change' : 'changes'}.`
                : `Still asking what it first did.`}
            </p>
          )}
          <MarketScatter check={result} />
          <p className="chart-note">
            Asking prices, not what the cars sold for — a deal usually lands somewhat lower. A listing
            counts at the last price it asked, and at the age it was then.
          </p>
        </div>
      )}
    </div>
  )
}
