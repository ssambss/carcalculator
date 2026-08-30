// Conformance: what every source adapter has to get right.
//
// Run against every source in the registry, so adding one means running these
// rather than hoping. Nothing here touches the network - the point is the shape
// of the interface and the invariants the orchestration relies on, not whether
// a particular site is up.
//
// If you are writing a new adapter, this file is the specification.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_SOURCE_ID,
  SOURCES,
  hasSource,
  identifyUrl,
  sourceIds,
  sourceOf,
} from '../src/sources/index.js';
import { checkRanges } from '../src/fields.js';
import { groupBySearch, normalizeFilter, normalizeFilters } from '../src/filters.js';

describe('the source registry', () => {
  it('has at least one source and a default that exists', () => {
    assert.ok(SOURCES.length > 0);
    assert.ok(hasSource(DEFAULT_SOURCE_ID));
  });

  it('gives every source a unique id', () => {
    assert.equal(new Set(sourceIds()).size, SOURCES.length);
  });

  it('treats a filter naming no source as the default', () => {
    // A filter typed into the gist by hand, or written before sources existed,
    // names none - and it is a nettiauto filter, because that is all there was.
    assert.equal(sourceOf({}).id, DEFAULT_SOURCE_ID);
    assert.equal(sourceOf({ source: '' }).id, DEFAULT_SOURCE_ID);
  });

  it('refuses an unknown source rather than guessing one', () => {
    // Silently crawling the wrong site would be worse than stopping.
    assert.throws(() => sourceOf({ source: 'craigslist', name: 'X' }), /does not know/);
  });

  it('skips a filter naming an unknown source instead of failing the run', () => {
    // Probably a filter from a newer version of the app. Dropping it beats
    // taking every other filter down with it.
    const said = [];
    const filters = normalizeFilters(
      [
        { source: 'from-the-future', make: 'a', model: 'b' },
        { make: 'polestar', model: '2' },
      ],
      { log: (line) => said.push(line) },
    );
    assert.equal(filters.length, 1);
    assert.equal(filters[0].source, DEFAULT_SOURCE_ID);
    assert.match(said.join(' '), /unknown source "from-the-future"/);
  });
});

for (const source of SOURCES) {
  describe(`source: ${source.id}`, () => {
    it('declares its identity and politeness budget', () => {
      assert.equal(typeof source.id, 'string');
      assert.ok(source.id.length > 0);
      assert.equal(typeof source.label, 'string');
      // One host means one pacing queue in http.js. A source spread over
      // several would need that widened before it could be added.
      assert.equal(typeof source.host, 'string');
      assert.ok(source.host.includes('.'));
    });

    it('declares the numeric fields a filter can bound', () => {
      assert.ok(Array.isArray(source.fields));
      for (const field of source.fields) {
        assert.equal(typeof field.key, 'string', 'every field needs a key');
        assert.equal(typeof field.label, 'string', `${field.key} needs a label`);
        if ('unit' in field) assert.equal(typeof field.unit, 'string');
        if ('style' in field) assert.ok(['year'].includes(field.style));
      }
      assert.equal(new Set(source.fields.map((f) => f.key)).size, source.fields.length);
    });

    it('can check a range over each of its own fields', () => {
      // The declarations and the checker have to agree: a field the source
      // declares but whose value never appears would reject every listing.
      for (const field of source.fields) {
        const listing = { facts: { [field.key]: 100 } };
        assert.deepEqual(checkRanges(listing, { [field.key]: { max: 100 } }, source.fields), []);
        const reasons = checkRanges(listing, { [field.key]: { max: 99 } }, source.fields);
        assert.equal(reasons.length, 1, `${field.key} should report going over`);
      }
    });

    it('asks the editor for every key its search needs', () => {
      assert.ok(Array.isArray(source.searchKeys));
      assert.ok(source.searchKeys.length > 0);
      const asked = new Set((source.searchInputs ?? []).map((input) => input.key));
      for (const key of source.searchKeys) {
        assert.ok(asked.has(key), `searchInputs is missing "${key}", so nobody can fill it in`);
      }
    });

    it('builds a search from a filter, and back into a stable key', () => {
      const filled = Object.fromEntries(source.searchKeys.map((key) => [key, 'x']));
      const filter = normalizeFilter({ source: source.id, search: filled });
      const search = source.searchFrom(filter);
      assert.deepEqual(Object.keys(search).sort(), [...source.searchKeys].sort());
      assert.ok(source.canRun(search), 'a fully specified search should be runnable');
      // Stable: the group key is what dedupes crawls, so it cannot wobble.
      assert.equal(source.searchKey(search), source.searchKey(search));
      assert.equal(typeof source.describeSearch(search), 'string');
    });

    it('refuses a search that names no page to read', () => {
      const empty = normalizeFilter({ source: source.id });
      assert.equal(source.canRun(source.searchFrom(empty)), false);
      // ...and such a filter never reaches the crawl.
      assert.equal(normalizeFilters([{ source: source.id }]).length, 0);
    });

    it('exposes the two crawl entry points', () => {
      assert.equal(typeof source.fetchAllListings, 'function');
      assert.equal(typeof source.fetchListingDetail, 'function');
    });

    it('recovers a listing id from its own links but not from strangers', () => {
      assert.equal(typeof source.listingIdFromUrl, 'function');
      assert.equal(source.listingIdFromUrl(''), null);
      assert.equal(source.listingIdFromUrl(null), null);
      assert.equal(source.listingIdFromUrl('https://example.com/nothing/here'), null);
    });

    it('says where a reacted listing goes, even if the answer is nowhere', () => {
      // null is a legitimate answer: a source watching flats has no calculator
      // to add to, and reactions on its posts simply do nothing.
      assert.ok(source.sink === null || typeof source.sink === 'string');
    });

    it('supplies the labels its posts are built from', () => {
      assert.equal(typeof source.presentation, 'object');
      assert.equal(typeof source.presentation.locale, 'string');
      for (const key of ['price', 'seller', 'packages', 'caveats']) {
        assert.equal(typeof source.presentation.labels[key], 'string', `missing label: ${key}`);
      }
    });

    it('groups its filters by search, carrying itself along', () => {
      const filled = Object.fromEntries(source.searchKeys.map((key) => [key, 'x']));
      const one = normalizeFilter({ id: 'a', source: source.id, search: filled });
      const two = normalizeFilter({ id: 'b', source: source.id, search: filled });
      const [group, ...rest] = groupBySearch([one, two]);
      assert.equal(rest.length, 0, 'the same search should mean one crawl');
      assert.equal(group.source.id, source.id);
      assert.ok(group.key.startsWith(`${source.id}:`));
    });
  });
}

describe('recovering a listing from a link', () => {
  it('finds the right source for a url it recognises', () => {
    const found = identifyUrl('https://www.nettiauto.com/polestar/2/15900001');
    assert.deepEqual(found, { sourceId: 'nettiauto', id: '15900001' });
  });

  it('returns null for a link no source claims', () => {
    assert.equal(identifyUrl('https://example.com/a/b/1'), null);
    assert.equal(identifyUrl(''), null);
  });
});
