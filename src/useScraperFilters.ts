import { useCallback, useEffect, useRef, useState } from 'react'
import type { FilterSet, ScraperFilter } from './scraperFilters'
import { loadFilterSet, saveFilterSet, syncFilterSet } from './filterSync'
import type { SyncConfig } from './sync'

export type FilterSyncStatus = 'off' | 'syncing' | 'synced' | 'error'

export interface ScraperFilterStore {
  set: FilterSet
  status: FilterSyncStatus
  error: string
  save: (filter: ScraperFilter) => void
  remove: (id: string) => void
  toggle: (id: string) => void
  syncNow: () => void
}

/**
 * The scraper's filter list, kept in this browser and pushed to the gist the
 * watcher reads.
 *
 * Separate from the app's own data sync on purpose — see filterSync.ts — and
 * far simpler than it needs to be for cars: a filter changes when someone
 * presses Save, so every mutation can just read-merge-write straight away
 * instead of debouncing a stream of keystrokes.
 */
export function useScraperFilters(config: SyncConfig | null): ScraperFilterStore {
  const [set, setSet] = useState<FilterSet>(loadFilterSet)
  const [status, setStatus] = useState<FilterSyncStatus>(config ? 'syncing' : 'off')
  const [error, setError] = useState('')
  const setRef = useRef(set)

  const apply = useCallback((next: FilterSet) => {
    setRef.current = next
    saveFilterSet(next)
    setSet(next)
  }, [])

  const sync = useCallback(
    async (cfg: SyncConfig) => {
      setStatus('syncing')
      try {
        const merged = await syncFilterSet(cfg, setRef.current)
        if (JSON.stringify(merged) !== JSON.stringify(setRef.current)) apply(merged)
        setStatus('synced')
        setError('')
      } catch (e) {
        setStatus('error')
        setError(e instanceof Error ? e.message : 'Could not sync the filters.')
      }
    },
    [apply],
  )

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- sync reports the progress of an external request
    if (config) void sync(config)
    else setStatus('off')
  }, [config, sync])

  const mutate = useCallback(
    (change: (current: FilterSet) => FilterSet) => {
      apply(change(setRef.current))
      if (config) void sync(config)
    },
    [apply, config, sync],
  )

  const save = useCallback(
    (filter: ScraperFilter) => {
      const stamped = { ...filter, updatedAt: new Date().toISOString() }
      mutate((current) => ({
        ...current,
        filters: current.filters.some((f) => f.id === stamped.id)
          ? current.filters.map((f) => (f.id === stamped.id ? stamped : f))
          : [...current.filters, stamped],
      }))
    },
    [mutate],
  )

  const remove = useCallback(
    (id: string) => {
      mutate((current) => ({
        ...current,
        filters: current.filters.filter((f) => f.id !== id),
        // A tombstone, so the delete survives a device holding an older copy —
        // and so the watcher stops running it.
        tombstones: { ...current.tombstones, [id]: new Date().toISOString() },
      }))
    },
    [mutate],
  )

  const toggle = useCallback(
    (id: string) => {
      mutate((current) => ({
        ...current,
        filters: current.filters.map((f) =>
          f.id === id ? { ...f, enabled: !f.enabled, updatedAt: new Date().toISOString() } : f,
        ),
      }))
    },
    [mutate],
  )

  const syncNow = useCallback(() => {
    if (config) void sync(config)
  }, [config, sync])

  return { set, status, error, save, remove, toggle, syncNow }
}
