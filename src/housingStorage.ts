/**
 * Where the housing data lives: this browser, and a file of its own in the gist.
 *
 * A file of its own for the same reason the scraper filters got one: the app
 * rewrites `car-tco-data.json` wholesale through `normalizeData()` on every
 * push, so a device holding an older cached bundle — one that has never heard of
 * housing — would silently strip these keys on its next sync. A separate file is
 * left alone by writers that do not know about it, which is exactly the property
 * a newly added kind of data needs.
 *
 * The merge follows the same rules as cars and filters: per item by
 * `updatedAt`, deletion tombstones that a later edit can override, canonical
 * ordering so identical merges serialize identically on every device. The
 * situation (income, savings, the rules to assume) is one object, not a list,
 * so it merges by its own timestamp: newer edit wins whole.
 */

import {
  DEFAULT_HOUSING,
  type HousingSituation,
  type PropertyListing,
} from './housing'
import { type SyncConfig, github } from './sync'

const STORAGE_KEY = 'carcalculator.housing.v1'
const GIST_FILENAME = 'car-tco-housing.json'

export interface HousingData {
  version: 1
  situation: HousingSituation
  /** when the situation itself was last edited — its merge key */
  situationUpdatedAt: string
  properties: PropertyListing[]
  /** deleted property ids → deletion time, so a delete beats a stale copy */
  tombstones: Record<string, string>
}

export const EMPTY_HOUSING: HousingData = {
  version: 1,
  situation: { ...DEFAULT_HOUSING },
  situationUpdatedAt: '',
  properties: [],
  tombstones: {},
}

export function newProperty(): PropertyListing {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name: '',
    notes: '',
    favorite: false,
    price: 0,
    sizeM2: 0,
    maintenancePerMonth: 0,
    financingChargePerMonth: 0,
    otherPerMonth: 0,
    createdAt: now,
    updatedAt: now,
  }
}

/* -------------------------------------------------------------- normalizing */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Same reading as storage.ts: comma decimals and grouping spaces accepted. */
function toNum(v: unknown, fallback: number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback
  if (typeof v !== 'string') return fallback
  const cleaned = v.replace(/[\s  ]/g, '').replace(',', '.')
  if (!cleaned) return fallback
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : fallback
}

export function normalizeSituation(raw: unknown): HousingSituation {
  const s = isRecord(raw) ? raw : {}
  const d = DEFAULT_HOUSING
  return {
    netIncomePerMonth: Math.max(0, toNum(s.netIncomePerMonth, d.netIncomePerMonth)),
    otherLoanPaymentsPerMonth: Math.max(
      0,
      toNum(s.otherLoanPaymentsPerMonth, d.otherLoanPaymentsPerMonth),
    ),
    savings: Math.max(0, toNum(s.savings, d.savings)),
    housingSharePct: Math.min(100, Math.max(0, toNum(s.housingSharePct, d.housingSharePct))),
    ratePct: Math.max(0, toNum(s.ratePct, d.ratePct)),
    // A term of zero would make every annuity zero; a year is the sane floor.
    termYears: Math.max(1, toNum(s.termYears, d.termYears)),
    stressRatePct: Math.max(0, toNum(s.stressRatePct, d.stressRatePct)),
    minDownPaymentPct: Math.min(100, Math.max(0, toNum(s.minDownPaymentPct, d.minDownPaymentPct))),
    transferTaxPct: Math.max(0, toNum(s.transferTaxPct, d.transferTaxPct)),
    buyingCosts: Math.max(0, toNum(s.buyingCosts, d.buyingCosts)),
    maintenanceEstimatePerMonth: Math.max(
      0,
      toNum(s.maintenanceEstimatePerMonth, d.maintenanceEstimatePerMonth),
    ),
    useAspLoan: s.useAspLoan === true,
    aspRatePct: Math.max(0, toNum(s.aspRatePct, d.aspRatePct)),
    aspMaxLoan: Math.max(0, toNum(s.aspMaxLoan, d.aspMaxLoan)),
  }
}

export function normalizeProperty(raw: unknown): PropertyListing {
  const p = isRecord(raw) ? raw : {}
  const base = newProperty()
  const createdAt = typeof p.createdAt === 'string' ? p.createdAt : base.createdAt
  return {
    id: typeof p.id === 'string' && p.id ? p.id : base.id,
    name: typeof p.name === 'string' ? p.name : '',
    notes: typeof p.notes === 'string' ? p.notes : '',
    favorite: p.favorite === true,
    price: Math.max(0, toNum(p.price, 0)),
    sizeM2: Math.max(0, toNum(p.sizeM2, 0)),
    maintenancePerMonth: Math.max(0, toNum(p.maintenancePerMonth, 0)),
    financingChargePerMonth: Math.max(0, toNum(p.financingChargePerMonth, 0)),
    otherPerMonth: Math.max(0, toNum(p.otherPerMonth, 0)),
    createdAt,
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : createdAt,
  }
}

export function normalizeHousing(raw: unknown): HousingData {
  const obj = isRecord(raw) ? raw : {}
  const tombstones: Record<string, string> = {}
  if (isRecord(obj.tombstones)) {
    for (const [id, at] of Object.entries(obj.tombstones)) {
      if (typeof at === 'string') tombstones[id] = at
    }
  }
  return {
    version: 1,
    situation: normalizeSituation(obj.situation),
    situationUpdatedAt:
      typeof obj.situationUpdatedAt === 'string' ? obj.situationUpdatedAt : '',
    properties: Array.isArray(obj.properties) ? obj.properties.map(normalizeProperty) : [],
    tombstones,
  }
}

/* -------------------------------------------------------------------- merge */

const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Merge two copies, same rules as cars and filters: per property by
 * `updatedAt`, ties to `preferred`, a tombstone beats a property unless the
 * property was edited after the deletion, output ordering canonical. The
 * situation merges whole, by its own timestamp — half of one person's income
 * and half of another's savings is nobody's situation.
 */
export function mergeHousing(preferred: HousingData, other: HousingData): HousingData {
  const tombstones: Record<string, string> = {}
  for (const source of [other.tombstones, preferred.tombstones]) {
    for (const [id, at] of Object.entries(source)) {
      if (!tombstones[id] || tombstones[id] < at) tombstones[id] = at
    }
  }

  const byId = new Map<string, PropertyListing>()
  for (const p of other.properties) byId.set(p.id, p)
  for (const p of preferred.properties) {
    const existing = byId.get(p.id)
    if (!existing || p.updatedAt >= existing.updatedAt) byId.set(p.id, p)
  }

  const properties = [...byId.values()].filter((p) => {
    const deletedAt = tombstones[p.id]
    if (!deletedAt) return true
    if (p.updatedAt > deletedAt) {
      delete tombstones[p.id] // edited after the deletion → resurrected
      return true
    }
    return false
  })
  properties.sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
  )

  const cutoff = new Date(Date.now() - TOMBSTONE_TTL_MS).toISOString()
  const kept: Record<string, string> = {}
  for (const id of Object.keys(tombstones).sort()) {
    if (tombstones[id] >= cutoff) kept[id] = tombstones[id]
  }

  const preferredSituation =
    preferred.situationUpdatedAt >= other.situationUpdatedAt ? preferred : other

  return {
    version: 1,
    situation: preferredSituation.situation,
    situationUpdatedAt: preferredSituation.situationUpdatedAt,
    properties,
    tombstones: kept,
  }
}

/* ------------------------------------------------------------ localStorage */

export function loadHousing(): HousingData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalizeHousing(JSON.parse(raw))
  } catch {
    // corrupt or unavailable storage — start fresh
  }
  return structuredClone(EMPTY_HOUSING)
}

export function saveHousing(data: HousingData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // storage full or blocked — the app keeps working in memory
  }
}

/* --------------------------------------------------------------- gist sync */

interface GistFilePayload {
  content?: string
  truncated?: boolean
  raw_url?: string
}

interface GistPayload {
  files?: Record<string, GistFilePayload | undefined>
}

/** The housing data in the gist, or null when the file is not there yet. */
export async function pullHousing(cfg: SyncConfig): Promise<HousingData | null> {
  const res = await github(`/gists/${cfg.gistId}`, cfg.token)
  const gist = (await res.json()) as GistPayload
  const file = gist.files?.[GIST_FILENAME]
  if (!file) return null
  let content = file.content ?? ''
  if (file.truncated && file.raw_url) {
    content = await (await fetch(file.raw_url)).text()
  }
  if (!content.trim()) return null
  return normalizeHousing(JSON.parse(content))
}

export async function pushHousing(cfg: SyncConfig, data: HousingData): Promise<void> {
  const envelope = { app: 'carcalculator', savedAt: new Date().toISOString(), ...data }
  await github(`/gists/${cfg.gistId}`, cfg.token, {
    method: 'PATCH',
    body: JSON.stringify({
      files: { [GIST_FILENAME]: { content: `${JSON.stringify(envelope, null, 2)}\n` } },
    }),
  })
}

/**
 * Read, merge, write — the same shape as the filter sync, and for the same
 * reason: housing data changes one Save at a time, never keystroke by
 * keystroke, so every save can afford to pick up what another device wrote
 * before overwriting the file.
 */
export async function syncHousing(cfg: SyncConfig, local: HousingData): Promise<HousingData> {
  const remote = await pullHousing(cfg)
  const merged = remote ? mergeHousing(local, remote) : local
  const same = remote && JSON.stringify(merged) === JSON.stringify(remote)
  if (!same) await pushHousing(cfg, merged)
  return merged
}
