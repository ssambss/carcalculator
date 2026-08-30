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

import { loadEnvFile } from './env.js';

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
    ...[...options.keys()].filter((option) => !['--filters', '--only'].includes(option)),
  ];

  const source = options.get('--filters') ?? config.filters.source;
  if (!FILTER_SOURCES.includes(source)) {
    unknown.push(`--filters=${source} (use ${FILTER_SOURCES.join(', ')})`);
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
 */
async function collectMatches(source, search, listings, filters, store) {
  const matches = new Map(filters.map((filter) => [filter.id, []]));
  const rejected = new Map(filters.map((filter) => [filter.id, []]));
  let detailFetches = 0;
  let reusedVerdicts = 0;

  for (const listing of listings) {
    const verdicts = new Map();
    let wantsDetail = false;

    for (const filter of filters) {
      let verdict = evaluate(listing, null, filter);

      // A cached verdict can stand in for a detail fetch when nothing about
      // the listing has moved. A match that was never successfully announced
      // is excluded: it still has to be posted, and building that message
      // needs the detail page evidence.
      const cached = state.verdictFor(store, listing.id, filter.id);
      const canReuse =
        verdict.needsDetail &&
        cached &&
        !state.needsRecheck(store, listing, filter.id) &&
        (cached.status !== 'match' || state.wasAnnounced(store, listing.id, filter.id));

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

      verdicts.set(filter.id, verdict);
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
          if (!verdicts.get(filter.id).needsDetail) continue;
          let verdict = evaluate(listing, detail, filter);
          if (detail.sold) {
            verdict = {
              ...verdict,
              matched: false,
              reasons: [...verdict.reasons, 'no longer for sale'],
            };
          }
          verdicts.set(filter.id, verdict);
        }
      }
    }

    for (const filter of filters) {
      const verdict = verdicts.get(filter.id);
      const bucket = verdict.matched ? matches : rejected;
      bucket.get(filter.id).push({ listing, verdict, filter });
      state.record(store, listing, filter.id, verdict, { detailChecked });
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
async function pickUpReactions(listings, store, { dryRun, sources }) {
  const { botToken, webhookUrl } = config.discord;
  const gistToken = config.tco.gistToken;

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
      'Reaction pickup is on but DISCORD_BOT_TOKEN and GIST_TOKEN are not set - skipping. ' +
        'Add both secrets to enable it (see README.md).',
    );
    return;
  }
  if (!botToken || !gistToken) {
    const missing = !botToken ? 'DISCORD_BOT_TOKEN' : 'GIST_TOKEN';
    throw new Error(
      `Reaction pickup is half-configured: ${missing} is not set while the other token is. ` +
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
    if (!state.needsTcoAdd(store, id)) continue;
    const sink = sinks.get(entry.sourceId);
    if (!sink) continue;
    const listing = listings.get(id) ?? listingFromRecord(id, store.listings[id]);
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

    const { added, skipped } = await sink.add(batch);
    for (const id of added) state.recordTcoAdd(store, id);
    for (const id of skipped) {
      // Already there: whoever put it there, it is confirmed present.
      state.recordTcoAdd(store, id);
      state.recordTcoConfirmed(store, id);
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

  const { filters: allFilters, source } = await loadFilters({ source: args.filterSource });
  const wanted = args.only
    ? allFilters.filter(
        (filter) =>
          filter.id === args.only ||
          filter.name.toLowerCase().includes(args.only.toLowerCase()),
      )
    : allFilters;
  const filters = wanted.filter((filter) => filter.enabled);

  const disabled = wanted.length - filters.length;
  console.log(
    `${allFilters.length} filter(s) from the ${source}` +
      (args.only ? `, ${wanted.length} matching --only=${args.only}` : '') +
      (disabled ? `, ${disabled} disabled` : '') +
      ':',
  );
  for (const filter of filters) console.log(`  ${filter.name}: ${describeFilter(filter)}`);
  if (filters.length === 0) {
    console.log(NOTHING_TO_WATCH);
    return 0;
  }

  const store = args.list ? { ...(await state.loadState()) } : await state.loadState();
  const firstRun = store.isNew;

  // Nothing to post to? Stop here rather than crawling for two minutes to
  // deliver nowhere - but which kind of "nothing" this is decides whether that
  // is a quiet exit or a loud failure. See preflight.js for the rule.
  //
  // Stopping without seeding is deliberate: state written now would baseline
  // the market silently, so the first configured run would report nothing. Left
  // alone, that run seeds properly instead.
  const readiness = postingReadiness({
    webhookUrl: config.discord.webhookUrl,
    isNew: store.isNew,
    runs: store.runs,
    needsPosting: needsPosting(args),
  });
  if (readiness === 'regressed') {
    throw new Error(
      'DISCORD_WEBHOOK_URL is not set, but this watcher has run ' +
        `${store.runs} time(s) before - so it used to have one. Restore the secret ` +
        'rather than letting the channel go quiet. To run without posting anyway, ' +
        'use --dry-run or --list.',
    );
  }
  if (readiness === 'unconfigured') {
    console.log(`\n${NOT_CONFIGURED}`);
    return 0;
  }
  if (firstRun && !args.list) {
    console.log('\nNo state file yet - this run records what is on sale and posts nothing.');
  }
  if (store.migrated) {
    console.log(
      '\nState file upgraded to per-filter records. Listings already posted stay posted; ' +
        'verdicts are re-derived, so this run reads a few more listing pages than usual.',
    );
  }

  const groups = groupBySearch(filters);
  const everyListing = new Map();
  const perFilter = new Map();
  let detailFetches = 0;
  let reusedVerdicts = 0;

  for (const group of groups) {
    console.log(`\nFetching ${group.key} search results...`);
    const { listings, total } = await group.source.fetchAllListings(group.search, {
      onProgress: ({ page, lastPage, fresh }) =>
        console.log(`  page ${page}/${lastPage} (+${fresh} listings)`),
    });
    console.log(`Read ${listings.length} listings (site reports ${total ?? '?'}).`);
    for (const listing of listings) everyListing.set(listing.id, listing);

    const result = await collectMatches(
      group.source,
      group.search,
      listings,
      group.filters,
      store,
    );
    detailFetches += result.detailFetches;
    reusedVerdicts += result.reusedVerdicts;

    for (const filter of group.filters) {
      perFilter.set(filter.id, {
        filter,
        matches: result.matches.get(filter.id),
        rejected: result.rejected.get(filter.id),
      });
    }
  }

  const totalMatches = [...perFilter.values()].reduce((sum, entry) => sum + entry.matches.length, 0);
  console.log(
    `\n${totalMatches} match(es) across ${filters.length} filter(s) ` +
      `(${detailFetches} detail page(s) fetched, ${reusedVerdicts} cached verdict(s) reused).`,
  );

  if (args.verbose) {
    for (const { filter, rejected } of perFilter.values()) {
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
    for (const { filter, matches } of perFilter.values()) {
      console.log(`\n${filter.name} (${matches.length}):`);
      const sorted = [...matches].sort(
        (a, b) => (a.listing.price ?? Infinity) - (b.listing.price ?? Infinity),
      );
      for (const { listing } of sorted) console.log(`  ${formatListing(listing)}`);
    }
    return 0;
  }

  if (config.tco.pickUpReactions) {
    const sources = [...new Map(groups.map((group) => [group.source.id, group.source])).values()];
    console.log('\nChecking Discord reactions...');
    await pickUpReactions(everyListing, store, { dryRun: args.dryRun, sources });
  }

  // Anything matching that this filter has never announced. On a first or
  // seeded run - or for a new filter that asked to start quiet - these are
  // recorded as announced without posting, so the channel stays calm and only
  // genuinely new listings show up later.
  const pending = [];
  for (const { filter, matches } of perFilter.values()) {
    const unannounced = matches.filter(
      ({ listing }) => !state.wasAnnounced(store, listing.id, filter.id),
    );
    const brandNew = state.isNewFilter(store, filter.id);
    const silent = firstRun || args.seed || (brandNew && !filter.postExisting);

    if (silent) {
      for (const { listing } of unannounced) state.markAnnounced(store, listing.id, filter.id);
      if (unannounced.length) {
        console.log(
          `\n${filter.name}: ${args.dryRun ? 'would record' : 'recorded'} ` +
            `${unannounced.length} match(es) as already-seen. Nothing posted.`,
        );
      }
      continue;
    }

    if (brandNew && unannounced.length) {
      console.log(
        `\n${filter.name} is new: posting the ${unannounced.length} car(s) it found ` +
          'that are already on sale.',
      );
    }
    pending.push(
      unannounced.sort((a, b) => (a.listing.price ?? Infinity) - (b.listing.price ?? Infinity)),
    );
  }

  const waiting = pending.reduce((sum, items) => sum + items.length, 0);

  // A dry run must leave no trace, so the next real run behaves exactly as it
  // would have without it - including seeding, if that has not happened yet.
  const persist = async (extra = {}) => {
    for (const filter of filters) state.recordFilterRun(store, filter);
    if (args.dryRun) {
      console.log('  (dry run: state file not written)');
      return;
    }
    state.prune(store);
    await state.saveState({ ...store, runs: (store.runs ?? 0) + 1, ...extra });
  };

  if (firstRun || args.seed) {
    await persist({ seeded: true, seededAt: new Date().toISOString() });
    console.log('\nThe next run will post anything that appears from now on.');
    return 0;
  }

  if (waiting === 0) {
    await persist();
    // Two different populations, so name them separately: the matches are what
    // is on sale right now, while the record also remembers listings since
    // sold.
    const stats = state.summarise(store);
    console.log(
      `\nNothing new. ${totalMatches} match(es) currently on sale; ` +
        `remembering ${stats.tracked} listing(s).`,
    );
    return 0;
  }

  // The cap counts across every filter: it exists to stop a parser regression
  // or a brand new, very broad filter from flooding the channel. Filters take
  // turns filling it, cheapest first, so one filter with a long backlog cannot
  // starve the others out of the run - everyone gets a share now, and the rest
  // follows next run.
  //
  // A car matching two filters is posted once, not twice: a broad filter and a
  // narrow one over the same model are a normal thing to have, and seeing the
  // same advert twice in the channel would be noise. The other filters that
  // wanted it are marked as having announced it, because they have - it is in
  // the channel - and the run log names them.
  const cap = config.discord.maxPostsPerRun;
  const byFilter = new Map();
  const alsoMatched = new Map();
  const queuedIds = new Map();
  let queued = 0;
  let deduped = 0;

  for (let round = 0; queued < cap && pending.some((items) => items.length > round); round += 1) {
    for (const items of pending) {
      if (queued >= cap) break;
      const item = items[round];
      if (!item) continue;

      const alreadyQueued = queuedIds.get(item.listing.id);
      if (alreadyQueued) {
        alsoMatched.get(alreadyQueued).push(item.filter);
        deduped += 1;
        continue;
      }

      const bucket = byFilter.get(item.filter.id);
      if (bucket) bucket.push(item);
      else byFilter.set(item.filter.id, [item]);
      queuedIds.set(item.listing.id, item);
      alsoMatched.set(item, []);
      queued += 1;
    }
  }

  if (queued + deduped < waiting) {
    console.warn(
      `\nHolding back ${waiting - queued - deduped} listing(s): over the ` +
        `${cap}-per-run cap. They will be posted next run.`,
    );
  }

  console.log(`\nPosting ${queued} new listing(s) to Discord...`);
  let posted = 0;
  let batches = 0;
  for (const items of byFilter.values()) {
    const { filter } = items[0];
    const result = await announce(filter, items, {
      dryRun: args.dryRun,
      source: sourceOf(filter),
    });
    batches += result.batches;
    posted += result.announced.length;
    const accepted = new Set(result.announced);

    for (const item of items) {
      const shared = alsoMatched.get(item) ?? [];
      const names = [filter.name, ...shared.map((other) => other.name)].join(' + ');
      console.log(`  ${names}  ${formatListing(item.listing)}`);
      if (args.dryRun || !accepted.has(item.listing.id)) continue;
      state.markAnnounced(store, item.listing.id, filter.id);
      for (const other of shared) state.markAnnounced(store, item.listing.id, other.id);
    }
  }
  await persist();

  console.log(
    args.dryRun
      ? `Dry run: ${posted} listing(s) would have been posted in ${batches} message(s).`
      : `Posted ${posted} listing(s) in ${batches} message(s).`,
  );

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
