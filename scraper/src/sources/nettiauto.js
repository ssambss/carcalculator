// The nettiauto.com source: what its listings look like, and how to read them.
//
// One adapter of possibly many. Everything site-specific lives behind the
// object exported at the bottom of this file - the orchestration in index.js
// never names nettiauto, and the matcher in filter.js does not know what a car
// is. To follow something else, write another one of these.

import config from '../config.js';
import { fetchText } from '../http.js';
import { decodeEntities, htmlToText, oneLine, parseInteger, pick } from '../html.js';

const ORIGIN = 'https://www.nettiauto.com';

/**
 * Build a search results URL for one `{ make, model }` search.
 *
 * Deliberately unfiltered. Nettiauto does accept yearFrom/yearTo/kilometersTo
 * on this path, but combining them with `page` breaks pagination: every page
 * then returns the same first page of results, so most of the market silently
 * disappears. Measured on the full Polestar 2 listing - filtered, 8 pages
 * yielded 43 unique cars out of 261; unfiltered, 16 pages yielded all 464.
 *
 * So we page through the unfiltered listing and apply every requirement
 * locally in filter.js, which is also where the checks nettiauto has no filter
 * for (battery, drivetrain, option packages) have to happen anyway.
 */
export function buildSearchUrl(search, page = 1) {
  const suffix = page > 1 ? `?page=${page}` : '';
  return `${ORIGIN}/${search.make}/${search.model}${suffix}`;
}

export function buildListingUrl(search, id) {
  return `${ORIGIN}/${search.make}/${search.model}/${id}`;
}

/** Total number of results the search reports, or null if not found. */
function parseTotal(html) {
  return parseInteger(pick(html, /listing-total-ads-counter"[^>]*>([\s\S]*?)</));
}

/**
 * Highest page number linked in the pager, or 1. Pager hrefs arrive with
 * escaped ampersands (`&amp;page=2`), so both forms are accepted.
 */
function parseLastPage(html) {
  const pages = [...html.matchAll(/(?:\?|&|&amp;)page=(\d+)/g)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((page) => Number.isFinite(page));
  return pages.length ? Math.max(...pages) : 1;
}

/**
 * Parse a JSON-LD script body.
 *
 * The raw text must be parsed *before* any entity decoding: these payloads
 * carry inch marks as `&quot;` (`12,3&quot; Digimittaristo`), and decoding
 * first turns those into bare quotes that break the JSON. Individual strings
 * are decoded on the way out instead, by `text()`.
 */
function parseJsonLd(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(decodeEntities(raw));
    } catch {
      return null;
    }
  }
}

/** Normalise a JSON-LD string field to decoded, trimmed text or null. */
function text(value) {
  if (typeof value !== 'string') return null;
  const decoded = decodeEntities(value).replace(/\s+/g, ' ').trim();
  return decoded || null;
}

/** Depth-first search for every schema.org ItemList nested anywhere in a graph. */
function collectItemListElements(node, out = [], depth = 0) {
  if (depth > 8 || node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) collectItemListElements(child, out, depth + 1);
    return out;
  }
  if (Array.isArray(node.itemListElement)) out.push(...node.itemListElement);
  for (const value of Object.values(node)) {
    if (value !== null && typeof value === 'object') collectItemListElements(value, out, depth + 1);
  }
  return out;
}

/**
 * The search page embeds a schema.org ItemList covering every result on it,
 * nested inside a SearchResultsPage. It carries fields the visible card omits
 * - the full-size image, VIN, colour, body type - so we merge it in by id.
 */
function parseItemList(html) {
  const byId = new Map();
  for (const match of html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  )) {
    const payload = parseJsonLd(match[1]);
    if (!payload) continue;
    for (const element of collectItemListElements(payload)) {
      const item = element?.item;
      const url = typeof item?.url === 'string' ? item.url : '';
      // Anchor on the final path segment: /polestar/2/15789736 - the model
      // segment is numeric too, so an unanchored match would return "2".
      const id = url.match(/\/(\d+)\/?(?:[?#]|$)/)?.[1];
      if (!id) continue;
      byId.set(id, {
        vin: text(item.vehicleIdentificationNumber),
        color: text(item.color),
        bodyType: text(item.bodyType),
        fuelType: text(item.fuelType),
        transmission: text(item.vehicleTransmission),
        image: text(Array.isArray(item.image) ? item.image[0] : item.image),
        mileage: parseInteger(item.mileageFromOdometer?.value),
        price: parseInteger(item.offers?.price),
        schemaName: text(item.name),
      });
    }
  }
  return byId;
}

/**
 * Each result card carries a `data-datalayer` JSON blob (an analytics payload)
 * with the numeric facts already typed, which is far steadier to read than the
 * surrounding presentation markup.
 */
function parseCards(html, search) {
  const matches = [...html.matchAll(/data-datalayer="(\{[\s\S]*?\})"/g)];
  const cards = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    let data;
    try {
      data = JSON.parse(decodeEntities(match[1]));
    } catch {
      continue;
    }
    if (!data?.item_id) continue;
    // Skip cross-sell modules; genuine results are tagged as search hits.
    if (data.item_list_location && data.item_list_location !== 'Hakutulos') continue;

    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : html.length;
    const block = html.slice(start, end);

    const subTitle = pick(block, /class="product-card__sub-title"[^>]*>([\s\S]*?)<\/div>/);
    const specsRaw = pick(block, /class="product-card__basic-info-list"[^>]*>([\s\S]*?)<\/div>/);
    const specs = specsRaw
      .split(/[●•]/)
      .map((part) => part.trim())
      .filter(Boolean);
    const usp = pick(block, /class="product-card__usp-info[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const location = pick(block, /data-testid="ad_user_details"[^>]*>([\s\S]*?)<\/div>/).replace(
      /,\s*$/,
      '',
    );

    cards.push({
      id: String(data.item_id),
      url: buildListingUrl(search, data.item_id),
      title: data.item_name ? String(data.item_name) : '',
      subTitle,
      specs,
      usp,
      location,
      seller: data.item_seller ?? null,
      year: parseInteger(data.item_year_model),
      mileage: parseInteger(data.item_mileage),
      price: parseInteger(data.item_vehicle_price),
      fuelType: data.item_power_type ?? null,
      adStatus: data.item_ad_status ?? null,
      // "Neliveto" = AWD, "Etuveto" = FWD, "Takaveto" = RWD.
      driveType: specs.find((spec) => /veto$/i.test(spec)) ?? null,
      battery: /(\d+(?:[.,]\d+)?)\s*kwh/i.exec(subTitle)?.[1]?.replace(',', '.') ?? null,
    });
  }

  return cards;
}

/** Parse one search results page into listings plus pagination info. */
export function parseSearchPage(html, search) {
  const cards = parseCards(html, search);
  const extras = parseItemList(html);
  const listings = cards.map((card) => {
    const extra = extras.get(card.id) ?? {};
    return {
      ...card,
      vin: extra.vin ?? null,
      color: extra.color ?? null,
      bodyType: extra.bodyType ?? null,
      transmission: extra.transmission ?? null,
      image: extra.image ?? null,
      schemaName: extra.schemaName ?? null,
      mileage: card.mileage ?? extra.mileage ?? null,
      price: card.price ?? extra.price ?? null,
    };
  });

  return { listings, total: parseTotal(html), lastPage: parseLastPage(html) };
}

/**
 * Walk every page of the search.
 *
 * Stops on an empty page, on a page that adds no new ids (a guard against a
 * pager that clamps), or at maxSearchPages.
 *
 * **A page that fails does not end the crawl.** It used to: one flaky request
 * out of sixteen threw, and the whole run died for everybody. That is the wrong
 * trade, because the watcher is idempotent - a listing missed this time is found
 * next time and announced then, while a dead run announces nothing at all. So a
 * failed page is logged, counted, and stepped over.
 *
 * The exception is a *first* page that fails, or more than `maxFailedPages`
 * failing: that is a source which is down rather than a request that was
 * unlucky, and grinding through forty pages of it wastes the run. It gives up on
 * that search and lets the caller carry on with the others.
 */
export async function fetchAllListings(search, { onProgress } = {}) {
  const { maxSearchPages, maxFailedPages } = config.fetch;
  const listings = [];
  const seenIds = new Set();
  const failures = [];
  let page = 1;
  let lastPage = 1;
  let total = null;

  while (page <= maxSearchPages) {
    let html;
    try {
      html = await fetchText(buildSearchUrl(search, page), {
        label: `${search.make}/${search.model} search page ${page}`,
      });
    } catch (error) {
      failures.push({ page, message: error.message });
      // Nothing at all from the first page means the search itself is
      // unreachable: no total, no pager, nothing to step over.
      if (page === 1) {
        throw new Error(
          `${search.make}/${search.model} is unreachable - the first search page failed. ` +
            error.message,
        );
      }
      if (failures.length > maxFailedPages) {
        console.warn(
          `  giving up on ${search.make}/${search.model}: ${failures.length} pages failed. ` +
            `Keeping the ${listings.length} listing(s) read so far.`,
        );
        break;
      }
      console.warn(`  page ${page} failed, stepping over it: ${error.message}`);
      page += 1;
      continue;
    }
    if (!html) break;

    const parsed = parseSearchPage(html, search);
    if (page === 1) {
      total = parsed.total;
      lastPage = Math.min(parsed.lastPage, maxSearchPages);
    }

    const fresh = parsed.listings.filter((listing) => !seenIds.has(listing.id));
    for (const listing of fresh) {
      seenIds.add(listing.id);
      listings.push(listing);
    }

    onProgress?.({ page, lastPage, got: parsed.listings.length, fresh: fresh.length, total });

    if (parsed.listings.length === 0) break;
    if (fresh.length === 0 && page > 1) break;
    if (page >= lastPage) break;
    page += 1;
  }

  // `failures` is reported rather than swallowed: a run that quietly read twelve
  // of sixteen pages looks identical to one that read all of them, and the
  // difference is listings nobody was told about until later.
  return { listings, total, pagesFetched: page, failures };
}

const AD_STATUS_RE = /class="[^"]*ad-status[^"]*"[^>]*>([\s\S]*?)<\/div>/;
const SOLD_RE = /ilmoitus on poistettu|varattu|myyty/i;

export function parseDetailPage(html) {
  let schemaName = null;
  let seller = null;
  let locality = null;
  let price = null;

  for (const match of html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  )) {
    const payload = parseJsonLd(match[1]);
    if (!payload) continue;
    const types = [payload['@type']].flat();
    if (!types.includes('Car') && !types.includes('Product')) continue;
    schemaName = text(payload.name) ?? schemaName;
    seller = text(payload.offers?.seller?.name) ?? seller;
    locality = text(payload.offers?.seller?.address?.addressLocality) ?? locality;
    // Reported for reference only - do not let this replace the search card
    // price. This figure adds the delivery fee (e.g. card 25 300, here 25 649),
    // so mixing the two makes every listing look like it changed price on
    // every run, which defeats the change detection in state.js.
    price = parseInteger(payload.offers?.price) ?? price;
  }

  const descriptionHtml =
    /<div id="fullNote"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/.exec(html)?.[1] ??
    /<div id="fullNote"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ??
    '';
  const uspHtml =
    /class="[^"]*unique-selling-point[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';

  return {
    schemaName,
    seller,
    locality,
    price,
    description: htmlToText(descriptionHtml),
    usp: oneLine(uspHtml),
    sold: SOLD_RE.test(oneLine(AD_STATUS_RE.exec(html)?.[1] ?? '')),
  };
}

/**
 * Fetch a listing page for the details a search card cannot carry: the
 * canonical variant name and the seller's full description, which is the only
 * place option packages are ever named.
 */
export async function fetchListingDetail(search, id) {
  const html = await fetchText(buildListingUrl(search, id), { label: `listing ${id}` });
  if (!html) return null;
  return parseDetailPage(html);
}

/**
 * Numeric facts a nettiauto listing carries, and what to call them.
 *
 * `unit` labels the number where one reads naturally ("120 000 km"), and its
 * absence is what makes a rejection name the field instead ("rooms 2 under 3").
 * `style: 'year'` picks before/after over under/over and leaves the digits
 * ungrouped, because "year 2 019" is not a year.
 */
export const FIELDS = [
  { key: 'year', label: 'year', style: 'year' },
  { key: 'mileage', label: 'mileage', unit: 'km' },
  { key: 'price', label: 'price', unit: '€' },
];

/** Path segments identifying a nettiauto search: /<make>/<model>. */
const SEARCH_KEYS = ['make', 'model'];

/**
 * The nettiauto adapter.
 *
 * `searchFrom` is the one place that knows a nettiauto search is a make and a
 * model. Another source's search might be a region and a property type, and
 * nothing outside this file would need to change.
 */
export const nettiauto = {
  id: 'nettiauto',
  label: 'Nettiauto',
  /** Everything this source fetches shares one politeness budget. */
  host: 'www.nettiauto.com',
  fields: FIELDS,
  searchKeys: SEARCH_KEYS,

  /** What the editor asks for, so the app can build the form from this. */
  searchInputs: [
    { key: 'make', label: 'Make', placeholder: 'polestar' },
    { key: 'model', label: 'Model', placeholder: '2' },
  ],

  searchFrom(filter) {
    const search = {};
    for (const key of SEARCH_KEYS) search[key] = filter.search?.[key] ?? '';
    return search;
  },

  /** Filters over the same search share one crawl, so this is their group key. */
  searchKey(search) {
    return SEARCH_KEYS.map((key) => search[key]).join('/');
  },

  describeSearch(search) {
    return this.searchKey(search);
  },

  /** A search this incomplete names no page to read, so it cannot run. */
  canRun(search) {
    return SEARCH_KEYS.every((key) => Boolean(search[key]));
  },

  fetchAllListings,
  fetchListingDetail,

  /** Recover a listing id from a posted link, for the reaction pickup. */
  listingIdFromUrl(url) {
    return /nettiauto\.com\/[^/]+\/[^/]+\/(\d+)/.exec(url ?? '')?.[1] ?? null;
  },

  /**
   * Where a reacted listing goes. The car calculator only understands cars, so
   * a source watching flats sets this to null and reactions simply do nothing -
   * which is what lets it ship without a second calculator.
   */
  sink: 'car-tco',

  /** Field labels for the Discord embed, in the language of the site. */
  presentation: {
    locale: 'fi-FI',
    labels: {
      price: 'Hinta',
      mileage: 'Mittarilukema',
      year: 'Vuosimalli',
      specs: 'Tiedot',
      seller: 'Myyjä',
      packages: 'Varustepaketit (myyjän teksti)',
      caveats: 'Huom',
    },
    footer: 'nettiauto.com',
  },
};

export default nettiauto;
