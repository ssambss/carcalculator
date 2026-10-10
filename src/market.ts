import type { CarListing, Powertrain } from './types'

/**
 * The market record, read: what similar cars have been listed for, and how a
 * car's asking price looks against them.
 *
 * The record is the listing watcher's (scraper/src/market.js): every listing a
 * crawl has read, kept after it leaves the site, with its asking price over
 * time. Fetched from the repo at runtime rather than bundled - the watcher's
 * own commits do not redeploy the app, so a bundled copy would be as old as the
 * last change to the code.
 */

export interface MarketListing {
  title: string
  year: number | null
  mileage: number | null
  fuel: string | null
  drive: string | null
  battery: number | null
  seller: string | null
  /** hashed - recognises one car relisted under a new id */
  vin: string | null
  /** days, YYYY-MM-DD */
  first: string
  last: string
  /** [day, €], appended when the asking price moved */
  prices: [string, number][]
}

export interface MarketRecord {
  version: number
  source: string
  search: Record<string, string>
  updatedAt: string | null
  /** the last crawl that read every page - "gone" is only judged against it */
  completeAt: string | null
  listings: Record<string, MarketListing>
}

export interface MarketIndexEntry {
  file: string
  source: string
  search: Record<string, string>
  listings: number
  updatedAt: string | null
  completeAt: string | null
}

export interface MarketIndex {
  version: number
  updatedAt: string
  files: MarketIndexEntry[]
}

/** Where the record is read from. A fork points this at its own repo. */
export const MARKET_BASE: string =
  import.meta.env.VITE_MARKET_BASE ??
  'https://raw.githubusercontent.com/ssambss/carcalculator/main/scraper/data/market/'

/* ------------------------------------------------------------- matching */

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const LISTING_URL = /nettiauto\.com\/([^/?#\s]+)\/([^/?#\s]+)\/(\d+)/i

export interface ListingRef {
  make: string
  model: string
  id: string
}

/** The nettiauto listing a car came from - the watcher writes its link into the notes. */
export function listingRefOf(car: CarListing): ListingRef | null {
  const match = LISTING_URL.exec(car.notes)
  return match ? { make: slug(match[1]), model: slug(match[2]), id: match[3] } : null
}

/**
 * Which record a car belongs to: its own listing's search if it has one, or
 * the make and model in its name - "BMW 320e G20" is in the bmw/320 record,
 * the letter after the number being the engine, not another model.
 */
export function recordFor(car: CarListing, index: MarketIndex | null): MarketIndexEntry | null {
  if (!index) return null
  const entries = index.files.filter((f) => f.source === 'nettiauto' && f.search.make && f.search.model)
  const ref = listingRefOf(car)
  if (ref) {
    const hit = entries.find(
      (f) => slug(f.search.make) === ref.make && slug(f.search.model) === ref.model,
    )
    if (hit) return hit
  }
  const name = `-${slug(car.name)}-`
  return (
    entries.find((f) =>
      new RegExp(`-${slug(f.search.make)}-${slug(f.search.model)}[a-z]*-`).test(name),
    ) ?? null
  )
}

/* ------------------------------------------------------- what a car is */

/** "78 kWh" in an advert's title. */
export function batteryFromText(text: string): number | null {
  const match = /(\d{2,3}(?:[.,]\d)?)\s*kwh/i.exec(text)
  return match ? Number(match[1].replace(',', '.')) : null
}

/**
 * What a listing runs on, in the calculator's terms. The site's own word when
 * the record has it; otherwise the title, which nearly always says - "320d",
 * "330e", "78 kWh, Dual Motor".
 */
export function fuelOf(fuel: string | null, title: string): Powertrain | null {
  const f = (fuel ?? '').toLowerCase()
  if (f) {
    if (/lataus|plug|ladattava/.test(f)) return 'phev'
    if (/sähkö|electric/.test(f) && !/bensiini|diesel|hybrid/.test(f)) return 'ev'
    if (/diesel/.test(f)) return 'diesel'
    // A hybrid that does not plug in is fuelled with petrol - the calculator agrees.
    if (/bensiini|petrol|hybrid/.test(f)) return 'petrol'
  }
  const t = title.toLowerCase()
  if (/plug-?in|lataushybridi|\bphev\b|\b\d{3}e\b|tfsi ?e\b/.test(t)) return 'phev'
  if (/diesel|\btdi\b|\bcrdi\b|\b\d{3}x?d\b/.test(t)) return 'diesel'
  if (/bensiini|\b\d{3}i\b|\btsi\b|\btfsi\b/.test(t)) return 'petrol'
  const kwh = batteryFromText(t)
  if ((kwh !== null && kwh >= 30) || /\bev\b|sähkö|dual motor|single motor/.test(t)) return 'ev'
  return null
}

export type Drive = 'awd' | '2wd'

export function driveOf(drive: string | null, title: string): Drive | null {
  const d = (drive ?? '').toLowerCase()
  if (/neliveto|awd|4wd/.test(d)) return 'awd'
  if (/takaveto|etuveto/.test(d)) return '2wd'
  const t = title.toLowerCase()
  if (/dual motor|\bawd\b|neliveto|xdrive|\b4x4\b|quattro|4motion|4matic|\b4wd\b/.test(t)) return 'awd'
  if (/single motor|takaveto|etuveto|\brwd\b|\bfwd\b/.test(t)) return '2wd'
  return null
}

/* --------------------------------------------------------- the maths */

const YEAR_MS = 365.25 * 24 * 3600 * 1000
/** A model year's car is taken as half a year old on 1 July of that year. */
export const ageAt = (year: number, day: string | number): number =>
  (new Date(day).getTime() - Date.UTC(year, 6, 1)) / YEAR_MS

export interface Point {
  id: string
  year: number
  /** at the last sighting - the age it asked its last price at */
  age: number
  km: number
  /** the last price it asked */
  price: number
  gone: boolean
  first: string
  last: string
}

type Prepared = Point & { vin: string | null; fuel: Powertrain | null; battery: number | null; drive: Drive | null }

/**
 * Every usable listing in a record, read once: the title heuristics run over
 * hundreds of adverts, and every car on screen asks of the same record. Latest
 * sighting first, so a car relisted under a new id counts once, as it is now.
 */
const prepared = new WeakMap<MarketRecord, Prepared[]>()

function prepare(record: MarketRecord): Prepared[] {
  const hit = prepared.get(record)
  if (hit) return hit
  const completeDay = record.completeAt?.slice(0, 10) ?? null
  const seenVins = new Set<string>()
  const out: Prepared[] = []
  const entries = Object.entries(record.listings).sort((x, y) => y[1].last.localeCompare(x[1].last))
  for (const [id, l] of entries) {
    if (l.vin) {
      if (seenVins.has(l.vin)) continue
      seenVins.add(l.vin)
    }
    const price = l.prices.at(-1)?.[1]
    if (!l.year || l.mileage === null || !price || price < 1000) continue
    out.push({
      id,
      year: l.year,
      age: ageAt(l.year, l.last),
      km: l.mileage,
      price,
      gone: completeDay !== null && l.last < completeDay,
      first: l.first,
      last: l.last,
      vin: l.vin,
      fuel: fuelOf(l.fuel, l.title),
      battery: l.battery ?? batteryFromText(l.title),
      drive: driveOf(l.drive, l.title),
    })
  }
  prepared.set(record, out)
  return out
}

export interface Fit {
  a: number
  bAge: number
  bKm: number
}

/**
 * ln(price) = a + bAge·age + bKm·(km / 10 000), least squares. A term whose
 * input barely varies - every listing the same year - is left out rather than
 * fitted to noise. Null with too few points to say anything.
 */
function fitLogPrice(points: Point[]): Fit | null {
  if (points.length < MIN_SIMILAR) return null
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs)
  const useAge = spread(points.map((p) => p.age)) >= 0.75
  const useKm = spread(points.map((p) => p.km)) >= 15000
  const cols = (p: Point) => [1, ...(useAge ? [p.age] : []), ...(useKm ? [p.km / 10000] : [])]
  const k = cols(points[0]).length
  // Normal equations, solved by elimination: three unknowns at most.
  const m = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0))
  for (const p of points) {
    const x = cols(p)
    const y = Math.log(p.price)
    for (let i = 0; i < k; i += 1) {
      for (let j = 0; j < k; j += 1) m[i][j] += x[i] * x[j]
      m[i][k] += x[i] * y
    }
  }
  for (let c = 0; c < k; c += 1) {
    let pivot = c
    for (let r = c + 1; r < k; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r
    if (Math.abs(m[pivot][c]) < 1e-9) return null
    ;[m[c], m[pivot]] = [m[pivot], m[c]]
    for (let r = 0; r < k; r += 1) {
      if (r === c) continue
      const f = m[r][c] / m[c][c]
      for (let j = c; j <= k; j += 1) m[r][j] -= f * m[c][j]
    }
  }
  const beta = m.map((row, i) => row[k] / row[i])
  let i = 0
  const a = beta[i++]
  const bAge = useAge ? beta[i++] : 0
  const bKm = useKm ? beta[i++] : 0
  return { a, bAge, bKm }
}

export const predict = (fit: Fit, age: number, km: number) => fit.a + fit.bAge * age + fit.bKm * (km / 10000)

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/* ------------------------------------------------------- the check */

/** Fewer similar listings than this and the check says nothing. */
export const MIN_SIMILAR = 10

export interface PriceCheck {
  ok: true
  asking: number
  /** what a car of this age and mileage is typically listed for */
  typical: number
  /** the middle half of similar listings, at this car's age and mileage */
  low: number
  high: number
  /** asking - typical */
  diff: number
  /** how many similar listings are, for their age and mileage, priced higher */
  pricierShare: number
  count: number
  /** of those, how many have left the site */
  gone: number
  /** false until a crawl has read a whole search - before that, nothing is known to be gone */
  goneKnown: boolean
  /** the first day any of them was seen */
  since: string
  /** the first day the record has anything - a listing first seen then may be older */
  recordSince: string
  /** what "similar" came to mean: the model, and whatever narrowed it */
  criteria: string[]
  year: number
  /** this car's age today, which the chart adjusts every listing to */
  age: number
  km: number
  fit: Fit
  points: Point[]
  /** this car's own listing, when it has one in the record */
  listing: { first: string; last: string; prices: [string, number][]; gone: boolean | null } | null
}

export type PriceCheckResult =
  | PriceCheck
  | { ok: false; reason: 'year' | 'similar'; count?: number }

const POWERTRAIN_WORD: Record<Powertrain, string> = {
  petrol: 'petrol',
  diesel: 'diesel',
  ev: 'electric',
  phev: 'plug-in hybrid',
}

/**
 * The asking price against similar listings, adjusted for age and mileage.
 *
 * "Similar" starts narrow - the same fuel, and for an electric car the same
 * battery and drive - and widens a step at a time until there are enough
 * listings to say anything. Each listing counts at the last price it asked and
 * at the age it was then, so one seen in August and one seen today are judged
 * at their own ages rather than as if the calendar had stood still.
 *
 * Null for what the check does not apply to: a lease, or a car with no price
 * or no record.
 */
export function checkPrice(
  car: CarListing,
  record: MarketRecord | undefined,
  { today = new Date() }: { today?: Date } = {},
): PriceCheckResult | null {
  if (!record || car.financing.method === 'lease' || car.purchasePrice <= 0) return null
  const ref = listingRefOf(car)
  const own = ref ? record.listings[ref.id] : undefined
  const year = car.year || own?.year || 0
  if (!year) return { ok: false, reason: 'year' }

  const text = `${car.name} ${own?.title ?? ''}`
  const fuel = car.powertrain
  const battery = fuel === 'ev' ? (own?.battery ?? batteryFromText(text)) : null
  const drive = driveOf(own?.drive ?? null, text)
  const completeDay = record.completeAt?.slice(0, 10) ?? null

  // Not the car itself, under its own id or relisted under another.
  const all = prepare(record).filter((p) => p.id !== ref?.id && !(own?.vin && p.vin === own.vin))

  const make = record.search.make
  // "bmw" is BMW, "polestar" is Polestar: short makes are initials.
  const model = `${make.length <= 3 ? make.toUpperCase() : make[0].toUpperCase() + make.slice(1)} ${record.search.model}`
  const steps: { criteria: string[]; keep: (p: Prepared) => boolean }[] = []
  const sameFuel = (p: Prepared) => p.fuel === fuel
  const sameBattery = (p: Prepared) =>
    battery !== null && p.battery !== null && Math.abs(p.battery - battery) <= 4
  if (battery !== null && drive) {
    steps.push({
      criteria: [model, POWERTRAIN_WORD[fuel], `${battery} kWh`, drive === 'awd' ? 'AWD' : '2WD'],
      keep: (p) => sameFuel(p) && sameBattery(p) && p.drive === drive,
    })
  }
  if (battery !== null) {
    steps.push({ criteria: [model, POWERTRAIN_WORD[fuel], `${battery} kWh`], keep: (p) => sameFuel(p) && sameBattery(p) })
  }
  if (drive) {
    steps.push({
      criteria: [model, POWERTRAIN_WORD[fuel], drive === 'awd' ? 'AWD' : '2WD'],
      keep: (p) => sameFuel(p) && p.drive === drive,
    })
  }
  steps.push({ criteria: [model, POWERTRAIN_WORD[fuel]], keep: sameFuel })

  let chosen: { criteria: string[]; points: Point[] } | null = null
  let best = 0
  for (const step of steps) {
    const points = all.filter(step.keep)
    best = Math.max(best, points.length)
    if (points.length >= MIN_SIMILAR) {
      chosen = { criteria: step.criteria, points }
      break
    }
  }
  if (!chosen) return { ok: false, reason: 'similar', count: best }

  // Fit, drop what sits far outside the rest (a typo'd price, a wreck), fit again.
  let points = chosen.points
  let fit = fitLogPrice(points)
  if (!fit) return { ok: false, reason: 'similar', count: points.length }
  const residualsOf = (f: Fit, ps: Point[]) => ps.map((p) => Math.log(p.price) - predict(f, p.age, p.km))
  const first = residualsOf(fit, points)
  const sortedAbs = first.map(Math.abs).sort((x, y) => x - y)
  const mad = quantile(sortedAbs, 0.5) * 1.4826
  if (mad > 0) {
    const kept = points.filter((_, i) => Math.abs(first[i]) <= 3 * mad)
    const refit = kept.length >= MIN_SIMILAR ? fitLogPrice(kept) : null
    if (refit) {
      points = kept
      fit = refit
    }
  }

  const age = ageAt(year, today.getTime())
  const km = car.odometerKm
  const center = predict(fit, age, km)
  const residuals = residualsOf(fit, points).sort((x, y) => x - y)
  const ownResidual = Math.log(car.purchasePrice) - center
  const typical = Math.exp(center)

  return {
    ok: true,
    asking: car.purchasePrice,
    typical,
    low: Math.exp(center + quantile(residuals, 0.25)),
    high: Math.exp(center + quantile(residuals, 0.75)),
    diff: car.purchasePrice - typical,
    pricierShare: residuals.filter((r) => r > ownResidual).length / residuals.length,
    count: points.length,
    gone: points.filter((p) => p.gone).length,
    goneKnown: completeDay !== null,
    since: points.reduce((min, p) => (p.first < min ? p.first : min), points[0].first),
    recordSince: Object.values(record.listings).reduce(
      (min, l) => (l.first < min ? l.first : min),
      points[0].first,
    ),
    criteria: chosen.criteria,
    year,
    age,
    km,
    fit,
    points,
    listing: own
      ? {
          first: own.first,
          last: own.last,
          prices: own.prices,
          gone: completeDay === null ? null : own.last < completeDay,
        }
      : null,
  }
}
