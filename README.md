# Car TCO

A total-cost-of-ownership calculator for comparing the cars you might buy or
lease — built to be used at home and at the dealership (works well on a phone).

Running your own copy — the app, sync and the listing watcher, with your data
and your searches — is [SETUP.md](SETUP.md). Where the project is headed
(making the watcher's source pluggable so it can follow apartments or rentals,
and hosting it so people who do not write software can use it) is
[PLAN.md](PLAN.md).

Each car gets a listing with purchase price, expected resale value, financing
(cash, an annuity loan with optional balloon payment, or a lease), energy use
(petrol / diesel / EV / plug-in hybrid) and yearly costs. The app boils it all
down to **€ / month**, **€ / km** and a total over the ownership period, with a
color-coded cost breakdown and a side-by-side comparison table.

- **Leasing** is the third way to pay for a car, next to cash and a loan:
  monthly rate, term, payment at signing, mileage allowance and the
  excess-kilometre fee, plus toggles for whatever the price already covers
  (insurance, vehicle tax, maintenance, tires) so those are not counted twice.
  A lease is handed back, so it has no depreciation and no resale value to
  estimate — the contract gets its own cost category instead, and the purchase
  fields disappear from the form. Where the ownership period outlasts the
  contract the cost assumes you lease again on the same terms, with the signing
  payment charged once per term started; that keeps a 36-month lease comparable
  with a car kept for five years instead of making its last two years free.
- Data lives in the browser's `localStorage` by default — nothing is sent
  anywhere. Use **Export** to download a JSON backup, **Import** to restore.
- Optional **GitHub sync** (cloud button in the header): the app auto-syncs
  your data to a private gist on your GitHub account, so it survives browser
  resets and follows you between phone and desktop. Setup: create a classic
  GitHub token with only the `gist` scope (the dialog links to a prefilled
  token page) and paste it in once per device. Sync is last-write-wins by
  edit time; the app pulls on load and on tab focus, and pushes a couple of
  seconds after each change. Sync merges **per car** (with deletion
  tombstones), so several devices — and external writers like a bot adding
  cars to the gist — can write concurrently without overwriting each other.
- View-only sharing: the sync dialog offers a `?view=<gist-id>` link that
  renders the data read-only with no GitHub account or token — it reads the
  gist unauthenticated (secret gists are unlisted but readable by id, so
  treat the link itself as the access key).
- Filtering: search across name/notes, a make dropdown (derived from the
  first word of the car's name), powertrain chips, a synced ★ favorites
  shortlist, and per-card selection with a "Selected only" toggle. Filters
  narrow the cards, legend, lowest-cost badge and the comparison table
  together; selection is device-local while favorites travel with the data.
- **Scraper filters** (funnel button in the header): the saved searches the
  listing watcher runs, editable here — make and model (paste any nettiauto
  link and it fills both), year, odometer and price limits, phrases the advert
  must or must not contain, and required option packages. They sync to their
  own file in the same gist (`car-tco-filters.json`), so a filter made on a
  phone is live on the watcher's next run, with no commit and no deploy.
  *Paste JSON* / *Copy all as JSON* move filters in and out without retyping —
  the format is the same one `scraper/filters.json` uses.
  Deliberately *not* part of the car-data file: the app rewrites that
  wholesale on every edit, so a device on an older cached bundle would strip a
  key it has never heard of.
- **Per-car comparison period**: each car can override the shared ownership
  assumption (an 18-month lease vs a purchase kept for six years). €/month and
  €/km stay comparable across periods; absolute totals are shown over each
  car's own period and lose the lowest-value highlight when periods differ.
  A loan longer than the period only counts the interest accrued by then.
  When periods differ, the comparison table offers a **Same period** toggle
  that recomputes every car over the shortest window (early-exit depreciation,
  accrued interest and lease terms included) so totals compare directly —
  note that a manually entered resale value is not re-estimated for the
  shorter window, so auto-estimated cars normalize more faithfully.
- **Out of pocket / mo** (cards, table, form previews): the loan or lease
  payment plus running costs — what actually leaves the account each month
  during the term. The budget line, distinct from the economic €/month,
  which nets out resale value and only counts interest and depreciation.
- Light "paper ledger" and dark "night cockpit" themes; the toggle remembers
  your choice, defaulting to the OS preference.
- Number inputs accept both comma and dot decimals.

## Development

```
npm install
npm run dev      # dev server at http://localhost:5173
npm run build    # type-check + production build into dist/
npm run lint     # oxlint
```

The design mockups (Claude Design canvas) live in [design/](design/) —
open `design/car-tco-design.html` in a browser to view them.

## Deploying to GitHub Pages

The repo ships a workflow ([.github/workflows/deploy.yml](.github/workflows/deploy.yml))
that builds and deploys on every push to `main`.

One-time setup:

1. Create a GitHub repository and push this project to its `main` branch.
2. In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.

After that, every push to `main` publishes the app at
`https://<username>.github.io/<repo>/` (Vite is configured with a relative
base so any repo name works).

## Listing watcher (separate tool)

[scraper/](scraper/) holds a companion: a Node script that watches listing sites
for things matching your filters and posts anything new to a Discord channel.
React to a post there and the car appears in this calculator.

Which site a filter reads is its **source** — an adapter under
[scraper/src/sources/](scraper/src/sources/). `nettiauto` is the only one so
far; nothing outside that folder names a site, so following flats or rentals
means writing another adapter rather than changing the watcher.

It runs any number of filters — the ones you make in the app, with
[scraper/filters.json](scraper/filters.json) as the committed fallback. That
file ships **disabled**: the spec in it (a Polestar 2, 2021–2023, under
120 000 km, Long Range Dual Motor with the Pilot and Plus packages) is a
template and the worked example the matching rules are documented against, not
a car a fresh fork should start watching on its owner's behalf.

`cd scraper && npm run doctor` reports which secrets are set and what each one
unlocks, without posting or saving anything.

The code stays independent of the calculator — its own folder, no dependencies,
no shared code, and nothing the Vite build touches. The only thing the two
share is the shape of a filter: [src/scraperFilters.ts](src/scraperFilters.ts)
writes it, [scraper/src/filters.js](scraper/src/filters.js) reads it, and each
normalises it without trusting the other. The numeric fields a filter can bound
travel the same way — [src/listingFields.ts](src/listingFields.ts) mirrors the
source's own declarations, so the filter editor builds its inputs from them
rather than hardcoding year, odometer and price. See
[scraper/README.md](scraper/README.md).
