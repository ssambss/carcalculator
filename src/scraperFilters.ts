/**
 * The filters the nettiauto watcher runs.
 *
 * This is a shared contract, not app-internal state: the scraper reads exactly
 * this shape out of the gist (see scraper/src/filters.js, which normalises it
 * again on its side and never trusts a field to be present). Keep the two in
 * step — and keep every field optional-by-default, so an old app version and a
 * new scraper, or the reverse, still work.
 */

import {
  type Range,
  type Ranges,
  NETTIAUTO_FIELDS,
  describeRanges,
} from './listingFields'

export interface Implication {
  /** phrase whose presence proves the other one */
  if: string
  then: string
}

/**
 * "This word, after that package name, changes what it means."
 *
 * `lesser`: "Pilot Lite" is a smaller pack sold separately, so it must not
 * satisfy a requirement for Pilot. `feature`: "Pilot Assist" ships in both, so
 * seeing it proves nothing about which one the car has.
 *
 * These were hardcoded in the scraper's matcher, which meant every filter
 * carried one car's vocabulary. They belong to the filter that needs them.
 */
export interface PackageQualifier {
  package: string
  word: string
  means: 'lesser' | 'feature'
}

export interface ScraperFilter {
  id: string
  name: string
  enabled: boolean
  /** nettiauto URL path segments: /<make>/<model> */
  make: string
  model: string
  /**
   * Numeric limits, keyed by field: { year: { min, max }, mileage: { max } }.
   * The single source of truth in the app. The old yearFrom/maxMileage/maxPrice
   * spellings are read on the way in and written back out alongside this (see
   * toWire), so a device on an older bundle still sees the limits.
   */
  ranges: Ranges
  /** phrases required in the variant name and spec chips */
  variantMust: string[]
  variantMustNot: string[]
  /** phrases required anywhere in the ad, seller free text included */
  textMust: string[]
  textMustNot: string[]
  /** option packages, matched only when the text reads as a package */
  packages: string[]
  packageEvidence: 'strong' | 'weak'
  /** let a smaller variant of a package satisfy it (Pilot Lite for Pilot) */
  acceptLesserPackages: boolean
  /** words that change what a package name means when they follow it */
  packageQualifiers: PackageQualifier[]
  implications: Implication[]
  /** post the cars already on sale when this filter first runs */
  postExisting: boolean
  createdAt: string
  /** last edit — the basis for merging filters between devices */
  updatedAt: string
}

export interface FilterSet {
  version: 1
  filters: ScraperFilter[]
  /** deleted filter ids → deletion time, so a delete beats a stale copy */
  tombstones: Record<string, string>
}

export const EMPTY_FILTER_SET: FilterSet = { version: 1, filters: [], tombstones: {} }

/**
 * Package qualifiers a new filter starts with.
 *
 * Inert unless the filter asks for a package literally named "pilot", so a
 * filter for a BMW or a flat never meets them - which is what makes shipping
 * them by default harmless rather than a hidden car assumption. They are here
 * so a Polestar filter behaves correctly without the user having to discover
 * the feature; keeping them matches what the scraper defaults to for filters
 * written before the field existed.
 */
export const DEFAULT_PACKAGE_QUALIFIERS: PackageQualifier[] = [
  { package: 'pilot', word: 'lite', means: 'lesser' },
  { package: 'pilot', word: 'assist', means: 'feature' },
]

export function newScraperFilter(): ScraperFilter {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name: '',
    enabled: true,
    make: '',
    model: '',
    ranges: {},
    variantMust: [],
    variantMustNot: [],
    textMust: [],
    textMustNot: [],
    packages: [],
    packageEvidence: 'strong',
    acceptLesserPackages: false,
    packageQualifiers: [...DEFAULT_PACKAGE_QUALIFIERS],
    implications: [],
    postExisting: true,
    createdAt: now,
    updatedAt: now,
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function toIntOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseInt(v.replace(/[\s_]/g, ''), 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** Lowercased, trimmed, de-duplicated phrases — matching is case-insensitive. */
export function normalizePhrases(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const entry of v) {
    if (typeof entry !== 'string') continue
    const phrase = entry.trim().toLowerCase().replace(/\s+/g, ' ')
    if (phrase && !out.includes(phrase)) out.push(phrase)
  }
  return out
}

/** A nettiauto path segment: lowercase, no slashes or spaces. */
export function toSegment(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\s+/g, '-')
}

/**
 * Pull make and model out of a pasted nettiauto address.
 *
 * Both a search page and a single listing work, since the first two path
 * segments are the same either way: /polestar/2 and /polestar/2/15900001.
 */
export function parseNettiautoUrl(text: string): { make: string; model: string } | null {
  const match = /nettiauto\.com\/([^/?#\s]+)\/([^/?#\s]+)/i.exec(text.trim())
  const pair = match ?? /^\s*([^/?#\s]+)\/([^/?#\s]+)/.exec(text.trim())
  if (!pair) return null
  const make = toSegment(decodeURIComponent(pair[1]))
  const model = toSegment(decodeURIComponent(pair[2]))
  // A leading number is a path we do not understand, not a make.
  if (!make || !model || /^\d+$/.test(make)) return null
  return { make, model }
}

/** The old single-purpose fields, and the range slot each one fills. */
const LEGACY_RANGES: Record<string, [string, 'min' | 'max']> = {
  yearFrom: ['year', 'min'],
  yearTo: ['year', 'max'],
  maxMileage: ['mileage', 'max'],
  minPrice: ['price', 'min'],
  maxPrice: ['price', 'max'],
}

/**
 * Numeric limits, from the range bag and the old spellings together.
 *
 * **The old spelling wins where the two disagree.** Only a bundle that has
 * never heard of `ranges` writes one and not the other: it edits `maxPrice` and
 * copies the stale range straight through, so trusting the range there would
 * silently discard the edit. A current bundle writes both in step (see toWire),
 * so they agree and this never fires.
 *
 * Keys come out sorted so two devices serialize an identical set identically.
 */
export function normalizeRanges(raw: Record<string, unknown>): Ranges {
  const out: Ranges = {}
  const put = (key: string, side: 'min' | 'max', value: number | null) => {
    if (value === null) return
    const current: Range = out[key] ?? { min: null, max: null }
    out[key] = { ...current, [side]: value }
  }

  if (isRecord(raw.ranges)) {
    for (const [key, range] of Object.entries(raw.ranges)) {
      if (!key || !isRecord(range)) continue
      put(key, 'min', toIntOrNull(range.min))
      put(key, 'max', toIntOrNull(range.max))
    }
  }
  for (const [legacy, [key, side]] of Object.entries(LEGACY_RANGES)) {
    put(key, side, toIntOrNull(raw[legacy]))
  }

  const sorted: Ranges = {}
  for (const key of Object.keys(out).sort()) {
    // A field with neither bound asks for nothing; dropping it stops an empty
    // range reading as a requirement the scraper would reject every listing on.
    if (out[key].min === null && out[key].max === null) continue
    sorted[key] = out[key]
  }
  return sorted
}

/**
 * Package qualifiers, cleaned up.
 *
 * An **absent** field takes the defaults, matching the scraper; an explicitly
 * empty list means exactly that and clears them.
 */
export function normalizeQualifiers(value: unknown): PackageQualifier[] {
  if (value === undefined || value === null) return [...DEFAULT_PACKAGE_QUALIFIERS]
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: PackageQualifier[] = []
  for (const rule of value) {
    if (!isRecord(rule)) continue
    const pkg = typeof rule.package === 'string' ? rule.package.trim().toLowerCase() : ''
    const word = typeof rule.word === 'string' ? rule.word.trim().toLowerCase() : ''
    // A qualifier is the single token following the package name, so a phrase
    // cannot be one.
    if (!pkg || !word || /\s/.test(word)) continue
    const means: PackageQualifier['means'] = rule.means === 'feature' ? 'feature' : 'lesser'
    const key = `${pkg}|${word}|${means}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ package: pkg, word, means })
  }
  return out
}

/**
 * A filter as it goes onto the wire - localStorage or the gist.
 *
 * Writes `ranges` *and* the five old spellings it can express. The app itself
 * reads only `ranges`; the copies exist for a reader that predates it - a phone
 * holding a cached bundle for a few months, or the gist opened by hand. Without
 * them such a reader sees a filter with no limits at all, and could push that
 * widened version back.
 */
export function toWire(filter: ScraperFilter): Record<string, unknown> {
  const legacy: Record<string, number | null> = {}
  for (const [name, [key, side]] of Object.entries(LEGACY_RANGES)) {
    legacy[name] = filter.ranges?.[key]?.[side] ?? null
  }
  return { ...filter, ...legacy }
}

export function normalizeFilter(raw: unknown): ScraperFilter {
  const f = isRecord(raw) ? raw : {}
  const base = newScraperFilter()
  const implications = Array.isArray(f.implications)
    ? f.implications
        .map((rule) => ({
          if: isRecord(rule) && typeof rule.if === 'string' ? rule.if.trim().toLowerCase() : '',
          then:
            isRecord(rule) && typeof rule.then === 'string' ? rule.then.trim().toLowerCase() : '',
        }))
        .filter((rule) => rule.if && rule.then && rule.if !== rule.then)
    : []

  const createdAt = typeof f.createdAt === 'string' ? f.createdAt : base.createdAt
  return {
    id: typeof f.id === 'string' && f.id ? f.id : base.id,
    name: typeof f.name === 'string' ? f.name : '',
    enabled: f.enabled !== false,
    make: toSegment(f.make),
    model: toSegment(f.model),
    ranges: normalizeRanges(f),
    variantMust: normalizePhrases(f.variantMust),
    variantMustNot: normalizePhrases(f.variantMustNot),
    textMust: normalizePhrases(f.textMust),
    textMustNot: normalizePhrases(f.textMustNot),
    packages: normalizePhrases(f.packages),
    packageEvidence: f.packageEvidence === 'weak' ? 'weak' : 'strong',
    acceptLesserPackages: f.acceptLesserPackages === true,
    packageQualifiers: normalizeQualifiers(f.packageQualifiers),
    implications,
    postExisting: f.postExisting !== false,
    createdAt,
    updatedAt: typeof f.updatedAt === 'string' ? f.updatedAt : createdAt,
  }
}

/**
 * Read filters out of pasted JSON.
 *
 * Accepts everything someone might reasonably paste: a bare array, a single
 * filter object, the `{ filters: [...] }` envelope the gist file uses, or the
 * `scraper/filters.json` file verbatim. Throws with something readable when the
 * text is not JSON or holds no filter that names a page to crawl.
 *
 * An `id` in the pasted text is kept: it is what ties a filter to the watcher's
 * record of what it has already posted, so pasting the committed default back
 * in resumes that history rather than starting a new one.
 */
export function parseFilterJson(text: string): ScraperFilter[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That is not valid JSON.')
  }

  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.filters)
      ? parsed.filters
      : isRecord(parsed)
        ? [parsed]
        : []

  const filters = list.map(normalizeFilter).filter(isRunnable)
  if (filters.length === 0) {
    throw new Error('No filter in there with a make and model — nothing to add.')
  }
  return filters
}

export function normalizeFilterSet(raw: unknown): FilterSet {
  const obj = isRecord(raw) ? raw : {}
  const filters = Array.isArray(obj.filters) ? obj.filters.map(normalizeFilter) : []
  const tombstones: Record<string, string> = {}
  if (isRecord(obj.tombstones)) {
    for (const [id, at] of Object.entries(obj.tombstones)) {
      if (typeof at === 'string') tombstones[id] = at
    }
  }
  return { version: 1, filters, tombstones }
}

/** True once a filter names a page to crawl — the one thing it cannot skip. */
export function isRunnable(filter: ScraperFilter): boolean {
  return Boolean(filter.make && filter.model)
}

export function filterTitle(filter: ScraperFilter): string {
  return filter.name.trim() || [filter.make, filter.model].filter(Boolean).join(' ') || 'New filter'
}

/** The same one-line summary the scraper logs, for the filter list. */
export function describeFilter(filter: ScraperFilter): string {
  const parts: string[] = []
  if (filter.make && filter.model) parts.push(`${filter.make}/${filter.model}`)

  parts.push(...describeRanges(filter.ranges, NETTIAUTO_FIELDS))

  const must = [...filter.variantMust, ...filter.textMust]
  if (must.length) parts.push(`says ${must.join(' + ')}`)
  if (filter.packages.length) parts.push(`${filter.packages.join(' + ')} packages`)
  const not = [...filter.variantMustNot, ...filter.textMustNot]
  if (not.length) parts.push(`not ${not.join(', ')}`)

  return parts.join(' · ') || 'Everything on the model’s listing page'
}

/**
 * Merge two filter sets per filter, so two devices editing different filters
 * add up instead of clobbering each other. Newer `updatedAt` wins; ties go to
 * `preferred`; a tombstone beats a filter unless the filter was edited after
 * the deletion. Ordering is canonical, so the same merge serializes
 * identically wherever it runs.
 */
export function mergeFilterSets(preferred: FilterSet, other: FilterSet): FilterSet {
  const tombstones: Record<string, string> = {}
  for (const source of [other.tombstones, preferred.tombstones]) {
    for (const [id, at] of Object.entries(source)) {
      if (!tombstones[id] || tombstones[id] < at) tombstones[id] = at
    }
  }

  const byId = new Map<string, ScraperFilter>()
  for (const filter of other.filters) byId.set(filter.id, filter)
  for (const filter of preferred.filters) {
    const existing = byId.get(filter.id)
    if (!existing || filter.updatedAt >= existing.updatedAt) byId.set(filter.id, filter)
  }

  const filters = [...byId.values()].filter((filter) => {
    const deletedAt = tombstones[filter.id]
    if (!deletedAt) return true
    if (filter.updatedAt > deletedAt) {
      delete tombstones[filter.id] // edited after the deletion → resurrected
      return true
    }
    return false
  })
  filters.sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
  )

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const kept: Record<string, string> = {}
  for (const id of Object.keys(tombstones).sort()) {
    if (tombstones[id] >= cutoff) kept[id] = tombstones[id]
  }

  return { version: 1, filters, tombstones: kept }
}
