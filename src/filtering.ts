import type { CarListing, Powertrain } from './types'

export interface Filters {
  query: string
  /** 'all' or a make name (the first word of the car's name) */
  make: string
  /** empty = all powertrains */
  powertrains: Powertrain[]
  selectedOnly: boolean
}

export const NO_FILTERS: Filters = {
  query: '',
  make: 'all',
  powertrains: [],
  selectedOnly: false,
}

/** Make is derived from the name's first word ("Škoda Octavia…" → "Škoda"). */
export function makeOf(car: CarListing): string {
  return car.name.trim().split(/\s+/)[0] ?? ''
}

export function listMakes(cars: CarListing[]): string[] {
  const makes = new Set<string>()
  for (const car of cars) {
    const make = makeOf(car)
    if (make) makes.add(make)
  }
  return [...makes].sort((a, b) => a.localeCompare(b))
}

export function isFilterActive(f: Filters): boolean {
  return f.query.trim() !== '' || f.make !== 'all' || f.powertrains.length > 0 || f.selectedOnly
}

export function matchesFilters(
  car: CarListing,
  f: Filters,
  selected: ReadonlySet<string>,
): boolean {
  if (f.selectedOnly && !selected.has(car.id)) return false
  if (f.powertrains.length > 0 && !f.powertrains.includes(car.powertrain)) return false
  if (f.make !== 'all' && makeOf(car) !== f.make) return false
  const q = f.query.trim().toLowerCase()
  if (q && !car.name.toLowerCase().includes(q) && !car.notes.toLowerCase().includes(q)) {
    return false
  }
  return true
}

/* Selection is deliberately device-local (not synced): what one person picks
 * to compare shouldn't rearrange another device's view. */
const SELECTION_KEY = 'carcalculator.selection.v1'

export function loadSelection(): Set<string> {
  try {
    const raw = localStorage.getItem(SELECTION_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((x): x is string => typeof x === 'string'))
      }
    }
  } catch {
    // corrupt or unavailable — start unselected
  }
  return new Set()
}

export function saveSelection(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify([...ids]))
  } catch {
    // ignore
  }
}
