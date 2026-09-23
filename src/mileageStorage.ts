/**
 * Where the lease mileage lives: this browser, and a file of its own in the gist.
 *
 * Its own file for the reason housing got one: a device holding an older cached
 * bundle rewrites the files it knows wholesale, and would strip keys it has
 * never heard of. A file it does not know, it leaves alone.
 *
 * The merge follows the rules the cars, the filters and housing live by:
 * readings and trips per item by `updatedAt`, deletion tombstones that a later
 * edit can override, canonical ordering so identical merges serialize
 * identically on every device. The contract is one object, so it merges whole
 * by its own timestamp - one device's start date with another's allowance is
 * nobody's contract.
 */

import {
  DEFAULT_LEASE,
  dayOf,
  type MileageLease,
  type OdometerReading,
  type PlannedTrip,
} from './mileage'
import { type SyncConfig, github } from './sync'

const STORAGE_KEY = 'carcalculator.mileage.v1'
const GIST_FILENAME = 'car-tco-mileage.json'

export interface MileageData {
  version: 1
  lease: MileageLease
  /** when the contract itself was last edited - its merge key */
  leaseUpdatedAt: string
  readings: OdometerReading[]
  trips: PlannedTrip[]
  /** deleted reading and trip ids → deletion time, so a delete beats a stale copy */
  tombstones: Record<string, string>
}

export const EMPTY_MILEAGE: MileageData = {
  version: 1,
  lease: { ...DEFAULT_LEASE },
  leaseUpdatedAt: '',
  readings: [],
  trips: [],
  tombstones: {},
}

export function newReading(date: string, km: number): OdometerReading {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), date, km, createdAt: now, updatedAt: now }
}

export function newTrip(name: string, date: string, km: number): PlannedTrip {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), name, date, km, createdAt: now, updatedAt: now }
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

/** A real 'YYYY-MM-DD' day, or '' - never a date the maths would choke on. */
function toDate(v: unknown): string {
  return typeof v === 'string' && dayOf(v) !== null ? v : ''
}

export function normalizeLease(raw: unknown): MileageLease {
  const l = isRecord(raw) ? raw : {}
  const d = DEFAULT_LEASE
  return {
    startDate: toDate(l.startDate),
    // A lease of zero months has no days to spread the allowance over.
    termMonths: Math.max(1, Math.round(toNum(l.termMonths, d.termMonths))),
    allowanceKm: Math.max(0, toNum(l.allowanceKm, d.allowanceKm)),
    startOdometerKm: Math.max(0, toNum(l.startOdometerKm, d.startOdometerKm)),
    excessFeePerKm: Math.max(0, toNum(l.excessFeePerKm, d.excessFeePerKm)),
  }
}

function stamps(r: Record<string, unknown>): { createdAt: string; updatedAt: string } {
  const createdAt = typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString()
  return { createdAt, updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : createdAt }
}

/** A reading, or null when it has no day - an undated odometer figure says nothing. */
export function normalizeReading(raw: unknown): OdometerReading | null {
  const r = isRecord(raw) ? raw : {}
  const date = toDate(r.date)
  if (!date) return null
  return {
    id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
    date,
    km: Math.max(0, toNum(r.km, 0)),
    ...stamps(r),
  }
}

export function normalizeTrip(raw: unknown): PlannedTrip | null {
  const r = isRecord(raw) ? raw : {}
  const date = toDate(r.date)
  if (!date) return null
  return {
    id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
    name: typeof r.name === 'string' ? r.name : '',
    date,
    km: Math.max(0, toNum(r.km, 0)),
    ...stamps(r),
  }
}

function list<T>(raw: unknown, normalize: (x: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalize).filter((x): x is T => x !== null)
}

export function normalizeMileage(raw: unknown): MileageData {
  const obj = isRecord(raw) ? raw : {}
  const tombstones: Record<string, string> = {}
  if (isRecord(obj.tombstones)) {
    for (const [id, at] of Object.entries(obj.tombstones)) {
      if (typeof at === 'string') tombstones[id] = at
    }
  }
  return {
    version: 1,
    lease: normalizeLease(obj.lease),
    leaseUpdatedAt: typeof obj.leaseUpdatedAt === 'string' ? obj.leaseUpdatedAt : '',
    readings: list(obj.readings, normalizeReading),
    trips: list(obj.trips, normalizeTrip),
    tombstones,
  }
}

/* -------------------------------------------------------------------- merge */

const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

interface Item {
  id: string
  date: string
  createdAt: string
  updatedAt: string
}

/**
 * One list's merge: per item by `updatedAt`, ties to `preferred`, a tombstone
 * beats an item unless the item was edited after the deletion (and then the
 * tombstone goes). Ordered by day, then creation, then id - canonical, and
 * the order the log is read in anyway.
 */
function mergeItems<T extends Item>(
  preferred: T[],
  other: T[],
  tombstones: Record<string, string>,
): T[] {
  const byId = new Map<string, T>()
  for (const x of other) byId.set(x.id, x)
  for (const x of preferred) {
    const existing = byId.get(x.id)
    if (!existing || x.updatedAt >= existing.updatedAt) byId.set(x.id, x)
  }
  const kept = [...byId.values()].filter((x) => {
    const deletedAt = tombstones[x.id]
    if (!deletedAt) return true
    if (x.updatedAt > deletedAt) {
      delete tombstones[x.id] // edited after the deletion → resurrected
      return true
    }
    return false
  })
  return kept.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  )
}

export function mergeMileage(preferred: MileageData, other: MileageData): MileageData {
  const tombstones: Record<string, string> = {}
  for (const source of [other.tombstones, preferred.tombstones]) {
    for (const [id, at] of Object.entries(source)) {
      if (!tombstones[id] || tombstones[id] < at) tombstones[id] = at
    }
  }

  const readings = mergeItems(preferred.readings, other.readings, tombstones)
  const trips = mergeItems(preferred.trips, other.trips, tombstones)

  const cutoff = new Date(Date.now() - TOMBSTONE_TTL_MS).toISOString()
  const kept: Record<string, string> = {}
  for (const id of Object.keys(tombstones).sort()) {
    if (tombstones[id] >= cutoff) kept[id] = tombstones[id]
  }

  const preferredLease = preferred.leaseUpdatedAt >= other.leaseUpdatedAt ? preferred : other

  return {
    version: 1,
    lease: preferredLease.lease,
    leaseUpdatedAt: preferredLease.leaseUpdatedAt,
    readings,
    trips,
    tombstones: kept,
  }
}

/* ------------------------------------------------------------ localStorage */

export function loadMileage(): MileageData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalizeMileage(JSON.parse(raw))
  } catch {
    // corrupt or unavailable storage — start fresh
  }
  return structuredClone(EMPTY_MILEAGE)
}

export function saveMileage(data: MileageData): void {
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

/** The mileage data in the gist, or null when the file is not there yet. */
export async function pullMileage(cfg: SyncConfig): Promise<MileageData | null> {
  const res = await github(`/gists/${cfg.gistId}`, cfg.token)
  const gist = (await res.json()) as GistPayload
  const file = gist.files?.[GIST_FILENAME]
  if (!file) return null
  let content = file.content ?? ''
  if (file.truncated && file.raw_url) {
    content = await (await fetch(file.raw_url)).text()
  }
  if (!content.trim()) return null
  return normalizeMileage(JSON.parse(content))
}

export async function pushMileage(cfg: SyncConfig, data: MileageData): Promise<void> {
  const envelope = { app: 'carcalculator', savedAt: new Date().toISOString(), ...data }
  await github(`/gists/${cfg.gistId}`, cfg.token, {
    method: 'PATCH',
    body: JSON.stringify({
      files: { [GIST_FILENAME]: { content: `${JSON.stringify(envelope, null, 2)}\n` } },
    }),
  })
}

/** Read, merge, write - so a reading logged on the phone survives one logged on the laptop. */
export async function syncMileage(cfg: SyncConfig, local: MileageData): Promise<MileageData> {
  const remote = await pullMileage(cfg)
  const merged = remote ? mergeMileage(local, remote) : local
  const same = remote && JSON.stringify(merged) === JSON.stringify(remote)
  if (!same) await pushMileage(cfg, merged)
  return merged
}
