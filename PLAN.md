# Generalization plan

Turning this repo from *one person's car watcher* into (1) something anyone can
fork and run on their own data, and (2) a watcher whose **source** is a
pluggable module, so it can follow apartments, rentals or anything else with
listing pages.

> **Where we stand:** Phase 0 done — the repo is safe to hand to someone else.
> Next up is Phase 1, the change that stops `filter.js` being about cars.
> 110 scraper tests pass, no network. Last updated 2026-08-30.

| Phase | What it buys | Status |
|---|---|---|
| [0 · Hygiene](#phase-0--hygiene) | The repo is safe to hand to someone else | ✅ done |
| [1 · Declarative ranges](#phase-1--declarative-ranges) | `filter.js` stops being about cars | ⬜ next |
| [2 · Source seam](#phase-2--source-seam) | nettiauto becomes one adapter of many | ⬜ not started |
| [3 · State per tenant](#phase-3--state-per-tenant) | Forks stop conflicting; state is per-user | ⬜ not started |
| [4 · Conformance suite](#phase-4--conformance-suite) | A stranger can add a source safely | ⬜ not started |
| [5 · Second source](#phase-5--second-source) | Proof it generalizes (oikotie) | ⬜ not started |
| [6 · Fork & share](#phase-6--fork--share) | Other people actually running it | ⬜ not started |
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

**The gist is the tenant.** One secret gist per user, holding N files found by
the same lookup: `car-tco-data.json` (cars), `car-tco-filters.json` (filters),
and — after Phase 3 — the watcher's own state. Multi-tenancy needs no server
and no shared trust; it falls out of everyone pointing at their own gist.

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

## Phase 1 · Declarative ranges

*The unlock. `filter.js`'s hardcoded car facets are the real blocker — not
nettiauto.*

Replace named numeric fields with a generic constraint bag:

```json
{ "source": "oikotie-rent",
  "search": { "region": "helsinki", "type": "apartment" },
  "ranges": { "rent": {"max": 1400}, "sizeM2": {"min": 55}, "rooms": {"min": 3} },
  "textMust": ["parveke"], "textMustNot": ["putkiremontti tulossa"] }
```

- [ ] `ranges` in both normalizers (`scraper/src/filters.js`, `src/scraperFilters.ts`)
- [ ] Migrate `yearFrom`/`yearTo`/`maxMileage`/`minPrice`/`maxPrice` → `ranges.*`,
      reading the old shape forever (the gist is hand-edited)
- [ ] Sources declare their fields: `{ key, label, unit, range }`
- [ ] Move the Polestar vocabulary (`LESSER_VARIANT`, `FEATURE_NOT_PACKAGE`) off
      the module and onto the filter — same shape as `implications`, which
      already lives there
- [ ] Tests

Estimate: ~2 days. Knocks out the car-named fields, the Discord labels and the
hardcoded filter form in one move.

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

## Phase 3 · State per tenant

*One change that fixes multi-tenancy and fork friction together.*

Move `scraper/data/seen.json` into the user's gist as a third file.

- [ ] Namespace listing ids as `sourceId:id`, VERSION 3 + migration
- [ ] Read/write state via the gist, local file as the no-token fallback
- [ ] Drop `contents: write`, the commit-back step and the push-rebase retry
      loop from the workflow
- [ ] Key the gist lookup on a neutral marker, not `car-tco-data.json` — a pure
      apartment watcher has no calculator data to find
- [ ] Check the write ceiling first: the file is **770 KB / 1027 listings**
      today. The `truncated` + `raw_url` read path already exists in `gist.js`;
      the write side needs verifying.

Why it matters: every fork that runs the watcher diverges on `seen.json` on its
first run and conflicts on every upstream pull, forever. There are already 10
bot commits rewriting this file.

Estimate: ~1 day plus the ceiling check.

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

## Phase 6 · Fork & share

*Recommended shape: fork-per-user. No server, no shared trust, their Actions
minutes are their own.*

- [ ] Fork-and-run instructions, upstream-sync guidance
- [ ] Verify a clean fork end to end with fresh secrets

**Rejected:** a shared hosted instance. Needs a server, a per-user secret
store, per-user Discord routing, and holding other people's GitHub tokens — it
trades away everything that makes this cheap.

**Middle option** if it is 2–5 people you know: one repo, the watcher loops
over tenants with `GIST_TOKEN_ALICE`-style secrets. You would hold their tokens
and their state, and secrets do not scale past a handful.

Estimate: ~1 day once Phases 0 and 3 are done.

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
  - Found along the way: the local `.env` has the webhook but neither token —
    `GIST_TOKEN` and `DISCORD_BOT_TOKEN` live only as CI secrets. So local runs
    have always used `filters.json`, never the gist. Worth knowing before
    Phase 1 touches the filter shape, since the gist copy is the one that
    matters and it can only be exercised in CI or by adding the token locally.
