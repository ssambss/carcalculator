import { useEffect, useMemo, useRef, useState } from 'react'
import type { CarListing } from './types'
import { MARKET_BASE, type MarketIndex, type MarketRecord, recordFor } from './market'

/** The record moves when the watcher runs - every couple of hours at most. */
const STALE_MS = 30 * 60 * 1000
const CACHE_PREFIX = 'carcalculator.market.'

interface Cached<T> {
  fetchedAt: number
  data: T
}

/**
 * The last copy fetched, so a dealership with no signal still gets the check.
 * Best-effort: a full or blocked storage just means no offline copy.
 */
function readCache<T>(name: string): Cached<T> | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + name)
    return raw ? (JSON.parse(raw) as Cached<T>) : null
  } catch {
    return null
  }
}

function writeCache<T>(name: string, data: T) {
  try {
    localStorage.setItem(CACHE_PREFIX + name, JSON.stringify({ fetchedAt: Date.now(), data }))
  } catch {
    // no room - the check still works while the page is open
  }
}

async function fetchJson<T>(name: string): Promise<T> {
  const response = await fetch(MARKET_BASE + name)
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  return (await response.json()) as T
}

export interface MarketData {
  index: MarketIndex | null
  /** by file name, only the ones some car belongs to */
  records: ReadonlyMap<string, MarketRecord>
}

/**
 * The market records the cars on screen belong to, fetched as needed.
 *
 * Read-only and outside the sync on purpose: it is the watcher's, the same for
 * everybody, and nothing a person does here changes it.
 */
export function useMarket(cars: readonly CarListing[]): MarketData {
  const [index, setIndex] = useState<MarketIndex | null>(() => readCache<MarketIndex>('index')?.data ?? null)
  const [records, setRecords] = useState<ReadonlyMap<string, MarketRecord>>(() => new Map())
  const fetchedAt = useRef(new Map<string, number>([['index', readCache('index')?.fetchedAt ?? 0]]))
  const [tick, setTick] = useState(0)

  // Which files the cars need, as a stable key so the effect below runs when
  // that changes rather than on every edit.
  const needed = useMemo(
    () =>
      [...new Set(cars.map((car) => recordFor(car, index)?.file).filter((f): f is string => !!f))]
        .sort()
        .join('|'),
    [cars, index],
  )

  useEffect(() => {
    let cancelled = false
    const fresh = (name: string) => Date.now() - (fetchedAt.current.get(name) ?? 0) < STALE_MS

    async function load() {
      if (!fresh('index')) {
        try {
          const next = await fetchJson<MarketIndex>('index.json')
          fetchedAt.current.set('index', Date.now())
          writeCache('index', next)
          if (!cancelled) setIndex(next)
        } catch {
          // offline or the record is not there - whatever was cached stands
        }
      }
      for (const file of needed ? needed.split('|') : []) {
        if (cancelled) return
        if (fresh(file)) continue
        let data: MarketRecord | null = null
        try {
          data = await fetchJson<MarketRecord>(file)
          fetchedAt.current.set(file, Date.now())
          writeCache(file, data)
        } catch {
          data = readCache<MarketRecord>(file)?.data ?? null
        }
        if (data && !cancelled) {
          const record = data
          setRecords((prev) => new Map(prev).set(file, record))
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [needed, tick])

  // Back to the tab after a while: look again, as the car data's sync does.
  useEffect(() => {
    const onFocus = () => setTick((t) => t + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  return { index, records }
}
