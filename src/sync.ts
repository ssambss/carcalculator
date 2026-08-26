import type { AppData } from './types'
import { normalizeData } from './storage'

const CONFIG_KEY = 'carcalculator.sync.v1'
const EDITED_KEY = 'carcalculator.editedAt.v1'
const GIST_FILENAME = 'car-tco-data.json'
const API_BASE = 'https://api.github.com'

export interface SyncConfig {
  token: string
  gistId: string
}

export interface RemoteData {
  savedAt: string
  data: AppData
}

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as SyncConfig).token === 'string' &&
      typeof (parsed as SyncConfig).gistId === 'string'
    ) {
      return parsed as SyncConfig
    }
  } catch {
    // corrupt config — treat as not connected
  }
  return null
}

export function saveSyncConfig(cfg: SyncConfig | null): void {
  try {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
    else localStorage.removeItem(CONFIG_KEY)
  } catch {
    // storage unavailable
  }
}

/**
 * Timestamp of the last local USER edit (not of remote data being applied) —
 * the basis for last-write-wins between devices. ISO strings compare
 * lexicographically.
 */
export function getEditedAt(): string {
  try {
    return localStorage.getItem(EDITED_KEY) ?? ''
  } catch {
    return ''
  }
}

export function stampEditedAt(iso?: string): void {
  try {
    localStorage.setItem(EDITED_KEY, iso ?? new Date().toISOString())
  } catch {
    // ignore
  }
}

async function github(path: string, token: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      ...(init && init.headers ? init.headers : {}),
    },
  })
  if (res.status === 401 || res.status === 403) {
    throw new Error('GitHub rejected the token — make sure it is valid and has the "gist" scope.')
  }
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`)
  return res
}

interface GistFilePayload {
  content?: string
  truncated?: boolean
  raw_url?: string
}

interface GistPayload {
  id?: string
  files?: Record<string, GistFilePayload | undefined>
}

function envelope(data: AppData): string {
  return JSON.stringify(
    { app: 'carcalculator', savedAt: getEditedAt() || new Date().toISOString(), data },
    null,
    2,
  )
}

/** Find this app's gist on the account, or create a new secret one. */
export async function connectGist(token: string, current: AppData): Promise<SyncConfig> {
  const listRes = await github('/gists?per_page=100', token)
  const gists = (await listRes.json()) as GistPayload[]
  const existing = Array.isArray(gists)
    ? gists.find((g) => g.files && GIST_FILENAME in g.files)
    : undefined
  if (existing?.id) return { token, gistId: existing.id }

  if (!getEditedAt()) stampEditedAt()
  const createRes = await github('/gists', token, {
    method: 'POST',
    body: JSON.stringify({
      description: 'Car TCO calculator data (auto-synced)',
      public: false,
      files: { [GIST_FILENAME]: { content: envelope(current) } },
    }),
  })
  const created = (await createRes.json()) as GistPayload
  if (!created.id) throw new Error('GitHub did not return a gist id.')
  return { token, gistId: created.id }
}

export async function pullGist(cfg: SyncConfig): Promise<RemoteData | null> {
  const res = await github(`/gists/${cfg.gistId}`, cfg.token)
  const gist = (await res.json()) as GistPayload
  const file = gist.files?.[GIST_FILENAME]
  if (!file) return null
  let content = file.content ?? ''
  if (file.truncated && file.raw_url) {
    content = await (await fetch(file.raw_url)).text()
  }
  const parsed: unknown = JSON.parse(content)
  const savedAt =
    typeof parsed === 'object' &&
    parsed !== null &&
    typeof (parsed as { savedAt?: unknown }).savedAt === 'string'
      ? (parsed as { savedAt: string }).savedAt
      : ''
  const data = normalizeData((parsed as { data?: unknown } | null)?.data)
  return { savedAt, data }
}

export async function pushGist(cfg: SyncConfig, data: AppData): Promise<void> {
  await github(`/gists/${cfg.gistId}`, cfg.token, {
    method: 'PATCH',
    body: JSON.stringify({ files: { [GIST_FILENAME]: { content: envelope(data) } } }),
  })
}
