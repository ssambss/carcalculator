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
 * at a time is not an answer to it. A zone is a city's: Espoo's zone 1 and
 * Helsinki's are different places at different prices, so they are offered
 * apart.
 *
 * Whether a place is within reach is not a property of the listing: it comes
 * from the ceiling, which moves with income, savings and the rules. So the
 * match takes it as an argument rather than reading it off the place.
 */

import { findPlace, zoneLabel, type AreaRecord, type Place, type Zone } from './areas'
import { AREA_PRICES } from './data/areaPrices'
import type { PropertyListing } from './housing'
import { loadSelection, saveSelection } from './selection'

/** against the affordability ceiling — the housing answer to a powertrain chip */
export type Reach = 'fits' | 'over'

export interface PropertyFilters {
  query: string
  /** 'all', `code:00730` for one area, `zone:helsinki:3` for a whole price zone, or 'none' */
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

export const placeOf = (p: PropertyListing): Place | null => findPlace(AREA_PRICES, p.postalCode)

export const areaOf = (p: PropertyListing): AreaRecord | null => placeOf(p)?.area ?? null

/* ------------------------------------------------------------ the area list */

export interface AreaGroup {
  /** the city's key; null for the group of places the price data has no area for */
  city: string | null
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
  const byZone = new Map<string, { place: Place; areas: Map<string, string> }>()
  let unplaced = 0
  for (const p of properties) {
    const place = placeOf(p)
    if (!place) {
      unplaced++
      continue
    }
    const key = zoneValue(place)
    const group = byZone.get(key) ?? { place, areas: new Map<string, string>() }
    group.areas.set(place.area.code, place.area.name)
    byZone.set(key, group)
  }

  // Cities in the data's order, Helsinki first; zones in theirs.
  const rank = ({ data, area }: Place) => AREA_PRICES.indexOf(data) * 10 + area.zone
  const groups: AreaGroup[] = [...byZone.entries()]
    .sort((a, b) => rank(a[1].place) - rank(b[1].place))
    .map(([value, { place, areas }]) => {
      const { data, area } = place
      return {
        city: data.key,
        zone: area.zone,
        label: `${data.name} · zone ${area.zone} · ${zoneLabel(data, area.zone)}`,
        options: [
          { value, label: `All of ${data.name} zone ${area.zone}` },
          ...[...areas.entries()]
            .sort((a, b) => a[1].localeCompare(b[1], 'fi'))
            .map(([code, name]) => ({ value: `code:${code}`, label: `${code} ${name}` })),
        ],
      }
    })

  if (unplaced > 0) {
    groups.push({
      city: null,
      zone: null,
      label: 'Outside the price data',
      options: [{ value: NO_AREA, label: `No postal code the data covers (${unplaced})` }],
    })
  }
  return groups
}

/** "zone:espoo:1" - a whole price zone of one city. */
const zoneValue = ({ data, area }: Place): string => `zone:${data.key}:${area.zone}`

/** Does the area selection still name something the list offers? */
export function areaFilterExists(groups: AreaGroup[], area: string): boolean {
  if (area === ALL_AREAS) return true
  return groups.some((g) => g.options.some((o) => o.value === area))
}

function matchesArea(p: PropertyListing, area: string): boolean {
  if (area === ALL_AREAS) return true
  const found = placeOf(p)
  if (area === NO_AREA) return found === null
  if (area.startsWith('zone:')) return found !== null && zoneValue(found) === area
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
    const place = placeOf(p)
    const haystack = [p.name, p.notes, p.postalCode, place?.area.name ?? '', place?.data.name ?? '']
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
