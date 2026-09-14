import { useState } from 'react'
import { ZONE_LABELS, findArea, kindLabel, seriesKindFor } from '../areas'
import { HELSINKI_PRICES } from '../data/helsinkiPrices'
import { HOME_TYPES, type HomeType, type PropertyListing } from '../housing'
import { NumberField } from './NumberField'

/** What the postal code field says under itself: the area it found, or why it found none. */
function postalHint(code: string): string {
  if (!code) return 'Helsinki only — links the place to its area in "Helsinki by area"'
  const area = findArea(HELSINKI_PRICES, code)
  if (area) return `${area.name} · price zone ${area.zone}, ${ZONE_LABELS[area.zone]}`
  return code.length < 5 ? 'five digits, e.g. 00730' : 'not a Helsinki postal code the price data covers'
}

/** What the type field says under itself: which price series the place will be read against. */
function typeHint(type: HomeType | '', rooms: number): string {
  if (!type) return 'read as all flats in the price data until you say'
  const kind = seriesKindFor(type, rooms)
  if (kind === null)
    return 'real estate: the higher transfer tax, by itself; not in the housing-company price data — no area trend, the zone index still applies'
  if (type === 'terraced') return 'one price series whatever the size'
  return rooms > 0
    ? `measured against ${kindLabel(kind).toLowerCase()} in its area`
    : 'all flats — give the rooms to narrow it to a room-count series'
}

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
            {/*
              The type picks which of Statistics Finland's series the place is
              measured against - flats by room count, terraced houses as one,
              and a detached house as none. It matters more than it looks: an
              area can publish seventeen years of terraced prices and almost
              no flat ones, so the wrong default reads as "no data".
            */}
            <label className="field">
              <span className="field-label">Type</span>
              <span className="field-input-wrap">
                <select
                  value={draft.homeType}
                  onChange={(e) => set({ homeType: e.target.value as HomeType | '' })}
                >
                  <option value="">Not said</option>
                  {HOME_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label} — {t.fi}
                    </option>
                  ))}
                </select>
              </span>
              <span className="field-hint">{typeHint(draft.homeType, draft.rooms)}</span>
            </label>
            <NumberField
              label="Rooms"
              value={draft.rooms}
              onChange={(n) => set({ rooms: Math.max(0, Math.round(n)) })}
              unit="rooms"
              hint="the 2 of 2h+k — kitchen not counted"
            />
            <label className="field">
              <span className="field-label">Postal code</span>
              <span className="field-input-wrap">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  value={draft.postalCode}
                  placeholder="00730"
                  onChange={(e) =>
                    set({ postalCode: e.target.value.replace(/\D/g, '').slice(0, 5) })
                  }
                />
              </span>
              <span className="field-hint">{postalHint(draft.postalCode)}</span>
            </label>
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
