#!/usr/bin/env node
// Listing watcher: find listings matching your filters, announce the new ones.
//
// Which site a filter reads is its source's business (see src/sources/), and
// nothing in this file names one. Filters sharing a source and a search share a
// single crawl, so adding filters costs almost nothing.
//
//   node src/index.js              check, and post anything new to Discord
//   node src/index.js --dry-run    do everything except post
//   node src/index.js --seed       record the current listings without posting
//   node src/index.js --list       print the current matches and exit
//
// A filter is one saved search (see src/filters.js); there can be any number
// of them.
//
// On the very first run there is no state file, so every match is recorded and
// nothing is posted - otherwise the channel would fill with every car already
// on the market. From then on only genuinely new listings are announced, per
// filter. A filter added later starts posting what is on sale unless it says
// postExisting: false, since seeing the current market is the point of adding
// one.

import { expandSecretsJson, loadEnvFile } from './env.js';

// Both before config.js loads, since it reads named variables at import time.
expandSecretsJson();
await loadEnvFile();

const { default: config } = await import('./config.js');
const { describeFilter, groupBySearch, loadFilters } = await import('./filters.js');
const { evaluate } = await import('./filter.js');
const { announce, announceText } = await import('./discord.js');
const { needsPosting, postingReadiness } = await import('./preflight.js');
const { fetchReactedListingIds } = await import('./reactions.js');
const { sinkFor } = await import('./sinks/index.js');
const { sourceOf } = await import('./sources/index.js');
const state = await import('./state.js');
const { BACKENDS, storeFor } = await import('./storage/index.js');
const { describeTenant, loadTenants, postCapFor, selectTenants } = await import('./tenants.js');

const FLAGS = ['--dry-run', '--seed', '--list', '--verbose', '--notify-errors', '--help', '-h'];
const FILTER_SOURCES = ['auto', 'gist', 'file'];

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--') && !arg.includes('=')));
  const options = new Map(
    argv
      .filter((arg) => arg.startsWith('--') && arg.includes('='))
      .map((arg) => [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]),
  );

  const unknown = [
    ...[...flags].filter((flag) => !FLAGS.includes(flag)),
    ...[...options.keys()].filter(
      (option) => !['--filters', '--only', '--for', '--migrate-state'].includes(option),
    ),
  ];

  const source = options.get('--filters') ?? config.filters.source;
  if (!FILTER_SOURCES.includes(source)) {
    unknown.push(`--filters=${source} (use ${FILTER_SOURCES.join(', ')})`);
  }

  const migrateTo = options.get('--migrate-state') ?? null;
  if (migrateTo !== null && !BACKENDS.includes(migrateTo)) {
    unknown.push(`--migrate-state=${migrateTo} (use ${BACKENDS.join(', ')})`);
  }

  return {
    dryRun: flags.has('--dry-run'),
    seed: flags.has('--seed'),
    list: flags.has('--list'),
    verbose: flags.has('--verbose'),
    notifyErrors: flags.has('--notify-errors'),
    help: flags.has('--help') || flags.has('-h'),
    filterSource: source,
    only: options.get('--only') ?? null,
    onlyTenant: options.get('--for') ?? null,
    migrateTo,
    unknown,
  };
}

const HELP = `Listing watcher

Usage: node src/index.js [options]

  --dry-run        Run the full check but post nothing to Discord.
  --seed           Record what is on sale right now without posting.
                   Same as the automatic behaviour of a first run.
  --list           Print every current match and exit. Touches no state.
  --verbose        Also show near misses and why they were rejected.
  --notify-errors  Post a message to Discord if the run fails.
  --filters=SRC    Where to read filters from: auto (default), gist or file.
  --only=NAME      Run just the filters whose name or id contains NAME.
  --for=WHO        Run just one person, by tenant id or name. Useful when
                   onboarding somebody, to check their setup alone.
  --migrate-state=WHERE
                   Copy the record of what has been seen to another backend
                   (file, gist) and exit. Nothing else runs. See src/storage/.
  --help           This text.

Filters are made in the calculator's UI and read from your gist; scraper/
filters.json is the committed fallback. Each filter names a source - the site it
reads - and src/sources/ is where those live. Runtime knobs are in src/config.js
and the webhook in DISCORD_WEBHOOK_URL (a scraper/.env file is read
automatically). See README.md.`;

/** Shown when every filter is off, or there are none - including a fresh fork. */
const NOTHING_TO_WATCH = `Nothing to watch.

Make a filter in the calculator (funnel button in the header) and it reaches
this watcher through your gist on the next run. Or enable one in
scraper/filters.json - it ships with a disabled example.

  node src/index.js --list --filters=file    what the example would match
  npm run doctor                             check which secrets are set`;

/** Shown on a run that could post but has nowhere to post to. */
const NOT_CONFIGURED = `Nothing to post to: DISCORD_WEBHOOK_URL is not set.

Stopping here rather than crawling, and leaving the state file alone so the
first configured run still baselines the market properly.

  locally  cp .env.example .env, then paste your webhook URL into it
  in CI    Settings -> Secrets and variables -> Actions -> DISCORD_WEBHOOK_URL

  npm run doctor     check every secret and what it unlocks
  npm run dry-run    run the full check now, posting nothing

See README.md and ../SETUP.md.`;

/**
 * A filter's identity within one run.
 *
 * Filter ids are unique within a person's own gist, not across people - two of
 * them can paste the same filter JSON and end up sharing an id. Everything that
 * spans tenants in a single run is keyed by this instead.
 */
function entryKey(filter) {
  return `${filter.tenant?.id ?? 'owner'}/${filter.id}`;
}

/** The record a filter's verdicts belong in: its own owner's. */
function storeOf(filter) {
  return filter.tenant.store;
}

function formatListing(listing) {
  const price = listing.price === null ? '?' : listing.price.toLocaleString('fi-FI');
  const mileage = listing.mileage === null ? '?' : listing.mileage.toLocaleString('fi-FI');
  return `${listing.id}  ${listing.year ?? '????'}  ${mileage.padStart(9)} km  ${price.padStart(7)} €  ${listing.url}`;
}

/**
 * Work out which of a search's listings match which of its filters.
 *
 * Two passes on purpose: the search pages alone settle most listings, and only
 * the undecided ones cost a detail fetch. Verdicts already in the record are
 * reused, so a steady-state run fetches very few pages - and because the
 * detail page is the same for every filter, one fetch settles all of them.
 *
 * `filters` may belong to different people. Each one's verdict is recorded in
 * its own tenant's record, but the *fetching* is shared: if two people both
 * want the packages read off the same advert, that page is read once.
 */
async function collectMatches(source, search, listings, filters) {
  const matches = new Map(filters.map((filter) => [entryKey(filter), []]));
  const rejected = new Map(filters.map((filter) => [entryKey(filter), []]));
  let detailFetches = 0;
  let reusedVerdicts = 0;

  for (const listing of listings) {
    const verdicts = new Map();
    let wantsDetail = false;

    for (const filter of filters) {
      const store = storeOf(filter);
      let verdict = evaluate(listing, null, filter);

      // A cached verdict can stand in for a detail fetch when nothing about
      // the listing has moved. A match that was never successfully announced
      // is excluded: it still has to be posted, and building that message
      // needs the detail page evidence.
      const key = state.keyFor(listing);
      const cached = state.verdictFor(store, key, filter.id);
      const canReuse =
        verdict.needsDetail &&
        cached &&
        !state.needsRecheck(store, listing, filter.id) &&
        (cached.status !== 'match' || state.wasAnnounced(store, key, filter.id));

      if (canReuse) {
        reusedVerdicts += 1;
        verdict =
          cached.status === 'match'
            ? { ...verdict, matched: true, needsDetail: false, reasons: [] }
            : {
                ...verdict,
                matched: false,
                needsDetail: false,
                reasons: cached.reasons?.length ? cached.reasons : verdict.reasons,
              };
      } else if (verdict.needsDetail) {
        wantsDetail = true;
      }

      verdicts.set(entryKey(filter), verdict);
    }

    let detail = null;
    let detailChecked = false;
    if (wantsDetail) {
      try {
        detail = await source.fetchListingDetail(search, listing.id);
        detailFetches += 1;
      } catch (error) {
        console.warn(`  could not read listing ${listing.id}: ${error.message}`);
      }
      if (detail) {
        detailChecked = true;
        for (const filter of filters) {
          if (!verdicts.get(entryKey(filter)).needsDetail) continue;
          let verdict = evaluate(listing, detail, filter);
          if (detail.sold) {
            verdict = {
              ...verdict,
              matched: false,
              reasons: [...verdict.reasons, 'no longer for sale'],
            };
          }
          verdicts.set(entryKey(filter), verdict);
        }
      }
    }

    for (const filter of filters) {
      const verdict = verdicts.get(entryKey(filter));
      const bucket = verdict.matched ? matches : rejected;
      bucket.get(entryKey(filter)).push({ listing, verdict, filter });
      state.record(storeOf(filter), listing, filter.id, verdict, { detailChecked });
    }
  }

  return { matches, rejected, detailFetches, reusedVerdicts };
}

/** In spec on the numbers, held back only by something unprovable. */
function nearMisses(rejectedForFilter) {
  return rejectedForFilter.filter(
    ({ verdict }) =>
      verdict.reasons.length <= 2 &&
      verdict.reasons.every((reason) => /package|does not say|no mention of/.test(reason)),
  );
}

/** Rebuild enough of a listing from the state record to make a car entry. */
function listingFromRecord(id, entry) {
  if (!entry) return null;
  return {
    id,
    sourceId: entry.sourceId,
    url: entry.url,
    title: entry.title ?? '',
    subTitle: entry.title ?? '',
    year: entry.year ?? null,
    mileage: entry.mileage ?? null,
    price: entry.price ?? null,
    seller: entry.seller ?? null,
    color: null,
    location: null,
  };
}

/**
 * React to a posted listing in Discord -> the car appears in the calculator.
 *
 * Runs every cycle. The gist is read once; ids already present get confirmed
 * (see state.needsTcoAdd for how that interacts with the app's last-write-wins
 * sync), missing ones get written.
 */
async function pickUpReactions(listings, store, { dryRun, sources, tenant }) {
  // The bot token is shared: one bot reads every channel in the server. The
  // gist token is not - a reacted listing goes into the calculator of whoever
  // reacted in *their* channel, so it has to be theirs.
  const { botToken } = config.discord;
  const webhookUrl = tenant.webhookUrl;
  const gistToken = tenant.gistToken;

  // A source that declares no sink has nowhere to send a reacted listing, and
  // that is a legitimate answer rather than a gap: a filter watching flats has
  // no car calculator to add to, so reactions on its posts simply do nothing.
  // With every source in this run like that, the whole scan is pointless.
  const sinks = new Map();
  for (const source of sources) {
    const sink = sinkFor(source);
    if (sink) sinks.set(source.id, sink);
  }
  if (sinks.size === 0) {
    console.log('No source in this run sends reacted listings anywhere - skipping the scan.');
    return;
  }

  // Neither token set: the feature simply is not configured yet - skip with a
  // visible note instead of failing the run, so posting keeps working while
  // the secrets are being set up. Exactly one set is a half-finished setup or
  // a typo in a secret name, and that deserves a loud failure.
  if (!botToken && !gistToken) {
    console.log(
      `Reaction pickup is on but ${tenant.label} has no bot token or gist token - ` +
        'skipping. Both are needed (see README.md).',
    );
    return;
  }
  if (!botToken || !gistToken) {
    // Named as the secret actually is, so it can be found and fixed.
    const theirToken = tenant.ownerish
      ? 'GIST_TOKEN'
      : `TENANT_${tenant.id.toUpperCase()}_GIST_TOKEN`;
    const missing = !botToken ? 'DISCORD_BOT_TOKEN' : theirToken;
    throw new Error(
      `Reaction pickup is half-configured for ${tenant.label}: ${missing} is not set while ` +
        'the other token is. ' +
        'Add it, or set tco.pickUpReactions = false in src/config.js.',
    );
  }

  const { reacted, scanned } = await fetchReactedListingIds({ botToken, webhookUrl });
  console.log(`Scanned ${scanned} Discord message(s); ${reacted.size} reacted listing(s).`);
  if (reacted.size === 0) return;

  // Grouped by destination: a channel can carry posts from several sources, and
  // each one's listings go where its own source says.
  const wanted = new Map();
  for (const [id, entry] of reacted) {
    const key = state.keyOf(entry.sourceId, id);
    if (!state.needsTcoAdd(store, key)) continue;
    const sink = sinks.get(entry.sourceId);
    if (!sink) continue;
    const listing = listings.get(key) ?? listingFromRecord(id, store.listings[key]);
    if (!listing) {
      console.warn(`  reacted listing ${id} is unknown to the record; skipping`);
      continue;
    }
    if (wanted.has(sink.id)) wanted.get(sink.id).listings.push(listing);
    else wanted.set(sink.id, { sink, listings: [listing] });
  }
  if (wanted.size === 0) {
    console.log('Every reacted listing has already been picked up.');
    return;
  }

  for (const { sink, listings: batch } of wanted.values()) {
    if (dryRun) {
      for (const listing of batch) {
        console.log(`  [dry-run] would add to ${sink.label}: ${formatListing(listing)}`);
      }
      continue;
    }

    const { added, skipped } = await sink.add(batch, { token: gistToken });
    const keyById = new Map(batch.map((listing) => [listing.id, state.keyFor(listing)]));
    for (const id of added) state.recordTcoAdd(store, keyById.get(id));
    for (const id of skipped) {
      // Already there: whoever put it there, it is confirmed present.
      state.recordTcoAdd(store, keyById.get(id));
      state.recordTcoConfirmed(store, keyById.get(id));
    }
    if (added.length) {
      console.log(`Added ${added.length} listing(s) to ${sink.label}:`);
      for (const id of added) console.log(`  ${formatListing(batch.find((l) => l.id === id))}`);
    }
    if (skipped.length) {
      console.log(`${skipped.length} reacted listing(s) were already in ${sink.label}.`);
    }
  }
}

/**
 * Copy the record from one backend to another, once, on purpose.
 *
 * Moving where the state lives is not something to do as a side effect of
 * setting a token: a run that quietly looked somewhere new would find nothing,
 * conclude it was a first run, and silently re-baseline the whole market -
 * every listing currently on sale marked as already seen, and nothing to show
 * that it happened.
 *
 * So it is explicit, it refuses to overwrite a record that already exists, and
 * it upgrades the version on the way through (`loadState` migrates, `saveState`
 * writes the new shape).
 */
async function migrateState(target) {
  const from = storeFor();
  const to = storeFor(target);

  if (from.id === to.id) {
    console.log(`The record already lives in ${to.describe()}. Nothing to do.`);
    return 0;
  }

  const current = await state.loadState(from);
  if (current.isNew) {
    console.error(`There is no record in ${from.describe()} to copy.`);
    return 1;
  }

  const existing = await state.loadState(to);
  if (!existing.isNew) {
    console.error(
      `${to.describe()} already holds a record (${Object.keys(existing.listings).length} ` +
        'listing(s)). Refusing to overwrite it - delete it first if that is what you want.',
    );
    return 1;
  }

  const stats = state.summarise(current);
  const written = await state.saveState(current, to);
  console.log(
    `Copied ${stats.tracked} listing(s) and ${stats.announced} announcement(s) from ` +
      `${from.describe()} to ${to.describe()} (version ${written.version}).`,
  );
  console.log(
    `\nNow set state.store = '${target}' in src/config.js. The old record is left in place;` +
      ' delete it once the next run has worked.',
  );
  return 0;
}

/**
 * Load one person's filters and their record.
 *
 * Everything here is read with *their* token, from *their* gist: their filters,
 * their state, and later their calculator. Nothing of one tenant's is visible to
 * another, which is the whole point of the arrangement - the only thing shared
 * is the crawl.
 */
async function contextFor(tenant, args) {
  const say = (line) => console.log(`  ${line}`);
  const { filters: all, source } = await loadFilters({
    source: args.filterSource,
    gistToken: tenant.gistToken,
    log: say,
  });

  const wanted = args.only
    ? all.filter(
        (filter) =>
          filter.id === args.only || filter.name.toLowerCase().includes(args.only.toLowerCase()),
      )
    : all;
  const filters = wanted.filter((filter) => filter.enabled);

  // Where their record lives.
  //
  // Only the owner may use the file backend, and only because it is *their*
  // repo the file is committed into. Someone else's record must never go there:
  // it is a list of what they have been shown and what they are shopping for,
  // and this repo is public. So everyone else keeps theirs in their own gist,
  // which they have by definition - a tenant without a token is not a tenant.
  const where = tenant.ownerish ? config.state.store : 'gist';
  // A --list run must leave no trace, so it works on a copy.
  const backing = storeFor(where, { token: tenant.gistToken, log: say });
  const loaded = await state.loadState(backing);
  const store = args.list ? { ...loaded } : loaded;

  tenant.store = store;
  for (const filter of filters) filter.tenant = tenant;

  return { tenant, filters, store, source, found: all.length, wanted: wanted.length };
}

/**
 * Crawl every distinct search once, whoever asked for it.
 *
 * This is what makes a tenth person nearly free: two people watching the same
 * model share one crawl, and if both need the packages read off an advert, that
 * listing page is read once. Filters group by source and search regardless of
 * who owns them.
 */
async function crawlFor(contexts) {
  const filters = contexts.flatMap((context) => context.filters);
  const groups = groupBySearch(filters);
  const everyListing = new Map();
  const results = new Map();
  let detailFetches = 0;
  let reusedVerdicts = 0;

  for (const group of groups) {
    const who = [...new Set(group.filters.map((filter) => filter.tenant.label))];
    const forWhom = who.length > 1 || who[0] !== 'you' ? ` (for ${who.join(', ')})` : '';
    console.log(`\nFetching ${group.key} search results${forWhom}...`);
    const { listings, total } = await group.source.fetchAllListings(group.search, {
      onProgress: ({ page, lastPage, fresh }) =>
        console.log(`  page ${page}/${lastPage} (+${fresh} listings)`),
    });
    console.log(`Read ${listings.length} listings (site reports ${total ?? '?'}).`);
    // Stamped here rather than in each adapter: the record is keyed by source
    // and id together, and one forgetful adapter would silently collide with
    // another site's ids. Doing it once, centrally, cannot be forgotten.
    for (const listing of listings) {
      listing.sourceId = group.source.id;
      everyListing.set(state.keyFor(listing), listing);
    }

    const result = await collectMatches(group.source, group.search, listings, group.filters);
    detailFetches += result.detailFetches;
    reusedVerdicts += result.reusedVerdicts;

    for (const filter of group.filters) {
      results.set(entryKey(filter), {
        filter,
        matches: result.matches.get(entryKey(filter)),
        rejected: result.rejected.get(entryKey(filter)),
      });
    }
  }

  return { groups, everyListing, results, detailFetches, reusedVerdicts };
}

/**
 * Decide and post one person's new listings, then save their record.
 *
 * Per tenant on purpose, including the post cap: the cap exists so a parsing
 * regression or one very broad new filter cannot flood a channel, and sharing
 * one budget across people would let one person's backlog starve everyone
 * else's run.
 */
async function announceFor(context, crawled, args) {
  const { tenant, filters, store } = context;
  const firstRun = store.isNew;
  const mine = filters.map((filter) => crawled.results.get(entryKey(filter))).filter(Boolean);
  const label = tenant.label === 'you' ? '' : `[${tenant.label}] `;

  // Anything matching that this filter has never announced. On a first or
  // seeded run - or for a new filter that asked to start quiet - these are
  // recorded as announced without posting, so the channel stays calm and only
  // genuinely new listings show up later.
  const pending = [];
  for (const { filter, matches } of mine) {
    const unannounced = matches.filter(
      ({ listing }) => !state.wasAnnounced(store, state.keyFor(listing), filter.id),
    );
    const brandNew = state.isNewFilter(store, filter.id);
    const silent = firstRun || args.seed || (brandNew && !filter.postExisting);

    if (silent) {
      for (const { listing } of unannounced) {
        state.markAnnounced(store, state.keyFor(listing), filter.id);
      }
      if (unannounced.length) {
        console.log(
          `\n${label}${filter.name}: ${args.dryRun ? 'would record' : 'recorded'} ` +
            `${unannounced.length} match(es) as already-seen. Nothing posted.`,
        );
      }
      continue;
    }

    if (brandNew && unannounced.length) {
      console.log(
        `\n${label}${filter.name} is new: posting the ${unannounced.length} listing(s) it ` +
          'found that are already on sale.',
      );
    }
    pending.push(
      unannounced.sort((a, b) => (a.listing.price ?? Infinity) - (b.listing.price ?? Infinity)),
    );
  }

  const waiting = pending.reduce((sum, items) => sum + items.length, 0);
  const onSale = mine.reduce((sum, entry) => sum + entry.matches.length, 0);

  // A dry run must leave no trace, so the next real run behaves exactly as it
  // would have without it - including seeding, if that has not happened yet.
  const persist = async (extra = {}) => {
    for (const filter of filters) state.recordFilterRun(store, filter);
    if (args.dryRun) {
      console.log(`  ${label}(dry run: record not written)`);
      return;
    }
    state.prune(store);
    await state.saveState({ ...store, runs: (store.runs ?? 0) + 1, ...extra }, store.store);
  };

  if (firstRun || args.seed) {
    await persist({ seeded: true, seededAt: new Date().toISOString() });
    console.log(`\n${label}The next run will post anything that appears from now on.`);
    return { posted: 0 };
  }

  if (waiting === 0) {
    await persist();
    // Two different populations, so name them separately: the matches are what
    // is on sale right now, while the record also remembers listings since sold.
    const stats = state.summarise(store);
    console.log(
      `\n${label}Nothing new. ${onSale} match(es) currently on sale; ` +
        `remembering ${stats.tracked} listing(s).`,
    );
    return { posted: 0 };
  }

  // Filters take turns filling the cap, cheapest first, so one filter with a
  // long backlog cannot starve the others - everyone gets a share now and the
  // rest follows next run.
  //
  // A listing matching two of this person's filters is posted once, not twice:
  // a broad filter and a narrow one over the same model are a normal pair to
  // have. The others are marked as having announced it, because they have - it
  // is in the channel - and the run log names them.
  const cap = postCapFor(tenant);
  const byFilter = new Map();
  const alsoMatched = new Map();
  const queuedKeys = new Map();
  let queued = 0;
  let deduped = 0;

  for (let round = 0; queued < cap && pending.some((items) => items.length > round); round += 1) {
    for (const items of pending) {
      if (queued >= cap) break;
      const item = items[round];
      if (!item) continue;

      const alreadyQueued = queuedKeys.get(state.keyFor(item.listing));
      if (alreadyQueued) {
        alsoMatched.get(alreadyQueued).push(item.filter);
        deduped += 1;
        continue;
      }

      const bucket = byFilter.get(entryKey(item.filter));
      if (bucket) bucket.push(item);
      else byFilter.set(entryKey(item.filter), [item]);
      queuedKeys.set(state.keyFor(item.listing), item);
      alsoMatched.set(item, []);
      queued += 1;
    }
  }

  if (queued + deduped < waiting) {
    console.warn(
      `\n${label}Holding back ${waiting - queued - deduped} listing(s): over the ` +
        `${cap}-per-run cap. They will be posted next run.`,
    );
  }

  console.log(`\n${label}Posting ${queued} new listing(s)...`);
  let posted = 0;
  let batches = 0;
  for (const items of byFilter.values()) {
    const { filter } = items[0];
    const result = await announce(filter, items, {
      dryRun: args.dryRun,
      source: sourceOf(filter),
      webhookUrl: tenant.webhookUrl,
    });
    batches += result.batches;
    posted += result.announced.length;
    const accepted = new Set(result.announced);

    for (const item of items) {
      const shared = alsoMatched.get(item) ?? [];
      const names = [filter.name, ...shared.map((other) => other.name)].join(' + ');
      console.log(`  ${names}  ${formatListing(item.listing)}`);
      if (args.dryRun || !accepted.has(item.listing.id)) continue;
      const key = state.keyFor(item.listing);
      state.markAnnounced(store, key, filter.id);
      for (const other of shared) state.markAnnounced(store, key, other.id);
    }
  }
  await persist();

  console.log(
    args.dryRun
      ? `${label}Dry run: ${posted} listing(s) would have been posted in ${batches} message(s).`
      : `${label}Posted ${posted} listing(s) in ${batches} message(s).`,
  );
  return { posted };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  if (args.unknown.length) {
    console.error(`Unknown option(s): ${args.unknown.join(', ')}\n`);
    console.error(HELP);
    return 2;
  }
  // Moving the record is all this run does; crawling on top of it would write
  // to the old backend and immediately make the copy stale.
  if (args.migrateTo) return migrateState(args.migrateTo);

  // --- Who this run is for. ---
  const { tenants: known, problems } = loadTenants();
  for (const problem of problems) console.error(`Configuration problem: ${problem}`);
  // A half-configured tenant is a typo or an unfinished setup. Failing is what
  // makes it visible: skipping quietly means somebody stops getting posts and
  // nobody finds out until they ask.
  if (problems.length) {
    throw new Error(
      `${problems.length} tenant(s) are half-configured. Fix the secrets above, or remove ` +
        'them. `npm run doctor` lists everyone it can see.',
    );
  }
  if (known.length === 0) {
    console.log(NOT_CONFIGURED);
    return 0;
  }
  const tenants = selectTenants(known, args.onlyTenant);
  if (tenants.length === 0) {
    console.error(
      `No tenant matches --for=${args.onlyTenant}. Known: ${known.map((t) => t.id).join(', ')}.`,
    );
    return 2;
  }
  if (known.length > 1) {
    console.log(`Running for ${tenants.length} of ${known.length} tenant(s):`);
    for (const tenant of tenants) console.log(`  ${describeTenant(tenant)}`);
  }

  // --- What each of them is watching, and what they have already seen. ---
  const contexts = [];
  for (const tenant of tenants) {
    const prefix = tenant.label === 'you' ? '' : `${tenant.label}: `;
    const context = await contextFor(tenant, args);
    const disabled = context.wanted - context.filters.length;
    console.log(
      `${prefix}${context.found} filter(s) from the ${context.source}` +
        (args.only ? `, ${context.wanted} matching --only=${args.only}` : '') +
        (disabled ? `, ${disabled} disabled` : '') +
        ':',
    );
    for (const filter of context.filters) {
      console.log(`  ${filter.name}: ${describeFilter(filter)}`);
    }

    // Nothing to post to? Say so before crawling for two minutes to deliver
    // nowhere - but which kind of "nothing" decides whether that is a quiet
    // exit or a loud failure. See preflight.js.
    const readiness = postingReadiness({
      webhookUrl: tenant.webhookUrl,
      isNew: context.store.isNew,
      runs: context.store.runs,
      needsPosting: needsPosting(args),
    });
    if (readiness === 'regressed') {
      throw new Error(
        `${tenant.label}: no webhook is set, but this watcher has run ` +
          `${context.store.runs} time(s) for them before - so there was one. Restore the ` +
          'secret rather than letting the channel go quiet. To run without posting anyway, ' +
          'use --dry-run or --list.',
      );
    }
    if (readiness === 'unconfigured') {
      console.log(`\n${NOT_CONFIGURED}`);
      return 0;
    }
    if (context.store.isNew && !args.list) {
      console.log(`  ${prefix}no record yet - this run notes what is on sale and posts nothing.`);
    }
    if (context.store.migrated) {
      console.log(
        `  ${prefix}record upgraded from version ${context.store.migratedFrom}. Everything ` +
          'already posted stays posted.' +
          (context.store.migratedFrom === 1
            ? ' Verdicts are re-derived, so this run reads a few more listing pages.'
            : ' Listing keys now name their source.'),
      );
    }

    if (context.filters.length > 0) contexts.push(context);
  }

  if (contexts.length === 0) {
    console.log(NOTHING_TO_WATCH);
    return 0;
  }

  // --- One crawl, shared. ---
  const crawled = await crawlFor(contexts);
  const totalMatches = [...crawled.results.values()].reduce(
    (sum, entry) => sum + entry.matches.length,
    0,
  );
  const filterCount = contexts.reduce((sum, context) => sum + context.filters.length, 0);
  console.log(
    `\n${totalMatches} match(es) across ${filterCount} filter(s) ` +
      `(${crawled.detailFetches} detail page(s) fetched, ` +
      `${crawled.reusedVerdicts} cached verdict(s) reused).`,
  );

  if (args.verbose) {
    for (const { filter, rejected } of crawled.results.values()) {
      const near = nearMisses(rejected);
      if (!near.length) continue;
      console.log(`\n${filter.name} - near misses (${near.length}), in spec but unproven:`);
      for (const { listing, verdict } of near) {
        console.log(`  ${formatListing(listing)}`);
        console.log(`      ${verdict.reasons.join('; ')}`);
      }
    }
  }

  if (args.list) {
    for (const { filter, matches } of crawled.results.values()) {
      const owner = filter.tenant.label === 'you' ? '' : `[${filter.tenant.label}] `;
      console.log(`\n${owner}${filter.name} (${matches.length}):`);
      const sorted = [...matches].sort(
        (a, b) => (a.listing.price ?? Infinity) - (b.listing.price ?? Infinity),
      );
      for (const { listing } of sorted) console.log(`  ${formatListing(listing)}`);
    }
    return 0;
  }

  // --- Then each person's own posting, reactions and record. ---
  const sources = [
    ...new Map(crawled.groups.map((group) => [group.source.id, group.source])).values(),
  ];
  for (const context of contexts) {
    if (config.tco.pickUpReactions) {
      const label = context.tenant.label === 'you' ? '' : `${context.tenant.label}: `;
      console.log(`\n${label}checking Discord reactions...`);
      await pickUpReactions(crawled.everyListing, context.store, {
        dryRun: args.dryRun,
        sources,
        tenant: context.tenant,
      });
    }
    await announceFor(context, crawled, args);
  }

  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`\nRun failed: ${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  if (process.argv.includes('--notify-errors')) {
    await announceText(`⚠️ ${config.discord.username} failed: ${error.message}`, {
      dryRun: process.argv.includes('--dry-run'),
    }).catch(() => {});
  }
  process.exitCode = 1;
}
