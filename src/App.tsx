import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppData, CarListing } from './types'
import { calcTco } from './calc'
import {
  type Filters,
  NO_FILTERS,
  listMakes,
  loadSelection,
  matchesFilters,
  saveSelection,
} from './filtering'
import { cloneLease, exportJson, importJson, loadData, newCar, saveData } from './storage'
import {
  type SyncConfig,
  connectGist,
  getEditedAt,
  loadSyncConfig,
  mergeData,
  pullGist,
  pushGist,
  saveSyncConfig,
  stampEditedAt,
} from './sync'
import { useTheme } from './theme'
import { useScraperFilters } from './useScraperFilters'
import { Legend } from './components/BreakdownBar'
import { CarCard } from './components/CarCard'
import { CarForm } from './components/CarForm'
import { ComparisonTable } from './components/ComparisonTable'
import { FilterBar } from './components/FilterBar'
import { ScraperFilterDialog } from './components/ScraperFilterDialog'
import { SettingsPanel } from './components/SettingsPanel'
import { SyncDialog, type SyncStatus } from './components/SyncDialog'

interface DraftState {
  car: CarListing
  isNew: boolean
}

export default function App() {
  const [data, setData] = useState<AppData>(loadData)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [theme, toggleTheme] = useTheme()
  const fileInput = useRef<HTMLInputElement>(null)

  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(loadSyncConfig)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(syncConfig ? 'syncing' : 'off')
  const [syncError, setSyncError] = useState('')
  const [syncOpen, setSyncOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  // The nettiauto watcher's saved searches: kept in their own gist file, so
  // they ride along with sync without being part of the car data.
  const scraperFilters = useScraperFilters(syncConfig)
  const dataRef = useRef(data)
  const syncConfigRef = useRef(syncConfig)
  // The last data object that came from a non-edit source (initial load or a
  // remote apply) — the push effect skips exactly that object.
  const nonEditDataRef = useRef<AppData>(data)
  const lastPullRef = useRef(0)

  useEffect(() => {
    saveData(data)
    dataRef.current = data
  }, [data])

  useEffect(() => {
    syncConfigRef.current = syncConfig
  }, [syncConfig])

  useEffect(() => {
    // Ask the browser to exempt this site's storage from eviction under
    // storage pressure. Best-effort: browsers may decline silently.
    navigator.storage?.persist?.().catch(() => {})
  }, [])

  /** All user-originated mutations go through this so the edit gets timestamped for sync. */
  function updateData(updater: (d: AppData) => AppData) {
    stampEditedAt()
    setData(updater)
  }

  const doPull = useCallback(async (cfg: SyncConfig) => {
    setSyncStatus('syncing')
    try {
      const remote = await pullGist(cfg)
      lastPullRef.current = Date.now()
      if (remote) {
        const localEditedAt = getEditedAt()
        const remoteNewer = remote.savedAt > localEditedAt
        // Merge per car instead of replacing wholesale, so writes from other
        // devices and the Discord bot survive concurrent edits
        const merged = remoteNewer
          ? mergeData(remote.data, dataRef.current)
          : mergeData(dataRef.current, remote.data)
        const mergedJson = JSON.stringify(merged)
        const differsFromLocal = mergedJson !== JSON.stringify(dataRef.current)
        const differsFromRemote = mergedJson !== JSON.stringify(remote.data)
        if (differsFromRemote) stampEditedAt()
        else if (remote.savedAt) stampEditedAt(remote.savedAt)
        if (differsFromLocal) {
          nonEditDataRef.current = merged
          setData(merged)
        }
        if (differsFromRemote) await pushGist(cfg, merged)
      }
      setSyncStatus('synced')
      setSyncError('')
    } catch (e) {
      setSyncStatus('error')
      setSyncError(e instanceof Error ? e.message : 'Sync failed.')
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- doPull reports progress of an external sync
    if (syncConfig) void doPull(syncConfig)
  }, [syncConfig, doPull])

  useEffect(() => {
    function onFocus() {
      const cfg = syncConfigRef.current
      if (cfg && Date.now() - lastPullRef.current > 30_000) void doPull(cfg)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [doPull])

  useEffect(() => {
    const cfg = syncConfigRef.current
    if (!cfg) return
    if (data === nonEditDataRef.current) return
    const timer = setTimeout(async () => {
      setSyncStatus('syncing')
      try {
        // Read-merge-write: pick up anything written since our last pull
        // (another device, the Discord bot) before overwriting the gist
        let payload = dataRef.current
        const remote = await pullGist(cfg).catch(() => null)
        lastPullRef.current = Date.now()
        if (remote) {
          const merged = mergeData(dataRef.current, remote.data)
          if (JSON.stringify(merged) !== JSON.stringify(dataRef.current)) {
            nonEditDataRef.current = merged
            setData(merged)
          }
          payload = merged
        }
        stampEditedAt()
        await pushGist(cfg, payload)
        setSyncStatus('synced')
        setSyncError('')
      } catch (e) {
        setSyncStatus('error')
        setSyncError(e instanceof Error ? e.message : 'Sync failed.')
      }
    }, 2000)
    return () => clearTimeout(timer)
  }, [data])

  async function handleConnect(token: string) {
    const cfg = await connectGist(token, dataRef.current)
    saveSyncConfig(cfg)
    setSyncConfig(cfg)
  }

  function handleDisconnect() {
    saveSyncConfig(null)
    setSyncConfig(null)
    setSyncStatus('off')
    setSyncError('')
  }

  const results = useMemo(
    () => new Map(data.cars.map((c) => [c.id, calcTco(c, data.settings)])),
    [data],
  )

  const sortedCars = useMemo(
    () =>
      [...data.cars].sort(
        (a, b) => (results.get(a.id)?.perMonth ?? 0) - (results.get(b.id)?.perMonth ?? 0),
      ),
    [data.cars, results],
  )

  const [filters, setFilters] = useState<Filters>({ ...NO_FILTERS })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(loadSelection)

  const visibleCars = useMemo(
    () => sortedCars.filter((c) => matchesFilters(c, filters, selectedIds)),
    [sortedCars, filters, selectedIds],
  )

  const cheapestId =
    visibleCars.length > 1 && (results.get(visibleCars[0].id)?.total ?? 0) > 0
      ? visibleCars[0].id
      : null

  function toggleFavorite(car: CarListing) {
    const stamped = { ...car, favorite: !car.favorite, updatedAt: new Date().toISOString() }
    updateData((d) => ({
      ...d,
      cars: d.cars.map((c) => (c.id === stamped.id ? stamped : c)),
    }))
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveSelection(next)
      return next
    })
  }

  function saveCar(car: CarListing) {
    const stamped = { ...car, updatedAt: new Date().toISOString() }
    updateData((d) => {
      const exists = d.cars.some((c) => c.id === stamped.id)
      return {
        ...d,
        cars: exists
          ? d.cars.map((c) => (c.id === stamped.id ? stamped : c))
          : [...d.cars, stamped],
      }
    })
    setDraft(null)
  }

  function deleteCar(car: CarListing) {
    if (!window.confirm(`Delete "${car.name || 'this car'}"?`)) return
    updateData((d) => ({
      ...d,
      cars: d.cars.filter((c) => c.id !== car.id),
      tombstones: { ...d.tombstones, [car.id]: new Date().toISOString() },
    }))
    setSelectedIds((prev) => {
      if (!prev.has(car.id)) return prev
      const next = new Set(prev)
      next.delete(car.id)
      saveSelection(next)
      return next
    })
  }

  function duplicateCar(car: CarListing) {
    const now = new Date().toISOString()
    const copy: CarListing = {
      ...car,
      financing: { ...car.financing },
      lease: cloneLease(car.lease),
      id: crypto.randomUUID(),
      name: `${car.name} (copy)`,
      createdAt: now,
      updatedAt: now,
    }
    updateData((d) => ({ ...d, cars: [...d.cars, copy] }))
  }

  async function handleImportFile(file: File) {
    try {
      const imported = await importJson(file)
      const ok = window.confirm(
        `Replace current data (${data.cars.length} cars) with "${file.name}" (${imported.cars.length} cars)?`,
      )
      if (ok) updateData(() => imported)
    } catch {
      window.alert('Could not read that file — it does not look like an export from this app.')
    }
  }

  const addCar = () => setDraft({ car: newCar(), isNew: true })

  const activeFilterCount = scraperFilters.set.filters.filter((f) => f.enabled).length

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1 className="app-title display">Car TCO</h1>
          <p className="app-subtitle">Total cost of ownership — compare your candidates</p>
        </div>
        <div className="header-actions">
          <button
            className="btn icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Night mode'}
          >
            {theme === 'dark' ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <circle cx="8" cy="8" r="3.2" />
                <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />
              </svg>
            )}
          </button>
          <button
            className="btn icon-btn"
            onClick={() => setFiltersOpen(true)}
            aria-label="Scraper filters"
            title={`Scraper filters (${activeFilterCount} active)`}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.4 3.4h11.2L9.4 8.5v4.6l-2.8-1.5V8.5z" />
            </svg>
            {activeFilterCount > 0 && <span className="btn-count">{activeFilterCount}</span>}
          </button>
          <button
            className="btn icon-btn sync-btn"
            onClick={() => setSyncOpen(true)}
            aria-label="Sync settings"
            title={
              syncStatus === 'off'
                ? 'Sync: not connected'
                : syncStatus === 'error'
                  ? `Sync error: ${syncError}`
                  : syncStatus === 'syncing'
                    ? 'Syncing…'
                    : 'Synced to GitHub'
            }
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12.5h6.6a2.7 2.7 0 0 0 .6-5.34 4 4 0 0 0-7.86.6A2.75 2.75 0 0 0 5 12.5z" />
            </svg>
            {syncConfig && <span className={`sync-dot ${syncStatus}`} />}
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v8" />
              <path d="M5 7l3 3 3-3" />
              <path d="M2 13h12" />
            </svg>
            <span className="btn-label">Import</span>
          </button>
          <button className="btn" onClick={() => exportJson(data)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 10V2" />
              <path d="M5 5l3-3 3 3" />
              <path d="M2 13h12" />
            </svg>
            <span className="btn-label">Export</span>
          </button>
          <button className="btn btn-primary header-add" onClick={addCar}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M8 3v10" />
              <path d="M3 8h10" />
            </svg>
            Add car
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleImportFile(file)
            e.target.value = ''
          }}
        />
      </header>

      <SettingsPanel
        settings={data.settings}
        onChange={(settings) => updateData((d) => ({ ...d, settings }))}
      />

      {data.cars.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-title display">No cars yet</div>
          <p className="empty-text">
            Add your first candidate to see its total cost of ownership — purchase,
            financing, energy, insurance and the rest, boiled down to one number per month.
          </p>
          <button className="btn btn-primary" onClick={addCar}>
            Add your first car
          </button>
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
              <p className="empty-text">Adjust or clear the filters to see your cars.</p>
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
                    onToggleSelect={() => toggleSelected(car.id)}
                    onToggleFavorite={() => toggleFavorite(car)}
                    onEdit={() => setDraft({ car, isNew: false })}
                    onDuplicate={() => duplicateCar(car)}
                    onDelete={() => deleteCar(car)}
                  />
                ))}
              </div>
              <ComparisonTable
                cars={visibleCars}
                results={results}
                years={data.settings.ownershipYears}
              />
            </>
          )}
        </>
      )}

      <button className="fab" onClick={addCar} aria-label="Add car">
        <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M8 3v10" />
          <path d="M3 8h10" />
        </svg>
      </button>

      <footer className="app-footer">
        Data is stored in this browser only — export a backup now and then.
      </footer>

      {draft && (
        <CarForm
          initial={draft.car}
          isNew={draft.isNew}
          settings={data.settings}
          onSave={saveCar}
          onCancel={() => setDraft(null)}
        />
      )}

      {filtersOpen && (
        <ScraperFilterDialog
          store={scraperFilters}
          connected={Boolean(syncConfig)}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {syncOpen && (
        <SyncDialog
          config={syncConfig}
          status={syncStatus}
          error={syncError}
          onConnect={handleConnect}
          onSyncNow={() => syncConfig && void doPull(syncConfig)}
          onDisconnect={handleDisconnect}
          onClose={() => setSyncOpen(false)}
        />
      )}
    </div>
  )
}
