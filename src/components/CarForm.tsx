import { useEffect, useState } from 'react'
import type {
  CarListing,
  FinancingMethod,
  Lease,
  LeaseIncludes,
  Powertrain,
  Settings,
} from '../types'
import {
  STANDARD_BALLOON_SHARE,
  calcLease,
  calcLoan,
  calcTco,
  estimateResaleValue,
  resolveYears,
} from '../calc'
import { fmtEur, fmtEurExact, fmtNum } from '../format'
import {
  FINANCING_LABEL,
  LEASE_INCLUDE_KEYS,
  LEASE_INCLUDE_LABEL,
  POWERTRAIN_LABEL,
} from '../labels'
import { NumberField } from './NumberField'

interface Props {
  initial: CarListing
  isNew: boolean
  settings: Settings
  onSave: (car: CarListing) => void
  onCancel: () => void
}

const POWERTRAINS: Powertrain[] = ['petrol', 'diesel', 'ev', 'phev']
const METHODS: FinancingMethod[] = ['cash', 'loan', 'lease']

/** "a", "a and b", "a, b and c" */
function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

export function CarForm({ initial, isNew, settings, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<CarListing>(initial)
  const years = resolveYears(draft, settings)

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
  const setLease = (patch: Partial<Lease>) =>
    setDraft((d) => ({ ...d, lease: { ...d.lease, ...patch } }))
  const toggleIncluded = (key: keyof LeaseIncludes) =>
    setDraft((d) => ({
      ...d,
      lease: { ...d.lease, includes: { ...d.lease.includes, [key]: !d.lease.includes[key] } },
    }))

  const usesFuel = draft.powertrain !== 'ev'
  const usesElectricity = draft.powertrain === 'ev' || draft.powertrain === 'phev'
  const method = draft.financing.method
  const isLoan = method === 'loan'
  const isLease = method === 'lease'
  const loan = calcLoan(draft)
  const lease = calcLease(draft, settings)
  const hasKmCap = draft.lease.includedKmPerYear > 0
  const standardBalloon = Math.round(draft.purchasePrice * STANDARD_BALLOON_SHARE)
  const resaleEstimate = estimateResaleValue(draft, settings)
  // The real calculation, so the preview honours whatever the lease covers
  const runningPerMonth = calcTco(draft, settings).runningPerMonth
  const covered = isLease ? LEASE_INCLUDE_KEYS.filter((k) => draft.lease.includes[k]) : []
  const showsYearly = (key: keyof LeaseIncludes) => !covered.includes(key)
  const coveredNote = covered.length
    ? `The lease covers ${joinWords(covered.map((k) => LEASE_INCLUDE_LABEL[k].toLowerCase()))} — not counted again here.`
    : ''

  const leaseNotes: string[] = []
  if (draft.lease.upfront > 0) {
    leaseNotes.push(`${fmtEur(draft.lease.upfront)} at signing, counted ${lease.termsStarted}×`)
  }
  if (lease.excessKmCost > 0) {
    leaseNotes.push(
      `${fmtEur(lease.excessKmCost)} for the ${fmtNum(lease.excessKmPerYear)} km/yr past the allowance`,
    )
  }
  if (lease.termsStarted > 1) {
    leaseNotes.push(
      `the term ends before the ${fmtNum(years)}-year comparison does, so it is costed as leasing again on the same terms`,
    )
  }

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
            <NumberField
              label="Comparison period"
              value={draft.keepYears}
              onChange={(n) => set({ keepYears: Math.max(0, n) })}
              unit="years"
              hint={
                draft.keepYears > 0
                  ? `This car is costed over its own ${fmtNum(draft.keepYears)}-year period.`
                  : `0 = the shared assumption (${fmtNum(settings.ownershipYears)} yrs).`
              }
            />
          </div>
        </div>

        {/* Nothing here applies to a lease: it is handed back, so there is no
            purchase price to lose value and no resale to estimate. */}
        {!isLease && (
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
        )}

        <div className="form-section">
          <div className="section-title">Financing</div>
          <div className="segmented">
            {METHODS.map((m) => (
              <button
                key={m}
                className={method === m ? 'active' : ''}
                onClick={() => setFin({ method: m })}
              >
                {FINANCING_LABEL[m]}
              </button>
            ))}
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
                  {years * 12 < draft.financing.termMonths && (
                    <span className="preview-side">
                      · only the {fmtNum(years)} yrs of interest accrued by then count in
                      the total
                    </span>
                  )}
                </div>
              )}
            </>
          )}
          {isLease && (
            <>
              <div className="form-grid">
                <NumberField
                  label="Monthly payment"
                  value={draft.lease.monthlyPayment}
                  onChange={(n) => setLease({ monthlyPayment: Math.max(0, n) })}
                  unit="€ / month"
                />
                <NumberField
                  label="Term"
                  value={draft.lease.termMonths}
                  onChange={(n) => setLease({ termMonths: Math.max(1, n) })}
                  unit="months"
                />
                <NumberField
                  label="Paid at signing"
                  value={draft.lease.upfront}
                  onChange={(n) => setLease({ upfront: Math.max(0, n) })}
                  unit="€"
                  hint="Enlarged first installment, delivery and registration fees."
                />
                <NumberField
                  label="Mileage allowance"
                  value={draft.lease.includedKmPerYear}
                  onChange={(n) => setLease({ includedKmPerYear: Math.max(0, n) })}
                  unit="km / yr"
                  hint="Leave at 0 if the contract sets no limit."
                />
                {hasKmCap && (
                  <>
                    <NumberField
                      label="Excess kilometre fee"
                      value={draft.lease.excessKmFee}
                      onChange={(n) => setLease({ excessKmFee: Math.max(0, n) })}
                      unit="€ / km"
                    />
                    <div className="field">
                      <span className="field-label">Past the allowance</span>
                      <span className="field-input-wrap field-static">
                        <span className="field-static-value">
                          {lease.excessKmPerYear > 0
                            ? `${fmtNum(lease.excessKmPerYear)} km / yr`
                            : 'nothing'}
                        </span>
                        <span className="field-unit">at {fmtNum(settings.annualKm)} km/yr</span>
                      </span>
                    </div>
                  </>
                )}
                <div className="field span-2">
                  <span className="field-label">Included in the lease</span>
                  <div className="filter-chips">
                    {LEASE_INCLUDE_KEYS.map((k) => (
                      <button
                        key={k}
                        className={`filter-chip${draft.lease.includes[k] ? ' active' : ''}`}
                        aria-pressed={draft.lease.includes[k]}
                        onClick={() => toggleIncluded(k)}
                      >
                        {LEASE_INCLUDE_LABEL[k]}
                      </button>
                    ))}
                  </div>
                  <span className="field-hint">
                    What the price already covers, the way full-service leasing does — these
                    drop out of the yearly costs below instead of being paid twice.
                  </span>
                </div>
              </div>
              {Math.abs(years * 12 - draft.lease.termMonths) > 0.5 && (
                <button
                  className="inline-link"
                  onClick={() => set({ keepYears: draft.lease.termMonths / 12 })}
                >
                  Compare this car over the contract term only (
                  {fmtNum(draft.lease.termMonths)} months)
                </button>
              )}
              {lease.total > 0 && (
                <>
                  <div className="preview-row">
                    <span className="preview-main display">{fmtEur(lease.perMonth)} / month</span>
                    <span className="preview-side">
                      · everything the contract costs, over {fmtNum(years)}{' '}
                      {years === 1 ? 'year' : 'years'}
                    </span>
                  </div>
                  {leaseNotes.length > 0 && (
                    <span className="field-hint">{leaseNotes.join(' · ')}</span>
                  )}
                </>
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
            {showsYearly('insurance') && (
              <NumberField
                label="Insurance"
                value={draft.insurancePerYear}
                onChange={(n) => set({ insurancePerYear: n })}
                unit="€ / yr"
              />
            )}
            {showsYearly('tax') && (
              <NumberField
                label="Vehicle tax"
                value={draft.taxPerYear}
                onChange={(n) => set({ taxPerYear: n })}
                unit="€ / yr"
              />
            )}
            {showsYearly('maintenance') && (
              <NumberField
                label="Maintenance"
                value={draft.maintenancePerYear}
                onChange={(n) => set({ maintenancePerYear: n })}
                unit="€ / yr"
              />
            )}
            {showsYearly('tires') && (
              <NumberField
                label="Tires"
                value={draft.tiresPerYear}
                onChange={(n) => set({ tiresPerYear: n })}
                unit="€ / yr"
              />
            )}
            <NumberField
              label="Other"
              value={draft.otherPerYear}
              onChange={(n) => set({ otherPerYear: n })}
              unit="€ / yr"
            />
          </div>
          {coveredNote && <span className="field-hint">{coveredNote}</span>}
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
