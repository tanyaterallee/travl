# travl

A collaborative trip planner in the shape of Wanderlog's desktop web app:
a visual card list you build by dragging places into days, a live map beside
it, real-time co-editing, a shareable link, and a printable plan.

It runs on **Google Maps** worldwide and **Amap / 高德地图** inside mainland
China, chosen automatically, because Google's maps, places and directions are
all unreachable behind the Great Firewall — and it works with no API keys at
all.

```bash
npm install
npm run dev          # http://localhost:5173
```

No configuration is needed to try it. A worked example trip across Shanghai,
Beijing and Hong Kong is seeded on first run.

---

## What it does

**Plan visually.** Places are cards. Search adds them to a wishlist, and
dragging one into a day schedules it — in picture mode with photo-led tiles
(`?mode=picture`, the default) or a dense list (`?mode=list`).

**Plan together.** Open the same trip in two browsers and both edit at once,
with presence avatars and a live outline on whichever card someone else has
focused. Notes merge per character, so two people typing in the same note both
keep their words.

**Share by link.** The Share dialog produces a URL containing the entire trip.
It needs no server, no account, and no network to open. You can leave the
budget out, and the expense data is then absent from the bytes rather than
hidden in the UI.

**Print.** A dedicated print view with a static map per day, numbered stops,
travel times, reservations and checklists. It renders without a map SDK and
without an API key, so a shared link prints as well as the original.

**Meet people, at `#/meet`.** Publish the hours you are free on a trip as a
booking link. Friends in the city pick one; you see who took what without a
thread of messages about what you are doing on Thursday. See below.

**Both languages.** Full English and 中文, switchable in the header, with a
font stack that sets Latin and Chinese text comfortably together.

## travl meet — scheduling for a trip

Meeting friends while you are travelling is a small logistics problem with a
disproportionate cost: you *do* have Saturday morning free, but working that
out takes six messages and a screenshot of your itinerary. `#/meet` turns the
free hours into a link.

**Your side.** Link what you are already doing — this app's own trip, a Google
calendar, or a Wanderlog / Apple / TripIt `.ics` export — and everything on it
becomes unavailable time. Publish the hours around it as slots, each with a
place and a line of description. The calendar shows three states and only
three:

| | |
| --- | --- |
| **Open to reserve** | anyone with the link may take it |
| **Already slotted** | taken, with the name and email of who took it |
| **Unavailable** | the linked itinerary already has you somewhere, and says where |

Add, edit, duplicate or delete a slot from the page. Signed in to Google, each
one is mirrored into a calendar you pick, and its title carries the answer at a
glance — `Coffee on the waterfront · Mei Chen`, or `· open`.

**Their side.** Name and email, then a list of times showing the full date
(`Saturday, 12/09/26`), the activity and the place. Tapping one shows what the
place is, with the name and address linking straight into Google Maps and a map
below, and Confirm on the same screen. The confirmation page hands the plan to
Google Calendar, Outlook, or a downloaded `.ics` — which is what it takes to
reach both a phone and a desktop.

A guest gets **one booking, plus one second choice**. The second choice holds
nothing: the slot stays open for anyone else, the owner sees it as a tentative
hold, and can promote it in one click when the first falls through. The design
notes in [`docs/scheduling-design.md`](docs/scheduling-design.md) explain why
that cap is the centre of the feature rather than a limitation of it.

```bash
npm run relay                                   # bookings need a relay
VITE_RELAY_URL=ws://localhost:1234 npm run dev  # then open #/meet
```

Without a relay the page works, but its link only opens in the browser that
made it — the console says so rather than leaving you to find out.

## Configuration

Everything is optional — copy `.env.example` to `.env.local` and fill in what
you have.

| Variable | What it buys you |
| --- | --- |
| `VITE_GOOGLE_MAPS_KEY` | Worldwide search, real photos, driving directions |
| `VITE_GOOGLE_STATIC_KEY` | Separate, tighter-scoped key for print maps |
| `VITE_GOOGLE_CLIENT_ID` | Sign in with Google, and calendar sync on `#/meet` |
| `VITE_AMAP_JS_KEY` | Maps and search inside mainland China |
| `VITE_AMAP_SECURITY_CODE` | Required by newer Amap JS accounts |
| `VITE_AMAP_WEB_KEY` | Amap static maps for print (a *different* credential) |
| `VITE_RELAY_URL` | Live co-editing, and booking links that reach other people |

`VITE_GOOGLE_CLIENT_ID` is an OAuth 2.0 **web application** client id with the
Calendar API enabled — no client secret, because this is the browser token flow
and there is no server to keep one in. The access token is held in memory and
never written to storage, so a reload costs a silent re-authorization rather
than leaving a calendar-writing credential where a script can read it.

With none of them set, a bundled OpenStreetMap provider serves tiles, a small
place index, and straight-line travel estimates that are labelled as estimates.

> Anything prefixed `VITE_` is compiled into the client bundle and is readable
> by anyone who loads the page. That is unavoidable for browser map SDKs —
> both Google and Amap work this way. Restrict the keys by referrer and domain
> in the provider console and set quota alerts.

### Live collaboration

Sharing works without a server. Simultaneous editing needs a relay:

```bash
npm run relay                                   # ws://localhost:1234
VITE_RELAY_URL=ws://localhost:1234 npm run dev
```

`server/relay.mjs` forwards Yjs updates between everyone in a room and keeps
the latest state in memory. It never parses a trip, so it needs no knowledge
of the document schema. **It has no authentication** — anyone who knows a room
name can read and write it. Put it behind auth before exposing it publicly.

## How it is built

The interface was designed four ways under conflicting constraints before any
code was written; [`docs/interface-design.md`](docs/interface-design.md)
records the alternatives, the comparison, and what was taken from each. The
shipped design is the recommendation at the end of that document.

```
src/core/     the document: CRDT schema, ordering, geodesy, sharing, React hooks
src/maps/     the provider contract and its Google, Amap and OSM adapters
src/ui/       cards, itinerary, sections, print
src/meet/     scheduling: slots, bookings, Google sign-in, the booking page
```

Four decisions carry most of the weight:

**The wishlist is `dayId === null`.** There is no second list. Dragging a card
into a day is one field write, so it can never end up in both lists or neither
when two people drag it at once.

**Coordinates are opaque.** `Coords` has no readable `lat`, so handing a
WGS-84 point to Amap is a compile error rather than a bug that ships and puts
every pin in Shanghai 500 m from where it belongs. WGS-84 is stored as truth
and the provider's own value is kept alongside it, because converting an
Amap-native point to WGS-84 and back lands it a few metres off its own
building — and that error compounds on every save.

**Card order is a fractional index, never an array position.** Reordering
writes one key that sorts between its neighbours, so two people rearranging
different parts of the same day never touch the same field.

**Travel times live in the document.** Nothing fetches directions during
render. A resolver fills in missing legs once and writes them to the CRDT, so
collaborators do not each pay for the same lookup, and the shared link and
print view work with no network and no key.

**A slot's state is derived, never stored.** "Booked" means a booking points at
it; "unavailable" means the linked itinerary overlaps it. Cancelling reopens an
hour with no cleanup, and re-importing a changed plan stops blocking an
afternoon that is now free — a stored flag would let the calendar disagree with
the facts, which is the one bug this feature cannot afford.

## Development

```bash
npm test          # 112 unit tests
npm run typecheck
npm run lint
npm run build
```

The tests concentrate on the parts that fail silently and expensively:
fractional-index ordering under concurrent inserts, GCJ-02 conversion and its
carve-outs for Hong Kong and Taiwan, budget roll-ups, CRDT convergence, and
whether an excluded section is really gone from a share link's bytes.

On the scheduling side: the booking rules (one primary, one tentative, and a
tentative hold that must not block anybody else), slot state under a clash
between a booking and the itinerary, `.ics` parsing including `TZID` and
all-day entries, and that a date never comes out month-first.

## Known limits

- **Share links are capped by URL length.** Past roughly 32 KB the dialog says
  so instead of handing over a truncated link. A trip of a few hundred places
  fits; the seeded example is about 6 KB.
- **The relay is unauthenticated** and keeps room state in memory only.
- **Without API keys**, search covers a bundled index of about 35 well-known
  places, cards use generated cover art instead of photographs, and travel
  times are straight-line estimates marked as such.
- **Provider choice is per trip, not per day.** A trip crossing the border
  picks one provider for everything, based on where its places are.
- **No accounts.** Whoever holds the link holds the trip; roles exist in the
  model but are not enforced by a server.
- **A booking link needs the relay.** Without one, a meet page never leaves the
  browser that created it. The console warns rather than letting you send a
  link that silently opens empty.
- **The owner/guest split on a meet page is a product rule, not a security
  boundary.** The booking page contains no code that writes a slot, but the
  relay is unauthenticated, so anyone who knows a page id can read and write
  it — the same caveat as a shared trip.
- **Calendar sync is one-way.** Slots are mirrored *into* Google Calendar;
  changes made there do not come back. Reading a calendar is a separate,
  explicit import that blocks slots rather than editing them.
- **Recurring events are only expanded on the Google path.** An imported `.ics`
  reads single events and skips `RRULE` rather than guessing, because a wrong
  expansion would invent busy afternoons.
- **Cross-origin `.ics` links often cannot be fetched from a browser.** When
  the host sends no CORS headers the app says so and takes the file pasted
  instead; there is no proxy, because that would mean a server.
