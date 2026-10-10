// One-off: build the market record from the state file's git history.
//
//   node src/backfill-market.js          write data/market/ from history
//   node src/backfill-market.js --force  rebuild it even if it exists
//
// The state file only ever held each listing's latest price, but every run
// committed it, so the history of seen.json is a price history at run
// granularity. This walks it oldest first and replays each snapshot into the
// market record. What old snapshots cannot say - fuel, drive, battery, VIN -
// arrives with the next live crawl, for the listings still on sale.
//
// It builds from nothing rather than adding to a record already there:
// replaying a snapshot older than the record's newest sighting would put an
// old price after a new one.

import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_MARKET_DIR, dayOf, emptyMarket, marketFileName, saveMarket, sight } from './market.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const STATE = 'scraper/data/seen.json';
const LISTING_URL = /nettiauto\.com\/([^/]+)\/([^/]+)\/(\d+)/;

const git = (args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });

const existing = await readdir(DEFAULT_MARKET_DIR).catch(() => []);
if (existing.some((name) => name.endsWith('.json')) && !process.argv.includes('--force')) {
  console.error(`${DEFAULT_MARKET_DIR} already has a record. Pass --force to rebuild it from history.`);
  process.exit(1);
}

const commits = git(['log', '--reverse', '--format=%H', '--', STATE]).trim().split('\n').filter(Boolean);
console.log(`Replaying ${commits.length} snapshots of ${STATE}...`);

const markets = new Map();
let latest = null;

for (const [index, sha] of commits.entries()) {
  let snapshot;
  try {
    snapshot = JSON.parse(git(['show', `${sha}:${STATE}`]));
  } catch {
    continue; // a snapshot that does not parse teaches nothing
  }
  if (typeof snapshot.updatedAt === 'string' && (!latest || snapshot.updatedAt > latest)) {
    latest = snapshot.updatedAt;
  }
  for (const record of Object.values(snapshot.listings ?? {})) {
    const match = LISTING_URL.exec(record?.url ?? '');
    if (!match || !record.firstSeenAt || !record.lastSeenAt) continue;
    const [, make, model, id] = match;
    const search = { make, model };
    const file = marketFileName('nettiauto', search);
    if (!markets.has(file)) markets.set(file, emptyMarket('nettiauto', search));
    sight(
      markets.get(file),
      id,
      {
        title: record.title ?? '',
        year: record.year,
        mileage: record.mileage,
        price: record.price,
        seller: record.seller ?? null,
      },
      { firstSeen: dayOf(record.firstSeenAt), seen: dayOf(record.lastSeenAt) },
    );
  }
  if ((index + 1) % 50 === 0) console.log(`  ${index + 1}/${commits.length}`);
}

for (const market of markets.values()) {
  // Whether the last of these crawls was complete is not recorded, so nothing
  // is judged gone until the first live run says it read everything.
  market.updatedAt = latest;
  market.completeAt = null;
  const path = await saveMarket(market);
  const listings = Object.values(market.listings);
  const repriced = listings.filter((entry) => entry.prices.length > 1).length;
  console.log(`${path}: ${listings.length} listings, ${repriced} with a price change.`);
}
