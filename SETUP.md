# Setting this up for yourself

Running your own copy: the calculator with your data, and the listing watcher
with your searches posting to your Discord channel.

Nothing here is shared with anyone else's copy. Your data lives in your
browser and, if you turn sync on, in a secret gist on your own GitHub account.
The watcher runs on your fork's GitHub Actions minutes, reads your gist and
posts to your webhook.

**Check your work at any point with `cd scraper && npm run doctor`.** It probes
every secret, says which are live, and names what each one unlocks. It posts
nothing and writes nothing.

---

## 1. The calculator alone

The quickest useful thing, and it needs no accounts at all.

Open the deployed page, add cars, done — data goes to `localStorage`, and
**Export** gives you a JSON backup. Or run it locally:

```sh
npm install
npm run dev          # http://localhost:5173
```

To deploy your own: fork the repo, then **Settings → Pages → Source → GitHub
Actions**. Every push to `main` publishes to
`https://<you>.github.io/<repo>/`. Vite uses a relative base, so any repo name
works.

## 2. Sync across devices (optional)

Makes your data survive a browser reset and follow you between phone and
desktop — and it is what the watcher reads your filters from, so it is a
prerequisite for step 4.

1. Create a **classic** GitHub token with **only the `gist` scope**
   ([github.com/settings/tokens](https://github.com/settings/tokens/new?scopes=gist&description=Car%20TCO%20sync)).
   Nothing else — this token can read and write gists and that is all it should
   ever be able to do.
2. In the app, cloud button in the header → paste the token.

The app finds or creates a secret gist and syncs to it: pulls on load and tab
focus, pushes a couple of seconds after each change, merges per car. Repeat on
each device with the same token.

> **Secret, not private.** A secret gist is unlisted but readable by anyone
> holding its id. That is what makes the `?view=<gist-id>` share link work with
> no account — so treat the link itself as the password.

## 3. The watcher, locally

```sh
cd scraper
cp .env.example .env      # paste your Discord webhook URL into it
npm run doctor            # what is set up so far
npm run dry-run           # the full check, posting nothing, saving nothing
```

No dependencies to install — Node 20+ and nothing else.

Get a webhook from Discord: **channel settings → Integrations → Webhooks → New
Webhook → Copy Webhook URL**. It can post to that one channel and do nothing
else.

**Filters** are the searches it runs. Make them in the calculator (funnel
button in the header) and they reach the watcher through your gist. The
committed [scraper/filters.json](scraper/filters.json) holds one **disabled**
example — a Polestar 2 spec — as a template and a worked example for the
matching rules; enable it to try the watcher out before you have built anything
of your own.

```sh
node src/index.js --list --filters=file   # what the example would match
```

## 4. The watcher, on a schedule

In **Settings → Secrets and variables → Actions**, add:

| Secret | Needed for | Without it |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | posting at all | the run stops before crawling and says so |
| `GIST_TOKEN` | filters made in the app; react-to-add-a-car | falls back to `scraper/filters.json`, skips the pickup |
| `DISCORD_BOT_TOKEN` | reading reactions | reactions are ignored |

`GIST_TOKEN` is the same kind of token as step 2 — classic, `gist` scope only,
on the account that owns the gist.

Then enable Actions on the fork (**Actions** tab → enable workflows). The
watcher runs every 30 minutes.

**`GIST_TOKEN` and `DISCORD_BOT_TOKEN` are a pair.** Reaction pickup needs
both; setting exactly one is treated as a half-finished setup and fails the run
loudly, because the alternative is a feature that looks configured and silently
does nothing. `npm run doctor` warns about this before a scheduled run finds it.

### React to a post → the car lands in the calculator

Needs both tokens above, plus one setting that is easy to miss: in the
[Discord developer portal](https://discord.com/developers/applications) →
your app → **Bot** → **Privileged Gateway Intents** → enable **Message Content
Intent**. Without it Discord strips the embeds from what the bot reads and a
reacted post cannot be matched back to its car. Invite the bot with
**OAuth2 → URL Generator**, scope `bot`, permissions *View Channels* +
*Read Message History*.

The app must be connected to sync (step 2) first — the watcher joins an
existing sync, it never starts one.

## 5. First run

The first run has no state file, so it **records everything currently on sale
and posts nothing**. Otherwise the channel would fill with every car already on
the market. From then on only genuinely new listings are posted.

A filter added later does post the cars already on sale, once — that is the
point of adding one. Turn it off per filter with *Post the cars already on
sale* in the editor's Advanced section.

---

## Rough edges when running a fork

Honest list, being worked through in [PLAN.md](PLAN.md):

- **`scraper/data/seen.json` is committed**, and the workflow commits it back
  after each run. Your fork diverges on it from its first run, so pulling
  upstream changes conflicts on it every time. Phase 3 of the plan moves state
  into your gist, which removes this entirely. Until then: resolve with
  `git checkout --ours scraper/data/seen.json` when pulling.
- **One webhook per fork.** Everyone reading a channel sees every filter's
  hits, and a reaction there adds the car to whichever gist that fork's
  `GIST_TOKEN` belongs to. Fine for one household; not a way to share one
  deployment between people who want separate data.
- **The watcher only reads nettiauto.** Making the source a pluggable module —
  so it can follow apartments or rentals — is Phases 1–5 of the plan.

## Tokens, and keeping them that way

- Both tokens are `gist`-scope-only classic tokens. Neither can read your code,
  your repos, or anything else on the account.
- `scraper/.env` is gitignored and must stay that way. Only `.env.example` is
  committed.
- Real environment variables always beat `.env`, so CI secrets override a
  stray local file.
- Revoke at [github.com/settings/tokens](https://github.com/settings/tokens)
  and in the Discord portal; nothing else needs undoing.
