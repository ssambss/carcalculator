# Car TCO

A total-cost-of-ownership calculator for comparing car purchase candidates —
built to be used at home and at the dealership (works well on a phone).

Each car gets a listing with purchase price, expected resale value, financing
(cash, or an annuity loan with optional balloon payment), energy use
(petrol / diesel / EV / plug-in hybrid) and yearly costs. The app boils it all
down to **€ / month**, **€ / km** and a total over the ownership period, with a
color-coded cost breakdown and a side-by-side comparison table.

- Data lives in the browser's `localStorage` by default — nothing is sent
  anywhere. Use **Export** to download a JSON backup, **Import** to restore.
- Optional **GitHub sync** (cloud button in the header): the app auto-syncs
  your data to a private gist on your GitHub account, so it survives browser
  resets and follows you between phone and desktop. Setup: create a classic
  GitHub token with only the `gist` scope (the dialog links to a prefilled
  token page) and paste it in once per device. Sync is last-write-wins by
  edit time; the app pulls on load and on tab focus, and pushes a couple of
  seconds after each change.
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

[scraper/](scraper/) holds an unrelated companion: a Node script that watches
nettiauto.com for used cars matching a spec (currently a Polestar 2, 2021–2023,
under 120 000 km, Long Range Dual Motor with the Pilot and Plus packages) and
posts new listings to a Discord channel.

It is deliberately independent of the calculator — its own folder, no
dependencies, no shared code, and nothing the Vite build touches. See
[scraper/README.md](scraper/README.md).
