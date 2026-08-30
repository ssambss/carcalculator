// Reading reactions when the channels are not all in one server.
//
// A tenant can run this in their own Discord rather than joining the owner's.
// Posting needs nothing for that - a webhook URL identifies its channel
// wherever it lives - but reading reactions needs the bot to be *in* that
// server, and it may not be. These are the two things that has to get right.

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { fetchReactedListingIds, listingsIn, resolveChannelId } from '../src/reactions.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer each request by URL pattern, so a test says only what it cares about. */
function stubFetch(routes) {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    for (const [pattern, reply] of routes) {
      if (String(url).includes(pattern)) return reply;
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  return seen;
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });

describe('which channel a webhook posts into', () => {
  it('reads it off the webhook rather than from configuration', async () => {
    stubFetch([['webhooks/2', ok({ channel_id: 'alice-channel' })]]);
    assert.equal(
      await resolveChannelId({ webhookUrl: 'https://discord.com/api/webhooks/2/alice' }),
      'alice-channel',
    );
  });

  it('gives two webhooks two different channels', async () => {
    // The leak this replaced: a single global DISCORD_CHANNEL_ID would have had
    // every tenant scanning the owner's channel and picking up the owner's
    // reactions into their own calculator.
    stubFetch([
      ['webhooks/1', ok({ channel_id: 'owner-channel' })],
      ['webhooks/2', ok({ channel_id: 'alice-channel' })],
    ]);
    const owner = await resolveChannelId({ webhookUrl: 'https://discord.com/api/webhooks/1/o' });
    const alice = await resolveChannelId({ webhookUrl: 'https://discord.com/api/webhooks/2/a' });
    assert.notEqual(owner, alice);
    assert.equal(owner, 'owner-channel');
    assert.equal(alice, 'alice-channel');
  });

  it('complains when the webhook itself cannot be read', async () => {
    stubFetch([['webhooks/', fail(404)]]);
    await assert.rejects(
      () => resolveChannelId({ webhookUrl: 'https://discord.com/api/webhooks/9/gone' }),
      /Could not read the webhook: HTTP 404/,
    );
  });
});

describe('a channel the bot cannot read', () => {
  const webhookUrl = 'https://discord.com/api/webhooks/2/alice';

  it('is flagged as a missing invitation, not a broken run', async () => {
    // Someone running this in their own server who has not invited the bot is a
    // legitimate setup: they get posts and add cars by hand. The caller skips
    // them; throwing plainly would take everyone else's run down too.
    stubFetch([
      ['webhooks/2', ok({ channel_id: 'alice-channel' })],
      ['/channels/', fail(403)],
    ]);
    await assert.rejects(
      () => fetchReactedListingIds({ botToken: 'b', webhookUrl }),
      (error) => {
        assert.equal(error.reason, 'no-channel-access');
        assert.match(error.message, /needs inviting/);
        return true;
      },
    );
  });

  it('treats a channel that is not there the same way', async () => {
    // A deleted channel, or one the bot cannot even see: same answer, since
    // neither is worth failing everyone else's run over.
    stubFetch([
      ['webhooks/2', ok({ channel_id: 'gone' })],
      ['/channels/', fail(404)],
    ]);
    await assert.rejects(
      () => fetchReactedListingIds({ botToken: 'b', webhookUrl }),
      (error) => error.reason === 'no-channel-access',
    );
  });

  it('still fails outright on a bad bot token', async () => {
    // Not a per-tenant condition: the token is shared, so this is broken for
    // everybody and should say so loudly.
    stubFetch([
      ['webhooks/2', ok({ channel_id: 'alice-channel' })],
      ['/channels/', fail(401)],
    ]);
    await assert.rejects(
      () => fetchReactedListingIds({ botToken: 'b', webhookUrl }),
      (error) => {
        assert.equal(error.reason, undefined, 'not a skippable condition');
        assert.match(error.message, /rejected the bot token/);
        return true;
      },
    );
  });
});

describe('reading a tenant\'s own channel', () => {
  it('only counts posts from their webhook, not another tenant\'s', async () => {
    // Every tenant's posts carry their own webhook id, so one person's channel
    // history cannot be credited to another - even if both are scanned by the
    // same bot in the same run.
    const mine = { id: 'm1', webhook_id: '2', reactions: [{ count: 1 }], embeds: [
      { url: 'https://www.nettiauto.com/polestar/2/15900001' },
    ] };
    const theirs = { id: 'm2', webhook_id: '3', reactions: [{ count: 1 }], embeds: [
      { url: 'https://www.nettiauto.com/polestar/2/15900002' },
    ] };
    stubFetch([
      ['webhooks/2', ok({ channel_id: 'shared' })],
      ['/channels/', ok([mine, theirs])],
    ]);
    const { reacted } = await fetchReactedListingIds({
      botToken: 'b',
      webhookUrl: 'https://discord.com/api/webhooks/2/alice',
      scanMessages: 100,
    });
    assert.deepEqual([...reacted.keys()], ['15900001']);
    assert.equal(reacted.get('15900001').sourceId, 'nettiauto');
  });

  it('ignores a reaction the bot added itself', async () => {
    const onlyMine = {
      id: 'm1',
      webhook_id: '2',
      reactions: [{ count: 1, me: true }],
      embeds: [{ url: 'https://www.nettiauto.com/polestar/2/15900001' }],
    };
    stubFetch([
      ['webhooks/2', ok({ channel_id: 'c' })],
      ['/channels/', ok([onlyMine])],
    ]);
    const { reacted } = await fetchReactedListingIds({
      botToken: 'b',
      webhookUrl: 'https://discord.com/api/webhooks/2/alice',
      scanMessages: 100,
    });
    assert.equal(reacted.size, 0, 'the bot must not vote for a car on its own');
  });
});

describe('recovering a listing from a post', () => {
  it('reads the link first, and the footer when the link is gone', () => {
    assert.deepEqual(listingsIn({ embeds: [{ url: 'https://www.nettiauto.com/a/b/900' }] }), [
      { sourceId: 'nettiauto', id: '900' },
    ]);
    assert.deepEqual(listingsIn({ embeds: [{ footer: { text: 'x · nettiauto 900' } }] }), [
      { sourceId: 'nettiauto', id: '900' },
    ]);
  });

  it('still reads the older Finnish footer form', () => {
    // Posts made before sources existed, and every one of those was nettiauto.
    assert.deepEqual(listingsIn({ embeds: [{ footer: { text: 'x · ilmoitus 900' } }] }), [
      { sourceId: 'nettiauto', id: '900' },
    ]);
  });

  it('claims nothing from a link no source recognises', () => {
    assert.deepEqual(listingsIn({ embeds: [{ url: 'https://example.com/a/b/900' }] }), []);
  });
});
