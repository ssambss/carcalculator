// Clearing away calculator cards whose advert has come down.
//
// A card stays in the calculator long after the car on it has sold, and a
// page of cars that can no longer be bought is a page nobody wants to scroll.
// So every run looks at the cards that link to an advert and deletes the ones
// whose advert is gone. Starred cards are kept and noted instead (see config).
//
// Deleting somebody's cards is the one thing this watcher does that cannot be
// undone from the channel, so it is careful about what counts as gone:
//
//  - The crawl is the cheap answer. A card whose listing it just saw is on
//    sale, and costs nothing. Only the rest have their advert opened, and each
//    at most once per recheck interval.
//  - Gone has to be said twice: two checks in a row, a recheck apart. One odd
//    page from the site, or one bad minute, cannot cost a card.
//  - And the check has to prove it still works. Before any "gone" in a run is
//    believed, an advert the crawl just saw on sale is opened the same way.
//    If that does not read as on sale either, the site has changed under the
//    parser and every "gone" from it is noise - otherwise a redesign could read
//    every advert as removed and empty the calculator in two runs.
//
// This file only decides. Reading and deleting cards is the sink's job, and
// saying so in the channel is index.js's.

import { identifyUrl } from './sources/index.js';
import * as state from './state.js';

/** Open an advert, turning "the site did not answer" into an answer. */
async function check(source, url) {
  try {
    return await source.checkListing(url);
  } catch (error) {
    return { status: 'unknown', why: error.message };
  }
}

/**
 * Does the source's check still read a live advert as on sale?
 *
 * Asked of a listing the crawl saw this very run. A source the crawl found
 * nothing on this run has nothing to ask with, and gets no benefit of the doubt.
 */
async function checkerWorks(source, listed) {
  const known = [...listed.values()].find((listing) => listing.sourceId === source.id);
  if (!known) return false;
  return (await check(source, known.url)).status === 'on-sale';
}

/**
 * Which of a calculator's cards should go?
 *
 * `cards` are the sink's, each `{ id, name, url, favorite, ... }`. `listed` is
 * everything this run's crawl saw, by record key; `sources` are this run's.
 * Notes what it learns in `store` and returns, as `{ card, key, why }`:
 *
 *   remove   cards to delete
 *   kept     starred cards whose advert is gone, not yet said
 *   opened   how many adverts were opened, for the log
 *
 * Cards linking to the same advert are checked once and share the verdict.
 */
export async function findGoneCards(
  cards,
  { store, listed, sources, recheckHours, keepFavorites = true, now = new Date(), log = () => {} },
) {
  const bySource = new Map(sources.map((source) => [source.id, source]));
  const groups = new Map();
  for (const card of cards) {
    const found = identifyUrl(card.url);
    const source = found && bySource.get(found.sourceId);
    // A site this run does not read, or one whose source cannot check an
    // advert: nothing here can say the car has sold, so the card is left be.
    if (!source?.checkListing) continue;
    const key = state.keyOf(found.sourceId, found.id);
    const group = groups.get(key) ?? { key, source, url: card.url, cards: [] };
    group.cards.push(card);
    groups.set(key, group);
  }

  const toOpen = [];
  for (const group of groups.values()) {
    const entry = store.tco[group.key];
    // Deleted once, and here again: somebody brought it back on purpose, and
    // deleting it a second time would be arguing with them.
    if (entry?.removedAt) continue;
    if (listed.has(group.key)) {
      state.noteListed(store, group.key, { now });
      continue;
    }
    // Starred, and the channel has already been told. Nothing left to learn.
    if (keepFavorites && entry?.keptAt && group.cards.every((card) => card.favorite)) continue;
    if (!state.cardCheckDue(store, group.key, { everyHours: recheckHours, now })) continue;
    toOpen.push(group);
  }

  const results = [];
  for (const group of toOpen) results.push({ group, result: await check(group.source, group.url) });

  // Only for a source with a "gone" to believe, so a quiet run opens nothing more.
  const trusted = new Map();
  for (const { group, result } of results) {
    if (result.status !== 'gone' || trusted.has(group.source.id)) continue;
    trusted.set(group.source.id, await checkerWorks(group.source, listed));
  }

  const remove = [];
  const kept = [];
  for (const { group, result } of results) {
    const name = group.cards[0].name;
    if (result.status === 'on-sale') {
      state.noteListed(store, group.key, { opened: true, now });
      log(`${name}: still on sale`);
      continue;
    }
    if (result.status === 'gone' && !trusted.get(group.source.id)) {
      state.noteChecked(store, group.key, now);
      log(
        `${name}: looks gone, but an advert the crawl just saw did not read as on sale ` +
          `either - not believing any "gone" from ${group.source.label} this run`,
      );
      continue;
    }
    if (result.status !== 'gone') {
      state.noteChecked(store, group.key, now);
      log(`${name}: could not tell (${result.why})`);
      continue;
    }
    if (!state.noteGone(store, group.key, now)) {
      const starred = keepFavorites && group.cards.every((card) => card.favorite);
      log(
        `${name}: gone (${result.why}) - ` +
          (starred ? 'starred, so it stays, but the channel is told' : 'deleted') +
          ' if the next check agrees',
      );
      continue;
    }
    for (const card of group.cards) {
      const item = { card, key: group.key, why: result.why };
      if (!keepFavorites || !card.favorite) remove.push(item);
      else if (!store.tco[group.key]?.keptAt) kept.push(item);
    }
    log(`${name}: gone (${result.why}), and was last time too`);
  }

  return { remove, kept, opened: toOpen.length };
}
