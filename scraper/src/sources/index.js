// The sources this watcher knows how to read.
//
// A source is one site: what its listings look like, which numeric facts they
// carry, how to page through a search, and how to recover a listing id from a
// link we posted. Everything else - the crawl orchestration, the spec matching,
// the record of what has been announced, the Discord posting - is written
// against this interface and names no site at all.
//
// To follow something new, write an adapter and add it here. `test/sources.test.js`
// holds the conformance checks every adapter has to pass.
//
// What an adapter provides:
//
//   id, label            identity; `id` namespaces listing ids in the record
//   host                 one politeness budget per site (see http.js)
//   fields               numeric facts a filter can bound (see fields.js)
//   searchKeys           which filter.search keys identify a search
//   searchInputs         what the editor should ask for
//   searchFrom(filter)   the search a filter names
//   searchKey(search)    group key - filters sharing it share one crawl
//   describeSearch       one line, for the run log
//   canRun(search)       false when the search names no page to read
//   fetchAllListings     (search, { onProgress }) -> { listings, total }
//   fetchListingDetail   (search, id) -> detail | null
//   listingIdFromUrl     recover an id from a posted link
//   sink                 where a reacted listing goes, or null for nowhere
//   presentation         embed labels and locale

import { nettiauto } from './nettiauto.js';

export const SOURCES = [nettiauto];

/** The source every filter belongs to when it does not say. */
export const DEFAULT_SOURCE_ID = nettiauto.id;

const byId = new Map(SOURCES.map((source) => [source.id, source]));

export function sourceIds() {
  return SOURCES.map((source) => source.id);
}

/**
 * The source a filter names.
 *
 * Falls back to the default rather than throwing: a filter typed into the gist
 * by hand, or written before sources existed, names none - and it is a nettiauto
 * filter, because that is all there was. An *unknown* source is different and
 * does throw, since silently crawling the wrong site would be worse than
 * stopping.
 */
export function sourceOf(filter) {
  const id = filter?.source || DEFAULT_SOURCE_ID;
  const source = byId.get(id);
  if (!source) {
    throw new Error(
      `Filter "${filter?.name ?? filter?.id ?? '?'}" names source "${id}", which this ` +
        `watcher does not know. Available: ${sourceIds().join(', ')}.`,
    );
  }
  return source;
}

export function hasSource(id) {
  return byId.has(id);
}

/**
 * Recover a listing id from a link, and say which source it belongs to.
 *
 * A channel can carry posts from several sources, so every adapter gets a look.
 * Returns `{ sourceId, id }` or null.
 */
export function identifyUrl(url) {
  for (const source of SOURCES) {
    const id = source.listingIdFromUrl?.(url);
    if (id) return { sourceId: source.id, id };
  }
  return null;
}
