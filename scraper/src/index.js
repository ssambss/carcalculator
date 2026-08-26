#!/usr/bin/env node
// Nettiauto watcher: find listings matching the spec, announce the new ones.
//
//   node src/index.js              check, and post anything new to Discord
//   node src/index.js --dry-run    do everything except post
//   node src/index.js --seed       record the current listings without posting
//   node src/index.js --list       print the current matches and exit
//
// On the very first run there is no state file, so every match is recorded and
// nothing is posted - otherwise the channel would fill with every car already
// on the market. From then on only genuinely new listings are announced.

import { loadEnvFile } from './env.js';

await loadEnvFile();

const { default: config } = await import('./config.js');
const { fetchAllListings, fetchListingDetail } = await import('./nettiauto.js');
const { evaluate } = await import('./filter.js');
const { announce, announceText } = await import('./discord.js');
const state = await import('./state.js');

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const unknown = [...flags].filter(
    (flag) =>
      !['--dry-run', '--seed', '--list', '--verbose', '--notify-errors', '--help', '-h'].includes(
        flag,
      ),
  );
  return {
    dryRun: flags.has('--dry-run'),
    seed: flags.has('--seed'),
    list: flags.has('--list'),
    verbose: flags.has('--verbose'),
    notifyErrors: flags.has('--notify-errors'),
    help: flags.has('--help') || flags.has('-h'),
    unknown,
  };
}

const HELP = `Nettiauto watcher

Usage: node src/index.js [options]

  --dry-run        Run the full check but post nothing to Discord.
  --seed           Record what is on sale right now without posting.
                   Same as the automatic behaviour of a first run.
  --list           Print every current match and exit. Touches no state.
  --verbose        Also show near misses and why they were rejected.
  --notify-errors  Post a message to Discord if the run fails.
  --help           This text.

Configure the search in src/config.js and the webhook in DISCORD_WEBHOOK_URL
(a scraper/.env file is read automatically). See README.md.`;

function describeSpec() {
  const { require: need } = config;
  return [
    `${config.search.make} ${config.search.model}`,
    `${need.yearFrom}-${need.yearTo}`,
    `max ${need.maxMileage.toLocaleString('fi-FI')} km`,
    need.battery,
    need.drivetrain,
    `${need.packages.join(' + ')} packages`,
  ].join(', ');
}

function formatListing(listing) {
  const price = listing.price === null ? '?' : listing.price.toLocaleString('fi-FI');
  const mileage = listing.mileage === null ? '?' : listing.mileage.toLocaleString('fi-FI');
  return `${listing.id}  ${listing.year ?? '????'}  ${mileage.padStart(9)} km  ${price.padStart(7)} €  ${listing.url}`;
}

/**
 * Work out which listings match.
 *
 * Two passes on purpose: the search pages alone settle most listings, and only
 * the undecided ones cost a detail fetch. Verdicts for listings we have already
 * rejected are reused from state, so a steady-state run fetches very few pages.
 */
async function collectMatches(listings, store, { verbose }) {
  const matches = [];
  const rejected = [];
  let detailFetches = 0;
  let reusedVerdicts = 0;

  for (const listing of listings) {
    let verdict = evaluate(listing);
    let detailChecked = false;

    // A cached verdict can be reused when nothing about the listing has moved.
    // A match that was never successfully announced is excluded: it still has
    // to be posted, and building that message needs the detail page evidence.
    const cached = store.listings[listing.id];
    const canReuse =
      verdict.needsDetail &&
      cached &&
      !state.needsRecheck(store, listing) &&
      (cached.status !== 'match' || state.wasAnnounced(store, listing.id));

    if (canReuse) {
      reusedVerdicts += 1;
      verdict =
        cached.status === 'match'
          ? { ...verdict, matched: true, needsDetail: false, reasons: [] }
          : { ...verdict, matched: false, needsDetail: false, reasons: cached.reasons ?? verdict.reasons };
    } else if (verdict.needsDetail) {
      let detail = null;
      try {
        detail = await fetchListingDetail(listing.id);
        detailFetches += 1;
      } catch (error) {
        console.warn(`  could not read listing ${listing.id}: ${error.message}`);
      }

      if (detail) {
        detailChecked = true;
        verdict = evaluate(listing, detail);
        if (detail.sold) {
          verdict = { ...verdict, matched: false, reasons: [...verdict.reasons, 'no longer for sale'] };
        }
      }
    }

    if (verdict.matched) matches.push({ listing, verdict });
    else rejected.push({ listing, verdict });

    state.record(store, listing, verdict, { detailChecked });
  }

  if (verbose) {
    const nearMisses = rejected.filter(
      ({ verdict }) =>
        verdict.reasons.length <= 2 &&
        verdict.reasons.every((reason) => /package|Pilot Lite/.test(reason)),
    );
    if (nearMisses.length) {
      console.log(`\nNear misses (${nearMisses.length}) - in spec but packages unproven:`);
      for (const { listing, verdict } of nearMisses) {
        console.log(`  ${formatListing(listing)}`);
        console.log(`      ${verdict.reasons.join('; ')}`);
      }
    }
  }

  return { matches, rejected, detailFetches, reusedVerdicts };
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

  console.log(`Looking for: ${describeSpec()}`);

  const store = args.list ? { ...(await state.loadState()) } : await state.loadState();
  const firstRun = store.isNew;
  if (firstRun && !args.list) {
    console.log('No state file yet - this run records what is on sale and posts nothing.');
  }

  console.log('\nFetching search results...');
  const { listings, total } = await fetchAllListings({
    onProgress: ({ page, lastPage, fresh }) =>
      console.log(`  page ${page}/${lastPage} (+${fresh} listings)`),
  });
  console.log(`Read ${listings.length} listings (site reports ${total ?? '?'}).`);

  console.log('\nEvaluating...');
  const { matches, detailFetches, reusedVerdicts } = await collectMatches(listings, store, {
    verbose: args.verbose,
  });
  console.log(
    `${matches.length} listing(s) meet the spec ` +
      `(${detailFetches} detail page(s) fetched, ${reusedVerdicts} cached verdict(s) reused).`,
  );

  if (args.list) {
    console.log('');
    for (const { listing } of matches.sort((a, b) => (a.listing.price ?? 0) - (b.listing.price ?? 0))) {
      console.log(formatListing(listing));
    }
    return 0;
  }

  // Anything matching that we have never announced. On a first or seeded run
  // these are recorded as announced without posting, so the channel starts
  // quiet and only genuinely new listings show up later.
  const unannounced = matches.filter(({ listing }) => !state.wasAnnounced(store, listing.id));
  const silent = firstRun || args.seed;

  // A dry run must leave no trace, so the next real run behaves exactly as it
  // would have without it - including seeding, if that has not happened yet.
  const persist = async (extra = {}) => {
    if (args.dryRun) {
      console.log('  (dry run: state file not written)');
      return;
    }
    state.prune(store);
    await state.saveState({ ...store, runs: (store.runs ?? 0) + 1, ...extra });
  };

  if (silent) {
    for (const { listing } of unannounced) state.markAnnounced(store, listing.id);
    console.log(
      `\n${args.dryRun ? 'Would record' : 'Recorded'} ${unannounced.length} match(es) ` +
        'as already-seen. Nothing posted.',
    );
    await persist({ seeded: true, seededAt: new Date().toISOString() });
    console.log('The next run will post anything that appears from now on.');
    return 0;
  }

  if (unannounced.length === 0) {
    await persist();
    // Two different populations, so name them separately: `matches` is what is
    // on sale right now, while the record also remembers listings since sold.
    const stats = state.summarise(store);
    console.log(
      `\nNothing new. ${matches.length} match(es) currently on sale; ` +
        `remembering ${stats.tracked} listing(s).`,
    );
    return 0;
  }

  const toPost = unannounced
    .sort((a, b) => (a.listing.price ?? Infinity) - (b.listing.price ?? Infinity))
    .slice(0, config.discord.maxPostsPerRun);

  if (toPost.length < unannounced.length) {
    console.warn(
      `\nHolding back ${unannounced.length - toPost.length} listing(s): over the ` +
        `${config.discord.maxPostsPerRun}-per-run cap. They will be posted next run.`,
    );
  }

  console.log(`\nPosting ${toPost.length} new listing(s) to Discord...`);
  const { announced, batches } = await announce(toPost, { dryRun: args.dryRun });

  if (!args.dryRun) {
    for (const id of announced) state.markAnnounced(store, id);
  }
  await persist();

  console.log(
    args.dryRun
      ? `Dry run: ${announced.length} listing(s) would have been posted in ${batches} message(s).`
      : `Posted ${announced.length} listing(s) in ${batches} message(s).`,
  );
  for (const { listing } of toPost) console.log(`  ${formatListing(listing)}`);

  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`\nRun failed: ${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  if (process.argv.includes('--notify-errors')) {
    await announceText(`⚠️ Nettiauto-vahti failed: ${error.message}`, {
      dryRun: process.argv.includes('--dry-run'),
    }).catch(() => {});
  }
  process.exitCode = 1;
}
