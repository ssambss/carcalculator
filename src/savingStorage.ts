/**
 * Where the saving plan and its check-ins live: this browser, and a file of
 * their own in the gist.
 *
 * Not inside the housing file, though they belong to the housing side: a
 * device holding a bundle that knows housing but not saving would read the
 * housing file, drop the keys it has never heard of, and write it back
 * without them. A file it does not know, it leaves alone - the reason the
 * housing and the mileage data got files of their own too.
 *
 * The merge follows the rules everything else lives by: check-ins per item by
 * `updatedAt`, deletion tombstones that a later edit can override, canonical
 * ordering so identical merges serialize identically on every device. The
 * plan is one object, so it merges whole by its own timestamp - one device's
 * purchase day with another's deposits is nobody's plan.
 */

import { dayOf } from './mileage'
import { DEFAULT_PLAN, type SavingPlan, type SavingReading, type Saver } from './saving'
import { type SyncConfig, github } from './sync'

const STORAGE_KEY = 'carcalculator.saving.v1'
const GIST_FILENAME = 'car-tco-saving.json'

export interface SavingData {
  version: 1
  plan: SavingPlan
  /** when the plan itself was last edited - its merge key */
  planUpdatedAt: string
  readings: SavingReading[]
  /** deleted check-in ids → deletion time, so a delete beats a stale copy */
  tombstones: Record<string, string>
}

export const EMPTY_SAVING: SavingData = {
  version: 1,
  plan: { ...DEFAULT_PLAN },
  planUpdatedAt: '',
  readings: [],
  tombstones: {},
}

export function newSavingReading(date: string, saver: Saver, amount: number): SavingReading {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), date, saver, amount, createdAt: now, updatedAt: now }
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

/** A real 'YYYY-MM' month, or ''. */
function toMonth(v: unknown): string {
  return typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) && dayOf(`${v}-01`) !== null ? v : ''
}

export function normalizePlan(raw: unknown): SavingPlan {
  const p = isRecord(raw) ? raw : {}
  const d = DEFAULT_PLAN
  return {
    targetDate: toDate(p.targetDate),
    monthlyDeposit: Math.max(0, toNum(p.monthlyDeposit, d.monthlyDeposit)),
    partnerMonthlyDeposit: Math.max(0, toNum(p.partnerMonthlyDeposit, d.partnerMonthlyDeposit)),
    // A savings account does not charge for holding money; zero is the floor.
    interestPct: Math.max(0, toNum(p.interestPct, d.interestPct)),
    bonusPct: Math.max(0, toNum(p.bonusPct, d.bonusPct)),
    goalPrice: Math.max(0, toNum(p.goalPrice, d.goalPrice)),
    goalHomeType:
      p.goalHomeType === 'flat' || p.goalHomeType === 'terraced' || p.goalHomeType === 'detached'
        ? p.goalHomeType
        : '',
    aspFirstMonth: toMonth(p.aspFirstMonth),
    partnerAspFirstMonth: toMonth(p.partnerAspFirstMonth),
  }
}

/** A check-in, or null when it has no day - an undated balance says nothing. */
export function normalizeSavingReading(raw: unknown): SavingReading | null {
  const r = isRecord(raw) ? raw : {}
  const date = toDate(r.date)
  if (!date) return null
  const createdAt = typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString()
  return {
    id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
    date,
    // Anything but the second borrower is yours: a file with no saver on a
    // check-in was written for one person.
    saver: r.saver === 'partner' ? 'partner' : 'self',
    amount: Math.max(0, toNum(r.amount, 0)),
    createdAt,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : createdAt,
  }
}

export function normalizeSaving(raw: unknown): SavingData {
  const obj = isRecord(raw) ? raw : {}
  const tombstones: Record<string, string> = {}
  if (isRecord(obj.tombstones)) {
    for (const [id, at] of Object.entries(obj.tombstones)) {
      if (typeof at === 'string') tombstones[id] = at
    }
  }
  return {
    version: 1,
    plan: normalizePlan(obj.plan),
    planUpdatedAt: typeof obj.planUpdatedAt === 'string' ? obj.planUpdatedAt : '',
    readings: Array.isArray(obj.readings)
      ? obj.readings
          .map(normalizeSavingReading)
          .filter((x): x is SavingReading => x !== null)
      : [],
    tombstones,
  }
}

/* -------------------------------------------------------------------- merge */

const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Merge two copies: check-ins per item by `updatedAt`, ties to `preferred`, a
 * tombstone beats a check-in unless it was edited after the deletion (and
 * then the tombstone goes). Ordered by day, then creation, then id -
 * canonical, and the order the log is read in anyway. The plan merges whole.
 */
export function mergeSaving(preferred: SavingData, other: SavingData): SavingData {
  const tombstones: Record<string, string> = {}
  for (const source of [other.tombstones, preferred.tombstones]) {
    for (const [id, at] of Object.entries(source)) {
      if (!tombstones[id] || tombstones[id] < at) tombstones[id] = at
    }
  }

  const byId = new Map<string, SavingReading>()
  for (const x of other.readings) byId.set(x.id, x)
  for (const x of preferred.readings) {
    const existing = byId.get(x.id)
    if (!existing || x.updatedAt >= existing.updatedAt) byId.set(x.id, x)
  }
  const readings = [...byId.values()]
    .filter((x) => {
      const deletedAt = tombstones[x.id]
      if (!deletedAt) return true
      if (x.updatedAt > deletedAt) {
        delete tombstones[x.id] // edited after the deletion → resurrected
        return true
      }
      return false
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    )

  const cutoff = new Date(Date.now() - TOMBSTONE_TTL_MS).toISOString()
  const kept: Record<string, string> = {}
  for (const id of Object.keys(tombstones).sort()) {
    if (tombstones[id] >= cutoff) kept[id] = tombstones[id]
  }

  const preferredPlan = preferred.planUpdatedAt >= other.planUpdatedAt ? preferred : other

  return {
    version: 1,
    plan: preferredPlan.plan,
    planUpdatedAt: preferredPlan.planUpdatedAt,
    readings,
    tombstones: kept,
  }
}

/* ------------------------------------------------------------ localStorage */

export function loadSaving(): SavingData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalizeSaving(JSON.parse(raw))
  } catch {
    // corrupt or unavailable storage — start fresh
  }
  return structuredClone(EMPTY_SAVING)
}

export function saveSaving(data: SavingData): void {
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

/** The saving data in the gist, or null when the file is not there yet. */
export async function pullSaving(cfg: SyncConfig): Promise<SavingData | null> {
  const res = await github(`/gists/${cfg.gistId}`, cfg.token)
  const gist = (await res.json()) as GistPayload
  const file = gist.files?.[GIST_FILENAME]
  if (!file) return null
  let content = file.content ?? ''
  if (file.truncated && file.raw_url) {
    content = await (await fetch(file.raw_url)).text()
  }
  if (!content.trim()) return null
  return normalizeSaving(JSON.parse(content))
}

export async function pushSaving(cfg: SyncConfig, data: SavingData): Promise<void> {
  const envelope = { app: 'carcalculator', savedAt: new Date().toISOString(), ...data }
  await github(`/gists/${cfg.gistId}`, cfg.token, {
    method: 'PATCH',
    body: JSON.stringify({
      files: { [GIST_FILENAME]: { content: `${JSON.stringify(envelope, null, 2)}\n` } },
    }),
  })
}

/**
 * Read, merge, write - so a balance one of you logs on a phone survives the
 * one the other logs on a laptop the same evening.
 */
export async function syncSaving(cfg: SyncConfig, local: SavingData): Promise<SavingData> {
  const remote = await pullSaving(cfg)
  const merged = remote ? mergeSaving(local, remote) : local
  const same = remote && JSON.stringify(merged) === JSON.stringify(remote)
  if (!same) await pushSaving(cfg, merged)
  return merged
}
