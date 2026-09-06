import { useState } from 'react'
import type { PropertyListing } from '../housing'
import { NumberField } from './NumberField'

interface Props {
  initial: PropertyListing
  isNew: boolean
  onSave: (p: PropertyListing) => void
  onCancel: () => void
}

export function PropertyForm({ initial, isNew, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<PropertyListing>({ ...initial })
  const set = (patch: Partial<PropertyListing>) => setDraft((d) => ({ ...d, ...patch }))

  function save() {
    onSave({ ...draft, name: draft.name.trim() || 'Unnamed place' })
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <div className="modal-title display">{isNew ? 'Add place' : 'Edit place'}</div>
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
          <div className="section-title">Place</div>
          <div className="form-grid">
            <label className="field span-2">
              <span className="field-label">Name</span>
              <span className="field-input-wrap">
                <input
                  type="text"
                  value={draft.name}
                  placeholder="Kamppi 2h+k, 58 m²"
                  onChange={(e) => set({ name: e.target.value })}
                  autoFocus={isNew}
                />
              </span>
            </label>
            <NumberField
              label="Asking price"
              value={draft.price}
              onChange={(n) => set({ price: Math.max(0, n) })}
              unit="€"
            />
            <NumberField
              label="Size"
              value={draft.sizeM2}
              onChange={(n) => set({ sizeM2: Math.max(0, n) })}
              unit="m²"
            />
            <label className="field">
              <span className="field-label">Notes</span>
              <span className="field-input-wrap">
                <input
                  type="text"
                  value={draft.notes}
                  placeholder="viewing on Tuesday, link…"
                  onChange={(e) => set({ notes: e.target.value })}
                />
              </span>
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-title">Charges per month</div>
          <div className="form-grid">
            <NumberField
              label="Maintenance charge"
              value={draft.maintenancePerMonth}
              onChange={(n) => set({ maintenancePerMonth: Math.max(0, n) })}
              unit="€/mo"
              hint="hoitovastike"
            />
            <NumberField
              label="Financing charge"
              value={draft.financingChargePerMonth}
              onChange={(n) => set({ financingChargePerMonth: Math.max(0, n) })}
              unit="€/mo"
              hint="rahoitusvastike — the housing company's own loan"
            />
            <NumberField
              label="Other"
              value={draft.otherPerMonth}
              onChange={(n) => set({ otherPerMonth: Math.max(0, n) })}
              unit="€/mo"
              hint="parking, sauna, broadband…"
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save place
          </button>
        </div>
      </div>
    </div>
  )
}
