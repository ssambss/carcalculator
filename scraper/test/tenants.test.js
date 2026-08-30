// One watcher, several people: who it runs for and how they are told apart.
//
// The naming scheme is load-bearing rather than cosmetic - a tenant exists
// because its secrets exist, so a typo in a secret name is a person who
// silently stops getting posts. Most of what follows is about making that
// impossible.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeTenant, loadTenants, postCapFor, selectTenants } from '../src/tenants.js';
import { expandSecretsJson } from '../src/env.js';
import { failureSummary } from '../src/preflight.js';

/** The owner's secrets, as they have always been named. */
const OWNER = { GIST_TOKEN: 'owner-token', DISCORD_WEBHOOK_URL: 'https://hook/owner' };

const ALICE = {
  TENANT_ALICE_GIST_TOKEN: 'alice-token',
  TENANT_ALICE_WEBHOOK: 'https://hook/alice',
};

const quiet = { log: () => {} };
const load = (env) => loadTenants({ env, ...quiet });

describe('who the watcher runs for', () => {
  it('runs for nobody when nothing is configured', () => {
    // A fresh fork. The run says so and exits 0 rather than half-working.
    const { tenants, problems } = load({});
    assert.deepEqual(tenants, []);
    assert.deepEqual(problems, []);
  });

  it('keeps a single-person setup working untouched', () => {
    // The whole point of leaving the owner on the original secret names: an
    // existing installation needs no TENANT_ secrets and behaves as before.
    const { tenants } = load({ ...OWNER });
    assert.equal(tenants.length, 1);
    assert.equal(tenants[0].id, 'owner');
    assert.equal(tenants[0].ownerish, true);
    assert.equal(tenants[0].gistToken, 'owner-token');
  });

  it('lets the owner run on a webhook alone', () => {
    // A watcher that has never connected the app to sync is a real, working
    // configuration: filters come from the committed file.
    const { tenants, problems } = load({ DISCORD_WEBHOOK_URL: 'https://hook/owner' });
    assert.equal(tenants.length, 1);
    assert.equal(tenants[0].gistToken, '');
    assert.deepEqual(problems, []);
  });

  it('finds someone from their pair of secrets, owner first', () => {
    const { tenants } = load({ ...OWNER, ...ALICE });
    assert.deepEqual(
      tenants.map((tenant) => tenant.id),
      ['owner', 'alice'],
    );
    assert.equal(tenants[1].gistToken, 'alice-token');
    assert.equal(tenants[1].webhookUrl, 'https://hook/alice');
    assert.equal(tenants[1].ownerish, false);
  });

  it('orders everyone else alphabetically, so a run log reads the same twice', () => {
    const { tenants } = load({
      ...OWNER,
      TENANT_ZOE_GIST_TOKEN: 'z',
      TENANT_ZOE_WEBHOOK: 'https://hook/z',
      ...ALICE,
      TENANT_MIKA_GIST_TOKEN: 'm',
      TENANT_MIKA_WEBHOOK: 'https://hook/m',
    });
    assert.deepEqual(
      tenants.map((tenant) => tenant.id),
      ['owner', 'alice', 'mika', 'zoe'],
    );
  });

  it('reads a name out of the secret, and multi-word names too', () => {
    const { tenants } = load({
      TENANT_MARY_ANN_GIST_TOKEN: 'm',
      TENANT_MARY_ANN_WEBHOOK: 'https://hook/m',
    });
    assert.equal(tenants[0].id, 'mary_ann');
    assert.equal(tenants[0].label, 'Mary Ann');
  });

  it('takes a label for a name a secret cannot spell', () => {
    // Secret names are ASCII, and plenty of real names are not.
    const { tenants } = load({
      ...ALICE,
      TENANT_ALICE_LABEL: 'Alice Mäkinen',
    });
    assert.equal(tenants[0].label, 'Alice Mäkinen');
  });
});

describe('a half-configured person', () => {
  it('is reported, not skipped, when the webhook is missing', () => {
    // Skipping quietly means somebody stops getting posts and nobody finds out
    // until they ask why it went silent.
    const { tenants, problems } = load({ TENANT_CARL_GIST_TOKEN: 'c' });
    assert.deepEqual(tenants, []);
    assert.equal(problems.length, 1);
    // The message names the secret as it actually is, so it can be found.
    assert.match(problems[0], /TENANT_CARL_WEBHOOK/);
  });

  it('is reported when the token is there but empty', () => {
    const { problems } = load({
      TENANT_CARL_GIST_TOKEN: '   ',
      TENANT_CARL_WEBHOOK: 'https://hook/c',
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /TENANT_CARL_GIST_TOKEN/);
  });

  it('does not let one broken person hide the others', () => {
    const { tenants, problems } = load({ ...OWNER, ...ALICE, TENANT_CARL_GIST_TOKEN: 'c' });
    assert.deepEqual(
      tenants.map((tenant) => tenant.id),
      ['owner', 'alice'],
    );
    assert.equal(problems.length, 1);
  });

  it('ignores a secret that is not a tenant at all', () => {
    const { tenants, problems } = load({
      ...OWNER,
      TENANT_ALICE_WEBHOOK: 'https://hook/alice',
      SOME_OTHER_SECRET: 'x',
      TENANT_: 'malformed',
    });
    // No _GIST_TOKEN means no tenant - a webhook alone names nobody, and there
    // is nothing to warn about because nothing claims to be a person.
    assert.deepEqual(
      tenants.map((tenant) => tenant.id),
      ['owner'],
    );
    assert.deepEqual(problems, []);
  });
});

describe('picking one person to run for', () => {
  const { tenants } = load({ ...OWNER, ...ALICE });

  it('runs for everyone by default', () => {
    assert.equal(selectTenants(tenants).length, 2);
  });

  it('matches on id or name, case-insensitively', () => {
    // For checking somebody's setup without posting to everybody.
    assert.deepEqual(
      selectTenants(tenants, 'alice').map((t) => t.id),
      ['alice'],
    );
    assert.deepEqual(
      selectTenants(tenants, 'Alice').map((t) => t.id),
      ['alice'],
    );
  });

  it('matches nobody rather than everybody on a typo', () => {
    // The caller turns this into a non-zero exit. Falling back to everyone
    // would post to the whole family on a mistyped name.
    assert.deepEqual(selectTenants(tenants, 'alise'), []);
  });
});

describe('secrets arriving as one bundle', () => {
  // Actions only puts a secret in the environment if the workflow names it, so
  // naming them one by one would mean editing YAML every time somebody joins.

  it('unpacks the bundle into individual variables', () => {
    const env = { SECRETS_JSON: JSON.stringify({ ...OWNER, ...ALICE }) };
    const loaded = expandSecretsJson(env);
    assert.equal(loaded, 4);
    assert.equal(env.GIST_TOKEN, 'owner-token');
    assert.equal(env.TENANT_ALICE_WEBHOOK, 'https://hook/alice');
    // And then the tenants fall out of it.
    assert.deepEqual(
      load(env).tenants.map((tenant) => tenant.id),
      ['owner', 'alice'],
    );
  });

  it('lets a real variable win over the bundle', () => {
    // Matches how .env is read, so a deliberate local override still works.
    const env = {
      SECRETS_JSON: JSON.stringify({ GIST_TOKEN: 'from-bundle' }),
      GIST_TOKEN: 'from-environment',
    };
    expandSecretsJson(env);
    assert.equal(env.GIST_TOKEN, 'from-environment');
  });

  it('does nothing when there is no bundle', () => {
    assert.equal(expandSecretsJson({}), 0);
    assert.equal(expandSecretsJson({ SECRETS_JSON: '  ' }), 0);
  });

  it('survives a bundle that is not JSON', () => {
    // Reported by the caller rather than thrown: the rest of the run is still
    // worth doing on whatever plain variables exist.
    assert.equal(expandSecretsJson({ SECRETS_JSON: '{nope' }), 0);
    assert.equal(expandSecretsJson({ SECRETS_JSON: '"a string"' }), 0);
  });

  it('ignores non-string values instead of stringifying them', () => {
    const env = { SECRETS_JSON: JSON.stringify({ A: 'yes', B: 7, C: null }) };
    assert.equal(expandSecretsJson(env), 1);
    assert.equal(env.A, 'yes');
    assert.equal(env.B, undefined);
  });
});

describe('the post cap', () => {
  it('is per person, not per run', () => {
    // A shared budget would let one person's backlog starve everyone else out
    // of the run entirely.
    const { tenants } = load({ ...OWNER, ...ALICE });
    const caps = tenants.map((tenant) => postCapFor(tenant));
    assert.ok(caps.every((cap) => cap > 0));
    assert.equal(new Set(caps).size, 1, 'the same cap each, applied separately');
  });
});

describe('describing a tenant for the run log', () => {
  it('says where their filters come from and whether they have a channel', () => {
    const { tenants } = load({ ...OWNER, ...ALICE });
    assert.match(describeTenant(tenants[0]), /you .*own gist/);
    assert.match(describeTenant(tenants[1]), /Alice .*own gist.*channel/);
  });

  it('says so when the owner has no gist of their own', () => {
    const { tenants } = load({ DISCORD_WEBHOOK_URL: 'https://hook/owner' });
    assert.match(describeTenant(tenants[0]), /filters from file/);
  });
});

describe('when it works for some people and not others', () => {
  // One person's expired token or deleted channel used to throw straight out of
  // the run, which cost every other tenant their watcher too. Now the healthy
  // ones are served and the run still ends red.

  it('says nothing when nobody failed', () => {
    assert.equal(failureSummary([], 3), null);
    assert.equal(failureSummary(undefined, 3), null);
  });

  it('names who failed, and how many of how many', () => {
    // Named because the owner has to know whose secrets to go and fix.
    const message = failureSummary(
      [{ tenant: { label: 'Alice' } }, { tenant: { label: 'Bob K.' } }],
      4,
    );
    assert.match(message, /2 of 4 tenant\(s\) failed/);
    assert.match(message, /Alice, Bob K\./);
  });

  it('says the others were served, so the message is not read as a dead run', () => {
    const message = failureSummary([{ tenant: { label: 'Alice' } }], 3);
    assert.match(message, /Everyone else was served/);
  });

  it('survives a failure with no tenant attached', () => {
    assert.match(failureSummary([{ error: new Error('x') }], 1), /unknown/);
  });
});
