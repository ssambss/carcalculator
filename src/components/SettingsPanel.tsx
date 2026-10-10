import type { NewCarDefaults, Settings } from '../types'
import { fmtNum } from '../format'
import { useOpen } from '../open'
import { NumberField } from './NumberField'

interface Props {
  settings: Settings
  onChange: (s: Settings) => void
}

export function SettingsPanel({ settings, onChange }: Props) {
  // Folded on a desktop too, as the housing situation is: set once and edited
  // rarely, it was a third of the first screen above the cars it feeds.
  const [expanded, toggle] = useOpen('cars.assumptions')

  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })
  const setNewCar = (patch: Partial<NewCarDefaults>) =>
    onChange({ ...settings, newCar: { ...settings.newCar, ...patch } })

  const summary = `${fmtNum(settings.annualKm)} km/yr · ${fmtNum(settings.ownershipYears)} yrs · ${fmtNum(settings.petrolPrice)} €/l · ${fmtNum(settings.electricityPrice)} €/kWh · new car at ${fmtNum(settings.newCar.annualRatePct)} % / ${fmtNum(settings.newCar.termMonths)} mo`

  return (
    <div className={`card assumptions folding-panel${expanded ? ' expanded' : ''}`}>
      <div className="folding-panel-head">
        <div className="assumptions-heading">
          <div className="assumptions-title">Assumptions</div>
          <div className="assumptions-caption">shared by every car</div>
        </div>
        {!expanded && <span className="assumptions-summary-text">{summary}</span>}
        <button className="assumptions-toggle" aria-expanded={expanded} onClick={toggle}>
          {expanded ? 'Done' : 'Edit'}
        </button>
      </div>
      {expanded && (
        <>
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

          {/*
            What a car starts on before any dealer has quoted a rate. A common
            baseline is the point - candidates only compare if they are financed
            alike until one of them has a real offer. The same goes for the yearly
            costs until a real insurance quote exists. Applies to a car typed in
            here and to one that arrives from a Discord reaction alike.
          */}
          <div className="assumptions-heading">
            <div className="assumptions-title">New car</div>
            <div className="assumptions-caption">what a car starts on, before a real quote</div>
          </div>
          <div className="assumptions-fields">
            <NumberField
              compact
              label="Down payment"
              value={settings.newCar.downPayment}
              onChange={(n) => setNewCar({ downPayment: Math.max(0, n) })}
              unit="€"
            />
            <NumberField
              compact
              label="Interest"
              value={settings.newCar.annualRatePct}
              onChange={(n) => setNewCar({ annualRatePct: Math.max(0, n) })}
              unit="%/yr"
            />
            <NumberField
              compact
              label="Loan term"
              value={settings.newCar.termMonths}
              onChange={(n) => setNewCar({ termMonths: Math.max(1, n) })}
              unit="months"
            />
            <NumberField
              compact
              label="EV use"
              value={settings.newCar.elecKwhPer100}
              onChange={(n) => setNewCar({ elecKwhPer100: Math.max(0, n) })}
              unit="kWh/100km"
            />
            <NumberField
              compact
              label="Fuel use"
              value={settings.newCar.fuelLPer100}
              onChange={(n) => setNewCar({ fuelLPer100: Math.max(0, n) })}
              unit="l/100km"
            />
            <NumberField
              compact
              label="Insurance"
              value={settings.newCar.insurancePerYear}
              onChange={(n) => setNewCar({ insurancePerYear: Math.max(0, n) })}
              unit="€/yr"
            />
            <NumberField
              compact
              label="Vehicle tax"
              value={settings.newCar.taxPerYear}
              onChange={(n) => setNewCar({ taxPerYear: Math.max(0, n) })}
              unit="€/yr"
            />
            <NumberField
              compact
              label="Maintenance"
              value={settings.newCar.maintenancePerYear}
              onChange={(n) => setNewCar({ maintenancePerYear: Math.max(0, n) })}
              unit="€/yr"
            />
            <NumberField
              compact
              label="Tires"
              value={settings.newCar.tiresPerYear}
              onChange={(n) => setNewCar({ tiresPerYear: Math.max(0, n) })}
              unit="€/yr"
            />
            <NumberField
              compact
              label="Other"
              value={settings.newCar.otherPerYear}
              onChange={(n) => setNewCar({ otherPerYear: Math.max(0, n) })}
              unit="€/yr"
            />
          </div>
        </>
      )}
    </div>
  )
}
