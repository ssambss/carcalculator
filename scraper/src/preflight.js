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
