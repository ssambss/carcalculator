import { useCallback, useEffect, useRef, useState } from 'react'
import type { MileageLease, OdometerReading, PlannedTrip } from './mileage'
import { type MileageData, loadMileage, saveMileage, syncMileage } from './mileageStorage'
import type { SyncConfig } from './sync'

export type MileageSyncStatus = 'off' | 'syncing' | 'synced' | 'error'

export interface MileageStore {
  data: MileageData
  status: MileageSyncStatus
  error: string
  saveLease: (lease: MileageLease) => void
  saveReading: (r: OdometerReading) => void
  removeReading: (id: string) => void
  saveTrip: (t: PlannedTrip) => void
  removeTrip: (id: string) => void
  syncNow: () => void
}

/**
 * The lease mileage, kept in this browser and mirrored to its own gist file.
 *
 * The same shape as the housing hook: the contract's fields edit keystroke by
 * keystroke, so the push is debounced rather than PATCHing the gist on every
 * digit, and every push reads and merges first.
 */
export function useMileage(config: SyncConfig | null): MileageStore {
  const [data, setData] = useState<MileageData>(loadMileage)
  const [status, setStatus] = useState<MileageSyncStatus>(config ? 'syncing' : 'off')
  const [error, setError] = useState('')
  const dataRef = useRef(data)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const apply = useCallback((next: MileageData) => {
    dataRef.current = next
    saveMileage(next)
    setData(next)
  }, [])

  const sync = useCallback(
    async (cfg: SyncConfig) => {
      setStatus('syncing')
      try {
        const merged = await syncMileage(cfg, dataRef.current)
        if (JSON.stringify(merged) !== JSON.stringify(dataRef.current)) apply(merged)
        setStatus('synced')
        setError('')
      } catch (e) {
        setStatus('error')
        setError(e instanceof Error ? e.message : 'Could not sync the mileage.')
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
    (change: (current: MileageData) => MileageData) => {
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

  const saveLease = useCallback(
    (lease: MileageLease) => {
      mutate((current) => ({ ...current, lease, leaseUpdatedAt: new Date().toISOString() }))
    },
    [mutate],
  )

  const saveReading = useCallback(
    (r: OdometerReading) => {
      const stamped = { ...r, updatedAt: new Date().toISOString() }
      mutate((current) => ({
        ...current,
        readings: current.readings.some((x) => x.id === stamped.id)
          ? current.readings.map((x) => (x.id === stamped.id ? stamped : x))
          : [...current.readings, stamped],
      }))
    },
    [mutate],
  )

  const saveTrip = useCallback(
    (t: PlannedTrip) => {
      const stamped = { ...t, updatedAt: new Date().toISOString() }
      mutate((current) => ({
        ...current,
        trips: current.trips.some((x) => x.id === stamped.id)
          ? current.trips.map((x) => (x.id === stamped.id ? stamped : x))
          : [...current.trips, stamped],
      }))
    },
    [mutate],
  )

  // A tombstone with every delete, so it survives a device holding an older copy.
  const removeReading = useCallback(
    (id: string) => {
      mutate((current) => ({
        ...current,
        readings: current.readings.filter((r) => r.id !== id),
        tombstones: { ...current.tombstones, [id]: new Date().toISOString() },
      }))
    },
    [mutate],
  )

  const removeTrip = useCallback(
    (id: string) => {
      mutate((current) => ({
        ...current,
        trips: current.trips.filter((t) => t.id !== id),
        tombstones: { ...current.tombstones, [id]: new Date().toISOString() },
      }))
    },
    [mutate],
  )

  const syncNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (config) void sync(config)
  }, [config, sync])

  return { data, status, error, saveLease, saveReading, removeReading, saveTrip, removeTrip, syncNow }
}
