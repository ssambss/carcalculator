// The record of what we have already seen.
//
// Two jobs: never announce the same listing twice, and stay silent on the very
// first run while still remembering everything it found. The file is the only
// thing that makes runs stateful, so it is written atomically - a half-written
// state file would either replay old listings or lose new ones.
//
// Everything about a listing that a filter decides - the verdict, the reasons,
// whether it was posted - is stored per filter, because two filters can
// legitimately disagree about the same listing. The listing's own facts (price,
// mileage, when its page was last read) are shared: they are properties of the
// advert, not of anyone's opinion of it.
//
// Records are keyed `sourceId:id`, because a site's ids are only unique within
// that site - see keyOf(). Where the bytes live is src/storage/'s business; this
// module only reads and writes text.

import config from './config.js';
import { DEFAULT_STATE_PATH, storeFor } from './storage/index.js';
import { fileStore } from './storage/file.js';
import { DEFAULT_SOURCE_ID } from './sources/index.js';

export { DEFAULT_STATE_PATH };

const VERSION = 3;

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

/**
 * A listing's key in the record: `sourceId:id`.
 *
 * Site ids are only unique within a site. Two sources will eventually both
 * number a listing 900, and a bare key would have them share one record - the
 * price of one overwriting the other's, and a reaction on one adding the other
 * to the calculator. Namespacing costs nothing and removes the whole class.
 */
export function keyOf(sourceId, id) {
  return `${sourceId ?? DEFAULT_SOURCE_ID}:${id}`;
}

/** The key for a listing, which carries its own source once parsed. */
export function keyFor(listing) {
  return keyOf(listing.sourceId, listing.id);
}

/** A path string is shorthand for a file store at that path. */
function asStore(where) {
  return typeof where === 'string' ? fileStore({ path: where }) : where;
}

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
  // Version 2, not VERSION: the migrations chain, and this record still has to
  // go through the re-keying below. Jumping to the newest version here left a
  // v1 file with bare, unnamespaced keys.
  return { ...parsed, version: 2, listings, filters: {} };
}

/**
 * Fold a version 2 record into namespaced keys.
 *
 * Every listing in a version 2 file is a nettiauto listing, because that is all
 * there was - so the whole record moves under that prefix and nothing is lost.
 * Announcements survive, which is the part that matters: a re-keying that
 * dropped them would repost the entire current market.
 */
function migrateFrom2(parsed) {
  const listings = {};
  for (const [id, entry] of Object.entries(parsed.listings ?? {})) {
    listings[keyOf(DEFAULT_SOURCE_ID, id)] = entry;
  }
  const tco = {};
  for (const [id, entry] of Object.entries(parsed.tco ?? {})) {
    tco[keyOf(DEFAULT_SOURCE_ID, id)] = entry;
  }
  return { ...parsed, version: VERSION, listings, tco };
}

/**
 * Read the stored record, or a fresh empty state if there is nothing yet.
 *
 * `where` is anything from src/storage/ — a local file by default, a gist when
 * configured. A plain path string is accepted as shorthand for a file there,
 * which is what a test or a one-off inspection wants.
 *
 * Older versions are migrated in memory on the way through, and written back in
 * the new shape by the next save.
 */
export async function loadState(where = storeFor()) {
  const store = asStore(where);
  const raw = await store.read();
  if (raw === null) return { ...emptyState(), isNew: true, store };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `The state in ${store.describe()} is not valid JSON (${error.message}). ` +
        'Fix or delete it - deleting means the next run re-seeds and announces nothing.',
    );
  }

  const from = parsed.version;
  if (parsed.version === 1) parsed = migrateFrom1(parsed);
  if (parsed.version === 2) parsed = migrateFrom2(parsed);
  const migrated = from !== VERSION;

  if (parsed.version !== VERSION) {
    throw new Error(
      `The state in ${store.describe()} has version ${parsed.version}, expected ${VERSION}. ` +
        'A newer version of the watcher wrote it; upgrade rather than downgrade.',
    );
  }

  return {
    ...emptyState(),
    ...parsed,
    listings: parsed.listings ?? {},
    filters: parsed.filters ?? {},
    tco: parsed.tco ?? {},
    isNew: false,
    migrated,
    migratedFrom: migrated ? from : null,
    store,
  };
}

/** Write the record back wherever it came from. */
export async function saveState(state, where = state.store ?? storeFor()) {
  const store = asStore(where);
  const persisted = { ...state };
  // Signals to this run, not part of the record.
  delete persisted.isNew;
  delete persisted.migrated;
  delete persisted.migratedFrom;
  delete persisted.store;
  persisted.version = VERSION;
  persisted.updatedAt = new Date().toISOString();

  // Indentation is a third of the bytes, and worth it only where a human opens
  // the file. The backend decides; see src/storage/.
  const text = store.pretty
    ? `${JSON.stringify(persisted, null, 2)}\n`
    : JSON.stringify(persisted);
  await store.write(text);
  return persisted;
}

export function hasSeen(state, key) {
  return Object.hasOwn(state.listings, key);
}

/** What a filter decided about a listing last time, if it ever did. */
export function verdictFor(state, key, filterId) {
  return state.listings[key]?.filters?.[filterId] ?? null;
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
export function wasAnnounced(state, key, filterId) {
  return Boolean(state.listings[key]?.filters?.[filterId]?.announcedAt);
}

/**
 * Should we spend a request re-reading a listing we already rejected?
 *
 * Yes if the price or mileage moved (the seller has been editing, so the
 * description may have changed too) or if the cached verdict has gone stale.
 * The detail page is shared by every filter, so its age is too.
 */
export function needsRecheck(state, listing, filterId, { recheckAfterDays = 14 } = {}) {
  const record = state.listings[keyFor(listing)];
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
  const key = keyFor(listing);
  const existing = state.listings[key];

  state.listings[key] = {
    firstSeenAt: existing?.firstSeenAt ?? timestamp,
    lastSeenAt: timestamp,
    detailCheckedAt: detailChecked ? timestamp : (existing?.detailCheckedAt ?? null),
    // Kept so a reacted listing can be rebuilt from the record alone, long
    // after it has dropped off the current crawl.
    sourceId: listing.sourceId ?? DEFAULT_SOURCE_ID,
    url: listing.url,
    title: listing.subTitle || listing.title,
    year: listing.year,
    mileage: listing.mileage,
    price: listing.price,
    seller: listing.seller,
    filters: existing?.filters ?? {},
  };

  return state.listings[key];
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

export function markAnnounced(state, key, filterId, now = new Date()) {
  const verdict = state.listings[key]?.filters?.[filterId];
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

  for (const [key, entry] of Object.entries(state.listings)) {
    const lastSeen = Date.parse(entry.lastSeenAt ?? '');
    if (Number.isFinite(lastSeen) && lastSeen < cutoff) {
      delete state.listings[key];
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
export function needsTcoAdd(state, key) {
  const entry = state.tco[key];
  return !entry || !entry.confirmedAt;
}

export function recordTcoAdd(state, key, now = new Date()) {
  const entry = state.tco[key] ?? (state.tco[key] = { addedAt: null, confirmedAt: null });
  entry.addedAt = entry.addedAt ?? now.toISOString();
}

export function recordTcoConfirmed(state, key, now = new Date()) {
  const entry = state.tco[key] ?? (state.tco[key] = { addedAt: null, confirmedAt: null });
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
