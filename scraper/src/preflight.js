// Deciding whether a run can go ahead, before it spends any requests.
//
// One rule lives here, and it exists because a missing webhook means two
// opposite things:
//
//   a fork nobody has configured yet   -> say what to set, exit 0
//   a watcher that used to post         -> fail loudly, the channel is dark
//
// Same absent value, and getting it backwards is costly either way. Exiting 0
// on a real regression hides it for as long as nobody looks at the channel;
// failing on a fresh fork mails its owner a failure every half hour until they
// find the off switch.
//
// The state file settles it: a watcher that has completed runs has been
// configured at some point, whatever it looks like now.

/**
 * Can this run post, and if not, whose problem is it?
 *
 * Returns `'ready'`, `'unconfigured'` (never ran - onboard and stop) or
 * `'regressed'` (ran before, so something was taken away).
 *
 * `needsPosting` is false for --dry-run, --list and --seed: none of them post,
 * so none of them care whether a webhook exists.
 */
export function postingReadiness({ webhookUrl, isNew, runs, needsPosting = true }) {
  if (!needsPosting) return 'ready';
  if (webhookUrl) return 'ready';
  return !isNew && (runs ?? 0) > 0 ? 'regressed' : 'unconfigured';
}

/** Which flags mean "this run has nothing to post". */
export function needsPosting({ dryRun = false, list = false, seed = false } = {}) {
  return !dryRun && !list && !seed;
}

/**
 * How a run ends when it worked for some people and not others.
 *
 * Returns a message when somebody failed, null when nobody did. The caller
 * throws it, and throws it *last*: throwing is what turns the workflow run red
 * and fires `--notify-errors`, while doing it after everyone else has been
 * served is what stops one person's expired token or deleted channel costing
 * the rest of the family their watcher.
 *
 * Both halves matter. Failing immediately made one person's problem everyone's;
 * swallowing it would leave somebody quietly unwatched, which is the failure
 * nobody notices until they ask why the channel went silent.
 */
export function failureSummary(failures, tenantCount) {
  if (!failures?.length) return null;
  const names = failures.map(({ tenant }) => tenant?.label ?? 'unknown').join(', ');
  return (
    `${failures.length} of ${tenantCount} tenant(s) failed: ${names}. ` +
    'Everyone else was served; their messages are above. ' +
    'Run `npm run doctor` to check each of them.'
  );
}

/**
 * Has enough time passed since the last real run to crawl again?
 *
 * This exists because GitHub's scheduler is unreliable in one direction and we
 * must not become unreliable in the other. Measured over four days, `7,37` fired
 * **17 times out of an expected 185** - a 9 % hit rate, median gap 5.7 hours -
 * and none of the misses were ours: no cancelled runs, every run under three
 * minutes. GitHub simply drops them.
 *
 * The fix is to ask for far more firings than we want and throttle here. Asking
 * for twelve an hour and taking whatever arrives would be six times the load on
 * a site that owes us nothing; asking for twelve and crawling at most every
 * `minMinutes` converges on the rate we actually intend, however many GitHub
 * decides to deliver. It is also self-correcting if their scheduler improves.
 *
 * Returns `'ready'` or `'too-soon'`.
 */
export function crawlReadiness({ lastRunAt, minMinutes = 0, now = Date.now(), force = false }) {
  if (force || minMinutes <= 0 || !lastRunAt) return 'ready';
  const age = (now - Date.parse(lastRunAt)) / 60000;
  // An unparseable timestamp is not a reason to stop running.
  if (!Number.isFinite(age)) return 'ready';
  return age < minMinutes ? 'too-soon' : 'ready';
}

/**
 * How long the watcher has been quiet, and whether that is worth saying out loud.
 *
 * The schedule degrading is invisible by design: every individual run succeeds,
 * so nothing fails and nobody is told. It took reading the Actions API to notice
 * a six-hour median gap. This turns that into a message.
 *
 * Rate-limited by `noticeEverySeconds` against the last notice, because if runs
 * are rare then a notice on every run is itself rare enough to be useful but
 * frequent enough to be ignored.
 */
export function stalenessNotice({
  lastRunAt,
  lastNoticeAt = null,
  staleAfterMinutes = 0,
  noticeEveryMinutes = 720,
  now = Date.now(),
}) {
  if (staleAfterMinutes <= 0 || !lastRunAt) return null;
  const gap = (now - Date.parse(lastRunAt)) / 60000;
  if (!Number.isFinite(gap) || gap < staleAfterMinutes) return null;

  if (lastNoticeAt) {
    const sinceNotice = (now - Date.parse(lastNoticeAt)) / 60000;
    if (Number.isFinite(sinceNotice) && sinceNotice < noticeEveryMinutes) return null;
  }

  const hours = (gap / 60).toFixed(1);
  return (
    `The previous run was ${hours} h ago, not the ${staleAfterMinutes} min or less ` +
    'it should be. GitHub drops most scheduled firings under load, so listings are ' +
    'arriving late rather than not at all. See PLAN.md, "the schedule".'
  );
}
