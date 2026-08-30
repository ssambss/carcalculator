# Generalization plan

Turning this repo from *one person's car watcher* into (1) something other
people can actually use — including people who do not write software — and
(2) a watcher whose **source** is a pluggable module, so it can follow
apartments, rentals or anything else with listing pages.

> **Where we stand:** Phases 0 and 1 done. The matcher no longer knows what a
> car is, and the filter editor generates itself from field declarations.
> 130 scraper tests pass; app build and lint clean.
> **Next: Phase 2**, the source seam.
>
> **Decided 2026-08-30:** this gets hosted (Phase 6, Tier 2), because
> fork-per-user does not reach a non-programmer. Sharing now outranks the
> second source, so the order is **1 → 2 → 3 → 6 → 4 → 5**.
> Stack choice is still open. See
> [the delivery-model constraint](#the-delivery-model-constraint).
>
> Last updated 2026-08-30.

| Phase | What it buys | Status |
|---|---|---|
| [0 · Hygiene](#phase-0--hygiene) | The repo is safe to hand to someone else | ✅ done |
| [1 · Declarative ranges](#phase-1--declarative-ranges) | `filter.js` stops being about cars | ✅ done |
| [2 · Source seam](#phase-2--source-seam) | nettiauto becomes one adapter of many | ⬜ not started |
| [3 · State adapter](#phase-3--state-behind-a-storage-adapter) | State is per-user, destination not baked in | ⬜ not started |
| [4 · Conformance suite](#phase-4--conformance-suite) | A stranger can add a source safely | ⬜ not started |
| [5 · Second source](#phase-5--second-source) | Proof it generalizes (oikotie) | ⬜ not started |
| [6 · Hosted sharing](#phase-6--hosted-for-people-who-cannot-fork) | Non-technical people actually using it | ⬜ decided, not started |
| [6b · Installable client](#phase-6b--installable-client-pwa) | Home-screen icon on desktop and phone; push | ⬜ recommended over native |
| [7 · Asset-agnostic TCO](#phase-7--asset-agnostic-tco-optional) | Apartments in the calculator | ⬜ optional |

Legend: ⬜ not started · 🔨 in progress · ✅ done · ⏸️ parked

---

## Why this order

Phases 1–2 change the filter shape and the state keys. **Every schema change
becomes a migration owed to other people the moment they fork**, so the
refactor comes before the sharing push — it is dramatically cheaper while
there is exactly one user.

Phase 0 is the exception: it is pure hygiene, it blocks nothing, and it is a
prerequisite for sharing *anything*.

Phase 7 is a separate project. Keeping the sink optional (Phase 2) means
apartment watching ships fully without it.

**Phase 6 moved ahead of 4 and 5** when hosting was chosen: sharing is the
committed priority, and Phase 6 needs only 2 and 3 in front of it. The cost is
that the modular-source work sits unproven until Phase 5 — if watching
apartments starts mattering more than friends joining, swap them back. Phase 4
stays immediately before 5 either way, since it is what de-risks it.

---

## Two things that are already true

Worth stating so no effort is wasted rebuilding them:

- **The frontend is already multi-user.** It is static, localStorage-first, and
  `sync.ts` finds the gist *by filename on whoever's token is pasted*. A second
  person gets their own private data and filters today.
- **The orchestration is already source-agnostic.** The two-pass crawl, verdict
  caching, per-filter records, cross-filter dedup and round-robin post capping
  in `scraper/src/index.js` never touch a nettiauto concept except via one
  import.

## The organizing principle

**A tenant is whoever owns a set of filters.** Everything the watcher reads and
writes is keyed by tenant, and *where* that lives is an implementation detail
with more than one answer:

| Tenant is | Store | For |
|---|---|---|
| a gist | `car-tco-data.json`, `car-tco-filters.json`, and after Phase 3 the watcher state | you, and technical friends |
| an account | the hosted store | everyone else (Phase 6) |

The gist route needs no server and no shared trust, and it was the whole plan
until it ran into the constraint below. It survives as one implementation of the
tenant idea rather than as the idea itself.

---

## The delivery-model constraint

Fork-per-user is a *developer* onboarding flow: GitHub account, fork, enable
Actions, create a classic PAT with the right scope, create a Discord webhook,
create a Discord bot and enable a privileged intent, paste three secrets. A
non-programmer will not do six of those eight steps. So fork-per-user is a
real answer for technical friends and **not an answer for anyone else.**

The constraint underneath it, which no amount of polish removes:

> A static app cannot write to a per-user store without either the user's own
> credential, or a server. Shipping a shared write token inside a static bundle
> hands it to everyone who opens the page.

So **non-technical multi-user requires a server.** A small one — but real, and
it changes what this project is: you would be holding other people's data.

Two things follow, and both are reflected below:

- **Phases 0–5 are unaffected.** They are internal refactors — the filter
  shape, the source seam, the conformance suite — that every delivery model
  needs. Choosing to host changed the order of the work, not the work.
- **Phase 3 must not bake the destination in.** It was "move state into the
  user's gist"; it is now "state behind a storage adapter", so the hosted store
  is a third implementation rather than a rewrite.

### An argument *for* hosting, on the merits

One shared crawl serves every user. N forks means N independent crawls of the
same nettiauto pages — worse for the site and no faster for anyone. A single
instance crawls once and fans out, which makes hosting the more polite
architecture, not the more extractive one.

### What gets harder, found in the code

- `discord.maxPostsPerRun` is a **global** cap. Per-user it becomes a per-user
  cap, or one person's broad filter starves everyone else's run.
- `data/seen.json` is **770 KB for two filters**. Per-user × per-filter state
  pushes past what a JSON file should hold, toward a real datastore.
- Verdict caching is per filter, so crawl cost grows with *total filters across
  all users*, not with users. Needs a per-user filter cap.
- The reaction → calculator pickup has to know *whose* calculator.
- Nothing currently stops one user adding fifty filters over fifty models.

### Notification channel is the biggest friction lever

Ranked by what the *user* has to do:

| Channel | User effort | Cost to you |
|---|---|---|
| **A Discord server you own**, channel per person, invite link | join a server | none — the whole posting/embed/reaction pipeline already works |
| Telegram bot you own | start a chat | a bot token |
| Email | nothing | a sending service |
| Web push (PWA) | install on iOS; nothing elsewhere | VAPID keys + a push endpoint |

The Discord server is the standout: zero setup for the user, and every line of
`discord.js`, `reactions.js` and the embed format keeps working unchanged.

---

## Phase 0 · Hygiene ✅

*Make the repo safe to hand to someone else. Blocks nothing else.*

- [x] Confirm `scraper/.env` is untracked (it is — only `.env.example` is committed)
- [x] Neutralize the committed `filters.json` — ships one **disabled** example,
      so a fresh fork watches nothing until it says otherwise. Kept as the
      worked example the READMEs document the matching rules against.
- [x] Graceful unconfigured paths, in three places:
      `loadFilters` returns `{ filters: [], source: 'nowhere' }` instead of
      throwing when no source answers; a run with no enabled filters prints how
      to make one; and a run with nowhere to post stops **before crawling**
      rather than failing two minutes in.
- [x] `npm run doctor` (`scraper/src/doctor.js`) — probes Node, `.env`, the
      webhook (a GET, which posts nothing), both tokens, which gist it finds,
      where filters resolve from, and the state file. Read-only, always exits 0.
      Warns specifically about the half-configured token pair, which fails a
      real run outright.
- [x] `SETUP.md` — fork-and-run guide, token scoping, and an honest list of the
      rough edges a fork still hits
- [x] 6 new tests (110 total, up from 104); `oxlint` and `tsc -b` clean

**Verified end to end:** the disabled example exits 0 with onboarding text, and
an enabled filter with the webhook unset fails loudly on the strength of the
14 prior runs in the state file — both before any network request.

### The rule worth remembering

A missing webhook means two opposite things, and the state file settles which.
Extracted to `scraper/src/preflight.js` so it is a tested rule rather than a
condition buried in `main()`:

| Situation | Signal | Behaviour |
|---|---|---|
| Fresh install, nothing configured | no state, or `runs === 0` | exit 0, print onboarding |
| Worked before, secret now missing | state exists with `runs > 0` | fail loudly — this is a regression |

Getting it backwards is costly either way: exiting 0 on a real regression hides
a dark channel for as long as nobody looks at it, while failing on a fresh fork
mails its owner a failure every half hour until they switch the workflow off —
and then a configured one would not run either.

Stopping *without seeding* is also deliberate. State written by an
unconfigured run would baseline the market silently, so the first configured run
would have nothing to report.

**Behaviour change to know about:** with the committed filter disabled, a gist
read failure now falls through to *nothing to watch* instead of quietly running
the stale Polestar spec. That is the better failure — but it is a change.

Safe to do because the committed filter's id (`polestar2-lr-dm`) had never run:
the live filters in `data/seen.json` are gist UUIDs (`BMW 320 G20`,
`Polestar 2 Long Range Dual Motor`).

**Design note — fresh vs. broken.** A missing webhook means two different
things, and they must not behave the same:

| Situation | Signal | Behaviour |
|---|---|---|
| Fresh install, nothing configured | no state, or `runs === 0` | exit 0, print onboarding |
| Worked before, secret now missing | state exists with `runs > 0` | fail loudly — this is a regression |

Distinguishing them off the state file is what keeps a fresh fork's scheduled
runs quiet without hiding a real breakage for someone already running it.

**Behaviour change to know about:** with the committed filter disabled, a gist
read failure falls through to *nothing to watch* instead of quietly running the
stale Polestar spec. That is the better failure — but it is a change.

Safe to do because the committed filter's id (`polestar2-lr-dm`) has never run:
the live filters in `data/seen.json` are gist UUIDs (`BMW 320 G20`,
`Polestar 2 Long Range Dual Motor`).

---

## Phase 1 · Declarative ranges ✅

*The unlock. `filter.js`'s hardcoded car facets are the real blocker — not
nettiauto.*

`scraper/src/fields.js` and `src/listingFields.ts` hold the field declarations
and the generic range check. `filter.js` no longer names a single car fact, and
the filter editor's five hand-written inputs are now generated from the
declarations — a source carrying square metres and a room count gets the right
form with no change to the component.

An apartment-shaped filter (`sizeM2`, `rooms`, no car fields at all) runs
through the same `evaluate()`, and through the app's normalizer untouched.
There are tests for both.

Replace named numeric fields with a generic constraint bag:

```json
{ "source": "oikotie-rent",
  "search": { "region": "helsinki", "type": "apartment" },
  "ranges": { "rent": {"max": 1400}, "sizeM2": {"min": 55}, "rooms": {"min": 3} },
  "textMust": ["parveke"], "textMustNot": ["putkiremontti tulossa"] }
```

- [x] `ranges` in the scraper normalizer, keys sorted canonically
- [x] `yearFrom`/`yearTo`/`maxMileage`/`minPrice`/`maxPrice` read forever and
      folded into `ranges.*`; **the legacy spelling wins on conflict**, because
      only a bundle that has never heard of `ranges` writes one and not the other
- [x] Field declarations with `label`/`unit`/`style`, and `factOf` reading either
      a `facts` bag or the listing's own properties, so Phase 2 needs no change
      here
- [x] Polestar vocabulary moved onto the filter as `packageQualifiers`
      (`{ package, word, means }`) — same shape as `implications`. A
      compatibility default keeps filters already in the gist behaving
      identically; it is inert unless a filter asks for a package named `pilot`
- [x] `accentColour` reads its ceiling from `ranges.price.max`
- [x] 16 new tests (126 total)
- [x] `src/listingFields.ts` — the app's mirror of the declarations, plus the
      editor helpers (`rangeInputs`, `withRange`) and the summary formatter
- [x] `src/scraperFilters.ts` — same `ranges` normalization and the same
      legacy-wins rule; `toWire()` **mirrors both spellings on write** so a
      device on an older cached bundle still reads the limits instead of seeing
      a filter with none and pushing that back
- [x] `ScraperFilterDialog.tsx` — inputs generated from the declarations. A
      field can narrow itself to one end (`ends: ['max']` on the odometer), so
      the generated form came out identical to the one it replaced
- [x] `filterSync.ts` and *Copy all as JSON* both serialize through `toWire`
- [ ] **Deferred:** drop the compatibility default once the live filters carry
      their own qualifiers — the last car-specific thing left in the matcher

### Gap worth knowing about

**The frontend has no test harness.** The scraper has 130 tests; `src/` has
none, so the app-side normalizer was verified with a throwaway script (compile
the two modules standalone, assert on the round trip) rather than something that
runs in CI. It checked the two rules that matter — legacy-wins-on-conflict, and
an unknown field surviving the normalizer — and both hold. But nothing stops
them regressing.

Adding vitest is the obvious fix and a real dependency decision, so it is
flagged rather than taken. It gets more pressing at Phase 6, where the app grows
auth and a second transport.

Estimate was ~2 days; came in around that.

---

## Phase 2 · Source seam

*nettiauto becomes one adapter behind an interface.*

A source supplies: `id` (namespaces listing ids), `searchKey(filter)`,
`fetchAllListings(search)`, `fetchListingDetail(search, id)`, a field
declaration, a URL parser, presentation hints.

Listings normalize to a universal core (`id`, `sourceId`, `url`, `title`,
`image`, `price`, `location`, plus the two text tiers `structuredText`/`text`
the matcher already distinguishes) plus a `facts` bag.

The interface is **already right**: `fetchAllListings` returns normalized
listings, not HTML, so an API-backed source drops in as easily as an HTML one.

- [ ] `sources/` registry; extract nettiauto behind it with no behaviour change
- [ ] Per-host pacing — the pacer in `http.js` is module-global, so one slow
      site would throttle every other
- [ ] **Sink** made optional and pluggable. Source *and* sink are independent
      axes; a source declaring no sink gets filters and Discord posts, and
      reactions simply do nothing. This is what lets apartments ship without
      Phase 7.
- [ ] Source-supplied Discord presentation (labels, accent) — drop the fixed
      28k/32k price bands
- [ ] Source-aware reaction id recovery (`reactions.js` hardcodes a nettiauto
      URL regex)
- [ ] Rename the package off `carcalculator-scraper`

Estimate: ~5 days.

---

## Phase 3 · State behind a storage adapter

*Was "move state into the user's gist". Widened so the delivery model stays an
open question — see [the constraint](#the-delivery-model-constraint).*

`state.js` currently reads and writes one committed JSON file. Put that behind
an interface with three implementations: **local file** (today, and the
no-credential fallback), **gist** (per-user, for anyone holding their own
token), and later **hosted store** (for users who cannot).

- [ ] Storage interface: `load()` / `save()`, nothing else — `state.js`'s logic
      is already independent of where the bytes live
- [ ] Namespace listing ids as `sourceId:id`, VERSION 3 + migration
- [ ] Gist implementation; drop `contents: write`, the commit-back step and the
      push-rebase retry loop from the workflow when it is in use
- [ ] Key the gist lookup on a neutral marker, not `car-tco-data.json` — a pure
      apartment watcher has no calculator data to find
- [ ] Check the write ceiling first: **770 KB / 1027 listings** today. The
      `truncated` + `raw_url` read path already exists in `gist.js`; the write
      side needs verifying. If it is tight, that is an argument for the hosted
      store sooner rather than a bigger JSON file.

Why it matters regardless of delivery model: every fork that runs the watcher
diverges on `seen.json` on its first run and conflicts on every upstream pull,
forever. There are already 10 bot commits rewriting this file.

Estimate: ~1.5 days (one more indirection than the gist-only version).

---

## Phase 4 · Conformance suite

*What turns "add your own source" from aspiration into something safe.*

- [ ] One shared spec every adapter must pass: ids stable across runs, prices
      parsed, pagination terminates, detail merge, politeness honoured
- [ ] Split the 940-line fixture suite per source

Treat as required, not nice-to-have. Estimate: ~1–2 days.

---

## Phase 5 · Second source

*Proof it generalizes.*

- [ ] Check oikotie's terms of service **before building**
- [ ] Adapter for rentals (the simpler of the two shapes)

**Risk lives here.** Nettiauto is an unusually kind target: server-rendered,
with `data-datalayer` blobs and schema.org `ItemList` already typed. Oikotie is
a JS app backed by an internal JSON API with token requirements. Budget this as
reverse-engineering with a real chance of needing another approach.

Estimate: ~2–4 days.

---

## Phase 6 · Hosted, for people who cannot fork

**Decided 2026-08-30: build this.** One instance you run, so a user's whole
setup is *click a Discord invite, click one sign-in button, make filters*. No
token, no bot, no webhook, no fork.

### What the user never has to do again

Every one of these is a step the fork route required and this one removes:
create a GitHub account, fork a repo, enable Actions, create a classic PAT and
get its scope right, create a Discord webhook, create a Discord application,
enable a privileged gateway intent, paste three secrets.

### Work

- [ ] **Pick the stack** (open — see *decisions still needed*)
- [ ] Sign-in that is not a pasted PAT. The client secret cannot live in a
      static bundle, so this is the one thing that genuinely needs a server
      side, however thin.
- [ ] A per-user store: filters, notification target, and the watcher state from
      Phase 3 as its third implementation
- [ ] Per-user routing in the watcher: **one crawl, fanned out per user.** The
      grouping in `groupBySearch` already collapses filters over the same
      search; this widens it across users, which is what keeps the crawl cost
      flat as people join.
- [ ] Per-user post cap (`maxPostsPerRun` is global today) and a per-user
      filter-count cap
- [ ] A Discord server you own, one channel per person; decide whether channels
      are pre-made or a bot with *Manage Channels* creates them
- [ ] Reaction → calculator pickup has to resolve *whose* calculator
- [ ] Account deletion that actually deletes, and a retention window

The scheduler stays on GitHub Actions and stays free — only auth and storage
need a host.

### Decisions still needed

| Decision | Options | Note |
|---|---|---|
| Stack | Supabase (auth + Postgres + RLS, no backend code to write); Cloudflare Workers + D1; a small Node service | Supabase is the least new code by a wide margin — auth and per-user isolation come as configuration |
| Sign-in | email magic link; Google; GitHub OAuth | Magic link asks the least of a non-technical user |
| Car TCO data for accountless users | stays `localStorage`-only; or moves into the store alongside filters | Gist sync assumes a GitHub account, so it cannot be the answer here |
| Existing gist path | keep for you and technical users, or retire | Keeping it means two transports for filters |

### What you are taking on

You become the holder of other people's searches and budgets. In the EU that is
a real duty — deletion, retention, telling people what you keep — not a
formality. Worth doing deliberately rather than discovering later.

Estimate: ~1–2 weeks plus an ongoing hosting cost.

### Still true, and still cheap

Fork-per-user remains the right answer for a technical friend, and costs ~1 day
of documentation once Phase 3 lands. It is not deleted, just demoted from *the*
plan to *a* path.

### Rejected

**Shipping a shared write credential in the static app** so users need no
account at all. It hands that credential to everyone who opens the page.

---

## Phase 6b · Installable client (PWA)

*Recommended answer to "should this be a desktop and phone app?" — see below.*

- [ ] Web app manifest, icons, `display: standalone`
- [ ] Service worker for offline shell (the data is already local-first)
- [ ] Web push where the platform supports it, with Discord as the fallback that
      never stops working

Adds an installable icon on both desktop and phone with no new build pipeline —
a manifest and a service worker on the Vite build that already exists. Estimate:
~1–2 days.

### Why not native

**A phone app cannot be the watcher, so going native does not remove the
server.** iOS gives background work no guaranteed interval and would not
tolerate a 30-minute crawl; Android's periodic work is throttled by Doze and OEM
battery killers. And if every user's phone crawled, that is N crawls of the same
pages — the impolite architecture, worse than forks. The crawl stays server-side
whatever the client is, so native would sit *on top of* Phase 6, not instead of
it.

What native would genuinely add over a PWA is **reliable push**: web push works
on Android and desktop, but on iOS only after the user adds the site to their
home screen, and it breaks if they remove it. That is the one real gap — and
with the Discord channel carrying notifications anyway, it is an upgrade rather
than a dependency.

What it would cost: two build targets, app-store review on every change, an
Apple Developer account and a Mac, and signing in CI. Instant updates are worth
a lot right now specifically because several schema migrations are still ahead.

There is also a **content-rights risk** that is much sharper in a store than in
a private web app used by a few people: an app whose value is redistributing
nettiauto and oikotie listings invites exactly the "you do not own this content"
objection.

**Parked, with the conditions that would revive it:** iOS push friction turns
out to be what actually blocks real users, or store distribution becomes a goal.
Capacitor can wrap this same codebase later with little rework, so choosing the
PWA now does not close the door.

---

## Phase 7 · Asset-agnostic TCO (optional)

Apartments need maintenance fee, transfer tax and appreciation where cars have
depreciation. Touches `calc.ts`, `CarForm.tsx` (533 lines),
`ComparisonTable.tsx`, `types.ts` and make-based filtering.

Deliberately out of scope until the watcher side proves out. Estimate:
~1–2 weeks.

---

## Log

- **2026-08-30** — Analysis done, plan written. Baseline: 104 scraper tests
  pass, no network.
- **2026-08-30** — **Phase 0 done.** Committed example disabled; unconfigured
  runs stop early with guidance instead of failing mid-crawl; `npm run doctor`
  added; `SETUP.md` written; READMEs updated. New files:
  `scraper/src/doctor.js`, `scraper/src/preflight.js`, `SETUP.md`, `PLAN.md`.
  110 tests pass, lint and typecheck clean. Nothing committed to git yet.
- **2026-08-30** — **Phase 1 done.** `fields.js` + `listingFields.ts`; `filter.js`
  no longer names a car fact; package vocabulary moved onto the filter; the
  filter editor generates its numeric inputs. 130 scraper tests, app build and
  lint clean. Frontend still has no test harness — see the gap note in Phase 1.
- **2026-08-30** — **Hosting chosen** (Phase 6, Tier 2). Fork-per-user stays
  documented as the technical-friend path but is no longer the plan. Re-sequenced
  to 1 → 2 → 3 → 6 → 4 → 5. Stack still to pick; Supabase is the current
  front-runner on least-new-code grounds.
- **2026-08-30** — **Delivery model reopened.** Fork-per-user does not reach a
  non-programmer, so Phase 6 is parked pending a call and Phase 3 was widened to
  a storage adapter rather than "the gist". The finding worth keeping: a static
  app cannot write per-user data without either the user's own credential or a
  server, so non-technical multi-user needs a server. Phases 1–5 unaffected.
- Earlier findings:
  - The local `.env` has the webhook but neither token —
    `GIST_TOKEN` and `DISCORD_BOT_TOKEN` live only as CI secrets. So local runs
    have always used `filters.json`, never the gist. Worth knowing before
    Phase 1 touches the filter shape, since the gist copy is the one that
    matters and it can only be exercised in CI or by adding the token locally.
