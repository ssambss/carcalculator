// Sink: a reacted listing becomes a car in the Car TCO calculator - and a card
// whose advert has come down leaves it again (see cleanup.js).
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
import { findTcoGist, readGistFile, readTcoData, writeTcoData } from '../gist.js';

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
 * The financing baseline a new car should arrive on: this person's own.
 *
 * Read from `settings.newCar` in their own calculator data, which is where the
 * app's Assumptions panel writes it. The watcher runs for several people, and a
 * rate and term hardcoded here would have put one person's assumptions about
 * borrowing into everybody else's calculator - defensible as a starting point,
 * but not something to decide on their behalf.
 *
 * Falls back field by field to src/config.js, so somebody whose app predates the
 * setting still gets a sensible car rather than a car financed at 0 % over 0
 * months, and with insurance and tax at a typical year rather than at nothing.
 */
export function newCarDefaults(envelope) {
  const base = config.tco.carDefaults;
  const theirs = envelope?.data?.settings?.newCar;
  if (!theirs || typeof theirs !== 'object') return base;

  const number = (value, fallback) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

  return {
    ...base,
    elecKwhPer100: number(theirs.elecKwhPer100, base.elecKwhPer100),
    fuelLPer100: number(theirs.fuelLPer100, base.fuelLPer100),
    insurancePerYear: number(theirs.insurancePerYear, base.insurancePerYear),
    taxPerYear: number(theirs.taxPerYear, base.taxPerYear),
    maintenancePerYear: number(theirs.maintenancePerYear, base.maintenancePerYear),
    tiresPerYear: number(theirs.tiresPerYear, base.tiresPerYear),
    otherPerYear: number(theirs.otherPerYear, base.otherPerYear),
    financing: {
      ...base.financing,
      downPayment: number(theirs.downPayment, base.financing.downPayment),
      annualRatePct: number(theirs.annualRatePct, base.financing.annualRatePct),
      // A term of zero would divide by nothing in the app's annuity.
      termMonths: number(theirs.termMonths, base.financing.termMonths) || base.financing.termMonths,
    },
  };
}

/**
 * Shape a scraped listing into the app's CarListing (see src/types.ts).
 *
 * Every field the app knows must be present: its normalizeCar() would fill
 * gaps with defaults, but writing the full shape keeps this file honest about
 * what the app expects.
 */
export function toCarListing(listing, { now = new Date(), defaults = config.tco.carDefaults } = {}) {
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
    year: listing.year ?? 0,
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
export async function addCarsToTco(listings, { now = new Date(), token } = {}) {
  if (listings.length === 0) return { added: [], skipped: [] };

  const gistId = await findTcoGist(token);
  const envelope = await readTcoData(gistId, token);
  const existingIds = new Set(envelope.data.cars.map((car) => car.id));
  // Their own baseline, out of their own data - see newCarDefaults().
  const defaults = newCarDefaults(envelope);

  const added = [];
  const skipped = [];
  for (const listing of listings) {
    const car = toCarListing(listing, { now, defaults });
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
    await writeTcoData(gistId, envelope, token);
  }

  return { added, skipped };
}

const URL_RE = /https?:\/\/[^\s<>"']+/i;

/**
 * The advert a card came from: the first web address in its notes.
 *
 * The same rule as the app's "Open advert" link (src/advert.ts in the repo
 * root), so the advert checked is the one the card links to - whether the
 * watcher wrote it there or it was pasted in by hand.
 */
export function advertUrlOf(notes) {
  const match = URL_RE.exec(notes ?? '');
  // Prose around a link ends it with punctuation that is not part of it.
  return match ? match[0].replace(/[.,;:!?)\]]+$/, '') : null;
}

/** The calculator's cards that link to an advert, as the cleanup needs them. */
export async function linkedCards({ token } = {}) {
  const gistId = await findTcoGist(token);
  // Somebody whose gist holds only filters has never connected the calculator,
  // and a file in a shape this does not know is not one to delete from: either
  // way, no cards.
  const envelope = await readGistFile(gistId, config.tco.gistFilename, token);
  const cars = Array.isArray(envelope?.data?.cars) ? envelope.data.cars : [];
  return cars
    .map((car) => ({
      id: car.id,
      name: car.name || 'Auto',
      url: advertUrlOf(car.notes),
      favorite: Boolean(car.favorite),
      price: typeof car.purchasePrice === 'number' && car.purchasePrice > 0 ? car.purchasePrice : null,
      updatedAt: car.updatedAt ?? null,
    }))
    .filter((card) => card.url);
}

/**
 * Delete cards from the calculator, leaving a tombstone for each.
 *
 * The tombstone is what makes it stick. The app merges per car, and a phone
 * still holding the card would otherwise push it straight back on its next
 * sync; with one, the merge drops the card everywhere - unless somebody edits
 * it after the deletion, which the app takes as wanting it back.
 *
 * Read again right before the write, as late as possible, and a card edited
 * since it was looked at is left alone: whoever is working on it now has the
 * better claim than a check made a minute ago.
 */
export async function removeCarsFromTco(cards, { now = new Date(), token } = {}) {
  if (cards.length === 0) return { removed: [] };

  const gistId = await findTcoGist(token);
  const envelope = await readTcoData(gistId, token);
  const wanted = new Map(cards.map((card) => [card.id, card]));
  const removed = [];
  envelope.data.cars = envelope.data.cars.filter((car) => {
    const card = wanted.get(car.id);
    if (!card || (car.updatedAt ?? null) !== card.updatedAt) return true;
    removed.push(car.id);
    return false;
  });

  if (removed.length > 0) {
    const stamp = now.toISOString();
    const tombstones = { ...envelope.data.tombstones };
    for (const id of removed) tombstones[id] = stamp;
    // In the app's own order, so its next merge has nothing to rewrite.
    envelope.data.tombstones = Object.fromEntries(
      Object.keys(tombstones)
        .sort()
        .map((id) => [id, tombstones[id]]),
    );
    envelope.app = envelope.app ?? 'carcalculator';
    envelope.savedAt = stamp;
    await writeTcoData(gistId, envelope, token);
  }

  return { removed };
}

/** Under Discord's 2 000 characters, and under announceText's own 1 900 clamp. */
const MESSAGE_BUDGET = 1900;

const EUR = new Intl.NumberFormat('fi-FI', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

/**
 * The line posted to the channel when reacted cars land in the calculator.
 *
 * A reaction used to be silent: the car turned up in the app on its next sync
 * and nothing said it had. The only way to know was to open the app and look.
 * So each car is named exactly as its card will be, and priced, and the app
 * is linked. Finnish, like the listing posts it answers.
 *
 * Links are in <angle brackets> so Discord does not unfurl each one into a
 * second copy of the listing that is already in the channel.
 */
export function addedMessage(
  listings,
  { appUrl = config.tco.appUrl, budget = MESSAGE_BUDGET } = {},
) {
  const described = (listing) => {
    const price = listing.price === null ? '' : ` · ${EUR.format(listing.price)}`;
    return `${carName(listing)}${price}`;
  };
  const linked = (listing) => `${described(listing)} · <${listing.url}>`;
  const open = appUrl ? `\nAvaa laskuri: <${appUrl}>` : '';
  if (listings.length === 1) return `🧮 **Lisätty laskuriin:** ${linked(listings[0])}${open}`;

  const head = `🧮 **Lisätty laskuriin ${listings.length} autoa:**`;
  return fitList(head, listings, { linked, described, tail: open, budget });
}

/**
 * A heading and a line per car, in one message.
 *
 * When the links would push it past Discord's limit they go first: each car's
 * listing post is in the channel above, and its card carries the link in its
 * notes. Only a run with dozens at once is cut short, and it says how many it
 * left out.
 */
function fitList(head, items, { linked, described, tail = '', budget }) {
  for (const line of [linked, described]) {
    const text = [head, ...items.map((item) => `• ${line(item)}`)].join('\n') + tail;
    if (text.length <= budget) return text;
  }
  const lines = [];
  let used = head.length + tail.length + '\n…ja 999 muuta'.length;
  for (const item of items) {
    const next = `• ${described(item)}`;
    if (used + next.length + 1 > budget) break;
    lines.push(next);
    used += next.length + 1;
  }
  return [head, ...lines, `…ja ${items.length - lines.length} muuta`].join('\n') + tail;
}

/** "Polestar 2 … · 27 790 €" - a card as the app shows it, by its own name. */
function describeCard(card) {
  const price = card.price === null ? '' : ` · ${EUR.format(card.price)}`;
  return `${card.name}${price}`;
}

const linkCard = (card) => `${describeCard(card)} · <${card.url}>`;

/**
 * The line posted when cards are cleared away because their adverts came down.
 *
 * Deleting somebody's cards without a word would be the quiet kind of
 * automation that makes people stop trusting the calculator. Named as the
 * cards were, so they can be recognised, and linked, so anyone who doubts it
 * can open the advert and see it marked removed.
 */
export function removedMessage(cards, { budget = MESSAGE_BUDGET } = {}) {
  if (cards.length === 1) {
    return `🧹 **Poistettu laskurista, ilmoitus poistunut:** ${linkCard(cards[0])}`;
  }
  const head = `🧹 **Poistettu laskurista ${cards.length} autoa, ilmoitukset poistuneet:**`;
  return fitList(head, cards, { linked: linkCard, described: describeCard, budget });
}

/** A starred card stays in the calculator, but its advert going is still news. */
export function keptMessage(cards, { budget = MESSAGE_BUDGET } = {}) {
  if (cards.length === 1) {
    return (
      '⭐ **Tähdellä merkityn auton ilmoitus on poistunut, kortti jäi laskuriin:** ' +
      linkCard(cards[0])
    );
  }
  const head =
    `⭐ **${cards.length} tähdellä merkityn auton ilmoitus on poistunut, ` +
    'kortit jäivät laskuriin:**';
  return fitList(head, cards, { linked: linkCard, described: describeCard, budget });
}
