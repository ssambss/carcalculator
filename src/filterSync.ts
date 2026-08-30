/**
 * Getting the scraper's filters from this browser to the watcher.
 *
 * They ride in the same gist the car data syncs to, but in a file of their
 * own — `car-tco-filters.json`. Deliberately not part of the car data
 * envelope: the app rewrites that file wholesale on every edit, so a device
 * running an older cached bundle would strip a key it has never heard of.
 * A separate file is simply left alone by writers that do not know it.
 *
 * The scraper reads `filters` out of this file every run (see
 * scraper/src/filters.js), so saving here is all it takes — no commit, no
 * deploy.
 */

import {
  type FilterSet,
  EMPTY_FILTER_SET,
  mergeFilterSets,
  normalizeFilterSet,
  toWire,
} from './scraperFilters'
import { type SyncConfig, github } from './sync'

const STORAGE_KEY = 'carcalculator.filters.v1'
const GIST_FILENAME = 'car-tco-filters.json'

export function loadFilterSet(): FilterSet {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalizeFilterSet(JSON.parse(raw))
  } catch {
    // corrupt or unavailable storage — start fresh
  }
  return { ...EMPTY_FILTER_SET }
}

export function saveFilterSet(set: FilterSet): void {
  try {
    // toWire, not the set as-is: it adds the old yearFrom/maxPrice spellings
    // beside `ranges`, so a bundle that predates the range bag still reads the
    // limits out of storage rather than seeing a filter with none.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...set, filters: set.filters.map(toWire) }))
  } catch {
    // storage full or blocked — the app keeps working in memory
  }
}

interface GistFilePayload {
  content?: string
  truncated?: boolean
  raw_url?: string
}

interface GistPayload {
  files?: Record<string, GistFilePayload | undefined>
}

/** The filters in the gist, or null when the file is not there yet. */
export async function pullFilterSet(cfg: SyncConfig): Promise<FilterSet | null> {
  const res = await github(`/gists/${cfg.gistId}`, cfg.token)
  const gist = (await res.json()) as GistPayload
  const file = gist.files?.[GIST_FILENAME]
  if (!file) return null
  let content = file.content ?? ''
  if (file.truncated && file.raw_url) {
    content = await (await fetch(file.raw_url)).text()
  }
  if (!content.trim()) return null
  return normalizeFilterSet(JSON.parse(content))
}

export async function pushFilterSet(cfg: SyncConfig, set: FilterSet): Promise<void> {
  const envelope = {
    app: 'carcalculator',
    savedAt: new Date().toISOString(),
    // Read by scraper/src/filters.js. Written through toWire so both the range
    // bag and the old single-purpose fields are present - the scraper prefers
    // the old spelling on conflict, and they agree whenever we are the writer.
    filters: set.filters.map(toWire),
    tombstones: set.tombstones,
  }
  await github(`/gists/${cfg.gistId}`, cfg.token, {
    method: 'PATCH',
    body: JSON.stringify({
      files: { [GIST_FILENAME]: { content: `${JSON.stringify(envelope, null, 2)}\n` } },
    }),
  })
}

/**
 * Read, merge, write — in that order, every time.
 *
 * Filters are edited one save at a time, never keystroke by keystroke, so
 * there is nothing to debounce: each save can afford to pick up whatever
 * another device wrote before overwriting the file.
 */
export async function syncFilterSet(cfg: SyncConfig, local: FilterSet): Promise<FilterSet> {
  const remote = await pullFilterSet(cfg)
  const merged = remote ? mergeFilterSets(local, remote) : local
  const same = remote && JSON.stringify(merged) === JSON.stringify(remote)
  if (!same) await pushFilterSet(cfg, merged)
  return merged
}
