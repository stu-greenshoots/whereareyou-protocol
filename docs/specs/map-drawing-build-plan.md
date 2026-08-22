# Map drawing — build & test plan

**Turns `map-drawing-plan.md` into an ordered, gated build.** The source plan
(web repo, branch `claude/map-drawing-share-8t97sb`, `docs/map-drawing-plan.md`)
carries the design: the transport decision, the wire format, the limits, the
per-repo change lists and the UI behaviour. It is good and its code-level claims
check out. This doc adds what it lacks: the gaps found on verification, an
ordered sequence with done-gates, the full test plan, and the A/B variants for
the phone trial. **Build with both docs open** — design detail there, order and
gates here.

Status: **built to the phone gate, 2026-08-22.** Decisions D1–D3 taken by
Stu: D1 both variants, D2 no web test runner for v1 (rationale below), D3 yes.

- **Phase 1 ✅** — codec + contract + 24 tests on protocol `main` (`b4698fe`).
- **Phase 2 ✅** — api `main` (`8513169`): store/routes/PATCH, 11 new tests
  (62 green against real Redis), README note, pin refreshed to `b4698fe`.
  Render deploy triggered by the push; verify a live mint-with-sketch
  resolves it back before deploying web.
- **Phase 3 code-complete** — web branch `sketch-drawing` (`ae8b820`):
  everything in S7–S11 including both D1 variants behind `?tools=`.
  Typecheck + production build green; local end-to-end verified (sketch →
  local api → Redis → console resolve, byte-identical). **Waiting on the
  phone gate (§3.4) — do not deploy web before it.**
- **Phase 4–5** — not started. Phone trial next.

---

## 0. Verified against the code

Every code-level claim in the source plan was checked against current source
before writing this. All of these hold:

- `Map.tsx`: map-in-`useState` StrictMode comment, teardown nulling of
  `markerRef`/`circleRef`/`trailRef`, click-to-move-pin handler, auto-pan
  effect, `requestAnimationFrame(invalidateSize)`, `.map-locate` top-right,
  blue `#2563eb` / amber `#d97706` pin meanings.
- `api.ts`: `mintSession` JSON-stringifies the options object straight into the
  body — adding `sketch?: string` to `MintOptions` is genuinely the whole change.
- `routes.ts`: `note` is truncated-not-rejected (line 182), `toResolved` uses the
  spread-if-defined idiom (line 71), PATCH exists at line 317.
- `store-redis.ts`: `encode()`'s `put()` helper omits `undefined` (line 48);
  `decode()`'s half-written-hash guard is a specific field list `sketch` must
  stay out of.
- Protocol test conventions: vitest + fast-check, property-first
  (`offline.test.ts`).

### Gaps found — now covered by this plan

1. **`openapi.yaml` is never mentioned in the source plan.** The API contract
   lives in `protocol/openapi.yaml` and documents `note`'s truncation semantics;
   `sketch` needs the same treatment (charset, 4096 cap, *dropped-silently*
   semantics — you can't truncate a binary payload) plus
   `npm run validate:openapi`. Folded into S2.
2. **`web` has no test runner at all** — no vitest, no test script, nothing.
   The source plan's web testing is entirely manual. Decision D2 below.
3. **`api` has no general mint/resolve route tests.** `test/` holds rate-limit
   and store tests only. "Mirror the existing route tests" actually means
   *writing the first ones* — model the app bootstrap on
   `routes-rate-limit.test.ts`. Folded into S6.
4. **The wire format must be frozen the day it ships.** The encoder runs in a
   cached PWA on the caller's phone; the decoder runs in the dispatcher's
   (likely fresher) build. Version skew between the two ends is structural, so
   v1 must decode forever and the test suite needs **golden vectors** (fixed
   sketch → exact base64url string), not just round-trip properties. Folded
   into S3.

### Sequencing corrections

- **Branch the protocol work off `main`, not `word-codes`.** `word-codes` is
  the parallel unpushed sentence-code track; entangling them would make the
  sketch codec unlandable until the wordlists are reviewed.
- Landing on protocol `main` is necessary but **not sufficient** — `web` and
  `api` pin protocol at commit `a73eac2` in their lockfiles. Each consumer
  needs an explicit lockfile refresh (step in §4). TODO.md already notes this;
  the source plan understates it.

---

## 1. Decisions for Stu

The build order below is unchanged whichever way these go. Recommendations
first.

### D1 — Toolbar interaction model → **DECIDED: build both, phone trial decides**

The one genuinely unclear UX question: how does drawing mode engage?

| | **A — sticky palette** | **B — draw toggle** |
|---|---|---|
| Idle look | Toolbar always visible bottom-left | Single pencil button; map is clean |
| Enter drawing | Tap a tool; it latches | Tap pencil → toolbar expands, last tool active |
| Return to pan | Tap the explicit pan/pin tool | Close the toolbar (pencil again / ✕) |
| Risk | Clutter; accidental tool taps while panning | One extra tap before every drawing; discoverability |

The expensive code (layer rendering, pointer capture, gesture handling) is
identical in both; only the chrome differs. Build both behind a
`?tools=palette|toggle` URL param read once at mount (dev-only switch — the
winner becomes the only code path and the param dies in Phase 5). Stu compares
on a real phone, says which, we delete the loser.

### D2 — Web test infrastructure → **DECIDED: none for v1**

Skipped for v1. The correctness-critical maths (codec, simplification, bounds)
is fully tested in protocol; web-side geometry failures (wrong arrowhead, bad
gesture) are *visibly* wrong within seconds of the phone checklist, not silent.
`sketch-geometry.ts` stays pure regardless, so vitest can be added with a
regression test the moment the trial surfaces a geometry or gesture bug —
that's the trigger for revisiting.

### D3 — PATCH sketch → **DECIDED: API accepts it now; post-mint drawing UI deferred**

The source plan marks PATCH-a-replacement-sketch as stretch. Split it:

- **In v1:** protocol types (`UpdatePositionRequest.sketch?`), OpenAPI, and the
  API route change (~10 lines + tests). Cheap, and it makes the server contract
  complete in one protocol-pin refresh instead of two.
- **Deferred:** any web UI for editing after minting. In v1 you draw before
  sharing; on the shared screens the sketch is read-only. (Live mode included:
  the sketch rides the mint and stays put while the pin moves — by design, the
  anchor is a compression origin, not a position.)

### D4 — watch-item, not a decision: arrow gesture

Press-at-tail, release-at-head, as planned. If the trial shows the finger hides
the head point, tap-tap placement is the fallback — note it during the trial
rather than building both now.

---

## 2. Build phases

Detailed change lists (interfaces, wire format, gotchas) are in the source
plan — not repeated here. Each ticket: files → work → done-when.

### Phase 1 — protocol (blocks everything else)

Branch `sketch-codec` **off `main`**.

**S1 — codec.** `src/sketch.ts` per the source plan's interface block: types,
constants, `encodeSketch`, `decodeSketch`, `isValidSketchPayload`,
`simplifyStroke`, `sketchBounds`. Conventions of `offline.ts`: pure,
deterministic, no clock, comments carry the *why*. Two behavioural rulings the
source plan leaves open:
- `encodeSketch` does **not** silently simplify — determinism and a clean
  round-trip property. The web app calls `simplifyStroke` itself at stroke
  commit, so preview and payload are the same geometry.
- `sketchBounds` accounts for circle radii (the source plan says so; don't lose it).

**S2 — contract.** `src/types.ts`: `sketch?: string` on `CreateSessionRequest`,
`ResolvedSession`, `UpdatePositionRequest`, documented as opaque.
`src/index.ts`: export everything new. `openapi.yaml`: `sketch` on the create
request, resolved response, and PATCH request — pattern `^[A-Za-z0-9_-]+$`, max
length 4096, and the semantics sentence: *invalid or oversized sketches are
dropped silently and the session is still created; a malformed sketch must
never cost someone their code.* Done-when: `npm run validate:openapi` passes.

**S3 — tests.** `test/sketch.test.ts`, property-first like `offline.test.ts`:
- round-trip: encode → decode within 0.2 m, over arbitrary anchors/shapes
- every truncation of a valid payload → `null`, never a throw
- random junk → `null`; caps enforced (65 shapes, 513 points → `null`)
- poles / antimeridian anchors don't blow up
- `isValidSketchPayload(encodeSketch(s))` always true; rejects >4096 chars and
  bad charset
- `simplifyStroke`: endpoints preserved, every dropped point within tolerance
- realistic worst case stays under the ~2000-char encoder target
- **golden vectors** (the wire-format freeze, gap 4): a handful of fixed
  sketches with exact expected base64url strings, plus decode-side vectors.
  A failing golden test means the format changed — that needs a version bump,
  not a test edit. Say so in a comment.

**Gate:** `npm test` green (38 existing + new), `npm run build` clean →
merge/push to protocol **`main`**. Nothing downstream starts to *land* before
this, though S7+ can be developed in parallel via `npm link`.

### Phase 2 — api

Branch `sketch-field` off `main`. All four files exactly as the source plan
describes (§Repo 2): `store.ts` field, `store-redis.ts` `encode()`/`decode()`
(keep `sketch` **out** of the half-written-hash guard), `routes.ts` mint
validation via `isValidSketchPayload` + `toResolved` passthrough + PATCH
(per D3).

**S4 — lockfile refresh.** `npm install github:stu-greenshoots/whereareyou-protocol`
re-resolves the pin to protocol `main`'s new head. Needs SSH to GitHub
(`git+ssh://` in the lockfile). Commit the lockfile change separately —
this is the deliberate un-pinning TODO.md warns about, now with its reason.

**S5 — store + routes.** As above. Sketch is stored and returned **byte-for-byte**;
the server never decodes it.

**S6 — tests.** Two additions:
- `test/routes-sketch.test.ts` (the first general route tests — bootstrap the
  app the way `routes-rate-limit.test.ts` does): mint with a valid sketch →
  resolve returns it byte-identical; 10,000-char sketch → session minted,
  sketch absent; non-string sketch → same; bad-charset sketch → same; PATCH
  replaces it (D3); PATCH never extends `expiresAt`.
- `store-memory.test.ts` / `store-redis.test.ts`: sketch round-trips; absent
  sketch stays absent (`'sketch' in loaded === false`, mirroring the `note`
  test at store-redis.test.ts:184).

**Gate:** `npm test` green (51 existing + new) → merge to `main` → Render
auto-deploys → `curl` the live `/health`, then a live mint-with-sketch +
resolve against the deployed API before calling it done. README design note
("you said you avoid databases of location data…" → structural-TTL answer)
rides in this PR.

### Phase 3 — web

Branch `sketch-drawing` off `main` (**not** off the plan-doc branch). During
development: `npm link @whereareyou/protocol`; before committing lockfile
changes, unlink and do the real refresh as in S4. **Invoke the
`whereareyou-design` skill before building the toolbar UI** — surfaces, radii
and touch-target conventions come from there and from the `.map-locate` block
in `styles.css`.

**S7 — pure geometry.** New `src/sketch-geometry.ts`: the gesture reducer
(pointer stream → shape-in-progress → committed shape, including the
second-pointer-discards rule) and arrowhead maths (shaft + head polygon from
two layer points; pure 2D, no Leaflet import). If D2 = yes: `test/` with
vitest covering both.

**S8 — renderer.** `src/sketch-layer.ts` per the source plan: `attachSketch`
handle, `L.LayerGroup`, white casing under every ink stroke, arrowheads
computed in layer points and recomputed on `zoomend` (~14px head, ~0.42 rad).

**S9 — `Map.tsx`.** New props (`sketch`, `onSketchChange`, `sketchAnchor`,
`fitSketch`), toolbar in **both D1 variants** behind the `?tools=` switch,
pointer capture with drag/doubleClickZoom disabled while a tool is active,
`touch-action: none` saved/restored, and the five listed gotchas — above all:
null the sketch handle in the **same teardown** that nulls `markerRef`, and
suppress the click-moves-pin handler while a tool is active. Concrete ruling
for gotcha 3 (fit vs auto-pan): with `fitSketch`, call
`fitBounds(union(sketchBounds, pin), {padding})` **once when the sketch first
arrives**, then leave the existing auto-pan effect alone.

**S10 — `Share.tsx` + `api.ts`.** `sketch` state cleared by `startAgain`;
anchor = current position at first shape; editable map in `located`/`minting`,
read-only + `fitSketch` in `shared`/`offline-shared`; `simplifyStroke` +
degenerate-shape drop at stroke commit; **cap enforcement at commit** — if the
would-be sketch exceeds `MAX_SKETCH_SHAPES` or its encoding exceeds
`MAX_SKETCH_CHARS`, refuse the new shape with a quiet notice (undo/clear still
work) rather than dropping payload at mint time. `mint()` includes
`sketch: encodeSketch(sketch)`. Offline warning exactly as drafted in the
source plan, shown by the tools when `!online` **and again on
`offline-shared`** — that's the moment the caller decides what to read out.
`api.ts`: `sketch?: string` on `MintOptions`, nothing else.

**S11 — `Resolve.tsx` + `styles.css`.** `decodeSketch` guarded — `null` renders
the position without the drawing, never a blank screen. Provenance notice as
drafted ("The caller drew this… colours carry no meaning"). `OfflineView`
stays silent. Styles follow `.map-locate` conventions; ≥44px touch targets
(outdoors, one hand, rain).

**Gate:** `npm run typecheck` + `npm run build` clean; phone smoke test over
LAN against the local API; then deploy per `web/DEPLOY.md` — all three env
vars, `main` commit separate from the `gh-pages` force-push.

### Phase 4 — phone trial (Stu)

On the deployed app, real phone, outdoors at least once:

1. Draw with variant A (`?tools=palette`), then B (`?tools=toggle`): a plausible
   real sketch each time — arrow to a door, circle round a landmark, a freehand
   route. Note which felt right and any accidental tool taps / missed pans.
2. Watch the arrow gesture: did your finger hide the head? (D4 fallback.)
3. Run the manual checklist (§3.4). Anything that fails comes back as a fix
   before the variant decision is acted on.
4. Say which variant wins.

### Phase 5 — cleanup + docs

- Delete the losing D1 variant and the `?tools=` switch.
- Move `map-drawing-plan.md` from the web branch into `protocol/docs/` (all
  project docs live there), marked implemented, with a pointer to this doc;
  update TODO.md (§Draw-on-map → done); delete branch
  `claude/map-drawing-share-8t97sb`.
- Confirm the api README note landed in Phase 2; add the one-line endpoint
  mention.

---

## 3. Test plan

### 3.1 Automated — protocol
S3 above. The suite is the codec's real spec: properties for safety
(never-throw, caps), golden vectors for compatibility (wire freeze).

### 3.2 Automated — api
S6 above. The invariants that matter: a bad sketch never blocks a mint;
passthrough is byte-identical; absence is preserved; the half-written-hash
guard is untouched; TTL semantics unchanged by PATCH.

### 3.3 Automated — web (if D2 = yes)
Gesture reducer: down/move/up sequences for each tool, second-pointer discard,
degenerate shapes rejected. Arrowhead maths: head size independent of shaft
length, orientation correct in all quadrants.

### 3.4 Manual phone checklist (Phase 3 gate + Phase 4)

The source plan's seven checks, plus five found in verification:

1. Draw an arrow, mint, resolve the code in another tab — the arrow is there.
2. Drag the pin after drawing — the arrow keeps pointing at the same real place.
3. Live mode, walk around — sketch stays put, pin moves.
4. Kill the API mid-session — already-minted sketch still resolves.
5. Aeroplane mode: draw, mint → offline code, sketch stays local, warning shown
   at the tools **and** on the offline-shared screen.
6. Zoom hard in and out — arrowheads constant size on screen.
7. Two-finger pinch mid-stroke — zooms, no stray stroke committed.
8. **Dev only:** StrictMode remount — sketch layer survives (the ref-nulling
   gotcha; it fails *only* in dev if got wrong).
9. Tool active → tapping the map must **not** move the pin; tool off → it must.
10. Malformed-sketch resilience, end to end:
    `curl -s -X POST localhost:8787/v1/sessions -H 'content-type: application/json' -d '{"position":{"lat":51.5,"lon":-0.12,"accuracyM":10},"mode":"static","subject":"self","sketch":"AAAA"}'`
    ("AAAA" passes the charset check, decodes to `null`) → resolve that code in
    the console: position renders, no drawing, no blank screen.
11. Provenance notice present on the console whenever a sketch renders; absent
    otherwise; inks clearly distinct from the blue/amber pins on real tiles.
12. Undo removes the last shape only; clear empties; `startAgain` resets;
    a long 20-second scribble commits quickly and the encoded size (log it in
    dev) stays well under 2000 chars.

### 3.5 What is deliberately not tested
Leaflet internals, tile rendering, and the toolbar DOM — the phone checklist
covers those; mocking Leaflet would test the mock.

---

## 4. Sequencing & deploy checklist (the cross-repo hazard, operationalised)

1. Protocol `sketch-codec` → tests green → **land on `main`, push**.
2. `api`: lockfile refresh (S4, needs SSH) → build → tests → land on `main` →
   Render auto-deploys → verify live mint+resolve with a sketch.
3. `web`: unlink if linked → lockfile refresh → typecheck/build → phone smoke
   over LAN → deploy per `DEPLOY.md` (three env vars; source to `main` first,
   then the `gh-pages` force-push).
4. Order 2 before 3 in *deploy* terms: the deployed web app must never send
   `sketch` to an API that predates it. (Harmless if it happens — unknown body
   fields are ignored — but the sketch would be silently lost, which is the one
   failure this feature must not have.)

---

## 5. Out of scope for v1

- Post-mint drawing/editing UI (D3 deferral — the API will already accept it).
- Sketches on offline codes (structurally impossible — the code *is* the
  position; the UI says so instead).
- Dispatcher-side drawing, sketch-in-URL transport, more tools/colours,
  text labels on the map (the `note` field carries text).
