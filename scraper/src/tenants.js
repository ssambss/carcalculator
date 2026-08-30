// Who this watcher runs for.
//
// One watcher, several people. Each keeps their own data in their own gist on
// their own GitHub account - filters, calculator, and the record of what has
// been announced to them. Nothing of theirs is shared with anyone else's, and
// none of it lives here.
//
// The crawl is what they share: one fetch of a listing page serves everyone
// watching it, so a tenth person costs almost nothing in requests.
//
// ## Naming
//
// A tenant is declared entirely by its secrets - there is no list in the code,
// so onboarding someone is adding two secrets and offboarding is deleting them.
//
//   TENANT_ALICE_GIST_TOKEN    her gist token (classic, `gist` scope only)
//   TENANT_ALICE_WEBHOOK       the Discord webhook for her channel
//   TENANT_ALICE_LABEL         optional display name, for names a secret cannot
//                              spell: "Alice Mäkinen"
//
// Two secrets in the settings UI is the whole of onboarding - no YAML to edit
// and no commit, because the workflow hands the entire secret set over in one
// variable rather than naming each one. See withBundledSecrets below.
//
// Grouped by person rather than by kind (`GIST_TOKEN_ALICE`, `WEBHOOK_ALICE`)
// because GitHub's secrets page sorts alphabetically: this way everything
// belonging to one person sits together, so adding or removing them means
// touching adjacent rows instead of hunting through the list twice.
//
// The owner - you - stays on the original `GIST_TOKEN` and
// `DISCORD_WEBHOOK_URL`, so an existing single-person setup keeps working
// untouched and needs no TENANT_ secrets at all.

import config from './config.js';

/**
 * Secret names are uppercase letters, digits and underscores. `_GIST_TOKEN` is
 * the anchor: a name is a tenant because it has a token, and everything else
 * about them is optional.
 */
const TENANT_TOKEN_RE = /^TENANT_([A-Z0-9][A-Z0-9_]*)_GIST_TOKEN$/;

/** "ALICE" -> "Alice", "MARY_ANN" -> "Mary Ann". */
function titleCase(name) {
  return name
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Secrets arriving as one JSON object, rather than one variable each.
 *
 * GitHub Actions only puts a secret in the environment if the workflow names it
 * in `env:`, which would mean editing YAML - and committing - every time
 * somebody is added. `SECRETS_JSON: ${{ toJSON(secrets) }}` hands the whole set
 * over in one variable instead, so onboarding really is just two secrets in the
 * settings UI.
 *
 * Parsed here rather than by one of the marketplace actions that do this,
 * because those actions would be handling other people's tokens. Ten lines of
 * our own is a better trade.
 *
 * Real environment variables win over the bundle, matching how `.env` is read:
 * that keeps a local override working, and keeps the bundle from shadowing
 * something set deliberately.
 */
function withBundledSecrets(env, log) {
  const raw = env.SECRETS_JSON;
  if (!raw?.trim()) return env;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return env;
    const strings = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') strings[key] = value;
    }
    return { ...strings, ...env };
  } catch (error) {
    // Worth saying out loud: silently ignoring it would look exactly like
    // nobody having been configured.
    log(`  could not read SECRETS_JSON (${error.message}); using plain variables only.`);
    return env;
  }
}

/**
 * The owner's own tenancy, from the secrets that predate tenants.
 *
 * Returns null when neither is set, which is the fresh-install case - the run
 * then has no tenants at all and says so, rather than half-running.
 */
function ownerTenant(env) {
  const gistToken = env.GIST_TOKEN ?? '';
  const webhookUrl = env.DISCORD_WEBHOOK_URL ?? '';
  if (!gistToken && !webhookUrl) return null;
  return {
    id: 'owner',
    label: 'you',
    gistToken,
    webhookUrl,
    // The owner is the only tenant who may be half-configured on purpose: a
    // webhook with no token is exactly the single-person setup that has never
    // connected the app to sync, and it works - filters come from the file.
    ownerish: true,
  };
}

/**
 * Everyone this run should work for, owner first.
 *
 * Discovered from the environment rather than declared in code, so adding a
 * person never needs a commit. The cost of that is a typo in a secret name
 * being silent, which is why `npm run doctor` lists who it found and why a
 * tenant missing half its pair is a loud failure rather than a skip.
 */
export function loadTenants({ env: raw = process.env, log = console.log } = {}) {
  const env = withBundledSecrets(raw, log);
  const tenants = [];
  const problems = [];

  const owner = ownerTenant(env);
  if (owner) tenants.push(owner);

  const names = Object.keys(env)
    .map((key) => TENANT_TOKEN_RE.exec(key)?.[1])
    .filter(Boolean)
    .sort();

  for (const name of names) {
    const gistToken = env[`TENANT_${name}_GIST_TOKEN`] ?? '';
    const webhookUrl = env[`TENANT_${name}_WEBHOOK`] ?? '';
    const label = env[`TENANT_${name}_LABEL`]?.trim() || titleCase(name);

    // Half a tenant is a typo or an unfinished setup, and both deserve to be
    // seen. Skipping quietly would mean someone stops getting posts and nobody
    // finds out until they ask.
    if (!gistToken.trim()) {
      problems.push(`TENANT_${name}_GIST_TOKEN is set but empty.`);
      continue;
    }
    if (!webhookUrl.trim()) {
      problems.push(
        `${label} has TENANT_${name}_GIST_TOKEN but no TENANT_${name}_WEBHOOK, ` +
          'so there is nowhere to post their matches.',
      );
      continue;
    }

    tenants.push({
      id: name.toLowerCase(),
      label,
      gistToken: gistToken.trim(),
      webhookUrl: webhookUrl.trim(),
      ownerish: false,
    });
  }

  return { tenants, problems };
}

/**
 * The tenants a run should actually work for.
 *
 * `only` filters by id or label, the same way `--only` filters filters - useful
 * when onboarding someone, to check their setup without posting to everyone.
 */
export function selectTenants(tenants, only = null) {
  if (!only) return tenants;
  const needle = only.toLowerCase();
  return tenants.filter(
    (tenant) => tenant.id === needle || tenant.label.toLowerCase().includes(needle),
  );
}

/** One line per tenant, for the run log. */
export function describeTenant(tenant) {
  const bits = [tenant.gistToken ? 'own gist' : 'filters from file'];
  bits.push(tenant.webhookUrl ? 'posts to their channel' : 'no channel');
  return `${tenant.label} (${bits.join(', ')})`;
}

/**
 * How many listings one tenant may be sent in a single run.
 *
 * Per tenant, not per run: the cap exists to stop a parsing regression or one
 * very broad new filter flooding a channel, and a shared budget would let one
 * person's backlog starve everyone else out of the run entirely.
 */
export function postCapFor() {
  return config.discord.maxPostsPerRun;
}
