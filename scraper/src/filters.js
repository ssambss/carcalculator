// The list of searches the watcher runs.
//
// A filter is one saved search: which nettiauto listing page to read, plus the
// spec every listing on it is checked against. There can be any number of
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
// Every field is optional except make and model: a filter with no
// requirements at all is legal and matches the whole model's listing, which is
// exactly what you want when scouting a car you have no fixed spec for.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import config from './config.js';

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
  const make = segment(filter.make);
  const model = segment(filter.model);

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
      : [make, model].filter(Boolean).join(' ') || `Filter ${index + 1}`,
    enabled: filter.enabled !== false,
    make,
    model,

    yearFrom: integer(filter.yearFrom),
    yearTo: integer(filter.yearTo),
    maxMileage: integer(filter.maxMileage),
    minPrice: integer(filter.minPrice),
    maxPrice: integer(filter.maxPrice),

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

    // "Seeing A proves B": lets a filter accept the shorthand sellers use.
    implications,

    // Post the cars already on sale when this filter first runs. Off means it
    // starts from a clean slate and only reports what appears afterwards.
    postExisting: filter.postExisting !== false,
  };
}

export function normalizeFilters(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((filter, index) => normalizeFilter(filter, index))
    .filter((filter) => filter.make && filter.model);
}

/** One line describing what a filter looks for, for the run log and --list. */
export function describeFilter(filter) {
  const parts = [`${filter.make}/${filter.model}`];

  if (filter.yearFrom !== null && filter.yearTo !== null) parts.push(`${filter.yearFrom}-${filter.yearTo}`);
  else if (filter.yearFrom !== null) parts.push(`${filter.yearFrom}-`);
  else if (filter.yearTo !== null) parts.push(`-${filter.yearTo}`);

  if (filter.maxMileage !== null) parts.push(`max ${filter.maxMileage.toLocaleString('fi-FI')} km`);
  if (filter.minPrice !== null && filter.maxPrice !== null) {
    parts.push(`${filter.minPrice.toLocaleString('fi-FI')}-${filter.maxPrice.toLocaleString('fi-FI')} €`);
  } else if (filter.maxPrice !== null) parts.push(`max ${filter.maxPrice.toLocaleString('fi-FI')} €`);
  else if (filter.minPrice !== null) parts.push(`min ${filter.minPrice.toLocaleString('fi-FI')} €`);

  if (filter.variantMust.length) parts.push(filter.variantMust.join(' + '));
  if (filter.textMust.length) parts.push(filter.textMust.join(' + '));
  if (filter.packages.length) parts.push(`${filter.packages.join(' + ')} packages`);
  const excluded = [...filter.variantMustNot, ...filter.textMustNot];
  if (excluded.length) parts.push(`not ${excluded.join(', ')}`);

  return parts.join(', ');
}

/** Filters over the same listing page share one crawl, so they group by it. */
export function searchKey(filter) {
  return `${filter.make}/${filter.model}`;
}

export function groupBySearch(filters) {
  const groups = new Map();
  for (const filter of filters) {
    const key = searchKey(filter);
    const group = groups.get(key);
    if (group) group.filters.push(filter);
    else groups.set(key, { key, search: { make: filter.make, model: filter.model }, filters: [filter] });
  }
  return [...groups.values()];
}

async function readFiltersFile(path = DEFAULT_FILTERS_PATH) {
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
  return normalizeFilters(Array.isArray(parsed) ? parsed : parsed?.filters);
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
async function readFiltersFromGist({ log = console.log } = {}) {
  if (!config.tco.gistToken) return null;
  try {
    const { findTcoGist, readGistFile } = await import('./gist.js');
    const gistId = await findTcoGist();
    const envelope = await readGistFile(gistId, config.filters.gistFilename);
    if (!envelope || !Array.isArray(envelope.filters)) return null;
    return normalizeFilters(envelope.filters);
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
} = {}) {
  const tried = [];

  if (source === 'auto' || source === 'gist') {
    const fromGist = await readFiltersFromGist({ log });
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

  const fromFile = await readFiltersFile(file);
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
