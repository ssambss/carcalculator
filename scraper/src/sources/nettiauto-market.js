// How a car listing's asking price sits against similar ones in the market
// record - the line a post carries under its price.
//
// A port of checkPrice in the app's src/market.ts, which shares no code with
// the watcher by design (no dependency, no build step between them). The two
// must agree - a post and the card it becomes should not tell different
// stories - so a change to one is a change to both, and both test suites pin
// the same cases. Car-specific (fuel, battery, drive), so it lives with the
// car source rather than in the generic posting code.

import { hashVin } from '../market.js';

/** Fewer similar listings than this and the check says nothing. */
export const MIN_SIMILAR = 10;

const YEAR_MS = 365.25 * 24 * 3600 * 1000;
/** A model year's car is taken as half a year old on 1 July of that year. */
export const ageAt = (year, day) => (new Date(day).getTime() - Date.UTC(year, 6, 1)) / YEAR_MS;

export function batteryFromText(text) {
  const match = /(\d{2,3}(?:[.,]\d)?)\s*kwh/i.exec(text ?? '');
  return match ? Number(match[1].replace(',', '.')) : null;
}

/** What a listing runs on, in the calculator's terms: the site's word, or else the title's. */
export function fuelOf(fuel, title) {
  const f = (fuel ?? '').toLowerCase();
  if (f) {
    if (/lataus|plug|ladattava/.test(f)) return 'phev';
    if (/sähkö|electric/.test(f) && !/bensiini|diesel|hybrid/.test(f)) return 'ev';
    if (/diesel/.test(f)) return 'diesel';
    if (/bensiini|petrol|hybrid/.test(f)) return 'petrol';
  }
  const t = (title ?? '').toLowerCase();
  if (/plug-?in|lataushybridi|\bphev\b|\b\d{3}e\b|tfsi ?e\b/.test(t)) return 'phev';
  if (/diesel|\btdi\b|\bcrdi\b|\b\d{3}x?d\b/.test(t)) return 'diesel';
  if (/bensiini|\b\d{3}i\b|\btsi\b|\btfsi\b/.test(t)) return 'petrol';
  const kwh = batteryFromText(t);
  if ((kwh !== null && kwh >= 30) || /\bev\b|sähkö|dual motor|single motor/.test(t)) return 'ev';
  return null;
}

export function driveOf(drive, title) {
  const d = (drive ?? '').toLowerCase();
  if (/neliveto|awd|4wd/.test(d)) return 'awd';
  if (/takaveto|etuveto/.test(d)) return '2wd';
  const t = (title ?? '').toLowerCase();
  if (/dual motor|\bawd\b|neliveto|xdrive|\b4x4\b|quattro|4motion|4matic|\b4wd\b/.test(t)) return 'awd';
  if (/single motor|takaveto|etuveto|\brwd\b|\bfwd\b/.test(t)) return '2wd';
  return null;
}

/** ln(price) = a + bAge·age + bKm·(km / 10 000), least squares; a flat input is left out. */
function fitLogPrice(points) {
  if (points.length < MIN_SIMILAR) return null;
  const spread = (xs) => Math.max(...xs) - Math.min(...xs);
  const useAge = spread(points.map((p) => p.age)) >= 0.75;
  const useKm = spread(points.map((p) => p.km)) >= 15000;
  const cols = (p) => [1, ...(useAge ? [p.age] : []), ...(useKm ? [p.km / 10000] : [])];
  const k = cols(points[0]).length;
  const m = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (const p of points) {
    const x = cols(p);
    const y = Math.log(p.price);
    for (let i = 0; i < k; i += 1) {
      for (let j = 0; j < k; j += 1) m[i][j] += x[i] * x[j];
      m[i][k] += x[i] * y;
    }
  }
  for (let c = 0; c < k; c += 1) {
    let pivot = c;
    for (let r = c + 1; r < k; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    if (Math.abs(m[pivot][c]) < 1e-9) return null;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    for (let r = 0; r < k; r += 1) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let j = c; j <= k; j += 1) m[r][j] -= f * m[c][j];
    }
  }
  const beta = m.map((row, i) => row[k] / row[i]);
  let i = 0;
  const a = beta[i++];
  const bAge = useAge ? beta[i++] : 0;
  const bKm = useKm ? beta[i++] : 0;
  return { a, bAge, bKm };
}

const predict = (fit, age, km) => fit.a + fit.bAge * age + fit.bKm * (km / 10000);

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * A crawled listing's asking price against the record of its search.
 *
 * Null when there is nothing to say: no price, year or mileage, or fewer than
 * MIN_SIMILAR similar listings at the widest "similar" there is.
 */
export function checkListingPrice(listing, market, { today = new Date() } = {}) {
  if (!market || !listing?.price || !listing.year || listing.mileage === null || listing.mileage === undefined) {
    return null;
  }
  const title = listing.subTitle || listing.title || '';
  const fuel = fuelOf(listing.fuelType, title);
  if (!fuel) return null;
  const battery = fuel === 'ev' ? (Number(listing.battery) || batteryFromText(title)) : null;
  const drive = driveOf(listing.driveType, title);
  const ownVin = hashVin(listing.vin);

  const all = [];
  const seenVins = new Set();
  const entries = Object.entries(market.listings ?? {}).sort((x, y) => y[1].last.localeCompare(x[1].last));
  for (const [id, l] of entries) {
    if (id === String(listing.id) || (ownVin && l.vin === ownVin)) continue;
    if (l.vin) {
      if (seenVins.has(l.vin)) continue;
      seenVins.add(l.vin);
    }
    const price = l.prices?.at(-1)?.[1];
    if (!l.year || l.mileage === null || !price || price < 1000) continue;
    all.push({
      age: ageAt(l.year, l.last),
      km: l.mileage,
      price,
      fuel: fuelOf(l.fuel, l.title),
      battery: l.battery ?? batteryFromText(l.title),
      drive: driveOf(l.drive, l.title),
    });
  }

  const sameFuel = (p) => p.fuel === fuel;
  const sameBattery = (p) => battery !== null && p.battery !== null && Math.abs(p.battery - battery) <= 4;
  const steps = [];
  if (battery !== null && drive) steps.push((p) => sameFuel(p) && sameBattery(p) && p.drive === drive);
  if (battery !== null) steps.push((p) => sameFuel(p) && sameBattery(p));
  if (drive) steps.push((p) => sameFuel(p) && p.drive === drive);
  steps.push(sameFuel);

  let points = null;
  for (const keep of steps) {
    const kept = all.filter(keep);
    if (kept.length >= MIN_SIMILAR) {
      points = kept;
      break;
    }
  }
  if (!points) return null;

  let fit = fitLogPrice(points);
  if (!fit) return null;
  const residualsOf = (f, ps) => ps.map((p) => Math.log(p.price) - predict(f, p.age, p.km));
  const first = residualsOf(fit, points);
  const mad = quantile(first.map(Math.abs).sort((x, y) => x - y), 0.5) * 1.4826;
  if (mad > 0) {
    const kept = points.filter((_, i) => Math.abs(first[i]) <= 3 * mad);
    const refit = kept.length >= MIN_SIMILAR ? fitLogPrice(kept) : null;
    if (refit) {
      points = kept;
      fit = refit;
    }
  }

  const center = predict(fit, ageAt(listing.year, today.getTime()), listing.mileage);
  const residuals = residualsOf(fit, points).sort((x, y) => x - y);
  const ownResidual = Math.log(listing.price) - center;
  const typical = Math.exp(center);
  return {
    typical,
    diff: listing.price - typical,
    pricierShare: residuals.filter((r) => r > ownResidual).length / residuals.length,
    count: points.length,
  };
}
