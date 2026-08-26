// Search criteria and runtime knobs for the nettiauto watcher.
//
// `search` picks which listing pages to read; `require` is the actual spec and
// is checked locally against every listing. All the filtering lives locally on
// purpose - nettiauto has no server-side filter for battery, drivetrain or
// option packages, and its year/mileage filters break pagination when combined
// with `page` (see the note on buildSearchUrl in nettiauto.js).

export const config = {
  search: {
    // Nettiauto's pretty listing path: /<make>/<model>
    make: 'polestar',
    model: '2',
  },

  require: {
    yearFrom: 2021,
    yearTo: 2023,
    maxMileage: 120000,

    battery: 'long-range',
    drivetrain: 'dual-motor',
    packages: ['pilot', 'plus'],

    // Every Polestar 2 Dual Motor is a Long Range car — there was never a
    // Standard Range dual motor. So an explicit "Dual Motor" is accepted as
    // proof of Long Range when the listing doesn't spell the battery out.
    dualMotorImpliesLongRange: true,

    // Nettiauto reports AWD as "Neliveto". On a Polestar 2 that only ships
    // with the dual motor powertrain, so it counts as drivetrain evidence.
    awdImpliesDualMotor: true,

    // Option packages live in seller free text only. "strong" demands the
    // package word sit next to a paketti/pack/varuste word (or appear in a
    // "Pilot- ja Plus-paketit" style pairing); "weak" accepts a bare mention.
    packageEvidence: 'strong',
  },

  fetch: {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    // Be a polite guest: one request at a time, with a gap between them.
    delayMs: 1500,
    timeoutMs: 30000,
    retries: 3,
    retryBackoffMs: 4000,
    maxSearchPages: 40,
  },

  discord: {
    // Never hardcode these - both are write-capable secrets.
    webhookUrl: process.env.DISCORD_WEBHOOK_URL ?? '',
    // Only needed for the reaction pickup below; posting works without it.
    botToken: process.env.DISCORD_BOT_TOKEN ?? '',
    // Left empty, it is read off the webhook at runtime.
    channelId: process.env.DISCORD_CHANNEL_ID ?? '',
    username: 'Nettiauto-vahti',
    // One car per message. Discord allows 10 embeds, but a reaction applies to
    // a whole message, so batching would make "react to add this one"
    // ambiguous. See tco.pickUpReactions.
    embedsPerMessage: 1,
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

    // What an added car looks like before you refine it in the app. Only the
    // price and odometer come from the listing; everything below is an
    // assumption, so it all lives here where it is easy to change.
    carDefaults: {
      powertrain: 'ev',
      // Above the WLTP figure on purpose - roughly what a Polestar 2 uses in
      // mixed Finnish driving.
      elecKwhPer100: 20,
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
    // Listings unseen for this long are forgotten, so a genuine relisting
    // months later is announced again instead of being silently swallowed.
    forgetAfterDays: 90,
  },
};

export default config;
