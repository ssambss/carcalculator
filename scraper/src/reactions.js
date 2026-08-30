// Reading reactions off the listings we posted to Discord.
//
// Webhooks are send-only, so this needs a bot token. The bot reads the channel
// and maps each embed back to its listing through the link it points at, which
// means it works on messages posted before this feature existed, and needs no
// record of message ids.
//
// Every registered source gets a look at each link, because one channel can
// legitimately carry posts from several - so a reaction on a flat and a reaction
// on a car are told apart by which source claimed the URL.

import config from './config.js';
import { DEFAULT_SOURCE_ID, identifyUrl, sourceIds } from './sources/index.js';

const API = 'https://discord.com/api/v10';

/**
 * Matches the id marker a footer ends with: "<source> 15900001".
 *
 * The bare "ilmoitus <id>" alternative is the older form, from before there was
 * more than one source - every post carrying it is a nettiauto post.
 */
const FOOTER_ID_RE = new RegExp(`(?:(${sourceIds().join('|')})\\s+|ilmoitus\\s+)(\\d+)`);

/** The webhook's own id, used to tell our posts apart from anyone else's. */
export function webhookIdFrom(url) {
  return /\/webhooks\/(\d+)\//.exec(url ?? '')?.[1] ?? null;
}

async function discord(path, { botToken, label }) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bot ${botToken}`, 'User-Agent': 'listing-watch (carcalculator)' },
  });

  if (response.status === 401) {
    throw new Error('Discord rejected the bot token. Check DISCORD_BOT_TOKEN.');
  }
  if (response.status === 403 || response.status === 404) {
    // Not necessarily broken. A tenant running this in their own Discord server
    // who has not invited the bot is a perfectly good setup - they get posts and
    // simply add cars by hand. So this is flagged for the caller to skip rather
    // than thrown as a failure that would take everyone else's run down with it.
    const error = new Error(
      `The bot cannot read ${label}. In your own server it needs inviting; ` +
        'in one it is already in, it needs "View Channel" and "Read Message History".',
    );
    error.reason = 'no-channel-access';
    throw error;
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

/**
 * Which channel a webhook posts into.
 *
 * Always read off the webhook, never from configuration. There used to be a
 * `DISCORD_CHANNEL_ID` override to save this one request, and once the watcher
 * ran for several people that became a hole: it was global, so a single value
 * set for the owner would have had every tenant scanning the owner's channel and
 * picking up the owner's reactions into their own calculator. One request per
 * tenant per run is a very cheap way not to have that.
 */
export async function resolveChannelId({ webhookUrl = config.discord.webhookUrl } = {}) {
  const response = await fetch(webhookUrl);
  if (!response.ok) throw new Error(`Could not read the webhook: HTTP ${response.status}`);
  const body = await response.json();
  if (!body.channel_id) throw new Error('The webhook did not report a channel id.');
  return body.channel_id;
}

/**
 * Pull the listings out of a message's embeds, as `{ sourceId, id }`.
 *
 * The embed's own link is the good answer, and the only one that identifies the
 * source. The footer is the fallback for a post whose embed layout has since
 * changed - it carries "<source> <id>" now, and the older Finnish "ilmoitus
 * <id>" form is still read, from before there was more than one source.
 */
export function listingsIn(message) {
  const found = new Map();

  for (const embed of message.embeds ?? []) {
    const fromUrl = identifyUrl(embed.url);
    if (fromUrl) {
      found.set(`${fromUrl.sourceId}:${fromUrl.id}`, fromUrl);
      continue;
    }
    const match = FOOTER_ID_RE.exec(embed.footer?.text ?? '');
    if (match) {
      // No source named means a post from before sources existed, and every
      // one of those was nettiauto.
      const entry = { sourceId: match[1] || DEFAULT_SOURCE_ID, id: match[2] };
      found.set(`${entry.sourceId}:${entry.id}`, entry);
    }
  }
  return [...found.values()];
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
  // Reacted posts of ours whose embeds came back empty - see the throw below.
  let strippedEmbeds = 0;

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
      // Only our own posts; someone else's message linking a listing is not a
      // listing we announced.
      if (ourWebhookId && message.webhook_id && message.webhook_id !== ourWebhookId) continue;
      if (!hasQualifyingReaction(message, requiredEmoji)) continue;
      const listings = listingsIn(message);
      // Every post of ours carries an embed. A reacted post of ours with none
      // means Discord stripped them from the response, not that they're gone.
      if (listings.length === 0 && (message.embeds ?? []).length === 0) {
        strippedEmbeds += 1;
        continue;
      }
      for (const listing of listings) {
        if (!reacted.has(listing.id)) {
          reacted.set(listing.id, { messageId: message.id, sourceId: listing.sourceId });
        }
      }
    }

    scanned += messages.length;
    before = messages[messages.length - 1].id;
    onProgress?.({ scanned, found: reacted.size });
    if (messages.length < batch) break;
  }

  if (strippedEmbeds > 0) {
    throw new Error(
      `${strippedEmbeds} reacted post(s) came back without their embeds, so the cars on them ` +
        'cannot be identified. Discord strips embeds from bot reads (REST included) unless the ' +
        'bot has the Message Content Intent: developer portal -> your app -> Bot -> ' +
        'Privileged Gateway Intents -> enable "Message Content Intent", then rerun.',
    );
  }

  return { reacted, scanned, channelId };
}
