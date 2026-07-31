# travl — interface design study

Four independently-generated designs for the core layer of a Wanderlog-style
collaborative trip planner, produced under deliberately conflicting constraints
("design it twice"), then compared. This document records the options and the
reasoning; it is not the implementation.

**Scope of the core layer:** the trip document + mutation API, the
collaboration/sharing contract, and the map-provider abstraction (Google Maps
worldwide, Amap/高德 for mainland China).

---

## Design A — Minimal surface

**Constraint:** smallest possible number of exports. Deep module.

Five exports total: `openTrip`, `useTrip`, `Trip`, `Op`, `MapProvider`.

```ts
interface TripSession {
  readonly trip: Trip          // immutable snapshot, new identity per change
  readonly map: MapProvider    // already bound to Google or Amap; app never chooses
  apply(...ops: Op[]): void    // optimistic, atomic, undoable, permission-checked
  subscribe(onChange: () => void): () => void
}

type Op =
  | { set: Path; to: Json | undefined }          // create · update · delete
  | { move: Path; to: Path; before?: Id | null } // reorder + reparent
  | { undo: 1 | -1 }
```

The map contract is two methods:

```ts
interface MapProvider {
  query(q: MapQuery, signal?: AbortSignal): Promise<MapAnswer>  // find | place | route | still
  mount(el: HTMLElement, view: MapView): MapHandle              // declarative, diffed
}
```

There is no separate collaboration API. Presence, roles, sync status and the
share link are **fields of the same snapshot**, mutated with the same `set` op:

| Concern | API |
| --- | --- |
| Presence | `apply({ set: ['~here'], to: pathIWasEditing })`, read `trip.here` |
| Invite | `apply({ set: ['members','ana@x.com'], to: { role: 'editor' } })` |
| Publish | `apply({ set: ['share'], to: { mode: 'public', can: 'view' } })` |
| Undo | `apply({ undo: 1 })` |

**Hides:** CRDT choice, rich-text merge under a plain `string`, fractional
indices under `before`, socket lifecycle, offline replay, optimistic rollback,
role→capability resolution, datum conversion, provider selection, leg caching.

**Strains:** `Path` is stringly-typed — a typo is a runtime no-op, not a type
error. `to: Json` is untyped at the leaf. `apply` returns `void`, so failure
must be modelled as document state rather than a rejected promise. Presence
rides the persisted-op channel behind a `~` naming convention — the one visible
leak. One snapshot means one subscription granularity.

---

## Design B — Plugin kernel (maximum flexibility)

**Constraint:** third parties can add block types, map providers, views and
exporters without touching core.

The core owns identity, order, containment, transactions and dispatch — and no
features. Everything is a `Block`; a trip *is* a block.

```ts
interface Block<D = unknown> {
  readonly id: BlockId
  readonly type: BlockTypeId    // "core.place", "acme.ferry"
  readonly parent: BlockId | null
  readonly rank: Rank           // fractional index
  readonly data: Readonly<D>    // OPAQUE to core; owned by the block type
}
```

The load-bearing idea is the **facet** — a typed capability a block type
implements so cross-cutting subsystems can consume blocks they've never heard of:

```ts
const Geolocatable = facetKey<{ point(): GeoPoint | undefined }>('core.geolocatable')
const Scheduleable = facetKey<{ window(): TimeWindow | undefined }>('core.scheduleable')
const Costed       = facetKey<{ amounts(): readonly Money[] }>('core.costed')
const Printable    = facetKey<{ print(ctx: PrintCtx): PrintNode }>('core.printable')
```

A third-party "ferry crossing" block implementing Geolocatable + Scheduleable +
Costed appears on the map, in the day timeline, and in the budget total with
zero core changes. Queries are **data, not closures**, so the same query can run
in a worker or on the server for a share link. Drag/drop, paste and import all
go through one negotiation model (`TransformRule`). Redaction for public links is
delegated per block type (`redact(data, profile)`) — core never guesses which
fields are secret.

**Strains:** opaque `data` makes core blind — no cross-block validation, no
global refactor. Facets relocate coupling rather than remove it; versioning a
facet breaks every implementer. Merge correctness is delegated to plugin authors,
and a naive third-party `merge` corrupts a shared trip. Dynamic dispatch per
block per render. "Where does the itinerary get its times?" has no greppable
answer. And a buggy third-party `redact()` leaks expense data onto a public link,
which forces server-side redaction anyway — partly re-centralising what was just
decentralised.

Its own honest summary: the likely real need is "two providers and six block
types we write ourselves," and this pays a permanent tax for an ecosystem that
may never materialise.

---

## Design C — Optimise the common case

**Constraint:** make the 90% flow (search → wishlist → drag into Day 2 → see the
drive time → share) require the fewest concepts, even if rare cases get awkward.

**Two nouns: Place and Day. The wishlist is `day === null`.** Dragging a card
into a day is one field write, so the two lists can never desync.

```ts
interface Place {
  readonly name: string        // already localized
  readonly photo?: PhotoUrl    // hero, pre-sized for the card
  readonly rating?: number
  readonly coords: Coords      // opaque; carries both datums
  readonly day: DayNumber | null   // null ⇒ wishlist. THE field.
  readonly pending: boolean

  moveTo(day: DayNumber | null, index?: number): void
  set(patch: PlacePatch): void
  remove(): void
}

interface Day {
  readonly stops: Place[]
  readonly legs: Leg[]         // legs[i]: stops[i] → stops[i+1], auto-recomputed
  readonly total: { duration: string; distance: string }
}
```

Mutations hang off entities, not off a dispatcher. Six hooks cover the whole
flow — `useTrip`, `usePlace`, `useDay`, `usePlaceSearch`, `usePlaceDrag`,
`useShareLink` — plus `<TripMap day={2} />` as the only map API feature code
touches. No trip id is threaded through props; `TripProvider` holds it.

Coordinates are **opaque and branded**, which makes the datum bug structurally
unrepresentable:

```ts
type Coords = { readonly [CoordsBrand]: true }
declare function toWGS84(c: Coords): { lat: number; lng: number }  // escape hatch
```

Public view and print are the *same components* with a different `mode`:
`mode="print"` swaps `provider.Surface` for `provider.staticImage()`, disables
sync and presence, and suspends until the render is print-stable.

**Strains:** the document is not generic — notes/checklists/reservations/budget
are enumerated hooks, so a custom block type needs a schema change. `day: number
| null` cannot express a 3-night hotel spanning days (workaround: duplicate per
night, with `category: 'stay'` excluded from leg computation). Mutations are
`void` and fire-and-forget. Its sharpest edge: `useTrip()` returns the whole
document, so cards **must** subscribe via `usePlace(id)` and receive an id, not
an object — prop-drilling entity objects defeats the granularity and needs a lint
rule.

---

## Design D — Local-first CRDT

**Constraint:** the document is a CRDT in the client; the server is a relay.

Ordering is a first-class `Ordered<V>` collection — an id→value map plus a
fractional index per entry, never an array:

```ts
interface Ordered<V> {
  insert(v: V, at: { after?: EntityId; before?: EntityId }): EntityId
  move(id: EntityId, at: { after?: EntityId; before?: EntityId }): void
  transfer(id: EntityId, to: Ordered<V>, at: {...}): void  // cross-container, ONE op
}
```

`transfer` matters: wishlist → day is a single op, so a card is never in both
containers and never in neither.

**The radical move: resolver results live in the document.** A peer inside the
GFW cannot reach Google; an offline peer cannot reach anything. So peers publish
*tickets* into the doc, any peer with the right network claims one (a lease, not
a lock — a dead tab cannot wedge the queue), calls its provider, and writes the
answer back. Everyone converges on identical data, and the share link and print
view need no network at all.

Geodesy is type-enforced — a bare lat/lng is a compile error:

```ts
interface GeoPoint {
  wgs84: Wgs84
  native?: Gcj02                    // present iff provider is Amap
  origin: { datum: Datum; provider: ProviderId; converted: boolean }
}
```

The stored WGS-84 is never overwritten by a conversion, because round-tripping
an Amap-native GCJ-02 point through WGS-84 and back lands it 1–3 m off its own
building.

Share links serve a **sealed immutable snapshot** — history compacted, excluded
sections stripped from the *bytes* (not hidden by CSS), asset bytes inlined.
Public viewers never join the room, so no public reader can send an op.

**Strains — and this is the sharpest critique in the set:** permissions are the
deep wound. A CRDT says "any op merges"; a permission says "some ops must not."
The relay therefore has to run a headless replica and replay ops against policy —
exactly what "dumb relay" promised to avoid. Rejected ops come back as a visible
undo the user did not ask for. Field-level roles ("viewers can't see the budget")
force the budget into its own subdoc, which breaks transaction atomicity across
the seam. Anything needing global truth (quotas, plan gating, audit timestamps)
is not expressible in a merge function and leaks into RPCs — so the app becomes
two systems with two consistency models.

Also flagged: Google's terms restrict persisting most Places content (ratings,
photos, hours) beyond limited windows, which directly undermines
"everything lives in the doc forever" — hence `ttl` and a `redistribution:
'cacheable' | 'ephemeral'` marker, and a sweeper that deletes ephemeral fields
against the user's intent. And a demoted editor who worked offline for a week
gets bulk-rejected on reconnect — the worst UX in the design, needing an explicit
"export your rejected changes" hatch rather than a toast.

---

## Comparison

**Where they agree — and this is the strongest signal in the study.** All four
converged on seven decisions without coordination, so treat these as settled:

1. **The wishlist and the days hold the same entity.** Moving a card is one
   operation — a field write (C), a `transfer` (D), a `move` path (A), a ranked
   reparent (B) — never delete-then-create. Every design reached for this
   independently, because delete+create is what desyncs two lists under
   concurrent edits.
2. **Store WGS-84 as truth, convert only at the provider boundary,** and keep the
   provider-native coordinate alongside it to avoid round-trip drift.
3. **Travel times are derived and cached in the document,** not fetched at
   render. Nobody calls a directions API from a component.
4. **A share link is a frozen read-only artifact, not live room access.**
5. **Print uses a static map image, not an SDK canvas.**
6. **Permissions are enforced in the write path;** any `can()` on the client is
   cosmetic, for hiding affordances only.
7. **Provider selection is automatic** (coverage + reachability + locale) and
   feature code never names Google or Amap.

**Where they diverge most** is the mutation vocabulary, and it's a real trade.
A's three structural ops (`set`/`move`/`undo`) are the smallest thing that can
possibly work and make new sections nearly free — a new section is a new key,
not a new API. But they're stringly-typed, so the type system stops helping
exactly where the app gets big. C's entity methods (`place.moveTo(2)`) are fully
typed and read like English at the call site, at the cost of a closed schema.
B's named intents are the only ones that carry a label for undo and an intent for
audit, which A and C both have to reconstruct.

**On depth**, C is the deepest by the study's own measure: six hooks and one map
component hide sync, undo, permissions, Suspense, debouncing, race-cancellation,
leg computation, provider choice, datum conversion, i18n, and print mode. A is
close behind with a smaller surface but a weaker type story. B is the shallowest
— its kernel is genuinely thin, and the complexity doesn't disappear, it moves
into plugins where it's harder to grep and impossible to typecheck across.

**On ease of misuse**, C's opaque branded `Coords` is the best idea in the study:
it makes handing a WGS-84 point to Amap a *compile error* rather than a bug that
ships and puts every pin in Shanghai 500 m off. D reaches the same place with
more ceremony and more truth (it keeps provenance, which C discards). A doesn't
address it at the type level at all.

**On the China requirement specifically**, D is the only design that took the
constraint seriously as a *network topology* problem rather than an API-shape
problem. Its distributed resolver queue — peers behind the GFW request, peers
with reachability fulfill — is the only proposal here that makes a mixed
CN/non-CN group of collaborators see identical data. The others assume every
client can reach whichever provider was selected, which is exactly the assumption
that breaks at the border.

**On overshoot**, B is the clear outlier and says so itself. Its facet system is
genuinely elegant, and a *reduced* version of it earns its place: the budget
total and the print pipeline shouldn't need to enumerate block types. But the
plugin envelope, host permissions, per-plugin i18n bundles, semver ranges and
inert-placeholder blocks are all cost against a third-party ecosystem that
doesn't exist.

## Recommendation

**Build C's call-site ergonomics on D's storage model**, with two borrowings:

- **From C:** the two-noun model with `day === null` as the wishlist, entity
  methods over a dispatcher, the six hooks, `<TripMap>` as the only map surface
  feature code touches, opaque branded `Coords`, and one `mode` prop unifying
  edit / public / print.
- **From D:** fractional-index ordering with a single cross-container
  `transfer`, `GeoPoint` carrying WGS-84 *plus* the provider-native coordinate
  *plus* provenance (keep C's opaque wrapper on the outside, D's honesty on the
  inside), sealed-snapshot share links that strip excluded sections from the
  bytes, and the resolver-results-in-the-document idea — which is what makes
  print work offline and makes a CN/non-CN group converge.
- **From A:** the two-method map provider contract (`query` + declarative
  `mount`). It is the cleanest of the four and the easiest to write a third
  adapter against.
- **From B:** facets only for the genuinely cross-cutting consumers — budget
  totals, map pins, print nodes — and nothing else. No plugin envelope, no host
  permissions, no registry.

**Deliberately not adopted:** A's stringly-typed `Path` (the type system should
help here), B's plugin kernel (overshoot), and D's premise that the server is
dumb — D's own analysis shows permissions force a policy-aware server, so plan
for one from the start rather than discovering it later.

The one decision this study cannot make for you is how much server to build,
because "collaborators can manage the list" can mean a real-time backend or a
shared-link-plus-merge model, and that choice changes roughly half the code.
