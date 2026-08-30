// Minimal polite HTTP client: one request at a time per host, paced, retried.

import config from './config.js';
import { backoffMs, outcomeOf, retryAfterMs } from './retry.js';

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

/**
 * Fetch a URL as text, retrying transient failures.
 *
 * Returns null when the page is gone (404/410) - a listing that vanished
 * mid-run is not an error. Throws when every attempt failed, with what was
 * actually seen, because "Failed to fetch" in an Actions log tells nobody
 * anything: two scheduled runs died at the crawl step and the message was not
 * enough to say why.
 *
 * The policy - which statuses are worth another go, how long to wait, whether to
 * honour the server's own Retry-After - lives in retry.js, where it can be
 * tested without a network.
 */
export async function fetchText(url, { label = url, delayMs: perSource = null } = {}) {
  const { userAgent, delayMs, timeoutMs, retries, retryBackoffMs, retryMaxBackoffMs } =
    config.fetch;
  const host = hostOf(url);
  const gap = perSource ?? delayMs;
  const started = Date.now();
  // Every attempt's outcome, so a final failure can say what actually happened
  // rather than only how the last one ended.
  const seen = [];
  let lastError;
  // Set when an attempt saw something no retry will improve on.
  let giveUp = false;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    await pace(host, gap);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let retryAfter = null;

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

      const outcome = outcomeOf({ status: response.status });
      seen.push(`HTTP ${response.status}`);

      if (outcome === 'gone') return null;
      if (outcome === 'return') return await response.text();

      retryAfter = retryAfterMs(response.headers.get('retry-after'));
      lastError = new Error(`HTTP ${response.status} for ${label}`);
      // A status no amount of waiting will change - a 403 block, a 400 - stops
      // here rather than being hammered. Flagged rather than thrown, so there is
      // one exit and one place that builds the message.
      if (outcome === 'fail') giveUp = true;
    } catch (error) {
      // A network-level failure: DNS, a reset, or our own timeout firing.
      const aborted = error?.name === 'AbortError';
      seen.push(aborted ? `timeout after ${timeoutMs} ms` : (error?.message ?? 'network error'));
      lastError = error;
    } finally {
      clearTimeout(timer);
    }

    if (giveUp) throw describeFailure({ label, seen, started, cause: lastError });

    if (attempt < retries) {
      const wait = backoffMs({
        attempt,
        baseMs: retryBackoffMs,
        maxMs: retryMaxBackoffMs,
        retryAfter,
      });
      console.warn(
        `  ${label}: ${seen[seen.length - 1]}; retry ${attempt}/${retries - 1} in ` +
          `${Math.round(wait / 1000)}s`,
      );
      await sleep(wait);
    }
  }

  throw describeFailure({ label, seen, started, cause: lastError });
}

/**
 * One error that says what the whole attempt sequence saw.
 *
 * Every retry's outcome and the elapsed time, so an Actions log read days later
 * distinguishes "the site said 403 three times" from "three timeouts" from "DNS
 * never resolved" - which the previous single-line message could not.
 */
function describeFailure({ label, seen, started, cause }) {
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const error = new Error(
    `Could not fetch ${label} after ${seen.length} attempt(s) in ${elapsed}s: ` +
      `${seen.join(' -> ')}`,
  );
  error.cause = cause;
  error.attempts = seen.length;
  return error;
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
