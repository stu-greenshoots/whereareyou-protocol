# Idea backlog

Captured 2026-08-22 from Stu, **thought through but deliberately not built**.
Nothing here is ticketed or scheduled; when one graduates, it moves into
`TODO.md` (and probably gets a spec in `specs/`). Grounded against the code as
it stood on 22 Aug — including two things worth knowing before reading:

- **An accounts POC is in flight** (uncommitted in `api` and `web` as of
  22 Aug: register/login with opaque bearer tokens, scrypt passwords, avatars,
  saved maps). Several ideas below lean on it.
- **Structural expiry is a storage property, not a code property.** The Redis
  TTL is the only expiry mechanism; the session code itself encodes nothing
  about time. That makes *extending* a session cheap and *restarting* one a
  protocol-level decision. See idea 10.

Cross-cutting constraints that apply to most of these are collected at the
bottom — read those before estimating anything.

---

## 1. Chat in live shares

**The ask.** Participants in a live share can chat. A chat-bubble button opens
a composer; a sent message shows a small icon over the sender's marker;
clicking it opens a toggleable side panel with the conversation.

**How it lands.** The live room already fans out typed messages
(`protocol/src/live.ts`: `welcome` / `participant` / `left` / `expired`), so
chat is one more message type — which means **a protocol change, so the
cross-repo pin dance applies** (see constraints). Server side, `live-rooms.ts`
broadcasts it and keeps a capped ring (say the last 50) in room memory so late
joiners get context; that history dying on a Render cold start is fine for an
ephemeral tool.

**Design decisions to make.**
- Does the dispatcher console see chat? Probably yes, read-only — "we're
  behind the boathouse" is exactly what an operator wants. But it's a choice.
- Phone UI: a side bar is a desktop idiom; on the share screen this likely
  wants to be a bottom sheet. Dispatcher console can have a real side panel.
- Caps: message length (~500 chars), per-participant rate (reuse the existing
  rate-limit budget), render as text only.

**Threat model.** Message bodies are user content relayed through the server.
They must never be logged — the B8 audit-log work should exclude them **by
construction** (no content field on the audit event), same trick as positions.
THREAT-MODEL.md needs a paragraph.

---

## 2. Proper installed-app experience

**The ask.** Installs as a full app, real offline capability, opens full-page
with a splash screen; offline it offers only the offline codes and offline
lookup.

**How it lands.** Most of this exists: manifest is `display: standalone`, the
shell is precached (C1 done), offline mint falls through to the offline codec,
and there's a connectivity state machine (`connectivity.ts`). The real gaps:

- **iOS splash.** Android derives a splash from `background_color` + the
  512 icon — that's done. iOS needs the `apple-touch-startup-image` set
  (many sizes; `pwa-asset-generator` does it) or you get a white flash.
- **Offline gating.** "Offline offers only offline codes and lookup" is a UI
  audit: walk every screen and hard-gate online-only affordances on the
  existing connectivity state, rather than letting them fail and fall through.
  Partly done (mint fallback, offline map props); not systematic.
- **Offline map tiles.** The map is blank offline (handled gracefully, but
  blank). Real offline tiles either mean service-worker runtime caching of
  recently viewed raster tiles (OSM's usage policy tolerates modest caching;
  a swapped provider — idea 11 — is cleaner about it) or vector tiles.

**Ties to:** idea 7 — iOS only allows Web Push for *installed* PWAs, so this
is the gateway to push on iPhones. Idea 11 — a vector-tile switch changes the
offline-tiles answer entirely.

---

## 3. Participant history, zones, and arrival events

**The ask.** Track when each participant joined, was last seen, their accuracy
over time; view it from a user side panel or by tapping the user. Named
**zones** (the existing circle tool, given a name): entering and leaving a
zone is tracked and announced. Also track when someone **reaches a placed
marker**. Everything visible to everyone in the share.

**How it lands.** The biggest idea in this batch, and spec-worthy (pair it
with idea 6 — they share a data model). Sketch of the shape:

- **Participant metadata** — extend the roster state with `joinedAt`,
  `lastSeenAt`, and a capped ring of recent fixes (position + accuracy +
  time, last ~100). Lives in room memory, dies with the session.
- **Zones as first-class objects**, not sketch ink: `{id, name, center,
  radius, createdBy}`. The circle tool grows a name prompt when placed.
- **Detection server-side**, in the room relay — positions already flow
  through it, and one authority means one consistent event stream. Emit
  `event` messages: `entered` / `left` / `reached`.
- **Hysteresis or it flaps.** GPS jitter at a boundary will fire
  enter/leave/enter/leave forever. Enter at `distance < radius`; leave at
  `distance > radius + max(accuracy, 20m)`; require two consecutive fixes
  inside before announcing. Marker "reached" is the same test with a default
  radius of `max(25m, accuracy)`.
- **UI:** an events feed panel, and a per-user card (tap a marker or open the
  roster) showing joined/last-seen/accuracy/recent events.

**Threat model.** This is a real escalation: today positions are transient;
this retains in-session movement history and shares it with the whole room.
In-session-only, capped, dies at expiry, participants joined knowingly — 
defensible, but THREAT-MODEL.md needs a section, and **none of it may reach
logs** (the redaction lesson).

**Ties to:** idea 6 (route checkpoints are "reached" events in sequence),
idea 7 (zone events are the best push trigger in the whole list).

---

## 4. Bolder, more fun markers

**The ask.** Better marker design for both participants and placed markers —
bold and fun.

**How it lands.** Mostly a design task under the `whereareyou-design` skill,
but two structural notes:

- The marker-icon vocabulary is **protocol-owned** (`MARKER_ICONS` in
  `protocol/src/types.ts`), so *extending the set* triggers the pin dance.
  Restyling the existing set is web-only.
- The in-flight accounts POC has **avatars** (~96px, data-URL). A logged-in
  participant's marker could carry their avatar in the pin head; anonymous
  participants get bold colour + initial/shape.

**Requirements to hold onto:** legible at map scale, distinct on both the
light share map and the dark dispatcher console, colour-blind-safe
(shape + colour, never colour alone), and the accuracy halo stays.

---

## 5. Marked spot must survive going live

**The ask.** Mark a spot you're *not* at, then start a live share — the share
follows your current location and the marked spot is lost. It should persist
as a marker.

**Status: verify before designing.** The code's stated intent is the
opposite of the observed behaviour — `Share.tsx` (~line 199) declares the
marker "the spot the caller MARKED — never where they are", and the session
payload carries `marker`/`markerIcon` separately from position. So either the
live path drops/overwrites the marker (a bug), or the joiner/dispatcher view
renders it in a way that reads as replaced. **Measure it on a phone first**
— this project's most-repeated lesson — then fix. Likely a small, web-only
change once the actual behaviour is pinned down.

---

## 6. Multiple markers and routes

**The ask.** Allow several markers per share. Opens up marking a **route**
and watching people progress along it.

**How it lands.** `marker: Position | null` becomes
`markers: Array<{id, position, icon, name?}>` — in web state, the api session
payload, and protocol types (pin dance). Keep a cap (~20) so the Redis
payload stays bounded. Back-compat: old readers see `marker` = first entry,
or version the payload.

**The interesting part** is the combination with idea 3: an *ordered* marker
list plus "reached" detection is checkpoint progress — mark the path in to a
casualty, and each arriving helper auto-announces at each waypoint. That
story (route + arrival events + a push when someone reaches the last point)
is the strongest single scenario in this batch.

**Spec together with idea 3** — same data model, same wire changes, one pin
refresh instead of three.

---

## 7. Push notifications

**The ask.** Allow push notifications.

**How it lands.** Standard Web Push: VAPID keypair in Render env vars
(`sync: false`, like `API_KEYS`), the `web-push` package server-side, a
subscribe endpoint, and a push handler in the already-present service worker.
One genuinely elegant fit: **store subscriptions in Redis keyed to the
session, with the session's TTL** — structural expiry then guarantees
notifications become impossible after expiry, by construction.

**Triggers worth having** (roughly in value order): the dispatcher resolved
your code ("an operator has your position"); someone entered a zone / reached
a marker (idea 3); someone joined your share; chat while backgrounded
(idea 1); session nearing expiry (pairs with extend, idea 10 — "expiring in
5 min, extend?").

**Constraints.** iOS delivers Web Push **only to installed home-screen PWAs**
(16.4+) — idea 2 is the gateway. Ask permission in context (on joining a live
share), never on page load. Expiry-warning pushes need a scheduler — a sweep
piggybacked on the keepalive ping is the cheap version.

---

## 8. "Open in maps"

**The ask.** For plain shares, open the location in a maps app. For live
shares, ideally a link that opens *all* the markers.

**How it lands.**
- **Single point — easy and worth doing soon.** `geo:lat,lng` (Android),
  `https://maps.apple.com/?ll=…&q=Label` (iOS),
  `https://www.google.com/maps/search/?api=1&query=lat,lng` (everywhere).
  Offer per-platform; also useful per-marker (tap a marker → open in maps).
- **Multiple arbitrary pins — no clean URL exists.** Neither Google nor Apple
  Maps accepts "show these N pins" in a link. Honest options:
  - a **directions link with waypoints**
    (`google.com/maps/dir/?api=1&…&waypoints=a|b|c`, ≤9) — reads as a route,
    which actually *fits* idea 6's route semantics;
  - **GPX/KML export** via the Web Share API — imports into most map apps,
    works offline, and is the only real "everything" answer;
  - accept per-marker single links and stop there.
- **Caveat:** any maps link out of a live share is a snapshot — label it with
  its timestamp so nobody treats a 10-minute-old export as live.

---

## 9. Compass view

**The ask.** A full-screen compass showing participants and markers as
bearings, live-rotating as the user turns.

**How it lands.** Purely client-side, no server changes, and genuinely useful
in a field ("head that way, 200 m"). The work is in the platform mess:

- iOS: `webkitCompassHeading` (true heading), but requires
  `DeviceOrientationEvent.requestPermission()` from a **user gesture** —
  the view needs a tap-to-start.
- Android: `deviceorientationabsolute` alpha is *magnetic* north; UK
  declination is ~1°, ignorable for this purpose.
- Magnetometers are noisy: low-pass the heading, show a calibration hint when
  the OS reports low accuracy.
- Bearing/distance math: `geodesy` is already a web dependency. Targets
  render on a rose ring with distance labels; far targets clamp to the rim.

**Ties to:** idea 11 — MapLibre can rotate the *map* to the heading, a
lighter cousin of this feature; doing both from one heading source would be
coherent. Needs real-phone eyeballing more than anything else in this list.

---

## 10. Extend a session; restart an expired one

**The ask.** The share owner can extend a running session. After expiry, let
them restart it **with the same code** — maybe only for logged-in users.

**These are two very different ideas.**

**Extend — cheap and safe.** The owner already holds a per-session
`updateToken` (hashed server-side), so auth exists. An extend endpoint bumps
the Redis TTLs, re-arms the live-room expiry timer, and broadcasts the new
`expiresAt`. Compatible with the structural-expiry promise — the *stated*
expiry changes before it's reached, and the dispatcher sees the new one. Add
a cumulative lifetime cap (say 24 h) so a code can't become permanent.
Pairs beautifully with a "expiring soon" push (idea 7).

**Restart-same-code — recommend against, as designed.** Structural expiry
means the data is *gone*; restarting means re-minting a chosen code, which
(a) breaks the mint path's uniqueness model, and (b) — the real problem —
**re-arms a code that was spoken aloud in public**. Anyone who overheard or
wrote it down gets a second window into a new session. Account-binding
limits who can *trigger* it, not who can *use* the re-armed code. And the
user story is already served: share history + resume re-shares the same
content under a fresh code. If a concrete need for same-code-restart ever
appears, it's a THREAT-MODEL.md conversation first, not a feature ticket.

---

## 11. A nicer map

**The ask.** The current map looks a bit nasty. Free alternatives?

**Current stack:** Leaflet 1.9.4 + raster OSM tiles — which is both the look
Stu is reacting to and slightly fragile against OSM's tile usage policy for a
public app.

**Two-step recommendation:**

1. **Now, ~one line: swap tile provider to CARTO basemaps** (free for
   low-volume public use, attribution required). *Voyager* or *Positron* on
   the share screen, *Dark Matter* on the dispatcher console — which lands
   exactly on the project's existing visual split (issued document / control
   room). Biggest visual win per unit effort available anywhere in this list.
2. **Later, if ideas 2/9 justify it: MapLibre GL + OpenFreeMap** (free vector
   tiles, no API key, no stated limits). Buys crisp vector rendering, proper
   light/dark styles, smooth zoom, map rotation (compass synergy), and a much
   better offline-tiles story. Cost: replacing Leaflet, which touches
   `Map.tsx` — the most intricate file in web.

Keyed free tiers (Stadia, MapTiler, Thunderforest) work but put an API key in
a public unauthenticated app; CARTO/OpenFreeMap avoid that. Self-hosted
PMTiles is neat but a UK extract won't fit GitHub Pages' 1 GB limit — skip.

---

## Cross-cutting constraints

- **The pin dance.** Anything touching protocol wire types or vocabularies
  (chat messages, zone/event types, marker arrays, new marker icons) takes
  *three* steps: land on protocol `main` → refresh the lockfile pin in `web`
  and `api` → redeploy both. **Batch the wire changes** — ideas 1, 3, and 6
  should share one protocol release, not three.
- **Never log the new user content.** Chat bodies, position history, zone
  names-with-locations. The B8 audit log (Tier 2, still open) should make
  leaks a compile error — design the new types the same way.
- **THREAT-MODEL.md updates owed by:** chat (1), history/zones (3), push
  subscriptions (7), extend (10) — and a hard stop on restart-same-code.
- **iOS gates:** push needs the installed PWA (2→7); compass needs a
  permission gesture (9). Both need real-phone verification — the UI cannot
  be seen from the CLI.
- **Accounts are in flight, uncommitted** (api + web, 22 Aug). Ideas 4
  (avatar markers) and 10 (extend UX) should wait for that to land rather
  than assume its final shape.

## Related, pre-existing

- **Caller-chosen session label** as a dispatcher read-back confirmation
  ("blue tent by the weir") — Stu, 22 Aug, noted in the workspace CLAUDE.md.
  Name-as-confirmation is safe; name-as-address is not. Clusters with chat
  (1) and zones (3) as "words humans attach to a share".
