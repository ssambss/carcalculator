#!/usr/bin/env node
// Check the setup and report what works, without changing anything.
//
//   npm run doctor
//
// Every secret here is optional, and each one unlocks a different slice of the
// watcher - so "not set" is a legitimate answer, not a failure. The point is to
// say which slice is live and which is dark, because the alternative is finding
// out from a scheduled run at three in the morning.
//
// Read-only by design: no posting, no state written, no gist patched. The
// Discord webhook is probed with a GET, which returns the webhook's own record
// (channel included) and sends nothing to the channel.

import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expandSecretsJson, loadEnvFile } from './env.js';

expandSecretsJson();
await loadEnvFile();

const { default: config } = await import('./config.js');
const { describeFilter, loadFilters } = await import('./filters.js');
const state = await import('./state.js');
const { storeFor } = await import('./storage/index.js');
const { describeTenant, loadTenants } = await import('./tenants.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const MIN_NODE = 20;

const MARK = { ok: '  ok  ', off: ' off  ', bad: ' FAIL ' };

/** One report line: what it is, whether it works, and what it buys you. */
function line({ status, name, detail, unlocks }) {
  const rows = [`[${MARK[status]}] ${name}`];
  if (detail) rows.push(`           ${detail}`);
  if (unlocks) rows.push(`           ${unlocks}`);
  return rows.join('\n');
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function checkNode() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  return major >= MIN_NODE
    ? { status: 'ok', name: `Node ${process.versions.node}`, detail: null }
    : {
        status: 'bad',
        name: `Node ${process.versions.node}`,
        detail: `Too old - this needs Node ${MIN_NODE} or newer (it uses global fetch).`,
      };
}

async function checkEnvFile() {
  const path = resolve(HERE, '..', '.env');
  if (await exists(path)) {
    return { status: 'ok', name: 'scraper/.env', detail: 'Present; real environment variables still win over it.' };
  }
  return {
    status: 'off',
    name: 'scraper/.env',
    detail: 'Not there. Fine in CI, where secrets arrive as real environment variables.',
    unlocks: 'Locally: cp .env.example .env',
  };
}

/**
 * A webhook URL, checked by reading it rather than posting to it.
 *
 * A GET on a webhook returns its own record - id, name, channel_id - and
 * touches the channel not at all, so this is safe to run as often as you like.
 */
async function checkWebhook() {
  const url = config.discord.webhookUrl;
  if (!url) {
    return {
      status: 'off',
      name: 'DISCORD_WEBHOOK_URL',
      detail: 'Not set, so the watcher has nowhere to post and will stop before crawling.',
      unlocks: 'Posting new listings to Discord - the core of the thing.',
    };
  }
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\//.test(url)) {
    return {
      status: 'bad',
      name: 'DISCORD_WEBHOOK_URL',
      detail: 'Set, but that does not look like a Discord webhook URL.',
    };
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        status: 'bad',
        name: 'DISCORD_WEBHOOK_URL',
        detail:
          `Discord answered HTTP ${response.status}. A 401 or 404 means the webhook was ` +
          'deleted or the URL is wrong - make a new one in the channel settings.',
      };
    }
    const hook = await response.json();
    return {
      status: 'ok',
      name: 'DISCORD_WEBHOOK_URL',
      detail: `Live: "${hook.name ?? '?'}" posting into channel ${hook.channel_id ?? '?'}.`,
    };
  } catch (error) {
    return { status: 'bad', name: 'DISCORD_WEBHOOK_URL', detail: `Could not reach Discord: ${error.message}` };
  }
}

async function github(path, token) {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'listing-watch doctor',
    },
  });
}

/**
 * The gist token, and whether the gist it finds actually holds the two files
 * this repo cares about.
 *
 * Reported separately because they fail separately: a token can be perfectly
 * valid and still find no gist, which is what happens before the app has been
 * connected to sync even once.
 */
async function checkGistToken() {
  const token = config.tco.gistToken;
  if (!token) {
    return [
      {
        status: 'off',
        name: 'GIST_TOKEN',
        detail: 'Not set, so filters come from scraper/filters.json and reaction pickup is skipped.',
        unlocks: 'Filters made in the app, and react-to-add-a-car.',
      },
    ];
  }

  let response;
  try {
    response = await github('/gists?per_page=100', token);
  } catch (error) {
    return [{ status: 'bad', name: 'GIST_TOKEN', detail: `Could not reach GitHub: ${error.message}` }];
  }

  if (response.status === 401 || response.status === 403) {
    return [
      {
        status: 'bad',
        name: 'GIST_TOKEN',
        detail: 'GitHub rejected it. A classic token with only the "gist" scope is what this needs.',
      },
    ];
  }
  if (!response.ok) {
    return [{ status: 'bad', name: 'GIST_TOKEN', detail: `GitHub answered HTTP ${response.status}.` }];
  }

  const gists = await response.json();
  const dataFile = config.tco.gistFilename;
  const filterFile = config.filters.gistFilename;
  const match = Array.isArray(gists) ? gists.find((gist) => gist.files && dataFile in gist.files) : null;

  const tokenLine = {
    status: 'ok',
    name: 'GIST_TOKEN',
    detail: `Valid; the account has ${Array.isArray(gists) ? gists.length : '?'} gist(s).`,
  };

  if (!match) {
    return [
      tokenLine,
      {
        status: 'off',
        name: `Data gist (${dataFile})`,
        detail: 'No gist on this account holds it, so there is no sync to join yet.',
        unlocks: 'Connect the calculator to GitHub sync first (cloud button in the header).',
      },
    ];
  }

  return [
    tokenLine,
    {
      status: 'ok',
      name: `Data gist (${dataFile})`,
      detail: `Found: ${match.id}`,
    },
    filterFile in match.files
      ? { status: 'ok', name: `Filter file (${filterFile})`, detail: 'Present - the app has synced filters here.' }
      : {
          status: 'off',
          name: `Filter file (${filterFile})`,
          detail: 'Not in the gist yet, so the watcher falls back to scraper/filters.json.',
          unlocks: 'Make a filter in the app (funnel button) and save it.',
        },
  ];
}

/**
 * The bot token. Only half of the reaction pickup - it needs GIST_TOKEN too,
 * and index.js treats exactly one of the two as a half-finished setup and
 * fails on it, so that combination is called out here before it bites.
 */
async function checkBotToken() {
  const token = config.discord.botToken;
  if (!token) {
    return {
      status: 'off',
      name: 'DISCORD_BOT_TOKEN',
      detail: 'Not set, so reactions are not read.',
      unlocks: 'React to a post -> the car lands in the calculator.',
    };
  }
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}`, 'User-Agent': 'listing-watch doctor' },
    });
    if (response.status === 401) {
      return { status: 'bad', name: 'DISCORD_BOT_TOKEN', detail: 'Discord rejected it. Reset the token in the developer portal.' };
    }
    if (!response.ok) {
      return { status: 'bad', name: 'DISCORD_BOT_TOKEN', detail: `Discord answered HTTP ${response.status}.` };
    }
    const bot = await response.json();
    return {
      status: 'ok',
      name: 'DISCORD_BOT_TOKEN',
      detail: `Valid: ${bot.username ?? '?'}. Message Content Intent cannot be checked from here - ` +
        'without it, reacted posts come back with no embeds and the run says so.',
    };
  } catch (error) {
    return { status: 'bad', name: 'DISCORD_BOT_TOKEN', detail: `Could not reach Discord: ${error.message}` };
  }
}

/** Which source the filters would actually come from on a real run. */
async function checkFilters() {
  try {
    const { filters, source } = await loadFilters({ log: () => {} });
    const enabled = filters.filter((filter) => filter.enabled);
    if (enabled.length === 0) {
      return {
        status: 'off',
        name: 'Filters',
        detail:
          `${filters.length} found in the ${source}, none enabled - a run would do nothing.`,
        unlocks: 'Make a filter in the app, or enable the example in scraper/filters.json.',
      };
    }
    return {
      status: 'ok',
      name: 'Filters',
      detail:
        `${enabled.length} enabled of ${filters.length}, from the ${source}:\n` +
        enabled.map((filter) => `             - ${filter.name}: ${describeFilter(filter)}`).join('\n'),
    };
  } catch (error) {
    return { status: 'bad', name: 'Filters', detail: error.message };
  }
}

/** The record of what has been seen. Its absence is meaningful, not an error. */
async function checkState() {
  let where;
  try {
    where = storeFor();
  } catch (error) {
    return { status: 'bad', name: 'Record', detail: error.message };
  }

  try {
    const store = await state.loadState(where);
    if (store.isNew) {
      return {
        status: 'off',
        name: `Record (${where.id})`,
        detail:
          `Nothing in ${where.describe()} yet, so the next run records what is on ` +
          'sale and posts nothing.',
      };
    }
    const stats = state.summarise(store);
    const upgrade = store.migrated
      ? ` Will be upgraded from version ${store.migratedFrom} on the next write.`
      : '';
    return {
      status: 'ok',
      name: `Record (${where.id})`,
      detail:
        `${where.describe()}: ${store.runs ?? 0} run(s), remembering ${stats.tracked} ` +
        `listing(s), ${stats.announced} announcement(s) across ` +
        `${Object.keys(store.filters ?? {}).length} filter(s).${upgrade}`,
    };
  } catch (error) {
    return { status: 'bad', name: `Record (${where.id})`, detail: error.message };
  }
}

/**
 * Everyone this watcher runs for, and whether each of them is actually set up.
 *
 * The most useful thing here when onboarding somebody: their token and their
 * webhook are probed separately, because they fail separately and the messages
 * are quite different.
 */
async function checkTenants() {
  const { tenants, problems } = loadTenants({ log: () => {} });
  const lines = [];

  for (const problem of problems) {
    lines.push({ status: 'bad', name: 'Tenant', detail: problem });
  }

  const others = tenants.filter((tenant) => !tenant.ownerish);
  if (others.length === 0) {
    lines.push({
      status: 'off',
      name: 'Other people',
      detail: 'Nobody else configured - this watcher runs for you alone.',
      unlocks: 'TENANT_<NAME>_GIST_TOKEN + TENANT_<NAME>_WEBHOOK adds someone. See ../SETUP.md.',
    });
    return lines;
  }

  for (const tenant of others) {
    const found = [];
    const failed = [];

    const hook = await fetch(tenant.webhookUrl).catch(() => null);
    if (hook?.ok) {
      const body = await hook.json().catch(() => ({}));
      found.push(`channel ${body.channel_id ?? '?'}`);
    } else {
      failed.push(`webhook (HTTP ${hook?.status ?? 'unreachable'})`);
    }

    const gists = await github('/gists?per_page=1', tenant.gistToken).catch(() => null);
    if (gists?.ok) found.push('gist token valid');
    else failed.push(`gist token (HTTP ${gists?.status ?? 'unreachable'})`);

    lines.push({
      status: failed.length ? 'bad' : 'ok',
      name: `Tenant: ${tenant.label}`,
      detail: failed.length
        ? `${failed.join(', ')} - check TENANT_${tenant.id.toUpperCase()}_* secrets.`
        : `${describeTenant(tenant)}; ${found.join(', ')}.`,
    });
  }

  return lines;
}

const checks = [
  checkNode(),
  await checkEnvFile(),
  await checkWebhook(),
  ...(await checkGistToken()),
  await checkBotToken(),
  ...(await checkTenants()),
  await checkFilters(),
  await checkState(),
];

console.log('Listing watcher setup\n');
for (const check of checks) console.log(`${line(check)}\n`);

const broken = checks.filter((check) => check.status === 'bad');
const off = checks.filter((check) => check.status === 'off');

if (broken.length) {
  console.log(`${broken.length} thing(s) are set but not working: ${broken.map((c) => c.name).join(', ')}.`);
} else if (off.length) {
  console.log(`Nothing broken. ${off.length} optional thing(s) not set up: ${off.map((c) => c.name).join(', ')}.`);
} else {
  console.log('Everything checks out.');
}

// A half-configured reaction pickup fails a real run outright, so it is worth
// its own warning here rather than being read off two separate lines above.
const bot = Boolean(config.discord.botToken);
const gist = Boolean(config.tco.gistToken);
if (config.tco.pickUpReactions && bot !== gist) {
  console.log(
    `\nWARNING: reaction pickup needs both tokens, and only ${bot ? 'DISCORD_BOT_TOKEN' : 'GIST_TOKEN'} ` +
      `is set. A real run fails on this - set ${bot ? 'GIST_TOKEN' : 'DISCORD_BOT_TOKEN'} too, or ` +
      'set tco.pickUpReactions = false in src/config.js.',
  );
}

// Always exit 0: this is a report, and "not set up" is a valid state to be in.
process.exitCode = 0;
