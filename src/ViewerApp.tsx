import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppData } from './types'
import { calcTco, type TcoResult } from './calc'
import { type Filters, NO_FILTERS, listMakes, matchesFilters } from './filtering'
import { fmtDateTime, fmtNum } from './format'
import { pullGistPublic } from './sync'
import { useTheme } from './theme'
import { Legend } from './components/BreakdownBar'
import { CarCard } from './components/CarCard'
import { ComparisonTable } from './components/ComparisonTable'
import { FilterBar } from './components/FilterBar'

const NOOP = () => {}

/**
 * Read-only shared view: fetches the data gist without a token (secret gists
 * are unlisted but publicly readable by id). Nothing is written anywhere —
 * filters and compare-selection are in-memory view aids only.
 */
export function ViewerApp({ gistId }: { gistId: string }) {
  const [data, setData] = useState<AppData | null>(null)
  const [savedAt, setSavedAt] = useState('')
  const [error, setError] = useState('')
  const [theme, toggleTheme] = useTheme()
  const [filters, setFilters] = useState<Filters>({ ...NO_FILTERS })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const lastLoadRef = useRef(0)

  const load = useCallback(async () => {
    try {
      const remote = await pullGistPublic(gistId)
      lastLoadRef.current = Date.now()
      if (remote) {
        setData(remote.data)
        setSavedAt(remote.savedAt)
        setError('')
      } else {
        setError('This link does not contain shared car data.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the shared data.')
    }
  }, [gistId])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- load reports the state of an external fetch
    void load()
  }, [load])

  useEffect(() => {
    function onFocus() {
      if (Date.now() - lastLoadRef.current > 30_000) void load()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const results = useMemo(() => {
    if (!data) return new Map<string, TcoResult>()
    return new Map(data.cars.map((c) => [c.id, calcTco(c, data.settings)]))
  }, [data])

  const sortedCars = useMemo(() => {
    if (!data) return []
    return [...data.cars].sort(
      (a, b) => (results.get(a.id)?.perMonth ?? 0) - (results.get(b.id)?.perMonth ?? 0),
    )
  }, [data, results])

  const visibleCars = useMemo(
    () => sortedCars.filter((c) => matchesFilters(c, filters, selectedIds)),
    [sortedCars, filters, selectedIds],
  )

  const cheapestId =
    visibleCars.length > 1 && (results.get(visibleCars[0].id)?.total ?? 0) > 0
      ? visibleCars[0].id
      : null

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const s = data?.settings
  const assumptionsSummary = s
    ? `${fmtNum(s.annualKm)} km/yr · ${fmtNum(s.ownershipYears)} yrs · petrol ${fmtNum(s.petrolPrice)} €/l · diesel ${fmtNum(s.dieselPrice)} €/l · electricity ${fmtNum(s.electricityPrice)} €/kWh`
    : ''

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1 className="app-title display">Car TCO</h1>
          <p className="app-subtitle">
            Shared view — read-only{savedAt ? ` · updated ${fmtDateTime(savedAt)}` : ''}
          </p>
        </div>
        <div className="header-actions">
          <button
            className="btn icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Night mode'}
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="8" cy="8" r="3.2" />
                <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />
              </svg>
            )}
          </button>
          <button className="btn" onClick={() => void load()}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
              <path d="M13.7 1.8v2.5h-2.5" />
            </svg>
            <span className="btn-label">Refresh</span>
          </button>
        </div>
      </header>

      {s && (
        <div className="card assumptions">
          <div className="assumptions-heading">
            <div className="assumptions-title">Assumptions</div>
            <div className="assumptions-caption">set by the owner</div>
          </div>
          <span className="viewer-assumptions">{assumptionsSummary}</span>
        </div>
      )}

      {error ? (
        <div className="card empty-state">
          <div className="empty-title display">Could not load</div>
          <p className="empty-text">{error}</p>
          <button className="btn btn-primary" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : !data ? (
        <div className="card empty-state">
          <div className="empty-title display">Loading…</div>
          <p className="empty-text">Fetching the shared cars.</p>
        </div>
      ) : data.cars.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-title display">No cars yet</div>
          <p className="empty-text">Nothing has been shared here so far.</p>
        </div>
      ) : (
        <>
          <FilterBar
            filters={filters}
            onChange={setFilters}
            makes={listMakes(data.cars)}
            selectedCount={selectedIds.size}
            favoriteCount={data.cars.filter((c) => c.favorite).length}
            shownCount={visibleCars.length}
            totalCount={data.cars.length}
          />
          {visibleCars.length === 0 ? (
            <div className="card empty-state">
              <div className="empty-title display">No cars match</div>
              <p className="empty-text">Adjust or clear the filters to see the cars.</p>
              <button className="btn" onClick={() => setFilters({ ...NO_FILTERS })}>
                Clear filters
              </button>
            </div>
          ) : (
            <>
              <Legend breakdowns={visibleCars.map((c) => results.get(c.id)!.breakdown)} />
              <div className="card-grid">
                {visibleCars.map((car) => (
                  <CarCard
                    key={car.id}
                    car={car}
                    tco={results.get(car.id)!}
                    cheapest={car.id === cheapestId}
                    selected={selectedIds.has(car.id)}
                    readOnly
                    onToggleSelect={() => toggleSelected(car.id)}
                    onToggleFavorite={NOOP}
                    onEdit={NOOP}
                    onDuplicate={NOOP}
                    onDelete={NOOP}
                  />
                ))}
              </div>
              <ComparisonTable
                cars={visibleCars}
                results={results}
                settings={data.settings}
              />
            </>
          )}
        </>
      )}

      <footer className="app-footer">
        Shared from Car TCO — updates whenever the owner changes the data.
      </footer>
    </div>
  )
}
