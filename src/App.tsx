import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppData, CarListing } from './types'
import { byOutOfPocket, calcTco } from './calc'
import {
  type Filters,
  NO_FILTERS,
  listMakes,
  loadSelection,
  matchesFilters,
  saveSelection,
} from './filtering'
import { cloneLease, loadData, newCar, saveData } from './storage'
import { NotABackupError, exportBackup, importBackup } from './backup'
import { exportExcel, importExcel } from './excel'
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
import { type Mode, useMode } from './mode'
import { NARROW, useMedia } from './useMedia'
import { useScraperFilters } from './useScraperFilters'
import { useHousing } from './useHousing'
import { useMileage } from './useMileage'
import type { PropertyListing } from './housing'
import { newProperty } from './housingStorage'
import { HousingView } from './components/HousingView'
import { MileageView } from './components/MileageView'
import { PropertyForm } from './components/PropertyForm'
import { Legend } from './components/BreakdownBar'
import { CarCard } from './components/CarCard'
import { CarForm } from './components/CarForm'
import { ComparisonTable } from './components/ComparisonTable'
import { FilterBar } from './components/FilterBar'
import { ScraperFilterDialog } from './components/ScraperFilterDialog'
import { SettingsPanel } from './components/SettingsPanel'
import { SyncDialog, type SyncStatus } from './components/SyncDialog'

const MODE_TITLES: Record<Mode, [string, string]> = {
  cars: ['Car TCO', 'Total cost of ownership — compare your candidates'],
  housing: ['Housing budget', 'What you could afford — and what each place would cost'],
  mileage: ['Lease mileage', 'The km driven against what the contract allows'],
}

interface DraftState {
  car: CarListing
  isNew: boolean
}

interface PlaceDraft {
  property: PropertyListing
  isNew: boolean
}

export default function App() {
  const [data, setData] = useState<AppData>(loadData)
  const [draft, setDraft] = useState<DraftState | null>(null)
  // The housing form lives here beside the car one, so the header can open it.
  const [placeDraft, setPlaceDraft] = useState<PlaceDraft | null>(null)
  const [theme, toggleTheme] = useTheme()
  // Which calculator this device is on - cars, housing or mileage. Local like the theme.
  const [mode, setMode] = useMode()
  const fileInput = useRef<HTMLInputElement>(null)
  // A phone gets one menu for import and export - see the header.
  const narrow = useMedia(NARROW)

  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(loadSyncConfig)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(syncConfig ? 'syncing' : 'off')
  const [syncError, setSyncError] = useState('')
  const [syncOpen, setSyncOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  // The nettiauto watcher's saved searches: kept in their own gist file, so
  // they ride along with sync without being part of the car data.
  const scraperFilters = useScraperFilters(syncConfig)
  // The housing side: its own gist file, so an old cached bundle that has
  // never heard of housing cannot strip it on sync.
  const housing = useHousing(syncConfig)
  // The leased car's odometer log: a file of its own too, for the same reason.
  const mileage = useMileage(syncConfig)
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
    () => [...data.cars].sort(byOutOfPocket(results)),
    [data.cars, results],
  )

  const [filters, setFilters] = useState<Filters>({ ...NO_FILTERS })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(loadSelection)

  const visibleCars = useMemo(
    () => sortedCars.filter((c) => matchesFilters(c, filters, selectedIds)),
    [sortedCars, filters, selectedIds],
  )

  const cheapestId =
    visibleCars.length > 1 &&
    (results.get(visibleCars[0].id)?.outOfPocketPerMonth ?? 0) > 0
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

  /**
   * Read either format, chosen by the file rather than by the user.
   *
   * They mean different things, so they ask differently. A JSON backup is an
   * exact copy and **replaces** everything. A spreadsheet is something somebody
   * has been editing, so it **merges**: rows update the cars they match, new
   * rows are added, and a car the sheet does not mention is left alone -
   * deleting by omission is far too easy to do by accident in Excel.
   */
  async function handleImportFile(file: File) {
    const isSpreadsheet = /\.(xlsx|xlsm)$/i.test(file.name)
    try {
      if (isSpreadsheet) {
        const report = await importExcel(file, data)
        const changes = [
          report.updated ? `${report.updated} car(s) updated` : '',
          report.added ? `${report.added} added` : '',
          report.settingsChanged ? 'assumptions updated' : '',
        ].filter(Boolean)
        if (changes.length === 0) {
          // Reachable and worth saying plainly: importing a sheet nobody edited
          // is a no-op rather than a failure.
          window.alert(`Nothing in "${file.name}" differs from what is here already.`)
          return
        }
        const notes = report.warnings.length
          ? ['', '', 'Worth knowing:', ...report.warnings.map((w) => `• ${w}`)].join('\n')
          : ''
        const ok = window.confirm(
          [
            `Apply "${file.name}"?`,
            '',
            `${changes.join(', ')}.`,
            '',
            'Cars not in the sheet are left alone.',
          ].join('\n') + notes,
        )
        if (ok) updateData(() => report.data)
        return
      }

      const imported = await importBackup(file)
      // Counted only for what the file restores: an older backup has no
      // housing, or no mileage, and those sides are left as they are.
      const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
      const tally = (cars: number, places: number | undefined, readings: number | undefined) =>
        [
          count(cars, 'car', 'cars'),
          places === undefined ? '' : count(places, 'place', 'places'),
          readings === undefined ? '' : count(readings, 'reading', 'readings'),
        ]
          .filter(Boolean)
          .join(', ')
      const kept = [imported.housing ? '' : 'housing', imported.mileage ? '' : 'mileage'].filter(
        Boolean,
      )
      const here = tally(
        data.cars.length,
        imported.housing ? housing.data.properties.length : undefined,
        imported.mileage ? mileage.data.readings.length : undefined,
      )
      const there = tally(
        imported.data.cars.length,
        imported.housing?.properties.length,
        imported.mileage?.readings.length,
      )
      const ok = window.confirm(
        [
          `Replace what is here (${here}) with "${file.name}" (${there})?`,
          ...(kept.length
            ? [
                '',
                kept.length > 1
                  ? 'It is an older backup, from before housing and mileage were saved in it, so those are left as they are.'
                  : `It is an older backup, from before ${kept[0]} was saved in it, so that is left as it is.`,
              ]
            : []),
        ].join('\n'),
      )
      if (!ok) return
      updateData(() => imported.data)
      if (imported.housing) housing.replace(imported.housing)
      if (imported.mileage) mileage.replace(imported.mileage)
    } catch (error) {
      window.alert(
        error instanceof NotABackupError
          ? error.message
          : error instanceof Error && isSpreadsheet
            ? ['Could not read that spreadsheet.', '', error.message].join('\n')
            : 'Could not read that file — it does not look like an export from this app.',
      )
    }
  }

  // On this person's own financing baseline (Assumptions -> New car), the same
  // one a car added from a Discord reaction arrives with.
  const addCar = () => setDraft({ car: newCar(data.settings.newCar), isNew: true })
  const addPlace = () => setPlaceDraft({ property: newProperty(), isNew: true })

  const activeFilterCount = scraperFilters.set.filters.filter((f) => f.enabled).length

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1 className="app-title display">{MODE_TITLES[mode][0]}</h1>
          <p className="app-subtitle">{MODE_TITLES[mode][1]}</p>
        </div>
        {/* Beside the buttons on a desktop; on a phone a full-width row of its
            own under the title, where the buttons have the title's row. */}
        <div className="mode-toggle" role="tablist" aria-label="Calculator">
          <button
            className={`filter-chip${mode === 'cars' ? ' active' : ''}`}
            role="tab"
            aria-selected={mode === 'cars'}
            onClick={() => setMode('cars')}
          >
            Cars
          </button>
          <button
            className={`filter-chip${mode === 'housing' ? ' active' : ''}`}
            role="tab"
            aria-selected={mode === 'housing'}
            onClick={() => setMode('housing')}
          >
            Housing
          </button>
          <button
            className={`filter-chip${mode === 'mileage' ? ' active' : ''}`}
            role="tab"
            aria-selected={mode === 'mileage'}
            onClick={() => setMode('mileage')}
          >
            Mileage
          </button>
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
          {mode === 'cars' && (
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
          )}
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
          {/* Import and export, in every mode: the backup carries all three
              calculators, and the spreadsheet is the cars'. */}
          {!narrow && (
            <button className="btn" onClick={() => fileInput.current?.click()}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2v8" />
                <path d="M5 7l3 3 3-3" />
                <path d="M2 13h12" />
              </svg>
              <span className="btn-label">Import</span>
            </button>
          )}
          {/*
            Two formats, because they are for different things: a spreadsheet to
            read and edit, a JSON backup that is exact. A menu rather than two
            more buttons - the header is already full on a phone, where the menu
            takes Import in as well: five icons and the mode switch do not fit
            a 360px screen, and the page scrolled sideways to reach Export.
          */}
          <div className="menu-anchor">
            <button
              className={narrow ? 'btn icon-btn' : 'btn'}
              aria-haspopup="true"
              aria-expanded={exportOpen}
              aria-label={narrow ? 'Import and export' : undefined}
              title={narrow ? 'Import and export' : undefined}
              onClick={() => setExportOpen((open) => !open)}
            >
              {narrow ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="3.5" cy="8" r="1.3" />
                  <circle cx="8" cy="8" r="1.3" />
                  <circle cx="12.5" cy="8" r="1.3" />
                </svg>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 10V2" />
                    <path d="M5 5l3-3 3 3" />
                    <path d="M2 13h12" />
                  </svg>
                  <span className="btn-label">Export</span>
                </>
              )}
            </button>
            {exportOpen && (
              <>
                {/* Catches the next click anywhere, which is what closes it. */}
                <button
                  className="menu-backdrop"
                  aria-label="Close menu"
                  onClick={() => setExportOpen(false)}
                />
                <div className="menu" role="menu">
                  {narrow && (
                    <button
                      className="menu-item"
                      role="menuitem"
                      onClick={() => {
                        setExportOpen(false)
                        fileInput.current?.click()
                      }}
                    >
                      <span className="menu-item-name">Import</span>
                      <span className="menu-item-note">a spreadsheet or a backup</span>
                    </button>
                  )}
                  <button
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      setExportOpen(false)
                      exportExcel(data).catch(() =>
                        window.alert('Could not build the spreadsheet.'),
                      )
                    }}
                  >
                    <span className="menu-item-name">{narrow ? 'Export a spreadsheet' : 'Spreadsheet'}</span>
                    <span className="menu-item-note">.xlsx — every car in a grid, editable</span>
                  </button>
                  <button
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      setExportOpen(false)
                      exportBackup(data, housing.data, mileage.data)
                    }}
                  >
                    <span className="menu-item-name">{narrow ? 'Export a backup' : 'Backup'}</span>
                    <span className="menu-item-note">.json — cars and housing, exact, for restoring</span>
                  </button>
                </div>
              </>
            )}
          </div>
          {/* Each mode's own add, in the same place: on a phone the fab stands
              in for it. Mileage has none - its log form opens the page. */}
          {mode !== 'mileage' && (
            <button className="btn btn-primary header-add" onClick={mode === 'cars' ? addCar : addPlace}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <path d="M8 3v10" />
                <path d="M3 8h10" />
              </svg>
              {mode === 'cars' ? 'Add car' : 'Add place'}
            </button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json,.xlsx,.xlsm"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleImportFile(file)
            e.target.value = ''
          }}
        />
      </header>

      {mode === 'mileage' ? (
        <MileageView store={mileage} />
      ) : mode === 'housing' ? (
        <HousingView
          store={housing}
          onAdd={addPlace}
          onEdit={(property) => setPlaceDraft({ property, isNew: false })}
        />
      ) : (
        <>
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
                settings={data.settings}
              />
            </>
          )}
        </>
      )}
        </>
      )}

      {mode !== 'mileage' && (
        <button
          className="fab"
          onClick={mode === 'cars' ? addCar : addPlace}
          aria-label={mode === 'cars' ? 'Add car' : 'Add place'}
        >
          <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M8 3v10" />
            <path d="M3 8h10" />
          </svg>
        </button>
      )}

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

      {placeDraft && (
        <PropertyForm
          initial={placeDraft.property}
          isNew={placeDraft.isNew}
          onSave={(property) => {
            housing.saveProperty(property)
            setPlaceDraft(null)
          }}
          onCancel={() => setPlaceDraft(null)}
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
