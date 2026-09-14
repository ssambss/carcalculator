/**
 * Narrowing the housing side down to the places you actually want side by side.
 *
 * The car side's filters, asked of a flat: a text search, one dimension you
 * pick from a list, a couple of chips, and the device-local pick of what goes
 * into the comparison. What differs is the dimensions, because the questions
 * differ — a car has a make and a powertrain, a home has a location and a
 * price it either clears or does not.
 *
 * The area filter takes the postal code the listing already carries (it is
 * what ties a place to its price history) and offers it at two grains: one
 * postal-code area, or a whole price zone — "show me the outer-suburb
 * candidates" is a question somebody actually asks, and picking four areas one
 * at a time is not an answer to it.
 *
 * Whether a place is within reach is not a property of the listing: it comes
 * from the ceiling, which moves with income, savings and the rules. So the
 * match takes it as an argument rather than reading it off the place.
 */

import { ZONE_LABELS, findArea, type AreaRecord, type Zone } from './areas'
import { HELSINKI_PRICES } from './data/helsinkiPrices'
import type { PropertyListing } from './housing'
import { loadSelection, saveSelection } from './selection'

/** against the affordability ceiling — the housing answer to a powertrain chip */
export type Reach = 'fits' | 'over'

export interface PropertyFilters {
  query: string
  /** 'all', `code:00730` for one area, `zone:3` for a whole price zone, or 'none' */
  area: string
  /** empty = both; otherwise which side of the ceiling */
  reach: Reach[]
  selectedOnly: boolean
  favoritesOnly: boolean
}

export const NO_PROPERTY_FILTERS: PropertyFilters = {
  query: '',
  area: 'all',
  reach: [],
  selectedOnly: false,
  favoritesOnly: false,
}

export const ALL_AREAS = 'all'
export const NO_AREA = 'none'

export const areaOf = (p: PropertyListing): AreaRecord | null =>
  findArea(HELSINKI_PRICES, p.postalCode)

/* ------------------------------------------------------------ the area list */

export interface AreaGroup {
  /** null for the group of places the price data has no area for */
  zone: Zone | null
  label: string
  options: { value: string; label: string }[]
}

/**
 * The areas worth offering: the ones the listed places are actually in, by
 * zone, each zone openable as a whole. A group for the places with no usable
 * postal code appears only when there are some — an empty option that matches
 * nothing is just a way to make the view go blank.
 */
export function listPropertyAreas(properties: PropertyListing[]): AreaGroup[] {
  const byZone = new Map<Zone, Map<string, string>>()
  let unplaced = 0
  for (const p of properties) {
    const area = areaOf(p)
    if (!area) {
      unplaced++
      continue
    }
    const areas = byZone.get(area.zone) ?? new Map<string, string>()
    areas.set(area.code, area.name)
    byZone.set(area.zone, areas)
  }

  const groups: AreaGroup[] = [...byZone.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([zone, areas]) => ({
      zone,
      label: `Zone ${zone} · ${ZONE_LABELS[zone]}`,
      options: [
        { value: `zone:${zone}`, label: `All of zone ${zone}` },
        ...[...areas.entries()]
          .sort((a, b) => a[1].localeCompare(b[1], 'fi'))
          .map(([code, name]) => ({ value: `code:${code}`, label: `${code} ${name}` })),
      ],
    }))

  if (unplaced > 0) {
    groups.push({
      zone: null,
      label: 'Outside the price data',
      options: [{ value: NO_AREA, label: `No Helsinki postal code (${unplaced})` }],
    })
  }
  return groups
}

/** Does the area selection still name something the list offers? */
export function areaFilterExists(groups: AreaGroup[], area: string): boolean {
  if (area === ALL_AREAS) return true
  return groups.some((g) => g.options.some((o) => o.value === area))
}

function matchesArea(p: PropertyListing, area: string): boolean {
  if (area === ALL_AREAS) return true
  const found = areaOf(p)
  if (area === NO_AREA) return found === null
  if (area.startsWith('zone:')) return found !== null && String(found.zone) === area.slice(5)
  if (area.startsWith('code:')) return p.postalCode.trim() === area.slice(5)
  return true
}

/* -------------------------------------------------------------- the matching */

export function isPropertyFilterActive(f: PropertyFilters): boolean {
  return (
    f.query.trim() !== '' ||
    f.area !== ALL_AREAS ||
    f.reach.length > 0 ||
    f.selectedOnly ||
    f.favoritesOnly
  )
}

export function matchesPropertyFilters(
  p: PropertyListing,
  f: PropertyFilters,
  selected: ReadonlySet<string>,
  /** from the cost of this place against the current ceiling */
  fits: boolean,
): boolean {
  if (f.favoritesOnly && !p.favorite) return false
  if (f.selectedOnly && !selected.has(p.id)) return false
  if (f.reach.length > 0 && !f.reach.includes(fits ? 'fits' : 'over')) return false
  if (!matchesArea(p, f.area)) return false
  const q = f.query.trim().toLowerCase()
  if (q) {
    const area = areaOf(p)
    const haystack = [p.name, p.notes, p.postalCode, area?.name ?? '']
    if (!haystack.some((h) => h.toLowerCase().includes(q))) return false
  }
  return true
}

/* ------------------------------------------------------------- the selection */

/** Its own key: switching calculators should not clear either side's pick. */
const SELECTION_KEY = 'carcalculator.housing.selection.v1'

export function loadPropertySelection(): Set<string> {
  return loadSelection(SELECTION_KEY)
}

export function savePropertySelection(ids: ReadonlySet<string>): void {
  saveSelection(SELECTION_KEY, ids)
}
