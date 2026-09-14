import {
  ALL_AREAS,
  type AreaGroup,
  type PropertyFilters,
  NO_PROPERTY_FILTERS,
  type Reach,
  isPropertyFilterActive,
} from '../housingFiltering'

interface Props {
  filters: PropertyFilters
  onChange: (f: PropertyFilters) => void
  areas: AreaGroup[]
  selectedCount: number
  favoriteCount: number
  fitsCount: number
  overCount: number
  shownCount: number
  totalCount: number
}

const REACH_LABEL: Record<Reach, string> = {
  fits: 'Within reach',
  over: 'Over the ceiling',
}
const REACHES: Reach[] = ['fits', 'over']

export function PropertyFilterBar({
  filters,
  onChange,
  areas,
  selectedCount,
  favoriteCount,
  fitsCount,
  overCount,
  shownCount,
  totalCount,
}: Props) {
  const set = (patch: Partial<PropertyFilters>) => onChange({ ...filters, ...patch })
  const counts: Record<Reach, number> = { fits: fitsCount, over: overCount }

  function toggleReach(r: Reach) {
    const active = filters.reach.includes(r)
    set({ reach: active ? filters.reach.filter((x) => x !== r) : [...filters.reach, r] })
  }

  return (
    <div className="filter-bar">
      <input
        type="search"
        className="filter-search"
        placeholder="Search name, notes or area…"
        value={filters.query}
        onChange={(e) => set({ query: e.target.value })}
      />
      {areas.length > 0 && (
        <select
          className="filter-select"
          value={filters.area}
          onChange={(e) => set({ area: e.target.value })}
          aria-label="Filter by area"
        >
          <option value={ALL_AREAS}>All areas</option>
          {areas.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      <div className="filter-chips">
        {REACHES.map((r) => (
          <button
            key={r}
            className={`filter-chip${filters.reach.includes(r) ? ' active' : ''}`}
            disabled={counts[r] === 0 && !filters.reach.includes(r)}
            onClick={() => toggleReach(r)}
          >
            {REACH_LABEL[r]}
            {counts[r] > 0 ? ` (${counts[r]})` : ''}
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
      {isPropertyFilterActive(filters) && (
        <div className="filter-meta">
          <span>
            {shownCount} of {totalCount} {totalCount === 1 ? 'place' : 'places'}
          </span>
          <button className="inline-link" onClick={() => onChange({ ...NO_PROPERTY_FILTERS })}>
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
