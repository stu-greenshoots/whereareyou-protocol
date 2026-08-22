# Multi-party live sessions — build & test plan

**A session becomes a room.** The sharer can make their code a live session;
anyone who follows the link is asked whether to join. Joiners' positions
appear on everyone's map, everyone can draw, and everyone sees everyone's
drawings, in real time over WebSockets. Stu's framing, 22 Aug 2026: this is a
POC — the security consequences are real, known, and deliberately deferred
(§7 keeps the register, so deferral never becomes forgetting).

Status: **planned.** Decisions D1–D5 below have recommendations.

---

## 0. Verified context

- `api` is Fastify **5.2** → `@fastify/websocket` v11 is the right plugin.
  Single instance on Render; **in-process room state is sufficient** — no
  Redis pub/sub needed (multi-instance is a listed deferral). Render free
  tier supports WebSockets; an open socket counts as activity so live rooms
  keep the instance awake. First joiner after idle may eat the 30–50s cold
  start.
- Web derives HTTP calls from `VITE_API_BASE` ('' in dev, proxied). WS URL:
  `BASE === '' ? (proxy) : BASE.replace(/^http/, 'ws')` — and
  `vite.config.ts` needs `ws: true` on the `/v1` proxy entry.
- The benched "keep updating" toggle comes back **as part of this feature**
  for the owner — a live room is exactly the walk-around verification it was
  waiting for.
- The one-tap link (`lookup?code=`) already auto-resolves — the join prompt
  hangs off that seam when `mode === 'live'`.
- `mode: 'live'` and owner PATCH already exist server-side; participants are
  the new concept.

## 1. Design

### Room model (api, in-memory)

`Map<code, Room>`; a `Room` holds `Map<participantId, { socket, state }>`.
Created on first hello, destroyed on last leave or session expiry (server
closes every socket with `expired` at `expiresAt` — the TTL still rules
everything). Owner's position and sketch are **also written to the store**,
so a plain GET resolve — and the dispatcher console — stays truthful without
joining the room. Participants are ephemeral: reload → rejoin → resend.

### Wire protocol (protocol/src/live.ts — types only, JSON over WS)

```ts
// client → server
{ type: 'hello'; code: string; name?: string; updateToken?: string; share: boolean }
{ type: 'position'; position: Position }        // only if share was true
{ type: 'sketch'; sketch: string }              // encoded, opaque, existing caps
// server → client
{ type: 'welcome'; participantId: string; expiresAt: string; roster: LiveParticipant[] }
{ type: 'participant'; participant: LiveParticipant }   // join or state change
{ type: 'left'; participantId: string }
{ type: 'expired' }
{ type: 'refused'; reason: 'not-found' | 'not-live' | 'room-full' }

LiveParticipant = { id: string; name?: string; owner: boolean;
                    position?: Position; sketch?: string; updatedAt: string }
```

Caps, enforced server-side: name ≤ 40 chars; sketch = existing
`isValidSketchPayload`; **room ≤ 16 participants**; ≥ 1 s between messages
per connection (drop, don't disconnect); server pings every 30 s, drops a
silent socket after 90 s.

### Join flow (web)

Link opens lookup → auto-resolve → if `mode === 'live'`:
**"This is a live session — join it?"** with an optional name and two ways
in: **[Join and share my location]** / **[Just watch]** (`share: false` —
also how a dispatcher can watch without becoming a pin). Decline → today's
read-only view. Both roads lead to one new **session-map screen** used by
owner and joiners alike: full-height map, everyone's pins, everyone's
drawings, participant count, leave button. Reconnect with backoff + re-hello
is REQUIRED, not a nicety — phones lock.

### Rendering the crowd

- **Colour discipline holds.** Blue stays THE owner; amber stays third-party
  report. Joiners are **neutral dots with an initial** (the viewer-dot
  precedent) — a joiner must never be mistakable for the caller.
- Drawings: one `SketchHandle` per participant, keyed by id, all rendered
  with the existing shared ink palette. Per-person attribution beyond that
  is deferred.
- Own drawing: the existing toolbar; each commit sends the full re-encoded
  sketch (replace, not diff — sketches are tiny).

## 2. Decisions

### D1 — Who can join → **anyone with the code, no separate invite** (recommended)
The code IS the capability, consistent with the protocol. Consequence: the
code now grants presence + write, not just read — top of the §7 register.

### D2 — What joiners share → **continuous while joined, by explicit choice**
The join prompt's two buttons are the consent surface. No silent sharing.

### D3 — What persists → **owner state to the store; participants in-memory**
GET resolve stays truthful; nothing new is stored about joiners. POC-honest.

### D4 — Names → **optional, 40 chars, shown on the pin** (recommended)
The map is illegible with three anonymous dots. Local precedent: share names.

### D5 — Owner entry point → **a "Make this a live session" action on the
code screen** (recommended), which flips the mint to mode 'live' (or mints
live directly when chosen pre-mint in Options). Un-benches the live toggle
as "Live session" in Options too.

## 3. Build phases

### P1 — protocol: `src/live.ts` message + participant types, exported;
openapi.yaml note that `/v1/sessions/:code/live` is a WS endpoint (documented,
not schema'd — OpenAPI doesn't do WS). Tests: type-only module, no codec —
compile coverage only. Land on `main`, push.

### P2 — api: `@fastify/websocket`; `src/live-rooms.ts` (room manager, pure
enough to unit-test with fake sockets); route `GET /v1/sessions/:code/live`
(upgrade; hello validates session exists + live + not expired; owner iff
updateToken matches). Owner position/sketch writes through the existing
store patch (never extends TTL). Tests (`test/live-rooms.test.ts` +
`test/routes-live.test.ts` with a real `ws` client against a listening app):
join/roster/broadcast, watch-only join, caps (17th refused, oversized sketch
dropped), owner persistence lands in the store, expiry closes the room, rate
limit drops. Lockfile refresh → land → **manual Render deploy (hook gets its
first live test) → verify live WS from a script**.

### P3 — web: `src/live.ts` client (connect/reconnect/backoff, typed
handlers); join prompt in `Resolve.tsx`; new `SessionMap.tsx` screen (owner
+ joiner); multi-pin layer (initial-dots) + per-participant sketch handles in
`Map.tsx`/`sketch-layer.ts`; owner entry per D5; `vite.config.ts` ws proxy.
Gate: typecheck/build + **two-device LAN trial**.

### P4 — the trial that actually verifies live mode: two phones + a laptop.
Walk-around: owner walks, joiner watches the pin move (this un-benches the
old claim honestly). Joiner draws → appears on owner's phone < 1 s. Lock a
phone 2 min → unlock → reconnected roster correct. Kill the api → both see
the room drop, codes still resolve. Expiry mid-room → everyone ejected.

### P5 — ship: web deploy per DEPLOY.md, docs (map-first-share.md, READMEs,
TODO), journal, and §7 copied into THREAT-MODEL.md as open items.

## 4. Sequencing
protocol main → api (pin refresh, tests, deploy via hook + verify) → web
(pin refresh, build, LAN trial) → web deploy. Same shape as the sketch build.

## 5. Explicitly deferred (the security register — known, not forgotten)
1. The code now grants **write + presence** to anyone who has it (drawing
   spam, pin spoofing, lurking). Mitigations later: join approval by owner,
   per-participant tokens, viewer-vs-participant auth split.
2. Participant location privacy: no token binds a joiner to their pin —
   anyone with the code can claim any name.
3. Enumeration now finds *rooms*, not just positions — the rate-limit story
   must eventually cover WS upgrade attempts.
4. Single-instance room state (fine on Render today; breaks on scale-out).
5. No abuse controls on drawings beyond size caps.
