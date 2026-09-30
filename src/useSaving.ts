import { useCallback, useEffect, useRef, useState } from 'react'
import type { SavingPlan, SavingReading } from './saving'
import { type SavingData, loadSaving, saveSaving, syncSaving } from './savingStorage'
import type { SyncConfig } from './sync'

export type SavingSyncStatus = 'off' | 'syncing' | 'synced' | 'error'

export interface SavingStore {
  data: SavingData
  status: SavingSyncStatus
  error: string
  savePlan: (plan: SavingPlan) => void
  /** one or more check-ins at once - both savers' balances on the same day */
  saveReadings: (readings: SavingReading[]) => void
  removeReading: (id: string) => void
  /** a restored backup, wholesale - restamped so its plan wins the next merge */
  replace: (next: SavingData) => void
  syncNow: () => void
}

/**
 * The saving plan and its check-ins, kept in this browser and mirrored to
 * their own gist file.
 *
 * The mileage hook's shape: the plan's fields edit keystroke by keystroke, so
 * the push is debounced rather than PATCHing the gist on every digit, and
 * every push reads and merges first.
 */
export function useSaving(config: SyncConfig | null): SavingStore {
  const [data, setData] = useState<SavingData>(loadSaving)
  const [status, setStatus] = useState<SavingSyncStatus>(config ? 'syncing' : 'off')
  const [error, setError] = useState('')
  const dataRef = useRef(data)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const apply = useCallback((next: SavingData) => {
    dataRef.current = next
    saveSaving(next)
    setData(next)
  }, [])

  const sync = useCallback(
    async (cfg: SyncConfig) => {
      setStatus('syncing')
      try {
        const merged = await syncSaving(cfg, dataRef.current)
        if (JSON.stringify(merged) !== JSON.stringify(dataRef.current)) apply(merged)
        setStatus('synced')
        setError('')
      } catch (e) {
        setStatus('error')
        setError(e instanceof Error ? e.message : 'Could not sync the saving plan.')
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
    (change: (current: SavingData) => SavingData) => {
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

  const savePlan = useCallback(
    (plan: SavingPlan) => {
      mutate((current) => ({ ...current, plan, planUpdatedAt: new Date().toISOString() }))
    },
    [mutate],
  )

  const saveReadings = useCallback(
    (readings: SavingReading[]) => {
      const now = new Date().toISOString()
      const stamped = readings.map((r) => ({ ...r, updatedAt: now }))
      mutate((current) => {
        const ids = new Set(stamped.map((r) => r.id))
        return {
          ...current,
          readings: [...current.readings.filter((r) => !ids.has(r.id)), ...stamped],
        }
      })
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

  const replace = useCallback(
    (next: SavingData) => {
      mutate(() => ({ ...next, planUpdatedAt: new Date().toISOString() }))
    },
    [mutate],
  )

  const syncNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (config) void sync(config)
  }, [config, sync])

  return { data, status, error, savePlan, saveReadings, removeReading, replace, syncNow }
}
