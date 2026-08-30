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

## 6. Adding someone else

The watcher runs for several people at once. Each keeps their own data in their
own gist on their own GitHub account — their filters, their calculator, their
record of what has been posted to them. **You never see any of it**, and the only
thing shared is the crawl: two people watching the same model cost one fetch,
not two.

### Once per person, about ten minutes

1. **A Discord channel for them**, in your server. Channel settings →
   Integrations → Webhooks → New Webhook → Copy Webhook URL. Invite them to the
   server; joining is all they have to do to start seeing listings.
2. **A GitHub account**, if they have none. A signup form — worth doing together.
3. **A gist token on their account** — [this prefilled page](https://github.com/settings/tokens/new?scopes=gist&description=Car%20TCO%20sync)
   creates a classic one with only the `gist` scope. Set it never to expire
   unless you enjoy renewal reminders.
4. **Paste it into their browser**: open the app on their phone or laptop, cloud
   button in the header, paste. Their calculator now syncs to their own gist.
   Repeat per device.
5. **Two secrets in your repo**, under Settings → Secrets and variables →
   Actions, named for them:

| Secret | Value |
|---|---|
| `TENANT_ALICE_GIST_TOKEN` | the token from step 3 |
| `TENANT_ALICE_WEBHOOK` | the webhook from step 1 |
| `TENANT_ALICE_LABEL` | *optional* — a display name a secret cannot spell, e.g. `Alice Mäkinen` |

That is all of it. **No YAML to edit and nothing to commit** — the workflow hands
the whole secret set to the watcher in one variable, so the secrets *are* the
configuration. Removing someone is deleting their two secrets.

The names group by person rather than by kind (`GIST_TOKEN_ALICE`,
`WEBHOOK_ALICE`) because GitHub sorts that page alphabetically: everything of
Alice's sits together, so adding or removing her means touching adjacent rows
instead of hunting the list twice.

### Checking it worked

```sh
cd scraper
npm run doctor                             # lists everyone found, probes each
node src/index.js --for=alice --dry-run    # just her, posting nothing
```

`--for=<who>` matches a tenant id or name. It is the safe way to try somebody
new: a typo matches nobody rather than everybody, so it cannot accidentally post
to the whole family.

### What to tell them

- **You hold their gist token.** It reaches gists and nothing else — not their
  code, not their repositories — but it does reach any *other* gists on their
  account. Say so rather than let them assume otherwise.
- **Their data stays theirs.** It lives in their gist. The watcher reads their
  filters and writes their cars there, and copies it nowhere else.
- **Revoking is one click**, at [github.com/settings/tokens](https://github.com/settings/tokens).
  The watcher then fails loudly for them and carries on for everyone else.

### Their record never touches this repo

Only your own state can use the committed `data/seen.json`. Everyone else's lives
in their own gist, always — a record of what somebody has been shown and what
they are shopping for has no business in a public repository, so the code refuses
to put it there rather than leaving it to configuration.

### Before moving your own state into a gist

`--migrate-state=gist` stops the workflow committing `data/seen.json`, and those
commits are what keep the repository active: GitHub disables a public repo's
scheduled workflows after **60 days without commits**. Other people's records are
in their gists either way, so this only concerns yours — leave it on the file
backend unless something else is keeping the repo busy.

---

## Rough edges when running a fork

Honest list, being worked through in [PLAN.md](PLAN.md):

- **`scraper/data/seen.json` is committed**, and the workflow commits it back
  after each run. Your fork diverges on it from its first run, so pulling
  upstream changes conflicts on it every time. Phase 3 of the plan moves state
  into your gist, which removes this entirely. Until then: resolve with
  `git checkout --ours scraper/data/seen.json` when pulling.
- ~~One webhook per fork.~~ **Fixed** — see *Adding someone else* above. Each
  person gets their own channel, their own gist and their own record, and a
  reaction in their channel adds the car to their calculator, not yours.
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
