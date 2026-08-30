// The record of what we have already seen.
//
// Two jobs: never announce the same listing twice, and stay silent on the very
// first run while still remembering everything it found. The file is the only
// thing that makes runs stateful, so it is written atomically - a half-written
// state file would either replay old listings or lose new ones.
//
// Everything about a listing that a filter decides - the verdict, the reasons,
// whether it was posted - is stored per filter, because two filters can
// legitimately disagree about the same car. The listing's own facts (price,
// mileage, when its page was last read) are shared: they are properties of the
// advert, not of anyone's opinion of it.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import config from './config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STATE_PATH = resolve(HERE, '..', 'data', 'seen.json');

const VERSION = 2;

/**
 * Where a version 1 record's verdict is filed on migration.
 *
 * Version 1 predates filters: there was one hardcoded spec, so its
 * announcements cannot be attributed to any filter id in particular. They land
 * under this key, and the first filter to form a verdict on such a listing
 * copies the timestamp into its own record (see `record`) - so nothing the old
 * single-spec watcher already posted is posted again, while every filter still
 * keeps its own answer and can supersede it. Its *verdicts* are not reused,
 * since we no longer know which spec produced them.
 */
const LEGACY_KEY = '(pre-filters)';

function emptyState() {
  return {
    version: VERSION,
    seeded: false,
    seededAt: null,
    updatedAt: null,
    runs: 0,
    listings: {},
    // Filter id -> { name, firstRunAt, lastRunAt }. Knowing a filter has run
    // before is what makes "post what is already on sale" a one-off.
    filters: {},
    // Reaction pickups: listing id -> { addedAt, confirmedAt }. See recordTcoAdd.
    tco: {},
  };
}

/** Fold a version 1 record into the per-filter shape. */
function migrateFrom1(parsed) {
  const listings = {};
  for (const [id, entry] of Object.entries(parsed.listings ?? {})) {
    // `reasons` is dropped: it explained a spec no filter can claim now.
    const { status, reasons: _reasons, announcedAt, ...shared } = entry;
    listings[id] = {
      ...shared,
      filters: announcedAt
        ? { [LEGACY_KEY]: { status: status ?? 'match', reasons: [], announcedAt } }
        : {},
    };
  }
  return { ...parsed, version: VERSION, listings, filters: {} };
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

  let migrated = false;
  if (parsed.version === 1) {
    parsed = migrateFrom1(parsed);
    migrated = true;
  }

  if (parsed.version !== VERSION) {
    throw new Error(`State file ${path} has version ${parsed.version}, expected ${VERSION}.`);
  }

  return {
    ...emptyState(),
    ...parsed,
    listings: parsed.listings ?? {},
    filters: parsed.filters ?? {},
    tco: parsed.tco ?? {},
    isNew: false,
    migrated,
  };
}

/** Write the state file atomically: full write to a temp file, then rename. */
export async function saveState(state, path = DEFAULT_STATE_PATH) {
  const persisted = { ...state };
  // Signals to this run, not part of the record.
  delete persisted.isNew;
  delete persisted.migrated;
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

/** What a filter decided about a listing last time, if it ever did. */
export function verdictFor(state, id, filterId) {
  return state.listings[id]?.filters?.[filterId] ?? null;
}

/**
 * Has this listing been posted for this filter?
 *
 * Only the filter's own record answers. What the pre-filters watcher posted is
 * inherited once, when the filter first forms a verdict on the listing (see
 * `record`). Reading the legacy key here instead made it a blanket mute: it
 * belongs to no filter, so nothing ever supersedes it, and every filter made
 * in the UI stayed permanently silent on those cars whatever its spec.
 */
export function wasAnnounced(state, id, filterId) {
  return Boolean(state.listings[id]?.filters?.[filterId]?.announcedAt);
}

/**
 * Should we spend a request re-reading a listing we already rejected?
 *
 * Yes if the price or mileage moved (the seller has been editing, so the
 * description may have changed too) or if the cached verdict has gone stale.
 * The detail page is shared by every filter, so its age is too.
 */
export function needsRecheck(state, listing, filterId, { recheckAfterDays = 14 } = {}) {
  const record = state.listings[listing.id];
  if (!record) return true;
  const verdict = record.filters?.[filterId];
  if (!verdict) return true;
  if (verdict.status === 'match') return false;
  if (!record.detailCheckedAt) return true;
  if (record.price !== null && listing.price !== null && record.price !== listing.price) return true;
  if (record.mileage !== null && listing.mileage !== null && record.mileage !== listing.mileage) {
    return true;
  }
  const ageMs = Date.now() - Date.parse(record.detailCheckedAt);
  return !Number.isFinite(ageMs) || ageMs > recheckAfterDays * 24 * 60 * 60 * 1000;
}

/** Note that the listing is still on sale, and what its advert says now. */
export function touch(state, listing, { detailChecked = false, now = new Date() } = {}) {
  const timestamp = now.toISOString();
  const existing = state.listings[listing.id];

  state.listings[listing.id] = {
    firstSeenAt: existing?.firstSeenAt ?? timestamp,
    lastSeenAt: timestamp,
    detailCheckedAt: detailChecked ? timestamp : (existing?.detailCheckedAt ?? null),
    url: listing.url,
    title: listing.subTitle || listing.title,
    year: listing.year,
    mileage: listing.mileage,
    price: listing.price,
    seller: listing.seller,
    filters: existing?.filters ?? {},
  };

  return state.listings[listing.id];
}

/**
 * Record what one filter learned about a listing.
 *
 * `announcedAt` is never overwritten once set, so a listing that resurfaces is
 * not treated as new. A filter meeting a listing the pre-filters watcher had
 * already posted inherits that timestamp here: a human has seen the car in the
 * channel, and rebuilding the filter it came from does not undo that. The
 * inheritance is written per filter, so from then on it behaves like any other
 * announcement instead of muting everyone at once.
 */
export function record(state, listing, filterId, verdict, options = {}) {
  const entry = touch(state, listing, options);
  const existing = entry.filters[filterId];

  entry.filters[filterId] = {
    status: verdict.matched ? 'match' : 'rejected',
    reasons: verdict.matched ? [] : verdict.reasons,
    announcedAt: existing?.announcedAt ?? entry.filters[LEGACY_KEY]?.announcedAt ?? null,
  };

  return entry.filters[filterId];
}

export function markAnnounced(state, id, filterId, now = new Date()) {
  const verdict = state.listings[id]?.filters?.[filterId];
  if (verdict) verdict.announcedAt = verdict.announcedAt ?? now.toISOString();
}

/** Has this filter ever completed a run? */
export function isNewFilter(state, filterId) {
  return !state.filters[filterId]?.firstRunAt;
}

export function recordFilterRun(state, filter, now = new Date()) {
  const timestamp = now.toISOString();
  const entry = state.filters[filter.id] ?? (state.filters[filter.id] = { firstRunAt: null });
  entry.name = filter.name;
  entry.firstRunAt = entry.firstRunAt ?? timestamp;
  entry.lastRunAt = timestamp;
  return entry;
}

/**
 * Drop listings we haven't seen for a long time, and filters that stopped
 * running long ago.
 *
 * Keeps the file from growing without bound, and means a car genuinely
 * relisted months later is treated as news again rather than silently skipped.
 *
 * Filters are aged out rather than diffed against the filters of this run on
 * purpose: the filter list can come from the gist, and a token hiccup that
 * made it unreadable for one run must not throw away what has been announced.
 * A filter deleted in the UI simply stops being stamped and goes after the
 * same 90 days.
 */
export function prune(state, { forgetAfterDays = config.state.forgetAfterDays, now = Date.now() } = {}) {
  const cutoff = now - forgetAfterDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  const gone = new Set();
  for (const [filterId, entry] of Object.entries(state.filters)) {
    const lastRun = Date.parse(entry.lastRunAt ?? entry.firstRunAt ?? '');
    if (Number.isFinite(lastRun) && lastRun < cutoff) {
      delete state.filters[filterId];
      gone.add(filterId);
    }
  }

  for (const [id, entry] of Object.entries(state.listings)) {
    const lastSeen = Date.parse(entry.lastSeenAt ?? '');
    if (Number.isFinite(lastSeen) && lastSeen < cutoff) {
      delete state.listings[id];
      removed += 1;
      continue;
    }
    // The legacy key belongs to no filter and outlives all of them, or cars
    // from before per-filter tracking would be announced a second time.
    for (const filterId of gone) delete entry.filters?.[filterId];
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

/** Counts for the run summary; per filter when asked for one. */
export function summarise(state, filterId = null) {
  const entries = Object.values(state.listings);
  const verdicts = entries
    .map((entry) => (filterId ? entry.filters?.[filterId] : null))
    .filter(Boolean);

  if (filterId) {
    return {
      tracked: verdicts.length,
      matches: verdicts.filter((verdict) => verdict.status === 'match').length,
      announced: verdicts.filter((verdict) => verdict.announcedAt).length,
    };
  }

  const all = entries.flatMap((entry) => Object.values(entry.filters ?? {}));
  return {
    tracked: entries.length,
    matches: all.filter((verdict) => verdict.status === 'match').length,
    announced: all.filter((verdict) => verdict.announcedAt).length,
  };
}
