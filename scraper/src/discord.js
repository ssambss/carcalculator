// Posting new listings to a Discord channel via webhook.

import config from './config.js';
import { postJson, sleep } from './http.js';

const EUR = new Intl.NumberFormat('fi-FI', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
const KM = new Intl.NumberFormat('fi-FI');

// Discord's own limits; exceeding any of them rejects the whole message.
const LIMITS = { title: 256, fieldValue: 1024, description: 4096, footer: 2048 };

function clamp(text, limit) {
  if (!text) return '';
  const value = String(text);
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function euros(value) {
  return value === null || value === undefined ? 'hinta ?' : EUR.format(value);
}

function kilometres(value) {
  return value === null || value === undefined ? '? km' : `${KM.format(value)} km`;
}

/**
 * Colour by price, so a cheap find is visually obvious in the channel.
 *
 * Read against the filter's own ceiling where it has one - what counts as
 * cheap depends entirely on what you are shopping for - and against fixed
 * bands only when the filter sets no maximum.
 */
export function accentColour(price, maxPrice = null) {
  if (price === null || price === undefined) return 0x8a8a8a;
  if (maxPrice) {
    const share = price / maxPrice;
    if (share <= 0.85) return 0x2ecc71;
    if (share <= 0.95) return 0x3498db;
    return 0x9b59b6;
  }
  if (price < 28000) return 0x2ecc71;
  if (price < 32000) return 0x3498db;
  return 0x9b59b6;
}

/**
 * Build the embed for one listing.
 *
 * The package evidence is included verbatim: the packages are matched out of
 * seller free text, so showing the phrase we matched on lets the reader judge
 * the call themselves instead of trusting the scraper.
 */
export function buildEmbed(listing, verdict, filter = null) {
  const headline = [listing.year, listing.subTitle || listing.title].filter(Boolean).join(' ');

  const fields = [
    { name: 'Hinta', value: euros(listing.price), inline: true },
    { name: 'Mittarilukema', value: kilometres(listing.mileage), inline: true },
    { name: 'Vuosimalli', value: String(listing.year ?? '?'), inline: true },
  ];

  const specs = [listing.driveType, listing.color, listing.bodyType].filter(Boolean);
  if (specs.length) {
    fields.push({ name: 'Tiedot', value: clamp(specs.join(' · '), LIMITS.fieldValue), inline: true });
  }
  if (listing.location || listing.seller) {
    fields.push({
      name: 'Myyjä',
      value: clamp(listing.location || listing.seller, LIMITS.fieldValue),
      inline: true,
    });
  }

  const evidence = Object.entries(verdict?.packages ?? {})
    .filter(([, result]) => result.satisfied && result.snippet)
    .map(([name, result]) => {
      const label = name.charAt(0).toUpperCase() + name.slice(1);
      return `**${label}:** ${result.snippet}`;
    });
  if (evidence.length) {
    fields.push({
      name: 'Varustepaketit (myyjän teksti)',
      value: clamp(evidence.join('\n'), LIMITS.fieldValue),
      inline: false,
    });
  }

  const caveats = [...(verdict?.warnings ?? []), ...(verdict?.notes ?? [])];
  if (caveats.length) {
    fields.push({
      name: 'Huom',
      value: clamp(caveats.map((caveat) => `• ${caveat}`).join('\n'), LIMITS.fieldValue),
      inline: false,
    });
  }

  // The footer names the filter that matched, so a channel carrying several
  // searches stays readable. The listing id has to stay in it verbatim:
  // reactions.js maps a reacted post back to its car through this line.
  const footer = ['nettiauto.com', filter?.name, `ilmoitus ${listing.id}`]
    .filter(Boolean)
    .join(' · ');

  return {
    title: clamp(headline || listing.title || 'Ilmoitus', LIMITS.title),
    url: listing.url,
    color: accentColour(listing.price, filter?.ranges?.price?.max ?? null),
    fields,
    image: listing.image ? { url: listing.image } : undefined,
    footer: { text: clamp(footer, LIMITS.footer) },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Announce one filter's new listings, cheapest first, in batches.
 *
 * Returns the ids that Discord accepted, so the caller only marks those as
 * announced - a failed batch is retried on the next run rather than lost.
 */
export async function announce(
  filter,
  items,
  { webhookUrl = config.discord.webhookUrl, dryRun = false } = {},
) {
  if (items.length === 0) return { announced: [], batches: 0 };
  if (!dryRun && !webhookUrl) {
    throw new Error(
      'No Discord webhook configured. Set DISCORD_WEBHOOK_URL (see scraper/README.md).',
    );
  }

  const { username, embedsPerMessage } = config.discord;
  const announced = [];
  let batches = 0;

  for (let start = 0; start < items.length; start += embedsPerMessage) {
    const batch = items.slice(start, start + embedsPerMessage);
    const isFirstBatch = start === 0;
    const name = clamp(filter?.name ?? 'haku', 120);
    const heading =
      items.length === 1
        ? `**Uusi osuma hakuun ${name}**`
        : `**${items.length} uutta osumaa hakuun ${name}**`;

    const payload = {
      username,
      content: isFirstBatch ? heading : undefined,
      embeds: batch.map(({ listing, verdict }) => buildEmbed(listing, verdict, filter)),
      // Suppress link previews: the embeds already carry the images.
      allowed_mentions: { parse: [] },
    };

    if (dryRun) {
      console.log(`  [dry-run] would POST ${payload.embeds.length} embed(s)`);
      for (const embed of payload.embeds) console.log(`    - ${embed.title} -> ${embed.url}`);
    } else {
      await postJson(webhookUrl, payload, { label: 'Discord webhook' });
      // Webhooks allow ~5 requests per 2s; keep well under it.
      if (start + embedsPerMessage < items.length) await sleep(1200);
    }

    announced.push(...batch.map(({ listing }) => listing.id));
    batches += 1;
  }

  return { announced, batches };
}

/** Post a short plain-text status line (used by --notify-errors). */
export async function announceText(text, { webhookUrl = config.discord.webhookUrl, dryRun = false } = {}) {
  if (dryRun || !webhookUrl) {
    console.log(`  [dry-run] would post: ${text}`);
    return;
  }
  await postJson(
    webhookUrl,
    { username: config.discord.username, content: clamp(text, 1900), allowed_mentions: { parse: [] } },
    { label: 'Discord webhook' },
  );
}
