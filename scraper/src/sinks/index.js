// Where a reacted listing goes.
//
// A sink is the other half of a source, and a deliberately separate axis from
// it: a source says what to watch, a sink says what to do with a listing
// somebody reacted to. Nettiauto listings are cars, so they go to the
// calculator. A source watching flats declares `sink: null` and reactions on
// its posts do nothing at all - which is exactly what lets it ship before any
// apartment calculator exists.
//
// A sink provides:
//
//   id                    what a source's `sink` field names
//   label                 for the run log
//   add(listings, {token}) -> { added, skipped }, both arrays of listing ids
//
// The token is always passed in, never read from configuration. A sink writes
// into somebody's own gist, and whose is not a global fact - there used to be a
// `ready()` here that answered "is this sink usable?" by checking the *owner's*
// token, which would have been the wrong answer for every other tenant. It was
// never called; it is gone rather than fixed.

import { addCarsToTco } from './car-tco.js';

const carTco = {
  id: 'car-tco',
  label: 'the Car TCO calculator',
  add: addCarsToTco,
};

export const SINKS = [carTco];

const byId = new Map(SINKS.map((sink) => [sink.id, sink]));

/**
 * The sink a source feeds, or null when it feeds none.
 *
 * A source naming a sink that does not exist is a bug in the adapter rather
 * than something a user did, so it throws.
 */
export function sinkFor(source) {
  if (!source?.sink) return null;
  const sink = byId.get(source.sink);
  if (!sink) {
    throw new Error(
      `Source "${source.id}" names sink "${source.sink}", which does not exist. ` +
        `Available: ${[...byId.keys()].join(', ') || 'none'}.`,
    );
  }
  return sink;
}
