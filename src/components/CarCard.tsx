import type { CarListing } from '../types'
import type { TcoResult } from '../calc'
import { fmtEur, fmtEurExact } from '../format'
import { POWERTRAIN_LABEL } from '../labels'
import { BreakdownBar } from './BreakdownBar'

interface Props {
  car: CarListing
  tco: TcoResult
  years: number
  cheapest: boolean
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}

export function CarCard({ car, tco, years, cheapest, onEdit, onDuplicate, onDelete }: Props) {
  const isLoan = car.financing.method === 'loan'
  return (
    <div className="card car-card">
      <div className="car-card-head">
        <div className="car-name display">{car.name || 'Unnamed car'}</div>
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
          <span className="stat-label">Over {years} yrs</span>
          <span className="stat-value">{fmtEur(tco.total)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Running / mo</span>
          <span className="stat-value">{fmtEur(tco.runningPerMonth)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{isLoan ? 'Loan / mo' : 'Financing'}</span>
          <span className="stat-value">
            {isLoan ? fmtEurExact(tco.loan.monthlyPayment) : 'Cash'}
          </span>
        </div>
      </div>

      <BreakdownBar breakdown={tco.breakdown} total={tco.total} />

      {car.notes && <div className="car-notes">{car.notes}</div>}

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
    </div>
  )
}
