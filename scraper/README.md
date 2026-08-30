# Listing watch

Watches listing sites for things matching your filters and posts anything new to
a Discord channel. [nettiauto.com](https://www.nettiauto.com) is the source it
was built for and so far the only one; adding another is writing an adapter.

Runs as a standalone Node script — it shares no code, build step or dependency
with the TCO calculator in the repo root, and the Vite build never sees this
folder.

A **filter** is one saved search: a source, which of its listing pages to read,
and the spec every listing on it is checked against. There can be any number of
them, and filters sharing a source and a search share a single crawl.

## Sources

A **source** is one site. Everything site-specific lives in an adapter under
[src/sources/](src/sources/) - how to page through a search, how to parse a
card, which numeric facts its listings carry, how to recover a listing id from
a link. Nothing outside that folder names a site: the orchestration in
`src/index.js`, the matcher in `src/filter.js` and the Discord posting all work
against the interface.

`nettiauto` is the only one so far, and a filter that names no source gets it.
To follow something else - flats, rentals, anything with listing pages - write
another adapter, register it in [src/sources/index.js](src/sources/index.js),
and make it pass `test/sources.test.js`, which is the specification.

Two things a source decides that are worth knowing about:

- **Its fields.** A filter's numeric limits are a bag keyed by field
  (`ranges: { year: { max: 2023 }, mileage: { max: 120000 } }`), and the source
  declares which fields exist and what to call them. `price` is just another
  field. A flat's source would declare `sizeM2` and `rooms` and everything from
  the matcher to the Discord embed to the filter editor would follow.
- **Its sink**, meaning where a listing goes when someone reacts to it. Cars go
  to the calculator; a source watching flats declares no sink, and reactions on
  its posts do nothing. That is deliberate - it lets a new source ship without a
  second calculator having to exist first.

## Where the filters come from

Make them in the calculator (funnel button in the header). They sync to
`car-tco-filters.json` in the same secret gist the app already uses, and the
watcher reads them there on every run — so a filter created on a phone is live
within the half hour, with no commit and no deploy.

Resolution order, first source with at least one filter wins:

| | Source | Needs |
|---|---|---|
| 1 | `car-tco-filters.json` in the app's gist | `GIST_TOKEN` |
| 2 | [filters.json](filters.json) in this folder | nothing — it is committed |

**The gist shadows the file.** As soon as the app has one filter, `filters.json`
stops being read — so a filter that exists only in the file quietly stops
running. Once you start making filters in the app, keep every filter you care
about there. *Copy all as JSON* in the filter dialog gives you the list back in
this file's format, which is the easy way to keep the committed fallback in step
with reality.

`filters.json` is the fallback and the local default. It ships with **one
disabled filter**, so a fresh clone or fork watches nothing until you say
otherwise — the spec in it is one person's car, and inheriting it by accident is
not a useful default. Enable it to try the watcher out before you have built a
filter of your own; it is also the worked example the matching rules below are
written against:

| | |
|---|---|
| Car | Polestar 2 |
| Year | 2021–2023 |
| Odometer | max 120 000 km |
| Variant | says Long Range **and** Dual Motor |
| Never | Standard Range, Single Motor |
| Packages | Pilot **and** Plus |

Pin a run to one source with `--filters=gist` or `--filters=file` — the latter
is the one to use when trying a filter out locally, since it never touches the
network for its config. Every run prints which source it used and what it found
there, so `node src/index.js --only=nothing` is a quick way to ask "what would
you run right now?". Reading the gist needs `GIST_TOKEN` in `scraper/.env`
locally, exactly as in CI; without it a local run always uses the file.

## What a filter can ask for

The only thing a filter cannot leave out is the search — the page to read.
Everything else is optional, and a filter with no requirements at all matches
that whole listing page, which is what you want when scouting something you have
no fixed spec for.

| Field | Checked against |
|---|---|
| `source` | which site; omitted means `nettiauto` |
| `search` | which of its pages. For nettiauto, `{ make, model }` → `/polestar/2` |
| `ranges` | typed facts from the result card, keyed by field (see below) |
| `variantMust`, `variantMustNot` | the variant name and the spec chips — short, structured text |
| `textMust`, `textMustNot` | everything, the seller's own description included |
| `packages` + `packageEvidence` | free text, but only where it reads as a package (see below) |
| `packageQualifiers` | words that change what a package name means (see below) |
| `implications` | "seeing A proves B", for facts a seller left implicit |
| `postExisting` | whether its first run reports the listings already on sale |
| `enabled` | pausing keeps the filter and its history |

`ranges` is how every numeric limit is expressed, and which fields exist is the
source's declaration rather than anything hardcoded:

```json
"ranges": { "year": { "min": 2021, "max": 2023 }, "mileage": { "max": 120000 } }
```

Both bounds are inclusive, and a range over a field the listing does not state
*fails* — "under 120 000 km" is a claim about the car, and an advert that does
not say cannot support it. The older `yearFrom` / `yearTo` / `maxMileage` /
`minPrice` / `maxPrice` spellings are still read, and still win where they
disagree with `ranges`: only a writer that has never heard of the range bag sets
one without the other, so trusting the bag there would discard its edit.

Likewise `make` and `model` are still read from the filter's top level and fold
into `search`.

Phrases are matched on whitespace-flattened tokens, so `long range` finds
`Long-Range`, `LONG RANGE / 78kWh` and `long/range` alike. The last word of a
phrase may match the start of a longer token when it is at least five
characters — Finnish glues words together, so `lasikatto` has to find
`lasikattoluukku` — while shorter words are matched exactly, or `acc` would hit
something in every advert.

A package name may be more than one word (`m sport`, `tech pack`), and how the
seller punctuates it does not matter. But `packages` is for packages *named in
the free text*: it wants the name next to a `paketti`/`pack`/`varuste` word, or
paired with another required package. A trim that rides along in the model name
— BMW writes `320i A xDrive Business M Sport` — is not that, and asking for it
as a package finds nothing on the strong setting. Put a trim under
`variantMust`, where it is exactly the kind of claim that field is for. Real
example, on the 560 BMW 320 adverts live in August 2026: of the 28 that name M
Sport, **not one** writes it as a package, and several mean `M Sport ratti` —
the steering wheel, not the car.

`implications` are what keep the spec honest without teaching the matcher every
model's range. On a Polestar 2, `Neliveto` (AWD) proves Dual Motor, and Dual
Motor was only ever sold as Long Range — so a `Launch Edition` advert naming
neither battery nor drivetrain still matches, correctly, and the Discord post
says which facts were inferred. Rules chain, and they read the variant name and
spec chips only: a seller comparing their car to another one in the description
cannot accidentally prove anything.

## Quick start

```sh
cd scraper
cp .env.example .env          # then paste your Discord webhook URL into it
npm run doctor                # what is set up, and what each secret unlocks
npm run dry-run               # full check, posts nothing, saves nothing
npm start                     # the real thing

node src/index.js --list --filters=file   # what the committed example matches
```

There is nothing to install — no dependencies, Node 20+ only. Setting the whole
thing up from scratch, secrets included, is [../SETUP.md](../SETUP.md).

A run with no `DISCORD_WEBHOOK_URL` has nowhere to deliver, so it stops before
crawling rather than spending two minutes to find that out. Which *kind* of
missing decides what happens next: a watcher that has never completed a run is
an install waiting to be set up, and exits 0 with the onboarding text, while one
that has posted before and lost its webhook fails loudly — the channel has gone
quiet and that must not pass unnoticed.

## How announcing works

The first run has no state file, so it **records every current match and posts
nothing**. Without that, the channel would fill up with every car already on
the market. From then on, only listings that were not in the record get posted,
and each is posted exactly once *per filter*.

The record is the only thing that makes runs stateful. Delete it and the next
run re-seeds silently.

**Where it lives is a backend**, in [src/storage/](src/storage/):

| `state.store` | Where | Needs | Notes |
|---|---|---|---|
| `'file'` (default) | [data/seen.json](data/) | nothing | indented, and committed back by the workflow |
| `'gist'` | `car-tco-seen.json` in your gist | `GIST_TOKEN` | minified, per user, nothing committed |

The file backend makes the record *the repo's*, which is fine for one person
and awkward for anyone else: two people cannot share it, and a fork diverges on
it from its first run and then conflicts on every pull from upstream. The gist
backend fixes both and removes the workflow's need for write access to the repo.

Switching is deliberate, never automatic:

```sh
node src/index.js --migrate-state=gist   # copy the record across, then edit config.js
```

A run that quietly looked somewhere new would find nothing, conclude it was a
first run, and silently re-baseline the whole market. So the copy is explicit,
it refuses to overwrite a record that already exists, and it leaves the old one
in place until you delete it.

Records are keyed `<source>:<id>` — a site's ids are only unique within that
site. Older files are migrated on read (v1 gave listings per-filter verdicts,
v2 → v3 namespaces the keys) and rewritten in the new shape on the next save;
everything already announced stays announced.

- Verdicts, reasons and posts are stored **per filter**, because two filters
  can legitimately disagree about the same car. The listing's own facts (price,
  odometer, when its page was last read) are shared — they belong to the
  advert, not to anyone's opinion of it.
- **A filter added later posts the cars already on sale**, once. That is the
  point of adding one: you want to see the market. Turn it off per filter
  (*Post the cars already on sale* in the editor's Advanced section) to have it
  start quiet and report only what appears afterwards.
- **A car matching two filters is posted once**, not twice — a broad filter and
  a narrow one over the same model are a normal pair to have. The run log names
  every filter that wanted it, and all of them count it as announced, because
  it is in the channel.
- A listing is only marked as announced *after* Discord accepts the message, so
  a failed post is retried next run rather than lost.
- Listings not seen for 90 days are forgotten, so a car genuinely relisted
  months later counts as news again. A filter that has not run for 90 days is
  forgotten too, along with its verdicts — filters are aged out rather than
  diffed against the current list, so a gist hiccup that hides them for one run
  cannot throw away what has been posted.
- `maxPostsPerRun` (default 20) caps how much a single run can post *across all
  filters*, so neither a parsing regression nor one very broad new filter can
  flood the channel. The overflow goes out next run.
- Upgrading from the single-spec version: the state file is migrated in place,
  and everything it had already announced stays announced whatever the filters
  are now called. Its verdicts are dropped, since no filter can claim them, so
  the first run afterwards reads a few more listing pages than usual.

## Commands

```sh
npm start                    # check and post anything new
npm run dry-run              # everything except posting; writes no state
npm run seed                 # re-record what's on sale now, post nothing
npm run list                 # print current matches per filter, touch nothing
npm run doctor               # check the setup; posts nothing, writes nothing
npm test                     # unit tests (157 cases, no network)

node src/index.js --verbose          # also show near misses and why they missed
node src/index.js --only=polestar    # run one filter, by name or id
node src/index.js --filters=file     # ignore the gist, use filters.json
node src/index.js --migrate-state=gist   # move the record into your gist
node src/index.js --help
```

`--verbose` is the one to reach for when tuning a filter: it prints, per
filter, the cars that were in spec on the numbers but whose phrases or packages
could not be confirmed. `--only` keeps that output to the filter you are
working on.

## Configuration

The filters are the spec; [src/config.js](src/config.js) holds the runtime
knobs around them. The webhook is the one thing kept out of both — it is a
write-capable secret, so it comes from the `DISCORD_WEBHOOK_URL` environment
variable, read from `scraper/.env` (gitignored) if present. Real environment
variables always win over the file, so CI secrets override it.

| Key | Default | Notes |
|---|---|---|
| `filters.source` | `'auto'` | `'gist'` or `'file'` to pin it; `--filters=` overrides per run |
| `filters.file` | `'filters.json'` | The committed fallback |
| `filters.gistFilename` | `'car-tco-filters.json'` | Where the app syncs filters |
| `fetch.delayMs` | `1500` | Gap between requests |
| `fetch.maxSearchPages` | `40` | Per search, not per run |
| `discord.maxPostsPerRun` | `20` | Anti-spam cap, across all filters |
| `state.store` | `'file'` | `'gist'` to keep the record per user instead of in the repo |
| `state.gistFilename` | `'car-tco-seen.json'` | Where the gist backend keeps it |
| `state.forgetAfterDays` | `90` | When a vanished listing or a dormant filter is forgotten |

Per-filter settings — including `packageEvidence` (`'weak'` accepts a bare
mention of a package name), `acceptLesserPackages` (let **Pilot Lite** satisfy
Pilot) and `postExisting` — live on the filter itself, in the app's editor or
in `filters.json`.

To watch a different car, add a filter in the app, or copy the entry in
`filters.json` and change `make` / `model` to match the nettiauto URL path
(`/polestar/2` → `"make": "polestar", "model": "2"`). To watch something that is
not a car at all, that is a new source — see *Sources* above.

## Running it on a schedule

[`.github/workflows/nettiauto-watch.yml`](../.github/workflows/nettiauto-watch.yml)
runs the check every 30 minutes and commits `data/seen.json` back to the repo so
the record survives between runs. Set up:

1. Repo **Settings → Secrets and variables → Actions → New repository secret**,
   named `DISCORD_WEBHOOK_URL`.
2. Add `GIST_TOKEN` too, if you want the filters made in the app to reach the
   scheduled runs. Without it they run on the committed `filters.json`, quietly
   and correctly, but a filter created in the UI never arrives.
3. Commit `scraper/data/seen.json` (it must **not** be gitignored — it is how
   runs remember each other).

Locally instead, any scheduler works — Windows Task Scheduler or cron calling
`node src/index.js` in this directory.

## React to a post → the car lands in the calculator

React to any posted listing in Discord (any emoji, from anyone in the channel)
and within a cycle the car is added to the Car TCO calculator's comparison.
It arrives with the price, odometer and powertrain from the listing (a diesel
is added as a diesel — filters can watch anything now), the nettiauto link in
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
  → **New Application** → **Bot** → *Reset Token*, and enable **Message
  Content Intent** under *Privileged Gateway Intents* — without it Discord
  strips the embeds from what the bot reads, so a reacted post cannot be
  matched back to its car. Invite it to the server via **OAuth2 → URL Generator**, scope
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

## How the nettiauto source reads nettiauto

Everything below is one adapter's business, in
[src/sources/nettiauto.js](src/sources/nettiauto.js). It is the worked example
for writing another.

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

Two Polestar-specific exclusions matter, and they are the filter's own
`packageQualifiers` rather than anything the matcher knows:

- **Pilot Lite** is a smaller, separately sold package, so it does *not*
  satisfy Pilot. Tick *Accept the smaller version of a package* (or set
  `acceptLesserPackages: true`) if you want it to.
- **Pilot Assist** is a feature that ships in *both* Pilot and Pilot Lite, so
  seeing it proves nothing about which pack the car has, and it is ignored.
  (A listing naming both "Pilot Assist" and Pilot properly still matches.)

Both are expressed as `{ package, word, means }`, where `means` is `lesser` or
`feature`:

```json
"packageQualifiers": [
  { "package": "pilot", "word": "lite", "means": "lesser" },
  { "package": "pilot", "word": "assist", "means": "feature" }
]
```

A filter that says nothing gets those two by default, so nothing written before
the field existed changed behaviour. They are inert unless a filter asks for a
package literally named `pilot`. An explicitly empty list clears them.

Because this is fuzzy by nature, **every Discord post quotes the seller text it
matched on**, so the verdict can be checked at a glance instead of trusted. If
a listing contradicts itself — say `Pilot&Plus` in the title but `Pilot Lite`
in the highlights — the post carries a "worth confirming with the seller" note.

The two inferences that fill gaps in seller text are not hardcoded: they are
the filter's own `implications` rules, and both are reported in the post. See
*What a filter can ask for* above.

## Being a polite guest

One request at a time **per host**, 1.5 s apart, a real browser User-Agent, and
retries with backoff on 429/5xx. Per host rather than globally, so a run over
several sources does not make each one wait out the others' politeness budget —
within a site it is still strictly one request at a time, which is the part that
matters. Adding filters never means more requests in flight, only a longer run. A full first run over the Polestar 2 listing is
roughly 16 search pages plus a listing page for each undecided car; later runs
are mostly just the 16 search pages. Filters watching the same make and model
share that crawl; each additional make/model adds its own pages.

## Layout

```
filters.json           the committed example, disabled (the gist wins when it has any)
src/index.js           orchestration and CLI - names no site
src/filters.js          loading and normalising filters; grouping them into crawls
src/filter.js           the spec check: numbers, phrases, implications, packages
src/fields.js           checking numeric limits, whatever the fields are called
src/sources/index.js    the source registry
src/sources/nettiauto.js  everything nettiauto-specific
src/sinks/index.js      where a reacted listing goes
src/sinks/car-tco.js    ...into the calculator, as a car
src/state.js            what has been seen and announced, per filter
src/storage/index.js    where that record lives: a file, or your gist
src/discord.js          webhook payloads, labelled by the source
src/reactions.js        reading reactions off our own posts
src/gist.js             the GitHub gist plumbing
src/http.js             paced (per host), retrying fetch
src/html.js             entity decoding and text extraction
src/config.js           the runtime knobs
src/preflight.js        whether a run can post, and whose problem it is if not
src/doctor.js           the setup report (npm run doctor)
src/env.js              reads .env
test/                   unit tests, no network
test/sources.test.js    conformance: what every adapter has to get right
data/seen.json          the record (commit this)
```
