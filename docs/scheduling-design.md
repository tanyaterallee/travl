# travl meet — design notes

A scheduling page for someone who is *travelling*, not someone who is at work.
It borrows Calendly's shape — publish a link, a stranger picks a time — and
throws away most of its model, because the two situations are not the same
problem wearing different clothes.

## What a traveller's availability actually is

Calendly's core object is a **rule**: "30-minute meetings, weekdays, 9 to 5,
30 minutes of buffer, no more than four a day." That is the right model for a
week that repeats. A trip does not repeat. Tuesday is the Great Wall and
Wednesday is a train; there is no recurring shape for a rule to describe, and
any rule general enough to cover the week would be wrong on five of its days.

So the object here is a **slot**: one concrete offer, at one hour, at one
place. Five of them are a week's availability. This makes the model smaller
than Calendly's in every direction — no rules engine, no working hours, no
buffers, no round-robin — and it makes the one thing that matters possible,
which is that a slot carries a *place*. "Coffee at the Bund, Saturday at ten"
is a thing a guest can say yes to. "30 minutes, Saturday" is not.

## Three states, and why not more

The calendar shows exactly three:

| State | Means | Comes from |
| --- | --- | --- |
| **Open to reserve** | anyone with the link may take it | the absence of the other two |
| **Already slotted** | someone has it, by name | a primary booking |
| **Unavailable** | the owner is already somewhere | the linked itinerary |

Both non-open states are **derived on read**, never stored. A booking that is
cancelled reopens its hour with no cleanup; an itinerary that is re-imported
after a plan changed stops blocking the afternoon it used to block. Storing
either would mean a calendar that can disagree with the facts, and the failure
mode of that bug — a guest is shown a free hour that is not free — is the one
this whole product exists to prevent.

Where they collide, **booked wins**. If an imported itinerary lands on an hour
somebody has already taken, the owner needs to see the person, not a grey box:
a clash with a stranger's plans is something you resolve by talking to them.

## The second option

The rule: a guest may hold **one booking and one second choice**, and the
second choice reserves nothing.

This is the feature the brief actually asked for and the one Calendly has no
equivalent of, because it only makes sense under scarcity. A traveller with
four free hours in a city cannot let one guest option all four "just in case" —
the page would fill with holds and nobody would ever get an answer. But
"Saturday morning, or Sunday afternoon if that falls through" is a real thing a
friend wants to say, and forcing them to say it in a text message defeats the
link.

So a tentative hold is *expressed but not enforced*: the slot stays open, other
guests can take it outright, and the owner sees the hold as an amber line and
can promote it with one button when the first choice falls apart.

## Why it links an itinerary rather than asking you to restate it

The owner already has a plan somewhere — this app's planner, Wanderlog, Google
Calendar. Asking them to re-enter it as "busy" is how a scheduling tool ends up
lying: nobody maintains two copies of the same week.

Four import paths, all producing the same `BusyEvent`:

- **This app's own trip.** No network, no keys, no CORS, and the richest data —
  a stop knows its own address and coordinates.
- **Google Calendar**, after sign-in. Recurring events are expanded into
  instances, and only a window around the trip is read: a year of somebody's
  meetings is both noise and a great deal of private schedule to copy into a
  document a guest can read.
- **An `.ics` link**, fetched directly. This covers Wanderlog, Apple Calendar,
  TripIt and anything else with an export.
- **Pasted `.ics` text**, when the fetch is refused.

That last one is not a fallback so much as an admission. Many calendar hosts
send no CORS headers, so a browser cannot read their feed, and there is no
clever way around it from a static site — a proxy means a server, and a server
that fetches arbitrary URLs for users is a liability, not a feature. So when
the fetch fails the app says so plainly and offers the paste box, which always
works.

`RRULE` is deliberately **not** expanded from `.ics`. A wrong expansion would
silently invent blocked afternoons, and an itinerary that fabricates busy hours
is worse than one that admits it only reads single events. Google's own API
does the expansion server-side, which is why the Google path has no such limit.

## No back end, and what that costs

Sign-in is the browser OAuth flow (Google Identity Services), which needs a
client id and no secret — the reason the whole app can stay a static site. The
access token is held **in memory only**: an OAuth token in `localStorage` is
readable by any script that ever gets injected, and it grants write access to
someone's calendar. The cost is a silent re-authorization after a reload; the
saving is that a single XSS is not a calendar breach.

Bookings ride the same Yjs document and relay as trip collaboration, which is
what lets a guest's booking appear on the owner's screen with no refresh, and
what makes two guests booking two slots in the same second merge rather than
clobber.

The honest limits that follow:

- **Without a relay, a booking link only works in the browser that made it.**
  The console says so rather than leaving it to be discovered.
- **The relay is unauthenticated.** The owner/guest split is a product rule —
  the booking page contains no code that writes a slot — not a security
  boundary. Anyone who knows a page id can read and write that page. This is
  the same caveat that already applies to shared trips.
- **Calendar mirroring is one-way.** Reconciling an event the owner dragged in
  Google against a booking a guest made here in the same minute is a
  conversation, not an algorithm. What comes back from Google is separate and
  explicit: you *import* a calendar as your itinerary, which blocks slots
  rather than editing them.

## Small decisions worth keeping

**Dates are written `Saturday, 12/09/26`.** Weekday first because a guest
picking a time in a foreign city has no other cue for which day of the trip
this is, and day-before-month always, assembled by hand rather than left to
`Intl` — a US locale would render that same date as August 12th, and somebody
would book a flight around it.

**Times are instants; days are local.** Slots are stored as ISO instants and
grouped into days in the *viewer's* zone. A guest in Hong Kong and an owner in
Berlin never disagree about when a slot is, only about what to call the day —
which is the true answer, and the page says which zone it is showing.

**Confirm lives on the same screen as the place.** The guest has just read what
the place is; that is the moment they decide. A separate confirmation step
would only add a screen between the decision and the act.

**The confirmation page offers three calendars.** A Google link (a URL, so it
opens the app on Android and the web everywhere else), an `.ics` download
generated in the browser (what an iPhone or Outlook understands, and it works
offline), and an Outlook Web deeplink. There is no single route that reaches
everybody's phone, and this is the last screen — getting the plan out of the
app is the only thing it has left to do.
