// Runtime knobs for the nettiauto watcher.
//
// What to look for is no longer in here: that is a list of filters, created in
// the calculator's UI and read from the app's gist, with scraper/filters.json
// as the committed fallback. See src/filters.js.
//
// All the matching happens locally on purpose - nettiauto has no server-side
// filter for battery, drivetrain or option packages, and its year/mileage
// filters break pagination when combined with `page` (see the note on
// buildSearchUrl in nettiauto.js).

export const config = {
  filters: {
    // 'auto' tries the gist and falls back to the file; 'gist' or 'file'
    // pins it to one. --filters=<source> overrides this for a single run.
    source: 'auto',
    // Committed default, relative to the scraper folder.
    file: 'filters.json',
    // Where the app syncs the filters it creates, inside the data gist.
    gistFilename: 'car-tco-filters.json',
  },

  fetch: {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    // Be a polite guest: one request at a time, with a gap between them.
    delayMs: 1500,
    timeoutMs: 30000,
    // Five attempts, not three. Two scheduled runs have died at the crawl step,
    // one of them in thirty seconds - the shape of giving up quickly rather than
    // trying hard and losing. A page that fails is also no longer fatal (see
    // maxFailedPages), so the cost of trying longer is a slower run at worst.
    retries: 5,
    // Exponential with jitter from here, capped below - see src/retry.js. A
    // server's own Retry-After wins over both.
    retryBackoffMs: 4000,
    retryMaxBackoffMs: 45000,
    // How many pages of one search may fail before the crawl gives up on it.
    // A partial crawl is fine - the watcher is idempotent and will see the rest
    // next run - but a search where every page fails is a dead source, and
    // grinding through forty of them wastes the run.
    maxFailedPages: 3,
    maxSearchPages: 40,

    /**
     * Least time between crawls, whatever the schedule delivers.
     *
     * GitHub's scheduler drops most firings - measured at 9 % over four days -
     * so the workflow asks for one every five minutes and this decides which of
     * them actually does anything. Taking all twelve an hour would be six times
     * the load on a site that owes us nothing.
     *
     * Set below the intended gap rather than at it, or a firing that arrives a
     * minute early gets thrown away and the next chance is five minutes later.
     */
    minIntervalMinutes: 25,
  },

  /**
   * Say something when the watcher has been quiet far longer than intended.
   *
   * The schedule degrading is invisible: every run succeeds, so nothing fails
   * and nobody is told. It took reading the Actions API to notice a six-hour
   * median gap between runs. Zero turns this off.
   */
  liveness: {
    staleAfterMinutes: 120,
    // At most one notice per this long, so a persistently bad schedule says so
    // without saying it every time.
    noticeEveryMinutes: 720,
  },

  discord: {
    // Never hardcode these - both are write-capable secrets.
    webhookUrl: process.env.DISCORD_WEBHOOK_URL ?? '',
    // Only needed for the reaction pickup below; posting works without it.
    botToken: process.env.DISCORD_BOT_TOKEN ?? '',
    username: 'Nettiauto-vahti',
    // One car per message. Discord allows 10 embeds, but a reaction applies to
    // a whole message, so batching would make "react to add this one"
    // ambiguous. See tco.pickUpReactions.
    embedsPerMessage: 1,
    // Anti-spam cap, counted across every filter in a run. A brand new filter
    // usually has a backlog of cars already on sale; the overflow waits for
    // the next run rather than arriving as a wall of messages.
    // Guard against a parser regression spamming the channel.
    maxPostsPerRun: 20,
  },

  // React to a posted listing in Discord and it gets added to the Car TCO
  // calculator, by appending to the same secret gist the app already syncs
  // with. Needs DISCORD_BOT_TOKEN (to read reactions) and GIST_TOKEN (a
  // classic GitHub token with only the `gist` scope).
  tco: {
    pickUpReactions: true,
    gistToken: process.env.GIST_TOKEN ?? '',
    // Must match the app's sync target - see src/sync.ts in the repo root.
    gistFilename: 'car-tco-data.json',
    // Any reaction counts as "add this car".
    requiredEmoji: null,
    // How far back through the channel to look for reactions, in messages.
    scanMessages: 300,

    // The *fallback* baseline for an added car, not the baseline.
    //
    // The financing and consumption figures now come from whoever owns the
    // calculator the car is going into - settings.newCar in their own data,
    // which the app's Assumptions panel writes. This watcher runs for several
    // people, and a rate and term fixed here would have put one person's
    // assumptions about borrowing into everybody else's calculator.
    //
    // What is left here answers the case where their app predates that setting:
    // a car financed at 0 % over 0 months would be worse than an assumption.
    // See newCarDefaults() in src/sinks/car-tco.js.
    //
    // The price, odometer and powertrain always come from the listing itself.
    carDefaults: {
      // Fallback only - the listing's own fuel type decides when it says.
      powertrain: 'ev',
      // Above the WLTP figure on purpose - roughly what a mid-size EV uses in
      // mixed Finnish driving. Same idea for the l/100 km of a combustion car.
      elecKwhPer100: 20,
      fuelLPer100: 6.5,
      // Let the app estimate resale from age and mileage.
      autoResale: true,
      // A common baseline so candidates are comparable before you have a real
      // offer from any dealer. Change it here once a real rate is on the table.
      financing: {
        method: 'loan',
        downPayment: 0,
        annualRatePct: 6,
        termMonths: 72,
        autoBalloon: true,
        balloon: 0,
      },
      // Left at zero rather than guessed; they are near-identical across
      // candidates for the same model, so they barely affect a comparison.
      insurancePerYear: 0,
      taxPerYear: 0,
      maintenancePerYear: 0,
      tiresPerYear: 0,
      otherPerYear: 0,
    },
  },

  state: {
    // Where the record of what has been seen lives: 'file' (data/seen.json,
    // needs no credential) or 'gist' (per user, needs GIST_TOKEN).
    //
    // Switching is deliberate, never automatic. A run that quietly looked
    // somewhere else would find no state, conclude it was a first run, and
    // silently re-baseline the whole market - so moving the record is a
    // one-off `--migrate-state=<backend>`, not a side effect of setting a
    // token. See src/storage/.
    store: 'file',
    // Where the gist backend keeps it, beside the app's data and filters.
    gistFilename: 'car-tco-seen.json',
    // Listings unseen for this long are forgotten, so a genuine relisting
    // months later is announced again instead of being silently swallowed.
    forgetAfterDays: 90,
  },
};

export default config;
