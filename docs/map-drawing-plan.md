# Map drawing — implementation plan

Let the sharer draw on the map (arrows, freehand, circles) and have that
drawing arrive on the dispatcher's screen along with the code.

Status: **implemented, 2026-08-22** — kept as the design record. It was built
via `specs/map-drawing-build-plan.md`, which holds the ordering, the test
plan, the trial outcome (toolbar: the collapsed-pencil toggle won; the
palette variant was built, trialled and deleted) and the deviations found on
the way. Originally authored on `whereareyou-web` branch
`claude/map-drawing-share-8t97sb`, now retired.

---

## The decision: the drawing rides the session, not the link

A drawing cannot ride the *code*. A session code is 8 characters and an offline
code is 10, and their job is to be read aloud down a phone. There is no room and
no voice channel for arrows.

That leaves two transports:

1. **In the share link**, packed into the URL fragment. No server change at all,
   works offline, but produces a long URL and only travels where a link travels.
2. **With the position, through the resolver** — the sketch is stored against
   the session and returned when the code is resolved.

**We are doing (2).** The dispatcher types the same 8 characters they type
today and the drawing is simply there. No link, no fragment, nothing long to
paste.

The cost is that it needs all three repos, and that the offline path cannot
carry a drawing at all (see *No-signal behaviour* below).

### Why the server stores an opaque string

The resolver stores the sketch as a **base64url string it never parses**. It
checks the length and the character set, and nothing else. The codec lives in
`@whereareyou/protocol` next to the offline codec.

This keeps the resolver dumb about geometry. It has nothing to validate, no
drawing semantics to get wrong, and it cannot quietly become a drawing service.
It also means the sketch is a single scalar field in every store — no schema
work in Redis, no migration.

### What it does to the privacy story

The sketch lives inside the same `sess:{code}` Redis hash as everything else, so
it inherits the session TTL structurally: the drawing physically cannot outlive
the code. No new key, no second TTL, no sweeper. This is worth stating in the
API README next to the existing claim, because "caller-drawn content is now
stored server-side" is exactly the sort of thing that deserves an explicit
answer rather than silence.

---

## Decisions taken

**No-signal behaviour — let them draw, warn it won't send.**

The drawing tools stay usable with no connection, so a caller can still sketch
the situation and see it on their own screen. But an offline code has no server
behind it, so the sketch has nowhere to go, and the screen must say so plainly
rather than letting someone believe an operator can see their arrows.

This is the one place where getting the wording wrong would be genuinely
harmful, so it is not a footnote. Suggested copy, in the house voice:

> **Your drawing stays on this phone.** An offline code carries a position and
> nothing else — there is no server to hold the drawing. Describe it out loud
> instead, or get an expiring code when you have signal.

Note the existing precedent this matches: the "Keep updating my position" toggle
already disables offline with *"Needs a connection — a code that follows you has
to live on the server."* Same shape of explanation, one step softer because here
the tools still work.

**Tools — the lot, with colours.**

Arrow, freehand pen, circle. Undo and clear. A small colour palette.

---

## Colour, and the trap in it

Two colours on these maps already carry hard meaning:

| Colour | Meaning | Where |
|---|---|---|
| `#2563eb` blue | the sharer's own position | `Map.tsx`, `pinIcon` |
| `#d97706` amber | a third-party report | `Map.tsx`, `pinIcon` |

`Map.tsx` is explicit that a dispatcher confusing those two is the worst failure
this UI can produce. Ink colours must therefore be visibly distinct from both.

Proposed palette — four inks, none near blue or amber:

| # | Hex | Name |
|---|---|---|
| 0 | `#be185d` | rose |
| 1 | `#7c3aed` | violet |
| 2 | `#0f766e` | teal |
| 3 | `#1f2937` | graphite |

Every stroke gets a **white casing** underneath (same path, ~3px wider, white,
~0.85 opacity) so it stays legible over any tile.

**The trap:** ink colour has *no defined meaning*. Rose does not mean hazard and
teal does not mean safe. The dispatcher UI must not present the palette as if it
were a legend, and nothing about the drawing may be conveyed by colour alone —
the note field carries meaning, colour only groups. Worth a sentence in the
dispatcher's provenance notice. This also covers the colour-blindness case,
where rose and violet are the confusable pair.

---

## Wire format

Version 1. Compact binary, then base64url with no padding.

```
byte 0        version = 1
zigzag varint round(anchor.lat * 1e5)
zigzag varint round(anchor.lon * 1e5)
then shapes, repeated until end of buffer:
  byte        (kind << 4) | colour        kind: 1=pen 2=arrow 3=circle
                                          colour: 0..3
  pen         varint N (point count)
              N × (zigzag varint dEast, zigzag varint dNorth)
  arrow       2 × (zigzag varint dEast, zigzag varint dNorth)   [from, then to]
  circle      1 × (zigzag varint dEast, zigzag varint dNorth)   [centre]
              varint radius
```

**Points are deltas in decimetres** from a running cursor that starts at
`(0, 0)` — i.e. at the anchor. Each point sets the cursor. This makes freehand
cheap: a stroke sampled every few pixels costs about one byte per coordinate.

**Metres from the anchor**, equirectangular:

```
east  = (lon - anchor.lon) * 111320 * cos(anchor.lat)
north = (lat - anchor.lat) * 111320
```

Clamp `cos(anchor.lat)` to a floor of `1e-6` so the poles do not divide by zero.
The approximation is well inside drawing tolerance over the few kilometres a
sketch spans.

**Varint** — 7 bits per byte, little-endian, high bit is the continuation flag.
Use `Math.floor(n / 128)` rather than `>>> 7`; the anchor values reach ~9,000,000
and bit-shifting is a trap waiting for someone to raise the precision.

**Zigzag** — `n >= 0 ? 2n : -2n - 1`.

**Anchor is a compression origin, not a position.** All geometry decodes to
absolute lat/lon. This matters: an arrow keeps pointing at the real place when
the pin is dragged, and it does not follow a live session as the caller walks
away. Carrying the anchor explicitly also lets a sketch render standalone if the
position is ever unavailable.

### Limits, enforced by the decoder

Hostile input is a real case — this arrives from a server response and, one day,
from anyone who can mint a session.

| Limit | Value |
|---|---|
| `MAX_SKETCH_CHARS` | 4096 (exported from the protocol package; the API uses the same constant) |
| shapes per sketch | 64 |
| points per pen stroke | 512 |
| encoder target | stay under ~2000 chars |

**`decodeSketch` returns `null` on any malformed input and never throws.** Truncated
buffer, unknown version, unknown shape kind, counts over the cap — all `null`.

Sizes in practice: an arrow is 5–9 bytes (~12 base64 chars). A dozen mixed
shapes lands around 150–400 chars. Freehand is the expensive one, which is why
the encoder simplifies.

### Encoder-side simplification

Run Ramer–Douglas–Peucker over pen strokes at roughly 1.5 m tolerance before
encoding, and drop degenerate shapes (zero-length arrows, sub-metre circles,
single-point strokes). Without this a 20-second scribble is thousands of points.

---

## Repo 1 — `whereareyou-protocol`

**New `src/sketch.ts`**, sitting alongside `offline.ts` and following its
conventions (pure, deterministic, no network, no clock, heavily commented on the
*why*).

```ts
export interface SketchPoint { lat: number; lon: number }
export type SketchColour = 0 | 1 | 2 | 3
export type SketchShape =
  | { kind: 'pen';    colour: SketchColour; points: SketchPoint[] }
  | { kind: 'arrow';  colour: SketchColour; from: SketchPoint; to: SketchPoint }
  | { kind: 'circle'; colour: SketchColour; centre: SketchPoint; radiusM: number }
export interface Sketch { anchor: SketchPoint; shapes: SketchShape[] }

export const SKETCH_VERSION = 1
export const MAX_SKETCH_CHARS = 4096
export const MAX_SKETCH_SHAPES = 64
export const MAX_PEN_POINTS = 512

export function encodeSketch(sketch: Sketch): string
export function decodeSketch(encoded: string): Sketch | null
export function isValidSketchPayload(encoded: string): boolean   // shape/length only, no decode
export function simplifyStroke(points: SketchPoint[], toleranceM?: number): SketchPoint[]
export function sketchBounds(sketch: Sketch): [[number, number], [number, number]] | null
```

`sketchBounds` returns south-west / north-east and must account for circle radii,
not just centres. The web app uses it to fit the map.

`isValidSketchPayload` is the cheap check the API uses — length plus
`/^[A-Za-z0-9_-]+$/` — so the resolver never has to decode.

**`src/types.ts`** — add `sketch?: string` to `CreateSessionRequest`,
`ResolvedSession`, and `UpdatePositionRequest`. Document it as an opaque
encoded payload, and note that resolvers are not expected to interpret it.

**`src/index.ts`** — export the new functions, the constants, and the types.

**`test/sketch.test.ts`** — the repo already uses vitest with fast-check, and
this codec deserves the same treatment `offline.test.ts` gives:

- round-trip property: encode → decode → geometry within ~0.2 m of the original
- every truncation of a valid payload decodes to `null` rather than throwing
- random junk strings decode to `null`
- caps are enforced (65 shapes, 513 points)
- an anchor near the poles and across the antimeridian does not blow up
- encoded size stays under the cap for a realistic worst case

**Note the dependency direction:** both other repos consume this package from
GitHub (`github:stu-greenshoots/whereareyou-protocol`), which resolves to the
**default branch**. So either land the protocol change on `main` first, or
temporarily repoint the dependency in the other two repos at a branch. The web
and API work will not typecheck until the protocol package exposes the codec.
This is the main sequencing hazard in the whole plan.

---

## Repo 2 — `whereareyou-api`

**`src/store.ts`** — add `sketch?: string` to `StoredSession`.

**`src/store-redis.ts`** — add `sketch` in *both* directions:
- `encode()` — one more `put('sketch', patch.sketch)`; the existing `put` helper
  already omits `undefined` correctly, which is the behaviour we want since an
  absent sketch is meaningful.
- `decode()` — add `sketch` to the destructure, and make sure it is **not**
  added to the half-written-hash guard: a session with no drawing is perfectly
  valid and must not be rejected.

**`src/routes.ts`**:
- `POST /v1/sessions` — read `body['sketch']`, accept only when it is a string
  passing `isValidSketchPayload`; otherwise ignore it silently and mint anyway.
  A malformed sketch must never cost someone in trouble their code. Same spirit
  as the existing `note` handling, which truncates rather than rejects.
- `toResolved()` — pass `sketch` through with the existing
  `...(x !== undefined ? { x } : {})` idiom.
- `PATCH /v1/sessions/:code` — *(stretch)* accept a replacement `sketch` on live
  sessions, so a caller can add an arrow after the code is already out. Same
  validation. Keep the rule that `expiresAt` is never extended.

**Tests** — mirror the existing route tests: mint with a sketch and resolve it
back; mint with a 10,000-character sketch and confirm the session is still
created and the sketch dropped; mint with a non-string sketch and confirm the
same.

**README** — one line in the endpoint table, and a short design note answering
"you said you avoid databases of location data, and now you store drawings".
The answer is the structural-TTL one above.

---

## Repo 3 — `whereareyou-web`

Branch: `claude/map-drawing-share-8t97sb`.

### New `src/sketch-layer.ts`

All Leaflet rendering for a sketch, kept out of `Map.tsx` so that file stays
readable.

```ts
export interface SketchHandle {
  update(sketch: Sketch | null): void
  remove(): void
}
export function attachSketch(map: L.Map, sketch: Sketch | null): SketchHandle
export const SKETCH_INKS: readonly string[]   // the four hexes above
```

Internals: an `L.LayerGroup`; a white casing polyline under each ink polyline;
`L.circle` for circles; arrows as a shaft polyline plus a filled head polygon.

**Arrowheads must be a constant size on screen.** Compute them in layer points
(`map.latLngToLayerPoint`), convert back with `layerPointToLatLng`, and
recompute on `zoomend` — otherwise the head is a dot when zoomed out and covers
a street when zoomed in. Head length ~14px, spread ~0.42 rad.

### `src/Map.tsx`

New props:

```ts
sketch?: Sketch | null
onSketchChange?: (sketch: Sketch | null) => void
sketchAnchor?: { lat: number; lon: number }
fitSketch?: boolean
```

The map owns the active-tool state internally (`'pin' | 'pen' | 'arrow' | 'circle'`
plus the current ink), so `Share.tsx` only deals in sketches.

**Toolbar** — rendered only when `onSketchChange` is provided. Tool buttons,
four colour swatches, undo, clear. Position it clear of both Leaflet's zoom
control (top-left) and the existing `.map-locate` button (top-right); bottom-left
above the attribution is the free space. `z-index: 700` to match `.map-locate`.

**Pointer interaction**, while a draw tool is active:
- `pointerdown` starts a shape, `pointermove` extends it into a live preview,
  `pointerup` commits it via `onSketchChange`.
- `map.dragging.disable()` and `map.doubleClickZoom.disable()`, restored on
  cleanup. Otherwise a stroke pans the map.
- Set the container's inline `touch-action: none` while drawing, saving and
  restoring the previous value, so a stroke does not scroll the page.
- **Multi-touch:** if a second pointer arrives mid-stroke, discard the
  in-progress shape. Leaflet's pinch-zoom uses touch events and is unaffected by
  our pointer capture, so this leaves two-finger zoom working between strokes.
- Circle radius comes from drag distance; arrow is press-point to release-point.

### Gotchas in the existing `Map.tsx` — read these before touching it

1. **The map instance lives in `useState`, not a ref, deliberately.** There is a
   long comment explaining why: StrictMode mounts, tears down and remounts, and
   with the map in a ref the layer effect takes its "already exists" branch
   against a destroyed map and the pin silently never appears. Any new layer
   handle must be nulled in the *same* teardown that already nulls `markerRef`,
   `circleRef` and `trailRef`, or the sketch will vanish on remount in dev only.
2. **The existing map `click` handler moves the pin.** It must be suppressed
   while a draw tool is active, or the first stroke also teleports the pin.
3. **There is an auto-pan effect** that recentres when the position leaves the
   viewport. Do not let a fit-to-sketch fight it.
4. **Fit to sketch only on read-only maps** (`fitSketch`), never while editing —
   refitting under someone's finger mid-stroke is horrible.
5. `requestAnimationFrame(invalidateSize)` on create is cancelled on teardown for
   a reason. Leave it alone.

### `src/Share.tsx`

- New state `sketch: Sketch | null`, cleared by `startAgain`.
- Anchor the sketch at the position when the first shape is drawn.
- Pass `sketch` + `onSketchChange` to the `<Map>` in the `located` / `minting`
  phases; pass `sketch` read-only with `fitSketch` in `shared` and
  `offline-shared`.
- `mint()` — include `sketch: encodeSketch(sketch)` when there is one.
- **Offline warning** — when `!online` and the sketch is non-empty, show the
  notice quoted above. It belongs near the tools and again on the
  `offline-shared` screen, because that is the moment the caller is deciding
  what to read out.
- `nativeShare()` needs no change. The drawing travels with the code.

### `src/api.ts`

Add `sketch?: string` to `MintOptions`. `mintSession` already spreads the
options object into the body, so nothing else changes.

### `src/Resolve.tsx`

- `SessionView` — `decodeSketch(session.sketch)` when present, pass to `<Map>`
  with `fitSketch`.
- Guard the decode: `null` means a malformed payload, and the right response is
  to render the position without the drawing, not to blank the screen. A
  dispatcher losing the position because a sketch failed to parse would be a bad
  trade.
- **Provenance notice** when a sketch is present:

  > **The caller drew this.** It is their sketch of the scene, not survey data,
  > and the colours carry no meaning.

- `OfflineView` never shows a sketch. There is nothing to show — say nothing.

### `src/styles.css`

`.map-tools`, `.map-tool`, `.map-tool-active`, `.map-ink` swatches. Follow the
`.map-locate` block directly above for the surface, radius, border and shadow
conventions. Touch targets at least 40px — this is used outdoors, one-handed,
possibly in the rain.

---

## Suggested order

1. Protocol: codec + types + tests. **Land on `main`** so the other two repos
   can resolve it.
2. API: store field, Redis encode/decode, route validation, tests.
3. Web: `sketch-layer.ts` → `Map.tsx` → `Share.tsx` → `Resolve.tsx` → CSS.

Steps 2 and 3 are independent once step 1 is in.

## How to check it works

`npm run dev` in the API, `npm run dev` in the web app, then on a phone over the
LAN address — a laptop trackpad tells you almost nothing about whether the
drawing feels right, and this is a touch interaction above all.

- Draw an arrow, mint, look the code up in another tab: the arrow is there.
- Drag the pin after drawing: the arrow stays pointing at the same real place.
- Live mode, walk around: the sketch stays put while the pin moves.
- Kill the API mid-session: the drawing is already on the server and still
  resolves.
- Aeroplane mode, draw, mint: offline code, sketch stays local, warning shown.
- Zoom in and out hard: arrowheads stay the same size on screen.
- Two-finger pinch mid-drawing: zooms, and does not leave a stray stroke.
