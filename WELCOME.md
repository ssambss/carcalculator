# Welcome — setting up your car watcher

Somebody set this up and added you. This page takes you from nothing to working,
and then tells you how to use it.

There are two halves:

- **A watcher.** You describe the car you're looking for — a Polestar 2 from
  2021–2023, under 120 000 km, with the Pilot pack — and when one appears for
  sale, a message arrives in Discord. Usually within half an hour of it going up.
- **A calculator.** For each car you're considering, it works out what it
  actually costs you *per month*, once fuel, insurance, tax, depreciation and the
  loan are all counted. The number a price tag doesn't tell you.

The other people using this can't see your searches or your numbers, and you
can't see theirs. The person who set it up holds a key that reaches your data —
that's how the watcher works, and it's spelled out in
[What can and can't be seen](#what-can-and-cant-be-seen) at the end.

**The app lives here:** <https://ssambss.github.io/carcalculator/>

---

# Part 1 — Setting up

About fifteen minutes, once. **Easier on a laptop than a phone** — one step
involves a fiddly GitHub settings page — but you can do it all on a phone if
that's what you have.

You'll end up sending the person who set this up **two things**. They're listed
at [the end of this part](#what-to-send-back), so you can do it in one message.

---

## Step 1 — Open the app and add a car

No account needed for this. Open <https://ssambss.github.io/carcalculator/> and
press **Add car** (top right on a laptop; the round **+** button at the bottom on
a phone).

Give it a name and a price, then save. You'll see a card with a monthly figure and
a coloured bar.

**Check:** you have one car on screen. If so, the app works, and everything below
is about making it *yours* rather than just this browser's.

> Nothing has been sent anywhere. What you typed is in this browser only. The next
> steps are what make it follow you between devices and let the watcher reach it.

---

## Step 2 — Get a GitHub account

An odd-sounding ask, so here's the reason: **it's where your data lives, in your
name.** GitHub gives every account a private scratch space, and your cars and
searches are kept in yours — not in somebody else's database. If you ever want
out, you keep the data and revoke the access.

Already have an account? Skip to step 3.

1. Go to <https://github.com/signup>
2. Email, password, username, and confirm the email.

That's all. You never need to use GitHub for anything else.

**Check:** you can sign in at <https://github.com> and see your username in the
top-right corner.

---

## Step 3 — Create the key

The fiddliest step. It's one page, and this link fills most of it in for you.

1. Open **<https://github.com/settings/tokens/new?scopes=gist&description=Car+TCO+sync>**
   (sign in if it asks).
2. **Note** should already say `Car TCO sync`. Leave it.
3. **Expiration** — choose **No expiration**. GitHub will warn you about that;
   it's fine here, and the alternative is this breaking silently in 90 days. If
   you'd rather not, pick a date and put a reminder in your calendar.
4. **Scopes** — the box marked **gist** should already be ticked, and it should be
   the *only* one ticked. Check that. It's what limits this key to the scratch
   space and nothing else: not your code, not your repositories.
5. Scroll to the bottom and press **Generate token**.

You'll now see a long string starting with `ghp_`.

> ### Copy it now
>
> GitHub shows this **once**. Leave the page and it's gone for good — you'd have
> to delete it and make another. Put it somewhere you can paste from twice: you
> need it in step 4 and again in step 5.

**Check:** you have a string starting `ghp_` on your clipboard or in a note.

---

## Step 4 — Paste the key into the app

1. Back in the app, press the **cloud button** in the top bar.
2. Paste the key into the **GitHub token** box.
3. Press **Connect**.

**Check:** the dialog says **Synced**. If it says **Sync error**, see
[If something's wrong](#part-3--if-somethings-wrong).

Do this **once per device** — your phone and your laptop each need the same key
pasted in. That's the point of it: after this, the car you added in step 1 shows
up on both.

---

## Step 5 — Send the key to the person who set this up

They need it too. It's how the watcher reads the searches you make and writes
matching cars back into your calculator. Without it, nothing arrives.

**Send it privately.** A direct message or a text. Not a group chat, not a public
channel, and not anywhere it will sit in a shared history forever.

They'll add it to the watcher's settings. You don't need to do anything else with
it, and you can delete your own copy once they confirm it works.

---

## Step 6 — Somewhere to receive the listings

A Discord channel. Two ways, and it's entirely your choice.

### The easy way: join their server

They'll send you an invite link. Click it, sign in to Discord (or make a free
account), and you'll find a channel with your name on it. **Nothing else to do** —
skip to step 7.

### Or: use your own Discord server

If you'd rather keep it in your own space, you make the channel and hand over one
link pointing at it.

1. In your own server, make a channel — say `#cars`.
2. Click the **gear** next to the channel name → **Integrations** → **Webhooks** →
   **New Webhook**.
3. Press **Copy Webhook URL**.
4. Send that URL to the person who set this up, privately, along with the key from
   step 3.

That URL is all the watcher needs in order to post there. It doesn't have to be a
member of your server.

**One thing you lose unless you also add their bot:** reacting to a listing to
pull the car into your calculator. Reading reactions needs their bot to be *in*
your server. If you want that, ask for the invite link and click it — you'll need
permission to manage your own server, which you have, because it's yours. If
you'd rather not, everything else works and you add cars by hand instead.

**Check:** you can see a channel that's yours, in one server or the other.

---

## Step 7 — Make your first search

1. Press the **funnel button** in the top bar, then **New filter**.
2. **Make** and **Model** — or paste any nettiauto link for a car like the one you
   want into either box, and both fill themselves in.
3. Set whichever limits matter: year, odometer, price. **All of them are
   optional.** Leaving them blank means "show me this whole model", which is the
   right choice while you're still browsing.
4. Press **Save filter**.

**Check:** the filter appears in the list with a one-line summary under it, like
`polestar/2 · 2021–2023 · ≤ 120 000 km`.

You can make searches before you've been added to the watcher. They'll simply
start working once you have been.

---

## Step 8 — Set your assumptions

Press **Edit** on the **Assumptions** panel and set:

- **Driving / year** — kilometres. Every fuel and depreciation figure hangs off
  this one number.
- **Ownership** — how many years you'd keep the car.

Then look at **New car** just below, and set the interest rate and loan term you'd
realistically be offered. Every car you add starts on those, so comparisons stay
apples-to-apples until you have a real quote for one of them.

**Check:** the summary line at the top of the panel shows your numbers.

---

## What to send back

Two things, in one private message:

1. **The key** from step 3 (starts `ghp_`).
2. **The webhook URL** from step 6 — *only* if you chose your own Discord server.
   If you joined theirs, they already have it.

Then they add you, which takes them a minute. **You'll know it worked when
listings start arriving** — within half an hour, if cars matching your search are
already for sale.

---

# Part 2 — Using it

## Listings arrive in Discord

Each one shows the price, kilometres, year, seller and a photo, with a link to the
advert. If your search asked for something that only appears in the seller's own
text — an option pack, say — the message quotes the exact words it matched on, so
you can judge the call yourself rather than take its word for it.

## React to one, and it lands in your calculator

Any emoji, from anyone, on any listing. Within half an hour it turns up as a car
in the app, with the price, kilometres and engine type already filled in.

**Insurance, tax and maintenance are left blank on purpose.** Nobody can guess
those for a particular car and a particular person, and a made-up number looks
exactly like a real one. Get a quote, type it in, and the comparison becomes worth
trusting.

## Reading the numbers

Two monthly figures, answering different questions. Both are shown because people
routinely mean one and read the other.

| | |
|---|---|
| **€ / month** | What the car *costs* you. Depreciation, interest, fuel, insurance, tax — with what you'd get back when you sell it subtracted. The honest cost. |
| **Out of pocket / month** | What actually leaves your account each month while you're paying it off. Bigger, because it includes repaying the loan itself. The budget question. |

They differ because repaying a loan isn't a cost — you're buying something with
that money. Interest is a cost. Depreciation is a cost. The principal isn't.

**Depreciation is usually the biggest single line**, and it surprises people. A
car losing €8 000 of value over three years costs you more than its fuel. The
coloured bar on each card shows where the money actually goes, and it is often not
where you'd expect.

## Put it on your home screen

Then it opens like an app, and **works without a signal** — handy in a dealership
with bad reception.

- **iPhone:** Share → Add to Home Screen
- **Android:** menu → Install app, or Add to Home screen
- **Desktop:** an install icon appears in the address bar

## If you'd rather work in a spreadsheet

**Export → Spreadsheet** gives you every car as a row, with the monthly figures
alongside. Edit it in Excel and **Import** it back: the cars you changed get
updated, new rows get added, and anything you didn't touch is left alone.

Deleting a row does *not* delete the car — do that in the app.

**Export → Backup** is the other one: an exact copy, for keeping or restoring.

---

# Part 3 — If something's wrong

## During setup

| What you see | What it is |
|---|---|
| **Sync error** after pressing Connect | Almost always the key. Check you pasted all of it, that it starts `ghp_`, and that **gist** was the ticked scope. If in doubt, delete it at <https://github.com/settings/tokens> and make a new one. |
| You lost the key before pasting it | GitHub only ever shows it once. Delete that one at <https://github.com/settings/tokens> and repeat step 3. |
| The token page looks nothing like step 3 | You may be on the *fine-grained* tokens page. Use the link in step 3, which opens the classic one. |
| Cars appear on one device but not the other | The key hasn't been pasted on that device yet. Cloud button, paste, **Connect**. |
| All set up, but no listings ever arrive | Check with the person who set it up that they've added your two secrets. Until they do, your searches sit waiting. |

## Later on

| What you see | What it is |
|---|---|
| No listings for a day or two | Probably nothing matched. Narrow searches can be quiet for weeks — that's them working. Open the funnel and check your limits aren't stricter than you meant. |
| A flood of listings when you add a search | Expected, once. A new search reports what's already for sale before settling into only telling you about new arrivals. |
| A car you deleted came back | Delete it once more and it stays gone. The watcher double-checks that a car it added actually arrived, so deleting within the first half hour can cross with that check. |
| Everything vanished | Look before panicking: if sync is on, your data is in your GitHub space and the app pulls it back on reload. **Export → Backup** any time you want a copy on your own disk. |
| The numbers look mad | Check the Assumptions panel. A kilometres-per-year figure ten times too big makes every car look ruinous. |

Anything else, ask the person who set this up — they can see whether the watcher
is running, and that's usually the answer.

---

# What can and can't be seen

Worth being straight about, because you've been asked to hand over a key.

**Your data is in your GitHub account.** It isn't copied to anyone's server, and
there's no database with everyone's cars in it.

**But the person running the watcher holds a copy of your key**, because that's
how it reads your searches and writes cars into your calculator. That key reaches
your GitHub scratch space and nothing else — not your code, not your
repositories. Within that space, though, it reaches everything, so treat your car
data as *shared with them* rather than private from them. If you keep other things
in that same scratch space, those are reachable too.

**If you use your own Discord server** and invite their bot so that reacting
works, that bot can read the channels you give it access to. Skipping the bot
costs you only the react-to-add shortcut.

**The share link is a password.** If you use the view-only link to show somebody
your comparison, anyone holding that link can read it. Don't post it publicly.

**Getting out takes one click.** Revoke the key at
<https://github.com/settings/tokens> and the watcher stops for you on its next
run — and for nobody else. The app in your browser carries on with the copy it
already has; it just stops saving to GitHub. **Export → Backup** first if you want
a file of it.

---

# The short version

- Open <https://ssambss.github.io/carcalculator/> and add a car.
- GitHub account → make a key with only the **gist** scope → paste it into the app
  → send it privately to the person who set this up.
- Get a Discord channel, theirs or yours.
- Make a search with the funnel button; set your Assumptions.
- Listings arrive in Discord. React to one and it lands in the calculator.
- Fill in insurance and tax yourself — the blanks are deliberate.
- **€ / month** is what the car costs; **out of pocket** is what leaves your
  account. Depreciation is usually the biggest line.
- Add it to your home screen and it works offline.
- Revoking the key is one click, and stops it for you alone.
