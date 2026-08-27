import type { CarListing } from '../types'
import type { TcoResult } from '../calc'
import { fmtEur, fmtEurExact, fmtNum } from '../format'
import { FINANCING_LABEL, POWERTRAIN_LABEL } from '../labels'
import { BreakdownBar } from './BreakdownBar'

interface Props {
  car: CarListing
  tco: TcoResult
  cheapest: boolean
  selected: boolean
  /** shared-view mode: no editing affordances, favorite star is display-only */
  readOnly?: boolean
  onToggleSelect: () => void
  onToggleFavorite: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}

export function CarCard({
  car,
  tco,
  cheapest,
  selected,
  readOnly,
  onToggleSelect,
  onToggleFavorite,
  onEdit,
  onDuplicate,
  onDelete,
}: Props) {
  const isLoan = car.financing.method === 'loan'
  const isLease = car.financing.method === 'lease'
  return (
    <div className={`card car-card${selected ? ' selected' : ''}`}>
      <div className="car-card-head">
        <label className="select-box" title="Select for comparison">
          <input type="checkbox" checked={selected} onChange={onToggleSelect} />
        </label>
        <div className="car-name display">{car.name || 'Unnamed car'}</div>
        {readOnly ? (
          car.favorite && (
            <span className="fav-btn active" title="Favorited by the owner" aria-label="Favorite">
              <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" stroke="none">
                <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
              </svg>
            </span>
          )
        ) : (
          <button
            className={`fav-btn${car.favorite ? ' active' : ''}`}
            onClick={onToggleFavorite}
            aria-pressed={car.favorite}
            aria-label={car.favorite ? 'Remove from favorites' : 'Add to favorites'}
            title={car.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 16 16"
              fill={car.favorite ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            >
              <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
            </svg>
          </button>
        )}
        {isLease && <span className="chip">{FINANCING_LABEL.lease}</span>}
        <span className="chip">{POWERTRAIN_LABEL[car.powertrain]}</span>
      </div>

      <div className="hero-row">
        <div>
          <span className="hero-value display">{fmtEur(tco.perMonth)}</span>
          <span className="hero-unit">/mo</span>
        </div>
        {cheapest && (
          <span className="badge-good">
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 6.5l2.5 2.5L10 3.5" />
            </svg>
            Lowest cost
          </span>
        )}
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Per km</span>
          <span className="stat-value">{fmtEurExact(tco.perKm)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Over {fmtNum(tco.years)} yrs</span>
          <span className="stat-value">{fmtEur(tco.total)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Running / mo</span>
          <span className="stat-value">{fmtEur(tco.runningPerMonth)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">
            {isLoan ? 'Loan / mo' : isLease ? 'Lease / mo' : 'Financing'}
          </span>
          <span className="stat-value">
            {isLoan
              ? fmtEurExact(tco.loan.monthlyPayment)
              : isLease
                ? fmtEurExact(tco.lease.monthlyPayment)
                : 'Cash'}
          </span>
        </div>
        {(isLoan || isLease) && (
          <div className="stat">
            <span className="stat-label">Out of pocket / mo</span>
            <span className="stat-value">{fmtEur(tco.outOfPocketPerMonth)}</span>
          </div>
        )}
      </div>

      <BreakdownBar breakdown={tco.breakdown} total={tco.total} />

      {car.notes && <div className="car-notes">{car.notes}</div>}

      {!readOnly && (
        <div className="car-actions">
          <button className="link-btn" onClick={onEdit}>
            Edit
          </button>
          <button className="link-btn" onClick={onDuplicate}>
            Duplicate
          </button>
          <button className="link-btn danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
