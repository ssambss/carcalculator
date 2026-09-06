import { useCallback, useEffect, useRef, useState } from 'react'
import type { HousingSituation, PropertyListing } from './housing'
import { type HousingData, loadHousing, saveHousing, syncHousing } from './housingStorage'
import type { SyncConfig } from './sync'

export type HousingSyncStatus = 'off' | 'syncing' | 'synced' | 'error'

export interface HousingStore {
  data: HousingData
  status: HousingSyncStatus
  error: string
  saveSituation: (s: HousingSituation) => void
  saveProperty: (p: PropertyListing) => void
  removeProperty: (id: string) => void
  toggleFavorite: (id: string) => void
  syncNow: () => void
}

/**
 * The housing data, kept in this browser and mirrored to its own gist file.
 *
 * Same shape as the scraper filters' hook, for the same reason: housing
 * changes one Save at a time, so every mutation can read-merge-write straight
 * away instead of debouncing keystrokes the way the car data has to.
 */
export function useHousing(config: SyncConfig | null): HousingStore {
  const [data, setData] = useState<HousingData>(loadHousing)
  const [status, setStatus] = useState<HousingSyncStatus>(config ? 'syncing' : 'off')
  const [error, setError] = useState('')
  const dataRef = useRef(data)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const apply = useCallback((next: HousingData) => {
    dataRef.current = next
    saveHousing(next)
    setData(next)
  }, [])

  const sync = useCallback(
    async (cfg: SyncConfig) => {
      setStatus('syncing')
      try {
        const merged = await syncHousing(cfg, dataRef.current)
        if (JSON.stringify(merged) !== JSON.stringify(dataRef.current)) apply(merged)
        setStatus('synced')
        setError('')
      } catch (e) {
        setStatus('error')
        setError(e instanceof Error ? e.message : 'Could not sync the housing data.')
      }
    },
    [apply],
  )

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- sync reports the progress of an external request
    if (config) void sync(config)
    else setStatus('off')
  }, [config, sync])

  // Unlike the filters, the situation edits keystroke by keystroke through the
  // NumberFields - so the push is debounced the same way the car data's is,
  // rather than PATCHing the gist on every digit.
  const mutate = useCallback(
    (change: (current: HousingData) => HousingData) => {
      apply(change(dataRef.current))
      if (!config) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void sync(config), 2000)
    },
    [apply, config, sync],
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const saveSituation = useCallback(
    (situation: HousingSituation) => {
      mutate((current) => ({
        ...current,
        situation,
        situationUpdatedAt: new Date().toISOString(),
      }))
    },
    [mutate],
  )

  const saveProperty = useCallback(
    (p: PropertyListing) => {
      const stamped = { ...p, updatedAt: new Date().toISOString() }
      mutate((current) => ({
        ...current,
        properties: current.properties.some((x) => x.id === stamped.id)
          ? current.properties.map((x) => (x.id === stamped.id ? stamped : x))
          : [...current.properties, stamped],
      }))
    },
    [mutate],
  )

  const removeProperty = useCallback(
    (id: string) => {
      mutate((current) => ({
        ...current,
        properties: current.properties.filter((p) => p.id !== id),
        // A tombstone, so the delete survives a device holding an older copy.
        tombstones: { ...current.tombstones, [id]: new Date().toISOString() },
      }))
    },
    [mutate],
  )

  const toggleFavorite = useCallback(
    (id: string) => {
      mutate((current) => ({
        ...current,
        properties: current.properties.map((p) =>
          p.id === id ? { ...p, favorite: !p.favorite, updatedAt: new Date().toISOString() } : p,
        ),
      }))
    },
    [mutate],
  )

  const syncNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (config) void sync(config)
  }, [config, sync])

  return { data, status, error, saveSituation, saveProperty, removeProperty, toggleFavorite, syncNow }
}
