# Nettiauto watch

Watches [nettiauto.com](https://www.nettiauto.com) for used cars matching a
spec and posts new listings to a Discord channel. Runs as a standalone Node
script — it shares no code, build step or dependency with the TCO calculator in
the repo root, and the Vite build never sees this folder.

Current spec (in [src/config.js](src/config.js)):

| | |
|---|---|
| Car | Polestar 2 |
| Year | 2021–2023 |
| Odometer | max 120 000 km |
| Battery | Long Range |
| Drivetrain | Dual Motor |
| Packages | Pilot **and** Plus |

## Quick start

```sh
cd scraper
cp .env.example .env          # then paste your Discord webhook URL into it
npm run dry-run               # full check, posts nothing, saves nothing
npm start                     # the real thing
```

There is nothing to install — no dependencies, Node 20+ only.

## How announcing works

The first run has no state file, so it **records every current match and posts
nothing**. Without that, the channel would fill up with every Polestar 2
already on the market. From then on, only listings that were not in the record
get posted, and each is posted exactly once.

The record lives in [data/seen.json](data/) and is the only thing that makes
runs stateful. Delete it and the next run re-seeds silently.

- A listing is only marked as announced *after* Discord accepts the message, so
  a failed post is retried next run rather than lost.
- Listings not seen for 90 days are forgotten, so a car genuinely relisted
  months later counts as news again.
- `maxPostsPerRun` (default 20) caps how much a single run can post, so a
  parsing regression can't spam the channel. The overflow goes out next run.

## Commands

```sh
npm start                    # check and post anything new
npm run dry-run              # everything except posting; writes no state
npm run seed                 # re-record what's on sale now, post nothing
npm run list                 # print current matches, touch nothing
npm test                     # unit tests (66 cases, no network)

node src/index.js --verbose  # also show near misses and why they missed
node src/index.js --help
```

`--verbose` is the one to reach for when tuning the spec: it prints the cars
that were in spec on year, mileage and drivetrain but whose packages could not
be confirmed.

## Configuration

Everything lives in [src/config.js](src/config.js). The webhook is the one
thing kept out of it — it is a write-capable secret, so it comes from the
`DISCORD_WEBHOOK_URL` environment variable, read from `scraper/.env` (gitignored)
if present. Real environment variables always win over the file, so CI secrets
override it.

Useful knobs:

| Key | Default | Notes |
|---|---|---|
| `require.*` | see table above | The spec itself |
| `require.packageEvidence` | `'strong'` | `'weak'` accepts a bare mention of a package name |
| `require.acceptPilotLite` | *unset* | Set `true` to let **Pilot Lite** satisfy Pilot |
| `require.awdImpliesDualMotor` | `true` | AWD ("Neliveto") counts as dual motor evidence |
| `require.dualMotorImpliesLongRange` | `true` | Dual motor counts as long range evidence |
| `fetch.delayMs` | `1500` | Gap between requests |
| `discord.maxPostsPerRun` | `20` | Anti-spam cap |
| `state.forgetAfterDays` | `90` | When a vanished listing is forgotten |

To watch a different car, change `search.make` / `search.model` to match the
nettiauto URL path (`/polestar/2` → `make: 'polestar', model: '2'`) and adjust
`require`. The package matching is Polestar-specific; see below.

## Running it on a schedule

[`.github/workflows/nettiauto-watch.yml`](../.github/workflows/nettiauto-watch.yml)
runs the check every 30 minutes and commits `data/seen.json` back to the repo so
the record survives between runs. Set up:

1. Repo **Settings → Secrets and variables → Actions → New repository secret**,
   named `DISCORD_WEBHOOK_URL`.
2. Commit `scraper/data/seen.json` (it must **not** be gitignored — it is how
   runs remember each other).

Locally instead, any scheduler works — Windows Task Scheduler or cron calling
`node src/index.js` in this directory.

## React to a post → the car lands in the calculator

React to any posted listing in Discord (any emoji, from anyone in the channel)
and within a cycle the car is added to the Car TCO calculator's comparison.
It arrives with the price and odometer from the listing, the nettiauto link in
its notes, and an agreed financing baseline — 0 € down, 6 % interest, 72
months — so candidates are comparable before any dealer has quoted a real
rate. Everything else (insurance, tax, maintenance) is left at zero for you to
fill in; the defaults live in `tco.carDefaults` in [src/config.js](src/config.js).

No frontend changes are involved: the scraper appends to the same secret gist
the app's GitHub sync already uses, and the app pulls it on load and tab focus.
The app must therefore be connected to GitHub sync first (cloud button in the
header) — the scraper joins an existing sync, it never starts one.

Setup needs two more secrets (as env vars locally, or Actions secrets in CI;
with neither set the pickup is skipped and posting works as before):

- `DISCORD_BOT_TOKEN` — webhooks can post but not read reactions, so this
  needs a minimal bot: [discord.com/developers/applications](https://discord.com/developers/applications)
  → **New Application** → **Bot** → *Reset Token* (no privileged intents
  needed). Invite it to the server via **OAuth2 → URL Generator**, scope
  `bot`, permissions *View Channels* + *Read Message History*, and make sure
  it can see the channel the webhook posts into.
- `GIST_TOKEN` — a classic GitHub token with **only the `gist` scope**, same
  kind the app's sync dialog asks for, on the account that owns the data gist.

Worth knowing:

- A car is added once. Removing the reaction later does nothing — delete the
  car in the app instead, and it stays deleted (the scraper re-adds a car only
  until it has verified the write survived the app's last-write-wins sync,
  never after).
- The car's id is derived from the nettiauto id, so reacting twice, or both of
  you reacting, cannot create duplicates.
- Reactions are found by scanning recent channel history (`tco.scanMessages`,
  default 300 messages) and mapping embeds back to listings via their URLs, so
  it works on posts made before this feature existed too.
- To require a specific emoji instead of any reaction, set
  `tco.requiredEmoji` (e.g. `'✅'`) in [src/config.js](src/config.js).

## How it reads nettiauto

There is no public API, so this parses the server-rendered HTML. Two details
are worth knowing before changing anything:

**The search is crawled unfiltered, on purpose.** Nettiauto accepts
`yearFrom` / `yearTo` / `kilometersTo` on the listing path, but combining them
with `page` breaks pagination — every page returns the first page of results.
Measured on the full Polestar 2 listing: filtered, 8 pages yielded 43 unique
cars out of 261; unfiltered, 16 pages yielded all 464. So the scraper pages
through the unfiltered listing and applies the whole spec locally. It has to
anyway — nettiauto has no filter for battery, drivetrain or packages.

**Facts come from embedded structured data where possible.** Each result card
carries a `data-datalayer` JSON blob with year, mileage, price and seller
already typed, and each search page embeds a schema.org `ItemList` with the
image, colour, body type and VIN. Both are far steadier than scraping
presentation markup. (One trap: those payloads contain `&quot;` for inch marks,
so they must be `JSON.parse`d *before* any entity decoding.)

A listing page is only fetched when the search card cannot settle the verdict —
which is where the option packages usually have to be read from. Verdicts are
cached in the state file, so a steady-state run fetches almost no listing pages;
rejected listings are re-read only if their price or mileage moved, or after two
weeks.

## Matching the option packages

Pilot and Plus are never structured data — they exist only in seller free text,
written a dozen different ways. All of these are real and all are accepted:

```
Pilot- ja Plus-varustepaketit      Pilot&Plus            Pilot / Plus / 360
Pilot- ja Plus-pkt.                Plus&Pilot            Pilot + Plus
Pilot sekä Plus -paketit           PILOT & PLUS          Pilot ja Plus, 1-om.
```

The text is tokenised with every separator sellers use flattened to
whitespace, then a package counts when the name sits within three tokens of
either a `paketti`/`pkt`/`pack`/`varuste` word or the other required package.

Two Polestar-specific exclusions matter:

- **Pilot Lite** is a smaller, separately sold package, so it does *not*
  satisfy Pilot. Set `require.acceptPilotLite = true` if you want it to.
- **Pilot Assist** is a feature that ships in *both* Pilot and Pilot Lite, so
  seeing it proves nothing about which pack the car has, and it is ignored.
  (A listing naming both "Pilot Assist" and Pilot properly still matches.)

Because this is fuzzy by nature, **every Discord post quotes the seller text it
matched on**, so the verdict can be checked at a glance instead of trusted. If
a listing contradicts itself — say `Pilot&Plus` in the title but `Pilot Lite`
in the highlights — the post carries a "worth confirming with the seller" note.

Two harmless inferences fill gaps in seller text, both reported in the post:
a Polestar 2 Dual Motor was only ever sold as Long Range, and the only AWD
Polestar 2 is the dual motor. So `Launch Edition` + `Neliveto`, with no battery
named anywhere, still matches — correctly.

## Being a polite guest

One request at a time, 1.5 s apart, a real browser User-Agent, and retries with
backoff on 429/5xx. A full first run is roughly 16 search pages plus a listing
page for each undecided car; later runs are mostly just the 16 search pages.

## Layout

```
src/config.js     the spec and all the knobs
src/index.js      orchestration and CLI
src/nettiauto.js  fetching and parsing search + listing pages
src/filter.js     the spec check, including package matching
src/state.js      the record of what has been seen and announced
src/discord.js    webhook payloads
src/http.js       paced, retrying fetch
src/html.js       entity decoding and text extraction
src/env.js        reads .env
test/             unit tests, no network
data/seen.json    the record (commit this)
```
