// The state file on disk.
//
// The default, and the only backend that needs no credential - so it is what a
// fresh checkout and a local run use. In CI it is the file the workflow commits
// back after each run, which is what makes runs remember each other.
//
// Written atomically: a half-written state file would either replay old
// listings or lose new ones, and a run interrupted mid-write is not rare enough
// to ignore.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STATE_PATH = resolve(HERE, '..', '..', 'data', 'seen.json');

export function fileStore({ path = DEFAULT_STATE_PATH } = {}) {
  return {
    id: 'file',
    describe: () => path,

    /**
     * Indented, unlike the gist backend.
     *
     * It costs about a third of the file - 768 KB against 528 KB at a thousand
     * listings - but this is the copy a human opens when a verdict looks wrong,
     * and it is the copy git has to diff. Worth the bytes on a local disk;
     * not worth them over the network.
     */
    pretty: true,

    async read() {
      try {
        return await readFile(path, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },

    async write(text) {
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.tmp`;
      await writeFile(temp, text, 'utf8');
      await rename(temp, path);
    },
  };
}
