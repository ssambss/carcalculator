// Minimal polite HTTP client: sequential, paced, retried.

import config from './config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lastRequestAt = 0;

/** Space requests out so we never hammer nettiauto. */
async function pace(delayMs) {
  const wait = lastRequestAt + delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Fetch a URL as text, retrying transient failures with linear backoff.
 * Returns null on a 404 (a listing that vanished mid-run is not an error).
 */
export async function fetchText(url, { label = url } = {}) {
  const { userAgent, delayMs, timeoutMs, retries, retryBackoffMs } = config.fetch;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    await pace(delayMs);
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
