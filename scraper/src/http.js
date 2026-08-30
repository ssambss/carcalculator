// Minimal polite HTTP client: one request at a time per host, paced, retried.

import config from './config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * When we last spoke to each host.
 *
 * Per host rather than one global clock: a run over several sources should not
 * make each one wait out the others' politeness budget, and pacing nettiauto
 * has nothing to do with being a good guest somewhere else. Within a host it is
 * still strictly one request at a time, which is the part that matters.
 */
const lastRequestAt = new Map();

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}

/** Space requests out so we never hammer a site. */
async function pace(host, delayMs) {
  const wait = (lastRequestAt.get(host) ?? 0) + delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Fetch a URL as text, retrying transient failures with linear backoff.
 * Returns null on a 404 (a listing that vanished mid-run is not an error).
 */
export async function fetchText(url, { label = url, delayMs: perSource = null } = {}) {
  const { userAgent, delayMs, timeoutMs, retries, retryBackoffMs } = config.fetch;
  const host = hostOf(url);
  const gap = perSource ?? delayMs;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    await pace(host, gap);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fi-FI,fi;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cache-Control': 'no-cache',
        },
      });

      if (response.status === 404 || response.status === 410) return null;

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} for ${label}`);
        if (!RETRYABLE_STATUS.has(response.status)) throw error;
        lastError = error;
      } else {
        return await response.text();
      }
    } catch (error) {
      // A non-retryable HTTP status rethrows immediately.
      if (error instanceof Error && /^HTTP \d+/.test(error.message) && !lastError) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < retries) {
      const backoff = retryBackoffMs * attempt;
      console.warn(`  retry ${attempt}/${retries - 1} for ${label} in ${backoff}ms (${lastError?.message ?? 'unknown error'})`);
      await sleep(backoff);
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${label}`);
}

/** POST JSON, used for the Discord webhook. Honours 429 Retry-After. */
export async function postJson(url, body, { label = 'webhook', retries = 3 } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.status === 429) {
        const payload = await response.json().catch(() => ({}));
        const waitMs = Math.ceil((payload.retry_after ?? 2) * 1000) + 250;
        console.warn(`  ${label} rate limited, waiting ${waitMs}ms`);
        await sleep(waitMs);
        lastError = new Error('rate limited');
        continue;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${label} failed: HTTP ${response.status} ${text.slice(0, 300)}`);
      }

      return true;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(1500 * attempt);
    }
  }

  throw lastError ?? new Error(`${label} failed`);
}

export { sleep };
