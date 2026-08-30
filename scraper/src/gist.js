// Reading and writing a gist.
//
// Plumbing only: the GitHub calls, and finding the gist. What a reacted listing
// turns into once it gets there belongs to a sink - see src/sinks/.
//
// Every function takes the token explicitly, and there is no default. The
// watcher runs for several people, each with their own gist and their own
// token; an implicit token would quietly write one person's cars into another's
// calculator on nothing worse than a forgotten argument.
//
// Two contracts to honour, both defined by src/sync.ts and src/storage.ts in
// the repo root:
//
//  - The envelope is { app, savedAt, data } and the app applies remote data
//    only when its savedAt is NEWER than the device's last local edit. So a
//    stamp that is not current would make the app ignore the write forever.
//  - The app is last-write-wins: a device holding older local edits will push
//    its own data over ours. The caller handles that by verifying cars are
//    still present on later runs and re-adding them (see index.js).

import config from './config.js';

const API = 'https://api.github.com';

async function github(path, init = {}, token) {
  // No default. It used to fall back to the owner's token, which meant any
  // caller that forgot to pass one silently read and wrote the owner's gist
  // instead of the tenant's - the quietest possible version of exactly the bug
  // this module exists to avoid. Missing is now an error.
  if (!token) {
    throw new Error(
      'No gist token passed. Every gist call names whose gist it is talking to; ' +
        'see src/tenants.js.',
    );
  }
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'listing-watch (carcalculator)',
      ...init.headers,
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('GitHub rejected the gist token - it needs the "gist" scope.');
  }
  if (!response.ok) throw new Error(`GitHub API error ${response.status} for ${path}`);
  return response;
}

/**
 * Find the gist this watcher shares with the app.
 *
 * Any of the files we know about identifies it, not just the calculator's data
 * file: a watcher following flats has no car data to find, and would otherwise
 * be unable to locate its own gist. The car data file is tried first because
 * that is the one the app creates, so it is the usual answer.
 */
export async function findTcoGist(token) {
  const markers = [config.tco.gistFilename, config.filters.gistFilename, config.state.gistFilename];
  const response = await github('/gists?per_page=100', {}, token);
  const gists = await response.json();
  const match = Array.isArray(gists)
    ? gists.find((gist) => gist.files && markers.some((name) => name in gist.files))
    : null;
  if (!match) {
    throw new Error(
      `No gist on this account holds any of: ${markers.join(', ')}. Connect the app to ` +
        'GitHub sync first (cloud button in the header) - the scraper joins an existing ' +
        'sync, it does not start one.',
    );
  }
  return match.id;
}

/**
 * Read one JSON file out of the gist, or null when the gist has no such file.
 *
 * The gist holds more than the car data: the app also syncs the scraper's
 * filters into a file of its own here (see filters.js).
 */
export async function readGistFile(gistId, filename, token) {
  const response = await github(`/gists/${gistId}`, {}, token);
  const gist = await response.json();
  const file = gist.files?.[filename];
  if (!file) return null;
  let content = file.content ?? '';
  if (file.truncated && file.raw_url) {
    content = await (await fetch(file.raw_url)).text();
  }
  return JSON.parse(content);
}

export async function readTcoData(gistId, token) {
  const filename = config.tco.gistFilename;
  const parsed = await readGistFile(gistId, filename, token);
  if (!parsed) throw new Error(`Gist ${gistId} no longer has ${filename}.`);
  if (typeof parsed !== 'object' || !parsed.data || !Array.isArray(parsed.data.cars)) {
    throw new Error('The gist data does not look like calculator data; refusing to write over it.');
  }
  return parsed;
}

/** Replace one file in the gist, leaving every other file alone. */
export async function writeGistFile(gistId, filename, content, token) {
  await github(
    `/gists/${gistId}`,
    { method: 'PATCH', body: JSON.stringify({ files: { [filename]: { content } } }) },
    token,
  );
}

export async function writeTcoData(gistId, envelope, token) {
  await writeGistFile(
    gistId,
    config.tco.gistFilename,
    `${JSON.stringify(envelope, null, 2)}\n`,
    token,
  );
}
