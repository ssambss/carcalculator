// The market record: every listing a crawl has read, kept after it leaves the
// site, with its asking price over time.
//
// Separate from the state file on purpose. That one is the watcher's working
// memory - per person, keyed to verdicts and announcements, and pruned 90 days
// after a listing was last seen so a genuine relisting is announced again.
// History wants the opposite: nothing pruned, nobody's verdicts, one shared
// record per search however many people watch it. It is what a resale curve
// and a "is this price fair" check are computed from.
//
// One file per search (data/market/<source>-<search>.json), one listing per
// line, so a run's commit diffs as the handful of listings that changed rather
// than as the whole file.

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fileStore } from './storage/file.js';

export const MARKET_VERSION = 1;

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MARKET_DIR = resolve(HERE, '..', 'data', 'market');

/** What the app reads first, to learn which searches have a record at all. */
export const INDEX_FILE = 'index.json';

/** "Polestar" -> "polestar", "Model 3" -> "model-3". */
function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    // The accent comes apart from its letter; drop it, so Škoda is "skoda".
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The file a search's record lives in. Keyed by the search, not by a filter:
 * two people watching the same model share one record, as they share one crawl.
 */
export function marketFileName(sourceId, search) {
  const parts = Object.keys(search ?? {})
    .sort()
    .map((key) => slug(search[key]))
    .filter(Boolean);
  return `${slug(sourceId)}-${parts.join('-') || 'all'}.json`;
}

/** A calendar day is as fine as this record needs: prices move by the week. */
export const dayOf = (date) => new Date(date).toISOString().slice(0, 10);

/**
 * The VIN, hashed. It is what recognises one car relisted under a new id - by
 * another dealer, or the same one starting the advert afresh - and the hash
 * does that as well as the VIN itself. The record is public, so it keeps the
 * part that is useful and not the car's identity.
 */
export function hashVin(vin) {
  const clean = String(vin ?? '').trim().toUpperCase();
  if (clean.length < 11) return null;
  return createHash('sha256').update(clean).digest('hex').slice(0, 16);
}

const num = (value) => {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function emptyMarket(sourceId, search) {
  return {
    version: MARKET_VERSION,
    source: sourceId,
    search: { ...search },
    updatedAt: null,
    // When a crawl last read the whole search. A listing missing since then has
    // left the site; one missing only since a partial crawl may just have been
    // on a page that failed.
    completeAt: null,
    listings: {},
  };
}

/** Read whatever is on disk into the current shape; anything unrecognisable starts afresh. */
export function normalizeMarket(raw, sourceId, search) {
  const market = emptyMarket(sourceId, search);
  if (!raw || typeof raw !== 'object' || raw.version !== MARKET_VERSION) return market;
  market.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
  market.completeAt = typeof raw.completeAt === 'string' ? raw.completeAt : null;
  for (const [id, entry] of Object.entries(raw.listings ?? {})) {
    if (!entry || typeof entry !== 'object' || typeof entry.first !== 'string') continue;
    const prices = Array.isArray(entry.prices)
      ? entry.prices.filter(
          (p) => Array.isArray(p) && typeof p[0] === 'string' && Number.isFinite(p[1]),
        )
      : [];
    market.listings[id] = { ...entry, prices };
  }
  return market;
}

/**
 * One sighting of one listing.
 *
 * `firstSeen` and `seen` are days. They are the same day for a live crawl; a
 * backfill from old state files knows a listing was on sale from one day to
 * another and passes both. The price is appended only when it changed, and a
 * second change on the same day replaces the first - a typo corrected within
 * the hour is not a price cut.
 */
export function sight(market, id, facts, { firstSeen, seen }) {
  const key = String(id);
  const prev = market.listings[key];
  const prices = prev ? prev.prices.map((p) => [...p]) : [];
  const price = num(facts.price);

  if (price !== null) {
    const last = prices.at(-1);
    if (!last) {
      prices.push([firstSeen, price]);
    } else if (last[1] !== price) {
      if (last[0] === seen) {
        last[1] = price;
        // Changed and changed back within the day: it never really moved.
        if (prices.length > 1 && prices.at(-2)[1] === price) prices.pop();
      } else {
        prices.push([seen, price]);
      }
    }
  }

  market.listings[key] = {
    title: facts.title || prev?.title || '',
    year: num(facts.year) ?? prev?.year ?? null,
    mileage: num(facts.mileage) ?? prev?.mileage ?? null,
    fuel: facts.fuel ?? prev?.fuel ?? null,
    drive: facts.drive ?? prev?.drive ?? null,
    battery: num(facts.battery) ?? prev?.battery ?? null,
    seller: facts.seller ?? prev?.seller ?? null,
    vin: facts.vin ?? prev?.vin ?? null,
    first: prev && prev.first < firstSeen ? prev.first : firstSeen,
    last: prev && prev.last > seen ? prev.last : seen,
    prices,
  };
  return market.listings[key];
}

/** A crawled listing, in the record's terms. */
export function factsOf(listing) {
  return {
    title: listing.subTitle || listing.title || '',
    year: listing.year,
    mileage: listing.mileage,
    price: listing.price,
    fuel: listing.fuelType ?? null,
    drive: listing.driveType ?? null,
    battery: listing.battery ?? null,
    seller: listing.seller ?? null,
    vin: hashVin(listing.vin),
  };
}

/** Everything one crawl of one search read. */
export function observe(market, listings, { now = new Date(), complete = false } = {}) {
  const today = dayOf(now);
  let added = 0;
  let repriced = 0;
  for (const listing of listings) {
    const before = market.listings[String(listing.id)]?.prices.at(-1)?.[1];
    const after = sight(market, listing.id, factsOf(listing), { firstSeen: today, seen: today });
    if (before === undefined) added += 1;
    else if (after.prices.at(-1)?.[1] !== before) repriced += 1;
  }
  market.updatedAt = now.toISOString();
  if (complete) market.completeAt = now.toISOString();
  return { added, repriced };
}

/**
 * A listing per line, ids in numeric order, keys in a fixed order - so git
 * shows a run as the lines that changed. Still plain JSON: JSON.parse reads it.
 */
export function serializeMarket(market) {
  const ids = Object.keys(market.listings).sort((a, b) =>
    a.localeCompare(b, 'en', { numeric: true }),
  );
  const head = ['version', 'source', 'search', 'updatedAt', 'completeAt']
    .map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(market[key])}`)
    .join(',\n');
  const lines = ids.map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(market.listings[id])}`);
  return `{\n${head},\n  "listings": {\n${lines.join(',\n')}${lines.length ? '\n' : ''}  }\n}\n`;
}

export async function loadMarket(sourceId, search, { dir = DEFAULT_MARKET_DIR } = {}) {
  const path = join(dir, marketFileName(sourceId, search));
  let raw = null;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return normalizeMarket(raw, sourceId, search);
}

export async function saveMarket(market, { dir = DEFAULT_MARKET_DIR } = {}) {
  const path = join(dir, marketFileName(market.source, market.search));
  await fileStore({ path }).write(serializeMarket(market));
  return path;
}

/**
 * The index: one line per record in the folder, from the files themselves -
 * so a search nobody watches any more stays listed, its history still useful.
 */
export async function writeMarketIndex({ dir = DEFAULT_MARKET_DIR, now = new Date() } = {}) {
  const names = (await readdir(dir).catch(() => []))
    .filter((name) => name.endsWith('.json') && name !== INDEX_FILE)
    .sort();
  const files = [];
  for (const name of names) {
    let market;
    try {
      market = JSON.parse(await readFile(join(dir, name), 'utf8'));
    } catch {
      continue;
    }
    if (market?.version !== MARKET_VERSION) continue;
    files.push({
      file: name,
      source: market.source,
      search: market.search,
      listings: Object.keys(market.listings ?? {}).length,
      updatedAt: market.updatedAt,
      completeAt: market.completeAt,
    });
  }
  const index = { version: MARKET_VERSION, updatedAt: now.toISOString(), files };
  await fileStore({ path: join(dir, INDEX_FILE) }).write(`${JSON.stringify(index, null, 2)}\n`);
  return index;
}

/**
 * Record a whole run: every search it read, each into its own file.
 *
 * `reads` is what crawlFor read - the search, its listings, and whether every
 * page of it came back. A search that failed outright is not in it, which is
 * right: nothing was learned, and nothing should look as if it left the site.
 *
 * Each entry carries the record as it now stands, for the price line in the
 * posts. With `save: false` - a dry run - the records are brought up to date
 * in memory and nothing is written.
 */
export async function recordMarket(
  reads,
  { now = new Date(), dir = DEFAULT_MARKET_DIR, save = true } = {},
) {
  const summary = [];
  for (const { sourceId, search, listings, complete } of reads) {
    const market = await loadMarket(sourceId, search, { dir });
    const { added, repriced } = observe(market, listings, { now, complete });
    if (save) await saveMarket(market, { dir });
    summary.push({
      file: marketFileName(sourceId, search),
      added,
      repriced,
      total: Object.keys(market.listings).length,
      market,
    });
  }
  if (save && reads.length) await writeMarketIndex({ dir, now });
  return summary;
}
