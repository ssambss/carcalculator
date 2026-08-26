import { useEffect, useState } from 'react'
import type { CarListing, Powertrain, Settings } from '../types'
import {
  STANDARD_BALLOON_SHARE,
  calcLoan,
  energyCostPerYear,
  estimateResaleValue,
} from '../calc'
import { fmtEur, fmtEurExact, fmtNum } from '../format'
import { POWERTRAIN_LABEL } from '../labels'
import { NumberField } from './NumberField'

interface Props {
  initial: CarListing
  isNew: boolean
  settings: Settings
  onSave: (car: CarListing) => void
  onCancel: () => void
}

const POWERTRAINS: Powertrain[] = ['petrol', 'diesel', 'ev', 'phev']

export function CarForm({ initial, isNew, settings, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<CarListing>(initial)
  const years = settings.ownershipYears

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const set = (patch: Partial<CarListing>) => setDraft((d) => ({ ...d, ...patch }))
  const setFin = (patch: Partial<CarListing['financing']>) =>
    setDraft((d) => ({ ...d, financing: { ...d.financing, ...patch } }))

  const usesFuel = draft.powertrain !== 'ev'
  const usesElectricity = draft.powertrain === 'ev' || draft.powertrain === 'phev'
  const isLoan = draft.financing.method === 'loan'
  const loan = calcLoan(draft)
  const standardBalloon = Math.round(draft.purchasePrice * STANDARD_BALLOON_SHARE)
  const resaleEstimate = estimateResaleValue(draft, settings)
  const runningPerMonth =
    (energyCostPerYear(draft, settings) +
      draft.insurancePerYear +
      draft.taxPerYear +
      draft.maintenancePerYear +
      draft.tiresPerYear +
      draft.otherPerYear) /
    12

  function save() {
    onSave({ ...draft, name: draft.name.trim() || 'Unnamed car' })
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <div className="modal-title display">{isNew ? 'Add car' : 'Edit car'}</div>
          <button className="modal-close" onClick={onCancel} aria-label="Close">
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M5 5l10 10" />
              <path d="M15 5L5 15" />
            </svg>
          </button>
        </div>

        <div className="form-section">
          <div className="section-title">Car</div>
          <div className="form-grid">
            <label className="field span-2">
              <span className="field-label">Name</span>
              <span className="field-input-wrap">
                <input
                  type="text"
                  value={draft.name}
                  placeholder="e.g. Škoda Octavia 2.0 TSI (2022)"
                  onChange={(e) => set({ name: e.target.value })}
                  autoFocus={isNew}
                />
              </span>
            </label>
            <label className="field">
              <span className="field-label">Powertrain</span>
              <span className="field-input-wrap">
                <select
                  value={draft.powertrain}
                  onChange={(e) => set({ powertrain: e.target.value as Powertrain })}
                >
                  {POWERTRAINS.map((p) => (
                    <option key={p} value={p}>
                      {POWERTRAIN_LABEL[p]}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className="field">
              <span className="field-label">Notes</span>
              <span className="field-input-wrap">
                <input
                  type="text"
                  value={draft.notes}
                  placeholder="dealer, offer, links…"
                  onChange={(e) => set({ notes: e.target.value })}
                />
              </span>
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-title">Purchase &amp; value</div>
          <div className="form-grid">
            <NumberField
              label="Purchase price"
              value={draft.purchasePrice}
              onChange={(n) => set({ purchasePrice: n })}
              unit="€"
            />
            <NumberField
              label="Odometer"
              value={draft.odometerKm}
              onChange={(n) => set({ odometerKm: Math.max(0, n) })}
              unit="km"
            />
            {draft.autoResale ? (
              <div className="field span-2">
                <span className="field-label">Expected value after {years} years</span>
                <div className="preview-row">
                  <span className="preview-main display">{fmtEur(resaleEstimate)}</span>
                  <span className="preview-side">· estimated from age &amp; mileage</span>
                  <button
                    className="inline-link"
                    onClick={() =>
                      set({ autoResale: false, expectedResaleValue: resaleEstimate })
                    }
                  >
                    Enter manually
                  </button>
                </div>
              </div>
            ) : (
              <>
                <NumberField
                  label={`Expected value after ${years} years`}
                  value={draft.expectedResaleValue}
                  onChange={(n) => set({ expectedResaleValue: n })}
                  unit="€"
                />
                <div className="field">
                  <span className="field-label">&nbsp;</span>
                  <button
                    className="inline-link field-side-link"
                    onClick={() => set({ autoResale: true })}
                  >
                    Use estimate ({fmtEur(resaleEstimate)})
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="form-section">
          <div className="section-title">Financing</div>
          <div className="segmented">
            <button
              className={isLoan ? '' : 'active'}
              onClick={() => setFin({ method: 'cash' })}
            >
              Cash
            </button>
            <button
              className={isLoan ? 'active' : ''}
              onClick={() => setFin({ method: 'loan' })}
            >
              Loan
            </button>
          </div>
          {isLoan && (
            <>
              <div className="form-grid">
                <NumberField
                  label="Down payment"
                  value={draft.financing.downPayment}
                  onChange={(n) => setFin({ downPayment: n })}
                  unit="€"
                />
                <NumberField
                  label="Interest rate"
                  value={draft.financing.annualRatePct}
                  onChange={(n) => setFin({ annualRatePct: n })}
                  unit="% / year"
                />
                <NumberField
                  label="Term"
                  value={draft.financing.termMonths}
                  onChange={(n) => setFin({ termMonths: n })}
                  unit="months"
                />
                {draft.financing.autoBalloon ? (
                  <div className="field-stack">
                    <div className="field">
                      <span className="field-label">Final balloon payment</span>
                      <span className="field-input-wrap field-static">
                        <span className="field-static-value">{fmtEur(standardBalloon)}</span>
                        <span className="field-unit">25 % of price</span>
                      </span>
                    </div>
                    <button
                      className="inline-link"
                      onClick={() => setFin({ autoBalloon: false, balloon: standardBalloon })}
                    >
                      Enter manually
                    </button>
                  </div>
                ) : (
                  <div className="field-stack">
                    <NumberField
                      label="Final balloon payment"
                      value={draft.financing.balloon}
                      onChange={(n) => setFin({ balloon: n })}
                      unit="€"
                    />
                    <button
                      className="inline-link"
                      onClick={() => setFin({ autoBalloon: true })}
                    >
                      Use standard 25 % ({fmtEur(standardBalloon)})
                    </button>
                  </div>
                )}
              </div>
              {loan.loanAmount > 0 && (
                <div className="preview-row">
                  <span className="preview-main display">
                    {fmtEurExact(loan.monthlyPayment)} / month
                  </span>
                  <span className="preview-side">
                    · {fmtEur(loan.totalInterest)} interest over the term
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="form-section">
          <div className="section-title">Energy use</div>
          <div className="form-grid">
            {usesFuel && (
              <NumberField
                label="Fuel consumption"
                value={draft.fuelLPer100}
                onChange={(n) => set({ fuelLPer100: n })}
                unit="l / 100 km"
              />
            )}
            {usesElectricity && (
              <NumberField
                label="Electricity consumption"
                value={draft.elecKwhPer100}
                onChange={(n) => set({ elecKwhPer100: n })}
                unit="kWh / 100 km"
              />
            )}
            {draft.powertrain === 'phev' && (
              <NumberField
                label="Driven on electricity"
                value={draft.electricSharePct}
                onChange={(n) => set({ electricSharePct: Math.min(100, Math.max(0, n)) })}
                unit="%"
                hint="Share of your yearly kilometres driven on battery power."
              />
            )}
          </div>
        </div>

        <div className="form-section">
          <div className="section-title">Costs per year</div>
          <div className="form-grid">
            <NumberField
              label="Insurance"
              value={draft.insurancePerYear}
              onChange={(n) => set({ insurancePerYear: n })}
              unit="€ / yr"
            />
            <NumberField
              label="Vehicle tax"
              value={draft.taxPerYear}
              onChange={(n) => set({ taxPerYear: n })}
              unit="€ / yr"
            />
            <NumberField
              label="Maintenance"
              value={draft.maintenancePerYear}
              onChange={(n) => set({ maintenancePerYear: n })}
              unit="€ / yr"
            />
            <NumberField
              label="Tires"
              value={draft.tiresPerYear}
              onChange={(n) => set({ tiresPerYear: n })}
              unit="€ / yr"
            />
            <NumberField
              label="Other"
              value={draft.otherPerYear}
              onChange={(n) => set({ otherPerYear: n })}
              unit="€ / yr"
            />
          </div>
          {runningPerMonth > 0 && (
            <div className="preview-row">
              <span className="preview-main display">
                {fmtEur(runningPerMonth)} / month
              </span>
              <span className="preview-side">
                · running costs, energy included at {fmtNum(settings.annualKm)} km/yr
              </span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save car
          </button>
        </div>
      </div>
    </div>
  )
}
