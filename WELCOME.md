# Welcome — car watching, in plain terms

Somebody set this up for you. This page is everything you need to know, and
nothing you don't.

There are two halves:

- **A watcher.** You describe the car you're looking for — a Polestar 2 from
  2021–2023, under 120 000 km, with the Pilot pack — and when one appears for
  sale, you get a message. Usually within half an hour of it going up.
- **A calculator.** For each car you're considering, it works out what it
  actually costs you *per month*, once fuel, insurance, tax, depreciation and
  the loan are all counted. That's the number a price tag doesn't tell you.

You'll be watching your own cars. Nobody else sees your searches or your
numbers, and you don't see theirs.

---

## What you'll be asked for, and why

Three things, once. Roughly ten minutes together.

### 1. A GitHub account

An odd-sounding ask, so here's the reason: **it's where your data lives, in your
name.** GitHub gives every account a private scratch space, and your cars and
searches are kept in yours — not in somebody else's database. If you ever want
out, you keep the data and revoke the access.

It's a free signup form. If you already have an account, use it.

### 2. One password-like key, pasted into the app once

GitHub can hand out a key that unlocks *only* that scratch space — not your
email, not anything else. You'll create one and paste it into the app. That's
what lets the app save your work and have it show up on your phone and your
laptop both.

You'll paste it once per device. That's the whole setup.

### 3. Somewhere to receive the listings

A Discord channel. Two ways:

- **Join the server you were invited to** — one click, and your channel is
  waiting.
- **Or use your own Discord server**, if you'd rather. You make a channel, and
  hand over one link that points at it. Nothing else changes.

Either works exactly the same. See *What can and can't be seen* below for the one
difference.

**There's nothing to install.** It runs in your browser. You can put it on your
home screen if you like it there — see below.

---

## Your first ten minutes

1. **Open the app** on your phone or laptop.
2. **Tap the cloud button** in the top bar and paste the key. That's the sync
   set up; you won't do it again on this device.
3. **Tap the funnel button** and describe the car you're after. Make, model, and
   whichever limits matter — year, kilometres, price. Everything except make and
   model is optional; leaving it all blank means "show me the whole model", which
   is the right choice if you're still browsing.
4. **Open the Assumptions panel** and set how much you drive per year and how
   long you'd keep the car. Every calculation hangs off those two numbers, so
   they're worth a moment.
5. **Wait.** The watcher checks every half hour. If cars matching your search are
   already for sale, you'll get those first — that's the point of adding a
   search, not a bug.

---

## Using it

### Listings arrive in Discord

Each one shows the price, the kilometres, the year, the seller and a photo, with
a link to the advert. If your search asked for something that only appears in the
seller's own text — an option pack, say — the message quotes the exact words it
matched on, so you can judge for yourself rather than take its word for it.

### React to one, and it lands in your calculator

Any emoji, on any listing. Within half an hour it turns up as a car in the app,
with the price, kilometres and engine type already filled in.

**Insurance, tax and maintenance are left blank on purpose.** Nobody can guess
those for a particular car and a particular person, and a made-up number looks
exactly like a real one. Get a quote, type it in, and the comparison becomes
worth trusting.

### Reading the numbers

Two monthly figures, and they answer different questions. Both are shown because
people routinely mean one and read the other.

| | |
|---|---|
| **€ / month** | What the car *costs* you. Depreciation, interest, fuel, insurance, tax — with what you'd get back when you sell it subtracted. The honest cost of the car. |
| **Out of pocket / month** | What actually leaves your account each month while you're paying it off. Bigger, because it includes repaying the loan itself. The budget question. |

They differ because repaying a loan isn't a cost — you're buying something with
that money. Interest is a cost. Depreciation is a cost. The principal isn't.

**Depreciation is usually the biggest single line**, and it surprises people.
A car losing €8 000 of value over three years costs you more than its fuel. The
coloured bar on each card shows where the money actually goes; it's often not
where you'd expect.

### Put it on your home screen

It works without a signal once you've done this — handy in a dealership with bad
reception.

- **iPhone:** Share → Add to Home Screen
- **Android:** menu → Install app, or Add to Home screen
- **Desktop:** an install icon appears in the address bar

### If you'd rather work in a spreadsheet

**Export → Spreadsheet** gives you every car as a row, with the monthly figures
alongside. Edit it in Excel, then **Import** it back — the cars you changed get
updated, new rows get added, and anything you didn't touch is left alone.
Deleting a row does *not* delete the car; do that in the app.

---

## When something looks wrong

| What you see | What it usually is |
|---|---|
| No listings for a day or two | Probably nothing matched. Narrow searches can be quiet for weeks — that's them working. Open the funnel and check your limits aren't stricter than you meant. |
| A flood of listings when you add a search | Expected, once. A new search reports what's already for sale before it settles into only telling you about new arrivals. |
| The app looks empty on your other phone | The key hasn't been pasted on that device yet. Cloud button, paste, done. |
| A car you deleted came back | Delete it once more and it stays gone. The watcher double-checks that a car it added actually arrived, so deleting within the first half hour can cross with that check. After it has confirmed the car once, deleting is final. |
| Everything vanished | Look before panicking: if sync is on, your data is in your GitHub space and the app will pull it back on reload. **Export → Backup** any time you want a copy on your own disk. |
| The numbers look mad | Check the Assumptions panel first. A kilometres-per-year figure that's ten times too big makes every car look ruinous. |

Anything else, ask the person who set this up — they can see whether the watcher
is running, and that's usually the answer.

---

## What can and can't be seen

Worth being straight about, because you're being asked to hand over a key.

**Your data is in your GitHub account.** It isn't copied to anyone's server, and
there's no database with everyone's cars in it.

**But the person running the watcher holds a copy of your key**, because that's
how the watcher reads your searches and writes cars into your calculator. That
key reaches your GitHub scratch space and nothing else — not your code, not your
repositories. Within that space, though, it reaches everything —
so treat your car data as *shared with them*, not private from them. If you keep
other things in that same GitHub scratch space, they're reachable too.

**If you use your own Discord server** and invite their bot so that reacting
works, that bot can read the channels you give it access to. If you'd rather not,
say so — skip the bot, and everything still works except the react-to-add
shortcut. You'd add cars to the calculator by hand instead.

**The share link is a password.** If you use the view-only link to show somebody
your comparison, anyone with that link can read it. Don't post it publicly.

**Getting out takes one click.** Revoke the key in your GitHub settings and the
watcher stops for you on its next run — and for nobody else; everyone else keeps
working. The app in your browser carries on with the copy it already has, it just
stops saving to GitHub. Your data stays yours either way, and
**Export → Backup** gives you a file of it.

---

## The short version

- Your searches and your cars are yours, in your own GitHub account.
- Listings arrive in Discord; react to one and it lands in the calculator.
- Fill in insurance and tax yourself — the blanks are deliberate.
- **€ / month** is what the car costs; **out of pocket** is what leaves your
  account. Depreciation is usually the biggest line.
- Add it to your home screen and it works offline.
- The person running it holds a key to your data. Revoking is one click.
