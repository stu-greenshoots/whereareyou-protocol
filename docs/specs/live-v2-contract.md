# Live v2 — the wire contract

One batched protocol release (the "pin dance" is expensive, so ideas 1, 3, 6
and friends from `docs/IDEAS.md` ship as a single set of wire changes). This
document is what `api` and `web` implement to. The types themselves live in
`src/live.ts` and `src/types.ts`; where this doc and the code disagree, fix
whichever is wrong — they are supposed to be the same contract twice.

`LIVE_PROTOCOL_VERSION` is now **2**.

**Deploy order: api before web.** A v2 server in front of a v1 client is safe
(the tolerance rule below); a v2 client in front of a v1 server sees welcomes
without the new fields, which is survivable but bare.

---

## The tolerance rule (load-bearing)

A receiver — client or server — **MUST silently ignore any message whose
`type` it does not recognise, and any unknown fields on messages it does.**
Never close a connection, refuse, or surface an error over an unrecognised
type. The three repos pin this package at different commits at different
times; this one rule is what makes that skew survivable. It is stated in the
JSDoc on both message unions; it is restated here because it is the contract's
foundation, not a footnote.

---

## WebSocket messages

All frames are JSON, ≤ 16,384 chars. The server validates every inbound frame
with `parseLiveClientMessage` — null means drop the frame, nothing else.

### Client → server

| type | shape | notes |
|---|---|---|
| `hello` | `{type, code, share, name?, updateToken?, avatar?}` | First frame on every connection. `avatar` is new in v2 — see the avatar rule below. |
| `position` | `{type, position}` | A live fix. |
| `marker` | `{type, position \| null, icon?}` | **Legacy** single-marker form — see back-compat rule. |
| `markers` | `{type, markers: SessionMarker[]}` | Replace this participant's whole marker list. `[]` clears. ≤ 20 entries. |
| `sketch` | `{type, sketch}` | Unchanged from v1. |
| `chat` | `{type, text}` | Trimmed; truncated (not rejected) at 500 chars; blank → dropped as malformed. |
| `zone-create` | `{type, id, name, center: Position, radiusM}` | `id` client-generated (id rule below); name 1–60 chars after trim; radius 1–10,000 m. |
| `zone-remove` | `{type, id}` | Any participant may remove any zone (POC write posture). |

### Server → client

| type | shape | notes |
|---|---|---|
| `welcome` | `{type, participantId, expiresAt, roster, chat, zones, events}` | `chat`/`zones`/`events` are the retained history; a v2 server always sends them (possibly `[]`), clients treat absence as empty. |
| `participant` | `{type, participant}` | Whole participant, not a diff. No `trail` here — welcome only. |
| `left` | `{type, participantId}` | |
| `chat` | `{type, id, participantId, text, at}` | Fanout of one `ChatMessage`. `id`/`at` server-assigned. |
| `zone-created` | `{type, zone: Zone}` | Fanout **to everyone including the sender** — the echo is the create ack. |
| `zone-removed` | `{type, id}` | |
| `event` | `{type, kind, participantId, zoneId?, markerId?, at}` | `kind: 'entered' \| 'left' \| 'reached'`. `zoneId` for entered/left, `markerId` for reached. Ids may refer to zones/markers since removed. |
| `expiry` | `{type, expiresAt}` | The owner extended the session. |
| `expired` | `{type}` | Unchanged. |
| `refused` | `{type, reason}` | Unchanged. |

Fanout of a silently-dropped write (over-cap zone, duplicate id) simply never
arrives; because creates echo to the sender, the sender can tell.

### Shared types

```ts
SessionMarker = { id, position: Position, icon: MarkerIcon, name? }
ChatMessage   = { id, participantId, text, at }            // id, at server-assigned
Zone          = { id, name, center: Position, radiusM,
                  createdBy, createdAt }                    // createdBy/At server-stamped
LiveEvent     = { kind, participantId, zoneId?, markerId?, at }
```

`LiveParticipant` gains: `joinedAt`, `lastSeenAt` (ISO, server clock —
`lastSeenAt` refreshed on every frame received), `avatar?`, `markers?`, and
`trail?` (welcome roster only: last 20 fixes, oldest first; a fix without
`takenAt` is stamped with receipt time).

**The id rule** (`isValidLiveId`, exported): 1–64 chars of `A-Z a-z 0-9 _ -`.
Ids are client-generated (a UUID fits) and must be unique within the session —
events refer to zones and markers by id alone.

**The avatar rule**: `avatar` must match
`^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$` and be ≤
`MAX_AVATAR_CHARS` (10,240). Anything unusable is **dropped silently, never a
reason to refuse the join** — it is decoration, and the one hello field that
arrives from storage rather than the user's fingers.
*Seam to delete:* the api currently re-parses the raw hello frame for `avatar`
outside the protocol types (`extractAvatar()` in `api/src/live-route.ts`).
Now that `hello.avatar` is typed and validated by `parseLiveClientMessage`,
that re-parse must be deleted, not kept alongside.

### Caps (exported constants — never restate the numbers)

| constant | value | of |
|---|---|---|
| `MAX_CHAT_TEXT_CHARS` | 500 | chat text, UTF-16 units; truncate |
| `MAX_CHAT_HISTORY` | 50 | retained chat, oldest drop first |
| `MAX_SESSION_ZONES` | 20 | zones per session; creates beyond → silent drop |
| `MAX_ZONE_NAME_CHARS` | 60 | zone name; truncate |
| `MIN_ZONE_RADIUS_M` / `MAX_ZONE_RADIUS_M` | 1 / 10,000 | outside → malformed |
| `MAX_EVENT_HISTORY` | 50 | retained events |
| `MAX_SESSION_MARKERS` | 20 | markers per list (per participant live; per session record) |
| `MAX_MARKER_NAME_CHARS` | 60 | marker name; truncate |
| `MAX_TRAIL_FIXES` | 20 | trail per participant, welcome only |
| `MAX_AVATAR_CHARS` | 10,240 | avatar data URL |
| `ZONE_ENTER_CONSECUTIVE_FIXES` / `ZONE_LEAVE_SLACK_M` / `MARKER_REACHED_RADIUS_M` | 2 / 20 / 25 | detection, below |

All the new room state (chat ring, zones, events, trails) lives in room
memory and dies with the session; loss on a cold start is accepted.
Per-participant chat rate reuses the room's existing rate budget.

---

## The detection contract (server implements; verbatim)

Detection runs **server-side**, in the room relay — positions already flow
through it, and one authority means one consistent event stream. Distance is
participant fix to zone/marker centre, metres.

- **Enter** a zone: `distance < radiusM` on **2 consecutive fixes**
  (`ZONE_ENTER_CONSECUTIVE_FIXES`) from that participant. The event fires on
  the second fix.
- **Leave** a zone: `distance > radiusM + max(fix accuracyM, 20 m)`
  (`ZONE_LEAVE_SLACK_M`) on a single fix — only for a participant currently
  counted inside. The asymmetry is hysteresis: GPS jitter at the boundary must
  not fire enter/leave forever.
- **Reached** a marker: the enter test with an effective radius of
  `max(25 m, fix accuracyM)` (`MARKER_REACHED_RADIUS_M`), fired **at most once
  per participant per marker id**, ever, in room memory.

Removing a zone or marker discards its detection state; no synthetic `left`
events. A new zone starts everyone outside. Events append to the room's
retained ring (last 50) and fan out as `event` messages.

---

## The back-compat marker rule

`marker`/`markerIcon` are **legacy views of `markers[0]`**, everywhere they
appear (session record, resolve response, `LiveParticipant`):

- **On every read/fanout**, the server sets `marker = markers[0].position`
  and `markerIcon = markers[0].icon`, or omits both when the list is empty.
  They are never independently writable state.
- **A write carrying `markers` is authoritative**; any `marker`/`markerIcon`
  beside it are ignored.
- **A legacy write carrying only `marker`** replaces the list with a single
  entry whose id the server assigns as `legacy-<participantId>` (live) or
  `legacy` (session record); `marker: null` (or an empty `markers`) clears
  the whole list. A legacy client only ever had 0 or 1 markers, so nothing
  is lost.

`MARKER_ICONS` is append-only; the eight v2 additions (`tent water danger
meet dog camera boat tree`) are safe because renderers already fall back to a
plain spot for anything unrecognised.

---

## REST additions (api implements; web calls)

### `POST /v1/sessions/:code/extend`

Body `{updateToken, addMinutes}` → `200 {expiresAt}`.

- Auth by `updateToken` (hashed comparison, constant time, like PATCH).
  Wrong token or unknown code → the same `404 not-found` as everywhere.
- `addMinutes`: integer ≥ 1 (≤ 1440 in the schema). Clamped so **cumulative
  lifetime (`createdAt` → `expiresAt`) never exceeds 24 h** — a code spoken
  aloud must not become a permanent tracker. At the cap, `expiresAt` comes
  back unchanged. Callers read the response, never assume.
- Bumps every session-scoped Redis TTL (record, subscriptions), re-arms the
  live-room expiry timer, fans out `expiry {expiresAt}` to the room.
- Works for `static` and `live` sessions alike — it is a TTL operation.

### `GET /v1/push/config`

→ `200 {vapidPublicKey}` (base64url, the `applicationServerKey` for
`pushManager.subscribe()`), or `404` when the deployment has no VAPID keypair
— clients treat 404 as "push unavailable", not an error.

### `POST /v1/sessions/:code/push`

Body `{subscription}` (a standard `PushSubscription.toJSON()`:
`{endpoint, expirationTime?, keys: {p256dh, auth}}`) → `204`.

- No `updateToken`: holding the code grants a subscription — same POC posture
  as joining the live room.
- **Stored with the session's Redis TTL.** Structural expiry kills
  notifications by construction: an expired session cannot ping anyone.
  Extend bumps this TTL along with the rest.
- Cap 16 subscriptions per session; beyond that, dropped silently — still
  `204`, deliberately indistinguishable.
- The `endpoint` URL is effectively a device identifier. **Never log it.**

**Push triggers** (send order of value): a dispatcher resolved your code
("an operator has your position"); zone/marker events; a participant joined
your share; chat while backgrounded; session nearing expiry (pairs with
extend — "expiring in 5 min, extend?"). Payloads carry *that* something
happened and which session — never positions, chat bodies or zone names.

All three endpoints are in `openapi.yaml` (`npm run validate:openapi` passes).

---

## What must never reach a log

Chat bodies, zone names, trails, avatars, push endpoints — plus positions, as
ever. The audit posture is the same trick as B8: the audit event type has no
content field, so a leak is a compile error, not a code-review catch.
THREAT-MODEL.md owes sections for chat, history/zones, and push (tracked in
`docs/IDEAS.md`'s cross-cutting constraints).
