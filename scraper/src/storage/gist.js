// The state, kept in the user's own gist.
//
// Why this exists: the file backend's state is committed back to the repo after
// every run, which makes it *the repo's* state rather than a user's. Two people
// cannot share it, and a fork diverges on it from its first run and then
// conflicts on every pull from upstream, forever. Keeping it beside the filters
// in the gist that already belongs to whoever owns the data fixes both, and
// removes the workflow's need for write access to the repo at all.
//
// It is also the shape the hosted store slots into later (see PLAN.md phase 6):
// one more backend behind the same read/write pair, rather than a rewrite.

import config from '../config.js';
import { findTcoGist, readGistFile, writeGistFile } from '../gist.js';

/**
 * When to start complaining about size.
 *
 * The GitHub API truncates a gist file's inline content past about a megabyte -
 * `readGistFile` already falls back to `raw_url` for that, so reading keeps
 * working - but a state file heading for that size is a signal in itself.
 * Minified, a thousand listings is ~530 KB, so this is roughly two thousand.
 *
 * The answer if it is ever reached is the hosted store, not a bigger JSON blob.
 */
const WARN_BYTES = 900_000;

export function gistStore({
  filename = config.state.gistFilename,
  log = console.log,
  token = config.tco.gistToken,
} = {}) {
  let gistId = null;

  async function id() {
    gistId ??= await findTcoGist(token);
    return gistId;
  }

  return {
    id: 'gist',
    describe: () => `${filename} in your gist`,

    /**
     * Minified, unlike the file backend.
     *
     * Indentation is about a third of the bytes and nobody reads this copy by
     * hand - it is fetched and rewritten over the network every half hour.
     */
    pretty: false,

    async read() {
      const parsed = await readGistFile(await id(), filename, token);
      // readGistFile parses; the state layer wants text either way, so this
      // hands back a canonical serialization rather than the original bytes.
      return parsed === null ? null : JSON.stringify(parsed);
    },

    async write(text) {
      if (text.length > WARN_BYTES) {
        log(
          `  WARNING: the state file is ${Math.round(text.length / 1024)} KB, close to the ` +
            'size where GitHub truncates a gist file. Reading still works, but this is the ' +
            'point to move to a real store rather than a larger blob (see PLAN.md phase 6).',
        );
      }
      await writeGistFile(await id(), filename, text, token);
    },
  };
}
