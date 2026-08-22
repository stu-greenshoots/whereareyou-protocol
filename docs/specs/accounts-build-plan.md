# Accounts & saved maps — build record

**Status: built and verified locally, 2026-08-22 (evening).** This is the
record of what shipped, its seams, and what was deliberately deferred. POC
throughout — the point was the *saving model*, not production auth.

## What it is

Users can save maps — deliberately, with a **name** — and optionally create an
account so those maps live on the resolver instead of one browser.

- **Everyone starts with a local account.** Name + photo + saved maps in
  localStorage, exactly as private as the share history always was. No sign-up
  wall anywhere.
- **A real account is optional** and only changes *where saved maps live*.
  Username + password, no email, no reset ("a forgotten password is a lost
  account" — the register form says so). On sign-in/registration, local saves
  migrate up to the account and localStorage is cleared.
- **Saving is a named act**, offered wherever a map is material: the code
  screen (session or offline), the dispatcher's look-up result (session or
  offline), and inside a live room (anyone present; snapshot taken at save
  time). Auto-history stays as it was — recent, unnamed, device-local;
  saved maps are the deliberate keep.
- **The profile button** (top right — in the header on document screens, a
  floating control on the map-first screens, where the map's top-right stack
  shifts down a slot) opens a right-hand drawer: saved maps (open/delete),
  name, photo, sign in / create account / change username / change password /
  sign out.
- **The photo is the location marker.** One 64px JPEG data URL (canvas
  cover-crop, a few KB) used everywhere: the profile button, the drawer, and
  inside the map dots — own pin, viewer dot, live-room peer dots. The ring
  keeps its meaning-colour (blue = the caller, slate = peer/viewer, amber
  never wears a face — a third-party pin is not the sharer). Peers' avatars
  arrive over the wire, so they pass a strict data-URL regex before touching
  marker innerHTML.

## Server shape (api)

- `account-store.ts` — `AccountStore` interface with `RedisAccountStore` and
  `MemoryAccountStore`. **Swap seam:** the interface is the contract; Redis is
  the implementation of the day (shares the session store's connection).
  - Accounts keyed by an immutable random id; the username is a claimable
    pointer (`SET NX`) so rename = pointer move.
  - **Account and map keys carry no TTL** — the one deliberately persistent
    part of a system otherwise built on expiry. Login tokens DO expire (30
    days, refreshed on use).
  - Saved-map payloads are **opaque JSON blobs**: the server length-checks,
    JSON-validates, stores verbatim, never parses. The map's shape can evolve
    client-side without an API deploy; a future backend stores one blob
    column.
- `account-routes.ts` — `/v1/account/register|login|logout`, `GET/PATCH
  /v1/account`, `GET/PUT/DELETE /v1/account/maps[/:id]`. scrypt (node:crypto)
  for passwords; opaque bearer tokens (revocable, no JWT crypto to get
  wrong); login returns one error for both failure kinds (no username
  probing); register/login reuse the mint rate budget per-IP.
- Caps: 100 maps/account, 64KB/map blob, 64KB avatar, name 80 chars.
- The live-room avatar rides in the hello frame **outside the protocol
  types** — `parseLiveClientMessage` strips unknown fields, so
  `live-route.ts` re-reads `avatar` from the raw frame with its own
  validation (10KB cap, data-URL regex) and `LiveRooms` carries it as
  `RoomParticipant = LiveParticipant & { avatar?: string }`. **Marked POC
  seam:** if the avatar earns its place, it moves into the protocol's hello +
  `LiveParticipant` and the second parse disappears (that is a protocol
  change → lockfile refresh in both apps).

## Client shape (web)

- `account.ts` — storage layer + API client + `fileToAvatar` (canvas
  downscale). `AccountContext.tsx` — one provider: account state, maps,
  actions, and the drawer→share "open this saved map" handoff
  (`requestOpenMap`/`openMapRequest`). A 401 on map fetch degrades to a
  signed-out local account rather than an erroring drawer.
- `ProfileMenu.tsx` — button + drawer. `SaveMap.tsx` — the one save
  affordance (button → name prompt → saved state), `data` passed as a
  function so live maps snapshot at save time.
- Opening a saved map lands on the **located** screen with everything
  restored (sketch, marker, note, name) — the user presses share themselves;
  nothing is re-shared silently. Same rule as reusing history.
- The account name is the default live-room name (owner and joiner); the
  avatar goes with it.

## Verified (2026-08-22, local stack: api + Redis + Vite, Chrome automation)

- API: register → duplicate refused case-insensitively → map PUT/list
  byte-identical → avatar PATCH → wrong/right login → Redis TTLs asked of
  redis-cli directly (user/maps −1, token 30d). 96 api tests pass (45 new:
  routes suite + Redis account-store integration incl. name-claim race).
- UI walked end-to-end in a real browser: name set → account created (drawer
  flips to signed-in) → manual-pin share → code screen → Save this map →
  named → "✓ Saved to your account" → record confirmed in Redis → drawer
  lists it → tap reopens it on the located screen. Photo uploaded through
  the drawer: downscaled, stored, shown in button + drawer; amber pin
  correctly bare. Look-up console resolves and offers Save with the avatar
  in its header.

## Not verified / deferred

- **Live-room avatar relay on real devices** (two phones in one room) — the
  mechanism is exercised at both ends but the rendered peer-dot faces need a
  real multi-device eyeball.
- Self-pin avatar under real geolocation (automation can't grant the
  permission).
- No email/reset/verification; no token revoke-all on password change; no
  account deletion UI; register/login throttle borrows the mint budget
  rather than having its own; accounts fall back to memory (with a loud log)
  when Redis is absent.
- Not deployed. Render needs the same push+hook dance as ever; the web
  deploy is unchanged (no new build-time env vars — the account API rides
  the existing `VITE_API_BASE`).
