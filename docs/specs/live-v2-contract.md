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
| `zone-remove` | `{type, id}` | Honoured only when the remover is the zone's **creator**, matched by the best stable identity available — today that is the same-connection participantId (participants carry no account identity on this wire). POC-honest caveat, stated plainly: an anonymous creator who reconnects gets a new participantId and so **loses remove rights on their own zone**. The **session owner** (the connection that presented the `updateToken` at hello) may remove any zone. An unauthorised remove is **silently dropped — no error frame**. *(Supersedes the original v2 posture that let any participant remove any zone.)* |

### Server → client

| type | shape | notes |
|---|---|---|
| `welcome` | `{type, participantId, expiresAt, roster, chat, zones, events}` | `chat`/`zones`/`events` are the retained history; a v2 server always sends them (possibly `[]`), clients treat absence as empty. The roster may carry **disconnected** members — see the disconnection rule below. |
| `participant` | `{type, participant}` | Whole participant, not a diff. No `trail` here — welcome only. A **disconnection** arrives as one of these with `disconnectedAt` stamped (0.2.3) — see the disconnection rule below. |
| `left` | `{type, participantId}` | **Genuine removal only** (0.2.3): owner supersession, a reconnect merging away its own disconnected entry, eviction of an over-cap disconnected entry. A mere socket close is a `participant` update, never a `left`. |
| `chat` | `{type, id, participantId, name?, avatar?, text, at}` | Fanout of one `ChatMessage`. `id`/`at` server-assigned. `name`/`avatar` are the sender's identity **stamped by the server at send time** from their hello (absent for anonymous senders, and from a pre-0.2.1 server) — participant ids are per-connection, so history must not depend on roster liveness. Clients prefer the stamped `name`, fall back to the roster, then a generic label. |
| `zone-created` | `{type, zone: Zone}` | Fanout **to everyone including the sender** — the echo is the create ack. |
| `zone-removed` | `{type, id}` | |
| `event` | `{type, kind, participantId, name?, zoneId?, markerId?, targetName?, at}` | `kind: 'entered' \| 'left' \| 'reached'`. `zoneId` for entered/left, `markerId` for reached. Ids may refer to zones/markers since removed. `name` (actor display name) and `targetName` (zone or marker name) are **stamped by the server at event time** — participant ids are per-connection and zones can be deleted, so replayed history must depend on neither still existing; `targetName` is what keeps a welcome-replayed event legible after its zone is gone. Absent for anonymous actors / unnamed markers, and from a pre-0.2.2 server. Clients prefer the stamped values, fall back to roster/zone lookups, then a generic label. |
| `expiry` | `{type, expiresAt}` | The owner extended the session. |
| `expired` | `{type}` | Unchanged. |
| `refused` | `{type, reason}` | Unchanged. |

Fanout of a silently-dropped write (over-cap zone, duplicate id) simply never
arrives; because creates echo to the sender, the sender can tell.

### Shared types

```ts
SessionMarker = { id, position: Position, icon: MarkerIcon, name? }
ChatMessage   = { id, participantId, name?, avatar?,       // id, at server-assigned;
                  text, at }                                // name/avatar stamped at send time
Zone          = { id, name, center: Position, radiusM,
                  createdBy, createdAt }                    // createdBy/At server-stamped
LiveEvent     = { kind, participantId, name?, zoneId?,     // name/targetName stamped
                  markerId?, targetName?, at }              // at event time
```

`LiveParticipant` gains: `joinedAt`, `lastSeenAt` (ISO, server clock —
`lastSeenAt` refreshed on every frame received), `avatar?`, `markers?`, and
`trail?` (welcome roster only: last 20 fixes, oldest first; a fix without
`takenAt` is stamped with receipt time). 0.2.3 adds `disconnectedAt?` (ISO,
server clock; **absent means connected**) — see the disconnection rule.

---

## Disconnecting is not leaving (0.2.3)

A real two-person test found the flaw in the old model: the moment a
companion's phone dropped its connection, they simply vanished from the
share — no last position, no clue when they were last heard from. So:

- **On socket close the server RETAINS the member** in the roster —
  position, name, avatar, `joinedAt`, `lastSeenAt` intact — stamps
  `disconnectedAt` (ISO, server clock) and fans out a **`participant`**
  update, NOT a `left`.
- **`left` is reserved for genuine removal**: owner supersession, a
  reconnect merging away its own disconnected entry, eviction of an
  over-cap disconnected entry.
- **Reconnect merge**: a hello presenting the same identity the server
  already keyed the member by (its hello `name`, for non-owners) supersedes
  its own disconnected entry — the old entry is removed with a `left`, the
  new connection joins as a fresh participant (identity continuity only;
  nothing else is inherited server-side, and detection state starts from
  the silent baseline as for any join). The roster shows one entry,
  connected. Anonymous no-name hellos have no identity to merge on — they
  accumulate as separate disconnected entries, bounded by a server-side cap
  on retained disconnected members (oldest evicted with a `left`).
- **Clients render** a participant carrying `disconnectedAt` as stale:
  greyed, at their last position, labelled "last connected <time>" — never
  as gone. Absence of the field means connected.
- **Additive and tolerant** both ways: a pre-0.2.3 server never sends
  `disconnectedAt` (its socket closes still fan out `left`, which clients
  already handle); a pre-0.2.3 client ignores the unknown field and treats
  the retained member as present at their last position — imperfect but
  safe.

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
extend — "expiring in 5 min, extend?").

**Payload privacy basis** (revised from "generic by design"): Web Push
payloads are **end-to-end encrypted (RFC 8291**, aes128gcm against the
subscription's `p256dh`/`auth` keys**)** — the Apple/Google/Mozilla push
services relay ciphertext they cannot read. Names and short chat snippets in
payloads are therefore fine. **Precise coordinates still stay out**, as
defence-in-depth: a payload's end state is a lock screen. When the actor has
a name the bodies are rich; **actors with no name keep the generic bodies**
(`Someone joined your share.` / `New message on your share.` /
`Activity on your share.`):

| trigger | body | url |
|---|---|---|
| chat | `<Name>: <first ~100 chars>` | `lookup?code=<code>#chat` |
| zone event | `<Name> entered <Zone>` / `<Name> left <Zone>` | `lookup?code=<code>#activity` |
| marker reached | `<Name> reached <Marker>` | `lookup?code=<code>#activity` |
| joined | `<Name> joined your share` | `lookup?code=<code>#people` |

`url` is **relative** — the service worker resolves it against its own
location (so the GitHub Pages base needs no special-casing) and the client
opens the panel the fragment names. Notification icons are a client /
service-worker concern — never payload fields.

All three endpoints are in `openapi.yaml` (`npm run validate:openapi` passes).

---

## What must never reach a log

Chat bodies, zone names, trails, avatars, push endpoints — plus positions, as
ever. The audit posture is the same trick as B8: the audit event type has no
content field, so a leak is a compile error, not a code-review catch.
THREAT-MODEL.md owes sections for chat, history/zones, and push (tracked in
`docs/IDEAS.md`'s cross-cutting constraints).
