// Getting secrets into process.env before anything reads them.
//
// Two sources, both tiny and dependency-free, and in both cases an existing
// environment variable wins:
//
//   .env          a gitignored file, so the webhook need not be committed
//   SECRETS_JSON  the whole Actions secret set in one variable (see below)
//
// Order matters more than it looks: src/config.js reads individual variables at
// import time, so both of these have to run before it loads. That is why
// index.js imports this statically and everything else dynamically.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ENV_PATH = resolve(HERE, '..', '.env');

export async function loadEnvFile(path = DEFAULT_ENV_PATH) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }

  let loaded = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (Object.hasOwn(process.env, key)) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
    loaded += 1;
  }
  return loaded;
}

/**
 * Expand `SECRETS_JSON` into individual environment variables.
 *
 * GitHub Actions only puts a secret in the environment if the workflow names it
 * in `env:`, so a watcher running for several people would need a YAML edit -
 * and a commit - every time somebody was added. The workflow passes
 * `SECRETS_JSON: ${{ toJSON(secrets) }}` instead and this unpacks it, so
 * onboarding is two secrets in the settings UI and nothing else.
 *
 * Unpacked rather than read in place because config.js reads named variables at
 * import time; and done here rather than by one of the marketplace actions that
 * offer it, because those would be handling other people's tokens.
 *
 * Existing variables win, so a local .env or a deliberate override still beats
 * the bundle.
 */
export function expandSecretsJson(env = process.env) {
  const raw = env.SECRETS_JSON;
  if (!raw?.trim()) return 0;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // Loud: swallowing this looks exactly like nobody having been configured.
    console.warn(`  could not read SECRETS_JSON (${error.message}); ignoring it.`);
    return 0;
  }
  if (!parsed || typeof parsed !== 'object') return 0;

  let loaded = 0;
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') continue;
    if (key === 'SECRETS_JSON' || Object.hasOwn(env, key)) continue;
    env[key] = value;
    loaded += 1;
  }
  return loaded;
}
