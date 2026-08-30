// When to try again, and how long to wait.
//
// Pulled out of http.js so it can be tested without a network. The policy is
// the part that matters and the part that is easy to get subtly wrong; the
// fetching around it is a few lines.
//
// Written after two scheduled runs failed at the crawl step, one of them in
// thirty seconds - the shape of "gave up quickly" rather than "tried hard and
// lost". Three attempts with a flat four-second gap is thin for a site that owes
// us nothing and occasionally says no.

/**
 * Statuses worth trying again.
 *
 * The 5xx family and the explicit back-off codes, plus Cloudflare's 52x range,
 * which is what a site behind it returns when its own origin is unhappy - those
 * are transient by definition.
 *
 * Deliberately absent: **403**. Sometimes it is a bot block that would pass on
 * a retry, and hammering it is exactly the behaviour that earns a longer one. A
 * 403 stops the request and says so, which is the honest outcome.
 */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 527]);

export function isRetryableStatus(status) {
  return RETRYABLE.has(status);
}

/** A 404 or 410 is an answer, not a failure: the listing is simply gone. */
export function isGone(status) {
  return status === 404 || status === 410;
}

/**
 * `Retry-After`, in milliseconds, or null when the header says nothing useful.
 *
 * Both forms are legal: a number of seconds, or an HTTP date. Honouring it is
 * the difference between backing off and being told to back off twice - and
 * `fetchText` ignored it entirely before, so a 429 was retried after the flat
 * four seconds and usually met another 429.
 */
export function retryAfterMs(header, now = Date.now()) {
  if (!header) return null;
  const text = String(header).trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const seconds = Number.parseInt(text, 10);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }

  const at = Date.parse(text);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - now);
}

/**
 * How long to wait before attempt `attempt + 1`.
 *
 * Exponential with full jitter, capped. Exponential because a site that is busy
 * now is likely still busy in four seconds; jittered because several sources
 * retrying in lockstep is a small thundering herd; capped because a run has a
 * job timeout and waiting five minutes inside it helps nobody.
 *
 * A server's own `Retry-After` always wins - it knows and we are guessing - but
 * it is still capped, or a site could park the run for an hour.
 */
export function backoffMs({
  attempt,
  baseMs = 4000,
  maxMs = 60000,
  retryAfter = null,
  random = Math.random,
}) {
  if (retryAfter !== null && retryAfter >= 0) return Math.min(retryAfter, maxMs);
  const ceiling = Math.min(baseMs * 2 ** (attempt - 1), maxMs);
  // Full jitter: anywhere in [base, ceiling]. Never zero, so a retry is always
  // a pause rather than an immediate second go at the same server.
  return Math.round(baseMs + random() * Math.max(0, ceiling - baseMs));
}

/**
 * What one attempt's outcome means for the next.
 *
 * Returns `'return'` (use it), `'gone'` (a 404, the caller gets null),
 * `'retry'`, or `'fail'`. Splitting this out fixed a real bug: the old inline
 * version rethrew a non-retryable status only when no earlier attempt had
 * failed, so a 503 followed by a 403 kept retrying the 403.
 */
export function outcomeOf({ status = null, networkError = false }) {
  if (networkError) return 'retry';
  if (status === null) return 'fail';
  if (isGone(status)) return 'gone';
  if (status >= 200 && status < 300) return 'return';
  return isRetryableStatus(status) ? 'retry' : 'fail';
}
