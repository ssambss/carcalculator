import type { Powertrain } from '../types'
import { type Filters, NO_FILTERS, isFilterActive } from '../filtering'
import { POWERTRAIN_LABEL } from '../labels'

interface Props {
  filters: Filters
  onChange: (f: Filters) => void
  makes: string[]
  selectedCount: number
  shownCount: number
  totalCount: number
}

const POWERTRAINS: Powertrain[] = ['petrol', 'diesel', 'ev', 'phev']

export function FilterBar({
  filters,
  onChange,
  makes,
  selectedCount,
  shownCount,
  totalCount,
}: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })

  function togglePowertrain(p: Powertrain) {
    const active = filters.powertrains.includes(p)
    set({
      powertrains: active
        ? filters.powertrains.filter((x) => x !== p)
        : [...filters.powertrains, p],
    })
  }

  return (
    <div className="filter-bar">
      <input
        type="search"
        className="filter-search"
        placeholder="Search name or notes…"
        value={filters.query}
        onChange={(e) => set({ query: e.target.value })}
      />
      <select
        className="filter-select"
        value={filters.make}
        onChange={(e) => set({ make: e.target.value })}
        aria-label="Filter by make"
      >
        <option value="all">All makes</option>
        {makes.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <div className="filter-chips">
        {POWERTRAINS.map((p) => (
          <button
            key={p}
            className={`filter-chip${filters.powertrains.includes(p) ? ' active' : ''}`}
            onClick={() => togglePowertrain(p)}
          >
            {POWERTRAIN_LABEL[p]}
          </button>
        ))}
        <button
          className={`filter-chip${filters.selectedOnly ? ' active' : ''}`}
          disabled={selectedCount === 0 && !filters.selectedOnly}
          onClick={() => set({ selectedOnly: !filters.selectedOnly })}
        >
          Selected only{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </button>
      </div>
      {isFilterActive(filters) && (
        <div className="filter-meta">
          <span>
            {shownCount} of {totalCount} cars
          </span>
          <button className="inline-link" onClick={() => onChange({ ...NO_FILTERS })}>
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
