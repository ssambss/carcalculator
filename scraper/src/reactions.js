// Reading reactions off the listings we posted to Discord.
//
// Webhooks are send-only, so this needs a bot token. The bot reads the channel
// and maps each embed back to its listing through the nettiauto URL, which
// means it works on messages posted before this feature existed, and needs no
// record of message ids.

import config from './config.js';

const API = 'https://discord.com/api/v10';

/** The webhook's own id, used to tell our posts apart from anyone else's. */
export function webhookIdFrom(url) {
  return /\/webhooks\/(\d+)\//.exec(url ?? '')?.[1] ?? null;
}

async function discord(path, { botToken, label }) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bot ${botToken}`, 'User-Agent': 'nettiauto-watch (carcalculator)' },
  });

  if (response.status === 401) {
    throw new Error('Discord rejected the bot token. Check DISCORD_BOT_TOKEN.');
  }
  if (response.status === 403) {
    throw new Error(
      `Bot lacks access for ${label}. It needs "View Channel" and ` +
        '"Read Message History" on the channel.',
    );
  }
  if (response.status === 429) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Discord rate limited ${label}; retry after ${body.retry_after ?? '?'}s.`);
  }
  if (!response.ok) {
    throw new Error(`Discord ${label} failed: HTTP ${response.status}`);
  }
  return response.json();
}

/** Resolve the channel the webhook posts into, so it needn't be configured. */
export async function resolveChannelId({
  webhookUrl = config.discord.webhookUrl,
  channelId = config.discord.channelId,
} = {}) {
  if (channelId) return channelId;
  const response = await fetch(webhookUrl);
  if (!response.ok) throw new Error(`Could not read the webhook: HTTP ${response.status}`);
  const body = await response.json();
  if (!body.channel_id) throw new Error('The webhook did not report a channel id.');
  return body.channel_id;
}

/** Pull the listing ids out of a message's embeds. */
function listingIdsIn(message) {
  const ids = new Set();
  for (const embed of message.embeds ?? []) {
    const fromUrl = /nettiauto\.com\/[^/]+\/[^/]+\/(\d+)/.exec(embed.url ?? '')?.[1];
    if (fromUrl) {
      ids.add(fromUrl);
      continue;
    }
    // Older posts, or a changed embed layout: the footer carries the id too.
    const fromFooter = /ilmoitus\s+(\d+)/.exec(embed.footer?.text ?? '')?.[1];
    if (fromFooter) ids.add(fromFooter);
  }
  return [...ids];
}

/**
 * Does this message carry a reaction that counts?
 *
 * With `requiredEmoji` unset, any reaction from anyone counts - which is what
 * "react to add it" should mean. Reactions the bot itself added are ignored so
 * it can never vote for a car on its own.
 */
function hasQualifyingReaction(message, requiredEmoji) {
  const reactions = message.reactions ?? [];
  return reactions.some((reaction) => {
    const others = (reaction.count ?? 0) - (reaction.me ? 1 : 0);
    if (others <= 0) return false;
    if (!requiredEmoji) return true;
    return reaction.emoji?.name === requiredEmoji;
  });
}

/**
 * Scan recent channel history and return the listing ids people reacted to.
 *
 * A message may hold more than one embed (batched posts predate this feature),
 * and a reaction applies to the whole message - so every listing in a reacted
 * message counts. New posts are one car each, so this stays unambiguous going
 * forward.
 */
export async function fetchReactedListingIds({
  botToken = config.discord.botToken,
  webhookUrl = config.discord.webhookUrl,
  scanMessages = config.tco.scanMessages,
  requiredEmoji = config.tco.requiredEmoji,
  onProgress,
} = {}) {
  if (!botToken) {
    throw new Error('No Discord bot token configured. Set DISCORD_BOT_TOKEN (see README.md).');
  }

  const channelId = await resolveChannelId({ webhookUrl });
  const ourWebhookId = webhookIdFrom(webhookUrl);
  const reacted = new Map();
  let scanned = 0;
  let before = null;

  while (scanned < scanMessages) {
    const batch = Math.min(100, scanMessages - scanned);
    const query = new URLSearchParams({ limit: String(batch) });
    if (before) query.set('before', before);

    const messages = await discord(`/channels/${channelId}/messages?${query}`, {
      botToken,
      label: 'channel history',
    });
    if (!Array.isArray(messages) || messages.length === 0) break;

    for (const message of messages) {
      // Only our own posts; someone else's message with a nettiauto link is
      // not a listing we announced.
      if (ourWebhookId && message.webhook_id && message.webhook_id !== ourWebhookId) continue;
      if (!hasQualifyingReaction(message, requiredEmoji)) continue;
      for (const id of listingIdsIn(message)) {
        if (!reacted.has(id)) reacted.set(id, message.id);
      }
    }

    scanned += messages.length;
    before = messages[messages.length - 1].id;
    onProgress?.({ scanned, found: reacted.size });
    if (messages.length < batch) break;
  }

  return { reacted, scanned, channelId };
}
