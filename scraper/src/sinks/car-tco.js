// Sink: a reacted listing becomes a car in the Car TCO calculator.
//
// A *sink* is where a listing goes when someone reacts to it in Discord. It is
// a different axis from the source: nettiauto listings land here because they
// are cars, and a source watching flats declares no sink at all, so reactions
// on its posts simply do nothing. That is what lets a new source ship without
// a second calculator existing first.
//
// Appending to the gist is all it takes for a car to appear in the app - no
// frontend changes. The app is last-write-wins, so the caller verifies cars are
// still present on later runs and re-adds them (see index.js and
// state.needsTcoAdd).

import config from '../config.js';
import { findTcoGist, readTcoData, writeTcoData } from '../gist.js';

/**
 * Segments of a variant name that are pure measurements.
 *
 * Sellers pad the variant with the same figures the card already shows
 * ("78 kWh, Long Range Dual Motor, 300kW, 78kWh"), and those add nothing to a
 * name that has to fit in a table column.
 */
const UNIT = /^(kwh|kw|wh|hv|hp|ps|nm|kg|km)$/i;
const NUMBER_WITH_UNIT = /^[\d.,]+(kwh|kw|wh|hv|hp|ps|nm|kg|km)$/i;

/**
 * Drop the figures, keep the words.
 *
 * "78 kWh" and "300kW" go; "2.0" in "2.0 TDI" stays, because a bare number
 * with no unit after it is part of the variant's name, not a measurement.
 */
function stripMeasurements(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const kept = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (NUMBER_WITH_UNIT.test(word) || UNIT.test(word)) continue;
    if (/^[\d.,]+$/.test(word) && words[index + 1] && UNIT.test(words[index + 1])) {
      index += 1;
      continue;
    }
    kept.push(word);
  }
  return kept.join(' ');
}

/**
 * The part of the variant name worth keeping, e.g. "Long Range Dual Motor".
 *
 * Only up to the first separator: sellers put the variant first and the
 * equipment list after a comma or slash, and "Pilot- ja Plus-pkt." is not part
 * of what the car is called.
 */
export function variantHint(subTitle, limit = 40) {
  const hint = (subTitle ?? '')
    .split(/[,/|]/)
    .map((part) => stripMeasurements(part.trim()))
    .find((part) => part) ?? '';
  // Cut on a word boundary rather than mid-word.
  return hint.length > limit ? hint.slice(0, limit).replace(/\s+\S*$/, '') : hint;
}

/** Name for the comparison table, e.g. "Polestar 2 Long Range Dual Motor 2022 · 67 tkm". */
export function carName(listing) {
  const km =
    listing.mileage === null ? '' : ` · ${Math.round(listing.mileage / 1000)} tkm`;
  const parts = [listing.title || 'Auto', variantHint(listing.subTitle), listing.year ?? ''];
  return `${parts.filter(Boolean).join(' ')}${km}`.replace(/\s+/g, ' ').trim();
}

/**
 * The app's powertrain for a listing, from what nettiauto says it burns.
 *
 * Now that a filter can watch any car, this can no longer be assumed: an
 * electric default on a diesel would quietly compute the wrong running cost.
 * A non-plug hybrid maps to petrol, which is what it is fuelled with - the
 * calculator has no separate type for it.
 */
export function powertrainOf(listing, fallback = config.tco.carDefaults.powertrain) {
  const fuel = `${listing.fuelType ?? ''} ${listing.subTitle ?? ''}`;
  if (/lataushybrid|plug|phev/i.test(fuel)) return 'phev';
  if (/hybrid/i.test(fuel)) return 'petrol';
  if (/sähkö|sahko|electric/i.test(fuel)) return 'ev';
  if (/diesel/i.test(fuel)) return 'diesel';
  if (/bensiini|bensa|petrol|gasoline/i.test(fuel)) return 'petrol';
  return fallback;
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

  const powertrain = powertrainOf(listing);

  return {
    // Derived from the nettiauto id: stable across runs, so the same reaction
    // can never create a duplicate, and recognisable as scraper-made.
    id: `nettiauto-${listing.id}`,
    name: carName(listing),
    notes: noteLines.join('\n'),
    // The shortlist is the user's to curate; nothing arrives starred.
    favorite: false,
    powertrain,
    purchasePrice: listing.price ?? 0,
    odometerKm: listing.mileage ?? 0,
    autoResale: defaults.autoResale,
    expectedResaleValue: 0,
    financing: { ...defaults.financing },
    // One of these two is idle, depending on the powertrain above.
    fuelLPer100: defaults.fuelLPer100,
    elecKwhPer100: defaults.elecKwhPer100,
    // A plug-in hybrid's split is a guess either way; an EV's is not.
    electricSharePct: powertrain === 'ev' ? 100 : 50,
    insurancePerYear: defaults.insurancePerYear,
    taxPerYear: defaults.taxPerYear,
    maintenancePerYear: defaults.maintenancePerYear,
    tiresPerYear: defaults.tiresPerYear,
    otherPerYear: defaults.otherPerYear,
    createdAt: now.toISOString(),
    // The app merges per car on this stamp; a fresh car is as new as it gets.
    updatedAt: now.toISOString(),
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
