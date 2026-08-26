// The record of what we have already seen.
//
// Two jobs: never announce the same listing twice, and stay silent on the very
// first run while still remembering everything it found. The file is the only
// thing that makes runs stateful, so it is written atomically - a half-written
// state file would either replay old listings or lose new ones.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import config from './config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STATE_PATH = resolve(HERE, '..', 'data', 'seen.json');

const VERSION = 1;

function emptyState() {
  return {
    version: VERSION,
    seeded: false,
    seededAt: null,
    updatedAt: null,
    runs: 0,
    listings: {},
    // Reaction pickups: listing id -> { addedAt, confirmedAt }. See recordTcoAdd.
    tco: {},
  };
}

/** Read the state file, or return a fresh empty state if there isn't one. */
export async function loadState(path = DEFAULT_STATE_PATH) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { ...emptyState(), isNew: true };
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `State file ${path} is not valid JSON (${error.message}). ` +
        'Fix or delete it - deleting means the next run re-seeds and announces nothing.',
    );
  }

  if (parsed.version !== VERSION) {
    throw new Error(`State file ${path} has version ${parsed.version}, expected ${VERSION}.`);
  }

  return {
    ...emptyState(),
    ...parsed,
    listings: parsed.listings ?? {},
    tco: parsed.tco ?? {},
    isNew: false,
  };
}

/** Write the state file atomically: full write to a temp file, then rename. */
export async function saveState(state, path = DEFAULT_STATE_PATH) {
  const persisted = { ...state };
  // `isNew` is a signal to this run, not part of the record.
  delete persisted.isNew;
  persisted.version = VERSION;
  persisted.updatedAt = new Date().toISOString();

  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
  await rename(temp, path);
  return persisted;
}

export function hasSeen(state, id) {
  return Object.hasOwn(state.listings, id);
}

export function wasAnnounced(state, id) {
  return Boolean(state.listings[id]?.announcedAt);
}

/**
 * Should we spend a request re-reading a listing we already rejected?
 *
 * Yes if the price or mileage moved (the seller has been editing, so the
 * description may have changed too) or if the cached verdict has gone stale.
 */
export function needsRecheck(state, listing, { recheckAfterDays = 14 } = {}) {
  const record = state.listings[listing.id];
  if (!record) return true;
  if (record.status === 'match') return false;
  if (!record.detailCheckedAt) return true;
  if (record.price !== null && listing.price !== null && record.price !== listing.price) return true;
  if (record.mileage !== null && listing.mileage !== null && record.mileage !== listing.mileage) {
    return true;
  }
  const ageMs = Date.now() - Date.parse(record.detailCheckedAt);
  return !Number.isFinite(ageMs) || ageMs > recheckAfterDays * 24 * 60 * 60 * 1000;
}

/**
 * Record what we learned about a listing.
 *
 * `firstSeenAt` and `announcedAt` are never overwritten once set, so a listing
 * that resurfaces is not treated as new.
 */
export function record(state, listing, verdict, { detailChecked = false, now = new Date() } = {}) {
  const timestamp = now.toISOString();
  const existing = state.listings[listing.id];

  state.listings[listing.id] = {
    status: verdict.matched ? 'match' : 'rejected',
    firstSeenAt: existing?.firstSeenAt ?? timestamp,
    lastSeenAt: timestamp,
    announcedAt: existing?.announcedAt ?? null,
    detailCheckedAt: detailChecked ? timestamp : (existing?.detailCheckedAt ?? null),
    url: listing.url,
    title: listing.subTitle || listing.title,
    year: listing.year,
    mileage: listing.mileage,
    price: listing.price,
    seller: listing.seller,
    reasons: verdict.matched ? [] : verdict.reasons,
  };

  return state.listings[listing.id];
}

export function markAnnounced(state, id, now = new Date()) {
  const entry = state.listings[id];
  if (entry) entry.announcedAt = now.toISOString();
}

/**
 * Drop listings we haven't seen for a long time.
 *
 * Keeps the file from growing without bound, and means a car genuinely
 * relisted months later is treated as news again rather than silently skipped.
 */
export function prune(state, { forgetAfterDays = config.state.forgetAfterDays, now = Date.now() } = {}) {
  const cutoff = now - forgetAfterDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const [id, entry] of Object.entries(state.listings)) {
    const lastSeen = Date.parse(entry.lastSeenAt ?? '');
    if (Number.isFinite(lastSeen) && lastSeen < cutoff) {
      delete state.listings[id];
      removed += 1;
    }
  }
  return removed;
}

/**
 * Which of the reacted listings should be (re)written to the calculator?
 *
 * The app's sync is last-write-wins, so an append can be overwritten by a
 * device pushing older data moments later. The rule that makes this safe in
 * both directions:
 *
 *  - never added -> add it;
 *  - added but not yet seen present in the gist -> add again (a race ate it);
 *  - seen present once (`confirmedAt`) -> leave it alone forever, so a car
 *    the user deliberately deletes in the app stays deleted.
 */
export function needsTcoAdd(state, id) {
  const entry = state.tco[id];
  return !entry || !entry.confirmedAt;
}

export function recordTcoAdd(state, id, now = new Date()) {
  const entry = state.tco[id] ?? (state.tco[id] = { addedAt: null, confirmedAt: null });
  entry.addedAt = entry.addedAt ?? now.toISOString();
}

export function recordTcoConfirmed(state, id, now = new Date()) {
  const entry = state.tco[id] ?? (state.tco[id] = { addedAt: null, confirmedAt: null });
  entry.confirmedAt = entry.confirmedAt ?? now.toISOString();
}

export function summarise(state) {
  const entries = Object.values(state.listings);
  return {
    tracked: entries.length,
    matches: entries.filter((entry) => entry.status === 'match').length,
    announced: entries.filter((entry) => entry.announcedAt).length,
  };
}
