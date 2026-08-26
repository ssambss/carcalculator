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
    // Never hardcode the webhook - it is a write-capable secret.
    webhookUrl: process.env.DISCORD_WEBHOOK_URL ?? '',
    username: 'Nettiauto-vahti',
    // Discord allows 10 embeds per message; keep a little headroom.
    embedsPerMessage: 5,
    // Guard against a parser regression spamming the channel.
    maxPostsPerRun: 20,
  },

  state: {
    // Listings unseen for this long are forgotten, so a genuine relisting
    // months later is announced again instead of being silently swallowed.
    forgetAfterDays: 90,
  },
};

export default config;
