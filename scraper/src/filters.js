// The list of searches the watcher runs.
//
// A filter is one saved search: a source, which of its listing pages to read,
// and the spec every listing on it is checked against. There can be any number of
// them, and they are meant to be made in the calculator's UI - they travel to
// the scraper inside the same secret gist the app already syncs with, so a
// filter created on a phone is live on the next run, with no commit and no
// deploy.
//
// Resolution order, first source with at least one usable filter wins:
//
//   1. car-tco-filters.json in the app's gist - needs GIST_TOKEN
//   2. filters.json next to this folder - committed, so CI and a fresh
//      checkout have something to run before any UI has written a filter
//
// The filters get a file of their own in the gist rather than a corner of
// car-tco-data.json on purpose: the app rewrites that envelope on every edit
// through normalizeData(), so a device running a cached older bundle - one
// that has never heard of filters - would quietly strip them on its next
// push. A separate file is left alone by writers that do not know about it.
//
// The only thing a filter cannot leave out is the search - the page to read.
// Everything else is optional, and a filter with no requirements at all is
// legal: it matches that whole listing page, which is exactly what you want
// when scouting something you have no fixed spec for.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import config from './config.js';
import { describeRanges } from './fields.js';
import { DEFAULT_SOURCE_ID, hasSource, sourceOf } from './sources/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FILTERS_PATH = resolve(HERE, '..', config.filters.file);

/** A phrase list, lowercased and de-duplicated; anything odd is dropped. */
function phrases(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const phrase = entry.trim().toLowerCase().replace(/\s+/g, ' ');
    if (phrase) seen.add(phrase);
  }
  return [...seen];
}

function integer(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.replace(/[\s_]/g, ''), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * The single-purpose numeric fields a filter used to carry, and the range slot
 * each one now fills.
 *
 * Read forever, not for one release: the gist is hand-edited, a phone can hold
 * a cached app bundle for months, and a filter typed in before this change is
 * still a filter someone means to run.
 */
const LEGACY_RANGES = {
  yearFrom: ['year', 'min'],
  yearTo: ['year', 'max'],
  maxMileage: ['mileage', 'max'],
  minPrice: ['price', 'min'],
  maxPrice: ['price', 'max'],
};

/**
 * Numeric limits, as `{ field: { min, max } }`.
 *
 * Accepts the declared `ranges` bag and the five legacy fields together, and
 * **the legacy field wins where both say something.** That is the direction
 * that survives an old app bundle: it edits `maxPrice`, knows nothing about
 * `ranges`, and copies the stale one through untouched - so trusting `ranges`
 * there would quietly ignore the edit. A new bundle writes both in step, so
 * they agree and the rule never fires.
 *
 * The failure this cannot avoid is an old bundle *removing* a limit, which
 * leaves the range in place and is honoured as still-narrow. That errs toward
 * a filter that posts too little rather than one that floods the channel, and a
 * filter that has gone quiet is the easier of the two to notice.
 *
 * Keys come out sorted so two devices serialize an identical set identically.
 */
function ranges(raw) {
  const out = {};
  const put = (key, side, value) => {
    if (value === null) return;
    out[key] ??= { min: null, max: null };
    out[key][side] = value;
  };

  if (raw?.ranges && typeof raw.ranges === 'object') {
    for (const [key, range] of Object.entries(raw.ranges)) {
      if (!key || typeof range !== 'object' || range === null) continue;
      put(key, 'min', integer(range.min));
      put(key, 'max', integer(range.max));
    }
  }

  for (const [legacy, [key, side]] of Object.entries(LEGACY_RANGES)) {
    put(key, side, integer(raw?.[legacy]));
  }

  const sorted = {};
  for (const key of Object.keys(out).sort()) {
    // A field mentioned with neither bound asks for nothing; drop it so an
    // empty range cannot masquerade as a requirement.
    if (out[key].min === null && out[key].max === null) continue;
    sorted[key] = out[key];
  }
  return sorted;
}

/**
 * Package qualifiers applied when a filter names none of its own.
 *
 * These two were constants in filter.js, so every filter carried one car's
 * vocabulary. Moving them onto the filter is the generalisation; keeping them
 * as a default is what stops that being a silent behaviour change for a filter
 * already in the gist, which has never heard of the field and would otherwise
 * start letting Pilot Lite satisfy Pilot.
 *
 * They are inert unless a filter asks for a package literally named "pilot", so
 * a filter watching a BMW or a flat never meets them. Once the live filters
 * carry their own, this can go - it is the last car-specific thing left in the
 * matcher.
 */
export const DEFAULT_PACKAGE_QUALIFIERS = [
  { package: 'pilot', word: 'lite', means: 'lesser' },
  { package: 'pilot', word: 'assist', means: 'feature' },
];

/**
 * "This word after that package name changes what it means."
 *
 * An **absent** field takes the defaults above; an explicitly empty list means
 * exactly that and clears them. The distinction is what lets a filter say "no
 * qualifiers, I mean it" without a magic value.
 */
function qualifiers(value) {
  if (value === undefined || value === null) return [...DEFAULT_PACKAGE_QUALIFIERS];
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const rule of value) {
    if (!rule || typeof rule !== 'object') continue;
    const name = typeof rule.package === 'string' ? rule.package.trim().toLowerCase() : '';
    const word = typeof rule.word === 'string' ? rule.word.trim().toLowerCase() : '';
    if (!name || !word || /\s/.test(word)) continue;
    const means = rule.means === 'feature' ? 'feature' : 'lesser';
    const key = `${name}|${word}|${means}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ package: name, word, means });
  }
  return out;
}

/**
 * The search a filter names, as `{ key: segment }`.
 *
 * Which keys matter is the source's business - nettiauto wants a make and a
 * model, another site might want a region and a property type - so this
 * normalises whatever is there rather than naming fields itself.
 *
 * `make` and `model` used to sit at the filter's top level, and are read from
 * there forever for the same reason the old range spellings are: the gist is
 * hand-edited, and a phone can hold a cached bundle for months. The top-level
 * value wins where both say something, on the same argument - only a writer
 * that has never heard of `search` sets one without the other.
 */
function searchBag(raw) {
  const out = {};
  if (raw?.search && typeof raw.search === 'object') {
    for (const [key, value] of Object.entries(raw.search)) {
      const cleaned = segment(value);
      if (key && cleaned) out[key] = cleaned;
    }
  }
  for (const key of ['make', 'model']) {
    const cleaned = segment(raw?.[key]);
    if (cleaned) out[key] = cleaned;
  }

  const sorted = {};
  for (const key of Object.keys(out).sort()) sorted[key] = out[key];
  return sorted;
}

/** A URL path segment: lowercase, no slashes, no spaces. */
function segment(value) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\s+/g, '-');
}

/**
 * Fill in every field, whatever the source left out.
 *
 * The gist is written by the app and edited by hand often enough that this has
 * to assume nothing: a filter from an older app version, or one someone typed
 * into the gist directly, still has to run rather than crash the watcher.
 * Idempotent, so it is safe to call on an already-normalised filter.
 */
export function normalizeFilter(raw, index = 0) {
  const filter = raw && typeof raw === 'object' ? raw : {};
  const search = searchBag(filter);
  // An unknown source is kept rather than rewritten to the default: crawling
  // the wrong site would be worse than the loud failure sourceOf() raises when
  // the filter is actually run.
  const source =
    typeof filter.source === 'string' && filter.source.trim()
      ? filter.source.trim()
      : DEFAULT_SOURCE_ID;

  const implications = Array.isArray(filter.implications)
    ? filter.implications
        .map((rule) => ({
          if: typeof rule?.if === 'string' ? rule.if.trim().toLowerCase() : '',
          then: typeof rule?.then === 'string' ? rule.then.trim().toLowerCase() : '',
        }))
        .filter((rule) => rule.if && rule.then && rule.if !== rule.then)
    : [];

  return {
    id: typeof filter.id === 'string' && filter.id.trim() ? filter.id.trim() : `filter-${index + 1}`,
    name: typeof filter.name === 'string' && filter.name.trim()
      ? filter.name.trim()
      : Object.values(search).filter(Boolean).join(' ') || `Filter ${index + 1}`,
    enabled: filter.enabled !== false,
    source,
    // Which listing page to read. The source decides what these keys mean.
    search,

    // Numeric limits, keyed by field: { year: { min, max }, mileage: { max } }.
    // The legacy yearFrom/maxMileage/maxPrice spellings are read in here and
    // not re-emitted - inside the scraper this is the one source of truth. The
    // app still writes both, where an older bundle might read them.
    ranges: ranges(filter),

    // Phrases checked against the variant name and the spec chips - short,
    // structured text, so a hit here is worth trusting.
    variantMust: phrases(filter.variantMust),
    variantMustNot: phrases(filter.variantMustNot),
    // Phrases checked against everything, the seller's free text included.
    textMust: phrases(filter.textMust),
    textMustNot: phrases(filter.textMustNot),

    // Option packages: free text only, so they get the proximity treatment in
    // filter.js rather than a plain phrase search.
    packages: phrases(filter.packages),
    packageEvidence: filter.packageEvidence === 'weak' ? 'weak' : 'strong',
    // Let a smaller variant of a package satisfy it (Pilot Lite for Pilot).
    acceptLesserPackages: filter.acceptLesserPackages === true,
    // Which words make a package name mean something else. See qualifiers().
    packageQualifiers: qualifiers(filter.packageQualifiers),

    // "Seeing A proves B": lets a filter accept the shorthand sellers use.
    implications,

    // Post the cars already on sale when this filter first runs. Off means it
    // starts from a clean slate and only reports what appears afterwards.
    postExisting: filter.postExisting !== false,
  };
}

/**
 * Every runnable filter in a list.
 *
 * A filter is dropped when it names no page to read - which is the *source's*
 * judgement, not a hardcoded make-and-model check. One naming a source this
 * watcher does not have is dropped too, with a warning: it is probably a filter
 * from a newer version, and skipping it beats failing every other filter's run.
 */
export function normalizeFilters(raw, { log = console.log } = {}) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const [index, entry] of raw.entries()) {
    const filter = normalizeFilter(entry, index);
    if (!hasSource(filter.source)) {
      log(`  skipping "${filter.name}": unknown source "${filter.source}".`);
      continue;
    }
    const source = sourceOf(filter);
    if (!source.canRun(source.searchFrom(filter))) continue;
    out.push(filter);
  }
  return out;
}

/** One line describing what a filter looks for, for the run log and --list. */
export function describeFilter(filter) {
  const source = sourceOf(filter);
  const parts = [
    source.describeSearch(source.searchFrom(filter)),
    ...describeRanges(filter.ranges, source.fields),
  ];

  if (filter.variantMust.length) parts.push(filter.variantMust.join(' + '));
  if (filter.textMust.length) parts.push(filter.textMust.join(' + '));
  if (filter.packages.length) parts.push(`${filter.packages.join(' + ')} packages`);
  const excluded = [...filter.variantMustNot, ...filter.textMustNot];
  if (excluded.length) parts.push(`not ${excluded.join(', ')}`);

  return parts.join(', ');
}

/** Filters over the same listing page share one crawl, so they group by it. */
export function searchKey(filter) {
  const source = sourceOf(filter);
  // Prefixed with the source: two sites can legitimately use the same search
  // key, and merging their crawls would fetch one and report both.
  return `${source.id}:${source.searchKey(source.searchFrom(filter))}`;
}

/**
 * Group filters into the crawls that will actually be run.
 *
 * Filters sharing a source and a search share one fetch - which is what keeps
 * adding filters cheap. Each group carries its source, so the caller crawls
 * without knowing which site it is talking to.
 */
export function groupBySearch(filters) {
  const groups = new Map();
  for (const filter of filters) {
    const key = searchKey(filter);
    const group = groups.get(key);
    if (group) {
      group.filters.push(filter);
      continue;
    }
    const source = sourceOf(filter);
    groups.set(key, {
      key,
      source,
      search: source.searchFrom(filter),
      filters: [filter],
    });
  }
  return [...groups.values()];
}

async function readFiltersFile(path = DEFAULT_FILTERS_PATH, { log = console.log } = {}) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not valid JSON (${error.message}).`);
  }
  // Accept both a bare array and the app's { filters: [...] } envelope, so a
  // file exported from the UI can be dropped in as-is.
  return normalizeFilters(Array.isArray(parsed) ? parsed : parsed?.filters, { log });
}

/**
 * The filters the app has synced, or null when there is nothing to read.
 *
 * Null means "no answer here": no token, no filters file in the gist, or a
 * failure. An empty *array* is a different thing entirely - the file exists and
 * says there are no filters - and that answer is honoured, because someone who
 * deletes every filter in the app means it. Anything actually broken (a bad
 * token, a network failure) is reported and then falls through to the file: a
 * watcher that keeps running on slightly stale filters beats one that does not
 * run at all.
 */
async function readFiltersFromGist({ log = console.log, gistToken = '' } = {}) {
  if (!gistToken) return null;
  try {
    const { findTcoGist, readGistFile } = await import('./gist.js');
    const gistId = await findTcoGist(gistToken);
    const envelope = await readGistFile(gistId, config.filters.gistFilename, gistToken);
    if (!envelope || !Array.isArray(envelope.filters)) return null;
    return normalizeFilters(envelope.filters, { log });
  } catch (error) {
    log(`  could not read filters from the gist (${error.message})`);
    return null;
  }
}

/**
 * Load the filters to run, from the first source that answers.
 *
 * `source` is 'auto' (gist, then file), 'gist' or 'file'. An answer of "no
 * filters" is still an answer: emptying the list in the app has to mean the
 * watcher stops, not that the committed default quietly comes back.
 */
export async function loadFilters({
  source = config.filters.source,
  log = console.log,
  file = DEFAULT_FILTERS_PATH,
  // Empty means no gist, *not* the owner's gist: a forgotten token should read
  // one filter less, never somebody else's filters.
  gistToken = '',
} = {}) {
  const tried = [];

  if (source === 'auto' || source === 'gist') {
    const fromGist = await readFiltersFromGist({ log, gistToken });
    if (fromGist) {
      if (fromGist.length === 0) log('  the gist lists no filters - nothing to watch.');
      return { filters: fromGist, source: 'gist' };
    }
    tried.push('gist');
    if (source === 'gist') {
      throw new Error(
        'No filters file in the gist. Create a filter in the calculator (funnel button ' +
          'in the header) and make sure GIST_TOKEN is set, or run with --filters=file.',
      );
    }
  }

  const fromFile = await readFiltersFile(file, { log });
  if (fromFile) {
    if (fromFile.length === 0) log(`  ${config.filters.file} lists no filters - nothing to watch.`);
    return { filters: fromFile, source: 'file' };
  }
  tried.push(config.filters.file);

  // No source answered at all - a fresh checkout with the file deleted, or no
  // token and no file. That is an install waiting to be set up, not a failure:
  // the caller prints the onboarding text and exits 0, so a scheduled run on a
  // fork nobody has configured yet stays quiet instead of mailing a failure
  // every half hour. Pinning --filters=gist still throws above, because asking
  // for a specific source and not getting it *is* an error.
  log(`  no filters anywhere (looked in: ${tried.join(', ')}).`);
  return { filters: [], source: 'nowhere' };
}
