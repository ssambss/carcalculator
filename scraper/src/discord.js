// Posting new listings to a Discord channel via webhook.
//
// What a post says about a listing comes from the source: its field labels, in
// its own language, and the numeric fields it declares. Nothing here is written
// for cars - a flat's post is the same code with different labels.

import config from './config.js';
import { postJson, sleep } from './http.js';
import { factOf } from './fields.js';
import { sourceOf } from './sources/index.js';

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

/**
 * One numeric fact, formatted the way its field declares.
 *
 * A price gets its currency, a measurement gets its unit, a year gets neither
 * and no thousands separator. An unknown value still prints as "?" - a row
 * missing from half the posts reads as a layout bug rather than as missing data.
 */
function formatFact(value, field) {
  // An unknown value keeps its unit ("? km") but invents no label: the field's
  // own name is right above it, so the old "hinta ?" said price twice.
  if (value === null || value === undefined) return field.unit ? `? ${field.unit}` : '?';
  if (field.key === 'price') return EUR.format(value);
  if (field.style === 'year') return String(value);
  return field.unit ? `${KM.format(value)} ${field.unit}` : KM.format(value);
}

/**
 * Colour by how a price sits against the filter's own ceiling.
 *
 * What counts as cheap depends entirely on what you are shopping for, so the
 * filter's maximum is the only meaningful yardstick. There used to be fixed
 * fallback bands at 28 000 and 32 000 euros for a filter that set no maximum -
 * they were the price of a used Polestar and meant nothing for a van, let alone
 * a flat. A filter with no ceiling now simply gets the neutral colour.
 */
export function accentColour(price, maxPrice = null) {
  if (price === null || price === undefined) return 0x8a8a8a;
  if (!maxPrice) return 0x5865f2;
  const share = price / maxPrice;
  if (share <= 0.85) return 0x2ecc71;
  if (share <= 0.95) return 0x3498db;
  return 0x9b59b6;
}

/**
 * Build the embed for one listing.
 *
 * The package evidence is included verbatim: the packages are matched out of
 * seller free text, so showing the phrase we matched on lets the reader judge
 * the call themselves instead of trusting the scraper.
 */
export function buildEmbed(listing, verdict, filter = null, source = null) {
  const from = source ?? (filter ? sourceOf(filter) : null);
  const labels = from?.presentation?.labels ?? {};
  const headline = [listing.year, listing.subTitle || listing.title].filter(Boolean).join(' ');

  // One row per numeric field the source declares, in its declared order, so a
  // flat shows its size and room count where a car shows odometer and year.
  // `price` leads because it is the number everyone reads first.
  const fields = [];
  const ordered = [
    ...(from?.fields ?? []).filter((field) => field.key === 'price'),
    ...(from?.fields ?? []).filter((field) => field.key !== 'price'),
  ];
  for (const field of ordered) {
    const value = factOf(listing, field.key);
    fields.push({
      name: labels[field.key] ?? field.label ?? field.key,
      value: formatFact(value, field),
      inline: true,
    });
  }

  const specs = [listing.driveType, listing.color, listing.bodyType].filter(Boolean);
  if (specs.length && labels.specs) {
    fields.push({
      name: labels.specs,
      value: clamp(specs.join(' · '), LIMITS.fieldValue),
      inline: true,
    });
  }
  if (listing.location || listing.seller) {
    fields.push({
      name: labels.seller ?? 'Seller',
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
      name: labels.packages ?? 'Packages',
      value: clamp(evidence.join('\n'), LIMITS.fieldValue),
      inline: false,
    });
  }

  const caveats = [...(verdict?.warnings ?? []), ...(verdict?.notes ?? [])];
  if (caveats.length) {
    fields.push({
      name: labels.caveats ?? 'Note',
      value: clamp(caveats.map((caveat) => `• ${caveat}`).join('\n'), LIMITS.fieldValue),
      inline: false,
    });
  }

  // The footer names the site and the filter that matched, so a channel
  // carrying several searches - and now possibly several sites - stays
  // readable. The source and the id have to stay in it verbatim: reactions.js
  // falls back to this line when an embed's link cannot be read. See
  // FOOTER_ID_RE there.
  const marker = `${from?.id ?? ''} ${listing.id}`.trim();
  const footer = [from?.presentation?.footer, filter?.name, marker].filter(Boolean).join(' · ');

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
  { webhookUrl = config.discord.webhookUrl, dryRun = false, source = null } = {},
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
      embeds: batch.map(({ listing, verdict }) => buildEmbed(listing, verdict, filter, source)),
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
