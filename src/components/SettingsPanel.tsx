import { useState } from 'react'
import type { Settings } from '../types'
import { fmtNum } from '../format'
import { NumberField } from './NumberField'

interface Props {
  settings: Settings
  onChange: (s: Settings) => void
}

export function SettingsPanel({ settings, onChange }: Props) {
  const [expanded, setExpanded] = useState(false)

  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })

  const summary = `${fmtNum(settings.annualKm)} km/yr · ${fmtNum(settings.ownershipYears)} yrs · ${fmtNum(settings.petrolPrice)} €/l · ${fmtNum(settings.electricityPrice)} €/kWh`

  return (
    <div className={`card assumptions${expanded ? ' expanded' : ''}`}>
      <div className="assumptions-heading">
        <div className="assumptions-title">Assumptions</div>
        <div className="assumptions-caption">shared by every car</div>
      </div>
      <div className="assumptions-summary">
        <span className="assumptions-summary-text">{summary}</span>
        <button className="assumptions-toggle" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Done' : 'Edit'}
        </button>
      </div>
      <div className="assumptions-fields">
        <NumberField
          compact
          label="Driving / year"
          value={settings.annualKm}
          onChange={(n) => set({ annualKm: Math.max(0, n) })}
          unit="km"
        />
        <NumberField
          compact
          label="Ownership"
          value={settings.ownershipYears}
          onChange={(n) => set({ ownershipYears: Math.max(1, n) })}
          unit="years"
        />
        <NumberField
          compact
          label="Petrol"
          value={settings.petrolPrice}
          onChange={(n) => set({ petrolPrice: Math.max(0, n) })}
          unit="€/l"
        />
        <NumberField
          compact
          label="Diesel"
          value={settings.dieselPrice}
          onChange={(n) => set({ dieselPrice: Math.max(0, n) })}
          unit="€/l"
        />
        <NumberField
          compact
          label="Electricity"
          value={settings.electricityPrice}
          onChange={(n) => set({ electricityPrice: Math.max(0, n) })}
          unit="€/kWh"
        />
      </div>
    </div>
  )
}
