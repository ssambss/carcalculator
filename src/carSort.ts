import { useEffect, useState } from 'react'
import type { CarListing } from './types'
import { type TcoResult, byOutOfPocket } from './calc'

export type CarSort = 'outOfPocket' | 'perMonth' | 'perKm' | 'newest' | 'name'

/**
 * The orders the cards can take. No "total": with per-car periods, totals are
 * over different windows - the per-month figure after resale is the total made
 * comparable, so it stands in for it.
 */
export const CAR_SORTS: { key: CarSort; label: string }[] = [
  { key: 'outOfPocket', label: 'Out of pocket / mo' },
  { key: 'perMonth', label: 'After resale / mo' },
  { key: 'perKm', label: 'Per km' },
  { key: 'newest', label: 'Newest added' },
  { key: 'name', label: 'Name' },
]

export function carComparator(sort: CarSort, results: ReadonlyMap<string, TcoResult>) {
  const metric = (key: 'perMonth' | 'perKm') => (a: CarListing, b: CarListing) =>
    (results.get(a.id)?.[key] ?? 0) - (results.get(b.id)?.[key] ?? 0)
  switch (sort) {
    case 'perMonth':
      return metric('perMonth')
    case 'perKm':
      return metric('perKm')
    case 'newest':
      return (a: CarListing, b: CarListing) => b.createdAt.localeCompare(a.createdAt)
    case 'name':
      return (a: CarListing, b: CarListing) => a.name.localeCompare(b.name, 'fi')
    default:
      // The headline's own order, cash cars after the financed ones - see byOutOfPocket.
      return byOutOfPocket(results)
  }
}

const SORT_KEY = 'carcalculator.carSort'

function isCarSort(v: unknown): v is CarSort {
  return CAR_SORTS.some((s) => s.key === v)
}

/** Device-local like the theme: an order is how this person reads, not data. */
export function useCarSort(): [CarSort, (s: CarSort) => void] {
  const [sort, setSort] = useState<CarSort>(() => {
    try {
      const saved = localStorage.getItem(SORT_KEY)
      if (isCarSort(saved)) return saved
    } catch {
      // storage unavailable - the default order
    }
    return 'outOfPocket'
  })

  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, sort)
    } catch {
      // fine - the order still holds for this session
    }
  }, [sort])

  return [sort, setSort]
}
