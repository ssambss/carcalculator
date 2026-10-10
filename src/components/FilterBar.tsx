import { useId, useState } from 'react'
import type { Powertrain } from '../types'
import { type Filters, NO_FILTERS, isFilterActive } from '../filtering'
import { CAR_SORTS, type CarSort } from '../carSort'
import { POWERTRAIN_LABEL } from '../labels'

interface Props {
  filters: Filters
  onChange: (f: Filters) => void
  makes: string[]
  selectedCount: number
  favoriteCount: number
  shownCount: number
  totalCount: number
  sort: CarSort
  onSortChange: (s: CarSort) => void
}

const POWERTRAINS: Powertrain[] = ['petrol', 'diesel', 'ev', 'phev']

export function FilterBar({
  filters,
  onChange,
  makes,
  selectedCount,
  favoriteCount,
  shownCount,
  totalCount,
  sort,
  onSortChange,
}: Props) {
  // A phone folds everything but the search behind one button: open, the bar
  // was four rows tall before the first card.
  const [open, setOpen] = useState(false)
  const moreId = useId()
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })

  function togglePowertrain(p: Powertrain) {
    const active = filters.powertrains.includes(p)
    set({
      powertrains: active
        ? filters.powertrains.filter((x) => x !== p)
        : [...filters.powertrains, p],
    })
  }

  // What the fold hides, so a shut bar still says that it is narrowing.
  const folded =
    (filters.make !== 'all' ? 1 : 0) +
    filters.powertrains.length +
    (filters.favoritesOnly ? 1 : 0) +
    (filters.selectedOnly ? 1 : 0)

  return (
    <div className={`filter-bar${open ? ' open' : ''}`}>
      <input
        type="search"
        className="filter-search"
        placeholder="Search name or notes…"
        value={filters.query}
        onChange={(e) => set({ query: e.target.value })}
      />
      <button
        className={`filter-chip filter-toggle${folded > 0 ? ' active' : ''}`}
        aria-expanded={open}
        aria-controls={moreId}
        onClick={() => setOpen((o) => !o)}
      >
        Filters{folded > 0 ? ` (${folded})` : ''}
      </button>
      <div className="filter-more" id={moreId}>
        <label className="filter-sort">
          <span className="filter-sort-label">Sort</span>
          <select
            className="filter-select"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as CarSort)}
          >
            {CAR_SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
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
            className={`filter-chip${filters.favoritesOnly ? ' active' : ''}`}
            disabled={favoriteCount === 0 && !filters.favoritesOnly}
            onClick={() => set({ favoritesOnly: !filters.favoritesOnly })}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="currentColor"
              stroke="none"
              aria-hidden="true"
            >
              <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
            </svg>
            Favorites{favoriteCount > 0 ? ` (${favoriteCount})` : ''}
          </button>
          <button
            className={`filter-chip${filters.selectedOnly ? ' active' : ''}`}
            disabled={selectedCount === 0 && !filters.selectedOnly}
            onClick={() => set({ selectedOnly: !filters.selectedOnly })}
          >
            Selected only{selectedCount > 0 ? ` (${selectedCount})` : ''}
          </button>
        </div>
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
