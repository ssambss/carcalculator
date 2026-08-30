// Not giving up too easily, and not hammering anybody either.
//
// Two things prompted these. Scheduled runs were firing 17 times against an
// expected 185 - a 9 % hit rate, median gap 5.7 hours - so the schedule now asks
// for far more firings than it wants and the run decides which of them crawls.
// And two runs died at the crawl step, one of them in thirty seconds, which is
// the shape of giving up quickly rather than trying hard and losing.
//
// The policies are pure functions precisely so they can be checked here rather
// than inferred from a site's mood.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { backoffMs, isGone, isRetryableStatus, outcomeOf, retryAfterMs } from '../src/retry.js';
import { crawlReadiness, stalenessNotice } from '../src/preflight.js';

describe('which failures are worth another go', () => {
  it('retries the transient statuses', () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      assert.equal(isRetryableStatus(status), true, `HTTP ${status}`);
    }
  });

  it('retries the Cloudflare 52x range', () => {
    // What a site behind Cloudflare returns when its own origin is unhappy -
    // transient by definition, and previously treated as fatal.
    for (const status of [520, 521, 522, 524, 525, 527]) {
      assert.equal(isRetryableStatus(status), true, `HTTP ${status}`);
    }
  });

  it('does not retry a 403', () => {
    // Sometimes a bot block that would pass on a retry - and hammering it is
    // exactly the behaviour that earns a longer one.
    assert.equal(isRetryableStatus(403), false);
    assert.equal(isRetryableStatus(400), false);
    assert.equal(isRetryableStatus(401), false);
  });

  it('treats a vanished listing as an answer, not a failure', () => {
    assert.equal(isGone(404), true);
    assert.equal(isGone(410), true);
    assert.equal(isGone(500), false);
  });

  it('classifies each outcome exactly once', () => {
    assert.equal(outcomeOf({ status: 200 }), 'return');
    assert.equal(outcomeOf({ status: 204 }), 'return');
    assert.equal(outcomeOf({ status: 404 }), 'gone');
    assert.equal(outcomeOf({ status: 503 }), 'retry');
    assert.equal(outcomeOf({ status: 403 }), 'fail');
    assert.equal(outcomeOf({ networkError: true }), 'retry');
    assert.equal(outcomeOf({}), 'fail');
  });

  it('keeps a hard status hard even after a soft one', () => {
    // The bug this replaced: the inline version rethrew a non-retryable status
    // only when no earlier attempt had failed, so a 503 followed by a 403 kept
    // retrying the 403. Classification cannot depend on history.
    assert.equal(outcomeOf({ status: 503 }), 'retry');
    assert.equal(outcomeOf({ status: 403 }), 'fail');
  });
});

describe('how long to wait', () => {
  const noJitter = () => 0;
  const fullJitter = () => 1;

  it('grows exponentially rather than flatly', () => {
    // A site that is busy now is likely still busy in four seconds.
    const ceilings = [1, 2, 3, 4].map((attempt) =>
      backoffMs({ attempt, baseMs: 1000, maxMs: 60000, random: fullJitter }),
    );
    assert.deepEqual(ceilings, [1000, 2000, 4000, 8000]);
  });

  it('never waits less than the base, or nothing at all', () => {
    // A retry has to be a pause. Zero would be an immediate second go at the
    // same server, which is the opposite of backing off.
    for (const attempt of [1, 2, 5]) {
      const wait = backoffMs({ attempt, baseMs: 4000, random: noJitter });
      assert.equal(wait, 4000, `attempt ${attempt}`);
    }
  });

  it('jitters between the base and the ceiling', () => {
    // Several sources retrying in lockstep is a small thundering herd.
    const waits = new Set();
    for (let i = 0; i < 50; i += 1) {
      waits.add(backoffMs({ attempt: 4, baseMs: 1000, maxMs: 60000 }));
    }
    assert.ok(waits.size > 10, 'should not be a fixed value');
    for (const wait of waits) {
      assert.ok(wait >= 1000 && wait <= 8000, `${wait} outside [1000, 8000]`);
    }
  });

  it('caps, so a run cannot park itself past its own job timeout', () => {
    assert.equal(backoffMs({ attempt: 20, baseMs: 4000, maxMs: 45000, random: fullJitter }), 45000);
  });

  it("obeys the server's own Retry-After over its own guess", () => {
    // It knows and we are guessing.
    assert.equal(backoffMs({ attempt: 1, baseMs: 4000, retryAfter: 30000 }), 30000);
  });

  it('still caps a Retry-After, so a site cannot park the run for an hour', () => {
    assert.equal(backoffMs({ attempt: 1, maxMs: 45000, retryAfter: 3600000 }), 45000);
  });
});

describe('reading Retry-After', () => {
  it('takes a plain number of seconds', () => {
    assert.equal(retryAfterMs('30'), 30000);
    assert.equal(retryAfterMs('0'), 0);
  });

  it('takes an HTTP date', () => {
    const now = Date.parse('2026-08-30T12:00:00Z');
    assert.equal(retryAfterMs('Sun, 30 Aug 2026 12:00:45 GMT', now), 45000);
  });

  it('never returns a negative wait for a date already past', () => {
    const now = Date.parse('2026-08-30T12:00:00Z');
    assert.equal(retryAfterMs('Sun, 30 Aug 2026 11:59:00 GMT', now), 0);
  });

  it('ignores anything it cannot read', () => {
    for (const header of [null, undefined, '', '   ', 'soon', 'later please']) {
      assert.equal(retryAfterMs(header), null, JSON.stringify(header));
    }
  });
});

describe('deciding whether a firing should crawl', () => {
  const minMinutes = 25;
  const now = Date.parse('2026-08-30T12:00:00Z');
  const minutesAgo = (n) => new Date(now - n * 60000).toISOString();

  it('crawls when there is no previous run at all', () => {
    assert.equal(crawlReadiness({ lastRunAt: null, minMinutes, now }), 'ready');
  });

  it('crawls once the gap has passed', () => {
    assert.equal(crawlReadiness({ lastRunAt: minutesAgo(26), minMinutes, now }), 'ready');
  });

  it('stands down when the last run was too recent', () => {
    // This is what stops twelve firings an hour becoming twelve crawls an hour
    // on the rare stretches when GitHub delivers most of them.
    assert.equal(crawlReadiness({ lastRunAt: minutesAgo(4), minMinutes, now }), 'too-soon');
  });

  it('is overridable, because a deliberate run should always work', () => {
    assert.equal(
      crawlReadiness({ lastRunAt: minutesAgo(1), minMinutes, now, force: true }),
      'ready',
    );
  });

  it('does nothing when the throttle is switched off', () => {
    assert.equal(crawlReadiness({ lastRunAt: minutesAgo(1), minMinutes: 0, now }), 'ready');
  });

  it('crawls rather than stalls on a timestamp it cannot read', () => {
    // A corrupt or hand-edited record must not be able to switch the watcher
    // off silently.
    assert.equal(crawlReadiness({ lastRunAt: 'yesterday', minMinutes, now }), 'ready');
  });
});

describe('noticing that the watcher went quiet', () => {
  const now = Date.parse('2026-08-30T12:00:00Z');
  const hoursAgo = (n) => new Date(now - n * 3600000).toISOString();
  const base = { staleAfterMinutes: 120, noticeEveryMinutes: 720, now };

  it('says nothing while runs are arriving as intended', () => {
    assert.equal(stalenessNotice({ ...base, lastRunAt: hoursAgo(0.5) }), null);
  });

  it('speaks up after a long silence', () => {
    // Every individual run succeeds, so nothing fails and nobody is told. It
    // took reading the Actions API to notice a six-hour median gap.
    const notice = stalenessNotice({ ...base, lastRunAt: hoursAgo(6) });
    assert.match(notice, /6\.0 h ago/);
    assert.match(notice, /drops most scheduled firings/);
  });

  it('does not repeat itself within the notice window', () => {
    // A persistently bad schedule should say so without saying it every run.
    assert.equal(
      stalenessNotice({ ...base, lastRunAt: hoursAgo(6), lastNoticeAt: hoursAgo(2) }),
      null,
    );
  });

  it('speaks again once the window has passed', () => {
    assert.ok(stalenessNotice({ ...base, lastRunAt: hoursAgo(6), lastNoticeAt: hoursAgo(13) }));
  });

  it('stays quiet when switched off, or on a first run', () => {
    assert.equal(stalenessNotice({ ...base, lastRunAt: hoursAgo(6), staleAfterMinutes: 0 }), null);
    assert.equal(stalenessNotice({ ...base, lastRunAt: null }), null);
  });
});
