// Adding reacted cars to the Car TCO calculator's synced data.
//
// The calculator (repo root) syncs its data to a secret gist holding
// car-tco-data.json; every device pulls it on load and tab focus. Appending a
// car there is all it takes for it to appear in the app - no frontend changes.
//
// Two contracts to honour, both defined by src/sync.ts and src/storage.ts in
// the repo root:
//
//  - The envelope is { app, savedAt, data } and the app applies remote data
//    only when its savedAt is NEWER than the device's last local edit. So a
//    stamp that is not current would make the app ignore the write forever.
//  - The app is last-write-wins: a device holding older local edits will push
//    its own data over ours. The caller handles that by verifying cars are
//    still present on later runs and re-adding them (see index.js).

import config from './config.js';

const API = 'https://api.github.com';

async function github(path, init = {}) {
  const token = config.tco.gistToken;
  if (!token) {
    throw new Error('No GitHub gist token configured. Set GIST_TOKEN (see README.md).');
  }
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'nettiauto-watch (carcalculator)',
      ...init.headers,
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('GitHub rejected the gist token - it needs the "gist" scope.');
  }
  if (!response.ok) throw new Error(`GitHub API error ${response.status} for ${path}`);
  return response;
}

/** Find the calculator's gist by its data file, exactly like the app does. */
export async function findTcoGist() {
  const filename = config.tco.gistFilename;
  const response = await github('/gists?per_page=100');
  const gists = await response.json();
  const match = Array.isArray(gists)
    ? gists.find((gist) => gist.files && filename in gist.files)
    : null;
  if (!match) {
    throw new Error(
      `No gist with ${filename} on this account. Connect the app to GitHub sync ` +
        'first (cloud button in the header) - the scraper joins an existing sync, ' +
        'it does not start one.',
    );
  }
  return match.id;
}

export async function readTcoData(gistId) {
  const filename = config.tco.gistFilename;
  const response = await github(`/gists/${gistId}`);
  const gist = await response.json();
  const file = gist.files?.[filename];
  if (!file) throw new Error(`Gist ${gistId} no longer has ${filename}.`);
  let content = file.content ?? '';
  if (file.truncated && file.raw_url) {
    content = await (await fetch(file.raw_url)).text();
  }
  const parsed = JSON.parse(content);
  if (!parsed || typeof parsed !== 'object' || !parsed.data || !Array.isArray(parsed.data.cars)) {
    throw new Error('The gist data does not look like calculator data; refusing to write over it.');
  }
  return parsed;
}

export async function writeTcoData(gistId, envelope) {
  await github(`/gists/${gistId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      files: { [config.tco.gistFilename]: { content: `${JSON.stringify(envelope, null, 2)}\n` } },
    }),
  });
}

/** Short name for the comparison table, e.g. "Polestar 2 LR DM 2022 · 67 tkm". */
export function carName(listing) {
  const variant = /performance/i.test(listing.subTitle ?? '')
    ? 'LR DM Perf'
    : 'LR DM';
  const km =
    listing.mileage === null ? '' : ` · ${Math.round(listing.mileage / 1000)} tkm`;
  return `Polestar 2 ${variant} ${listing.year ?? ''}${km}`.replace(/\s+/g, ' ').trim();
}

/**
 * Shape a scraped listing into the app's CarListing (see src/types.ts).
 *
 * Every field the app knows must be present: its normalizeCar() would fill
 * gaps with defaults, but writing the full shape keeps this file honest about
 * what the app expects.
 */
export function toCarListing(listing, { now = new Date() } = {}) {
  const defaults = config.tco.carDefaults;
  const noteLines = [
    listing.url,
    [listing.subTitle, listing.color, listing.location].filter(Boolean).join(' · '),
    'Lisätty Discord-reaktiosta.',
  ].filter(Boolean);

  return {
    // Derived from the nettiauto id: stable across runs, so the same reaction
    // can never create a duplicate, and recognisable as scraper-made.
    id: `nettiauto-${listing.id}`,
    name: carName(listing),
    notes: noteLines.join('\n'),
    powertrain: defaults.powertrain,
    purchasePrice: listing.price ?? 0,
    odometerKm: listing.mileage ?? 0,
    autoResale: defaults.autoResale,
    expectedResaleValue: 0,
    financing: { ...defaults.financing },
    // Unused for an EV but part of the shape.
    fuelLPer100: 6.5,
    elecKwhPer100: defaults.elecKwhPer100,
    electricSharePct: 100,
    insurancePerYear: defaults.insurancePerYear,
    taxPerYear: defaults.taxPerYear,
    maintenancePerYear: defaults.maintenancePerYear,
    tiresPerYear: defaults.tiresPerYear,
    otherPerYear: defaults.otherPerYear,
    createdAt: now.toISOString(),
  };
}

/**
 * Append cars to the calculator, skipping any already present.
 *
 * Read-modify-write in one motion to keep the race window with a live app
 * session small. `savedAt` is stamped with the current time so every device
 * treats this as the newest edit and pulls it in.
 */
export async function addCarsToTco(listings, { now = new Date() } = {}) {
  if (listings.length === 0) return { added: [], skipped: [] };

  const gistId = await findTcoGist();
  const envelope = await readTcoData(gistId);
  const existingIds = new Set(envelope.data.cars.map((car) => car.id));

  const added = [];
  const skipped = [];
  for (const listing of listings) {
    const car = toCarListing(listing, { now });
    if (existingIds.has(car.id)) {
      skipped.push(listing.id);
      continue;
    }
    envelope.data.cars.push(car);
    existingIds.add(car.id);
    added.push(listing.id);
  }

  if (added.length > 0) {
    envelope.app = envelope.app ?? 'carcalculator';
    envelope.savedAt = now.toISOString();
    await writeTcoData(gistId, envelope);
  }

  return { added, skipped };
}
