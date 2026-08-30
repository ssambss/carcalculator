// Where the record of what has been seen actually lives.
//
// `state.js` holds the logic - what has been announced, per filter, and when to
// forget it - and knew nothing about files beyond reading and writing one. So
// the bytes moved behind this pair:
//
//   read()        -> the stored text, or null when there is nothing yet
//   write(text)   -> replace it
//   pretty        -> whether to indent (a local file yes, a network copy no)
//
// Three backends are in view. `file` is today's, needs no credential, and is
// what a fresh checkout uses. `gist` puts each user's state in their own gist,
// which is what stops a fork conflicting with upstream on every pull. A hosted
// store is the third, and lands as one more of these rather than a rewrite.
//
// The default stays `file`, and switching is deliberate rather than automatic:
// a run that silently looked somewhere else would find no state, conclude it
// was a first run, and quietly re-baseline the market. `--migrate-state` moves
// the record across once, on purpose.

import config from '../config.js';
import { DEFAULT_STATE_PATH, fileStore } from './file.js';
import { gistStore } from './gist.js';

export { DEFAULT_STATE_PATH };

export const BACKENDS = ['file', 'gist'];

/**
 * The store this run should use.
 *
 * `gist` without a token is a configuration error rather than something to
 * quietly fall back from: falling back to the file would look like it worked
 * while writing somewhere the next run may not read.
 */
export function storeFor(name = config.state.store, options = {}) {
  if (name === 'file') return fileStore(options);
  if (name === 'gist') {
    if (!(options.token ?? config.tco.gistToken)) {
      throw new Error(
        'State is configured to live in the gist, but GIST_TOKEN is not set. ' +
          'Set it, or set state.store = \'file\' in src/config.js.',
      );
    }
    return gistStore(options);
  }
  throw new Error(`Unknown state store "${name}". Use one of: ${BACKENDS.join(', ')}.`);
}
