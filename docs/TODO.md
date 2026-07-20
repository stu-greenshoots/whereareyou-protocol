# What's left

State as of 2026-07-20.

## ✅ LIVE

- **App:** https://stu-greenshoots.github.io/whereareyou-web/
- **API:** https://whereareyou-api.onrender.com (apikey mode, Redis-backed,
  structural expiry, rate limiting — all confirmed on the deployment)
- Full loop verified end to end through the public URL: mint on the share
  screen → resolve in the look-up console → mistyped code rejected → offline
  codes resolve client-side with no server.
- All eight feature branches merged to `main` in all three repos.
- `whereareyou-protocol` and `whereareyou-web` are **public**;
  `whereareyou-api` is still private.

### Live-deployment caveats

- **Render free tier spins down after ~15 min idle** — first request after a
  quiet spell takes 30–50s. Fine for test users, wrong for anything real.
- **The demo key ships in the public bundle.** Everyone shares `demo-key-alpha`,
  so claim-on-read binds every look-up to one identity and the anti-harvest
  property is off. A demo trade, documented in `Resolve.tsx`.
- **Pages redeploys are manual** (`gh-pages` branch, force-pushed) until the CI
  workflow can be added — see below.

---

## 0. Blocked on you (small, optional)

- [ ] **`gh auth refresh -h github.com -s workflow`** — lets me add the Pages
      CI workflow (already written, held in scratch) so redeploys stop being a
      manual `gh-pages` push. Not urgent; the site is live.
- [ ] **npm publish** — optional now. The protocol repo being public already
      makes the git dependency installable everywhere with no credentials, so
      this is only about registry distribution, not unblocking anything. Needs a
      2FA code when you want it.

---

## 1. Merge queue — 8 branches, none merged

All reviewable on GitHub. Suggested order, because some contain others:

**`whereareyou-protocol`** — three independent doc branches, any order:
- [ ] `a4-openapi` — OpenAPI 3.1 spec, validates against the meta-schema
- [ ] `a5-threat-model` — enumeration arithmetic, verified empirically
- [ ] `e4-comparison` — vs AML / w3w / Plus Codes, with the measured typo data

**`whereareyou-api`** — `b7` sits on top of `b2`:
- [ ] `b2-redis-store` — structural expiry, verified via `redis-cli`
- [ ] `b7-rate-limiting` — contains b2; merging this alone brings both

**`whereareyou-web`** — `c1` and `design-system` both sit on `c7`:
- [ ] `c7-offline-first-minting` — merge first
- [ ] `design-system` — fonts, tokens, semantic colour fixes
- [ ] `c1-pwa-offline-shell` — rebase onto main after the above; no file overlap
      with `design-system`, so it should merge cleanly

---

## 2. Known defects

**In already-pushed code:**

- [ ] **Log redaction has never worked** (`api/src/index.ts:21`). All three
      redact paths are dead — Fastify's serializers strip `req.body`/`res.body`
      before pino's redaction runs. **The README line 65 still claims
      "Coordinates never reach the logs."** Fix both. Scoped into B8.
- [ ] **C7's captive-portal probe never runs** (`web/src/connectivity.ts:83`).
      `if (online) return;` short-circuits the exact case the comment above it
      names. Either fix the logic or correct the comment and README.
- [ ] **Trail polyline is never removed** (`web/src/Map.tsx:134`). No `else`
      branch, so one caller's track stays drawn over the next caller's
      position. Does not reproduce today only because nothing passes `trail` —
      **becomes live the moment D5 lands.** Fix before starting D5.
- [ ] **Live-mode update failures silently dropped** (`web/src/Share.tsx:208`).
      `void updatePosition(...)` ignores the result, so a live session losing
      connectivity mid-stream never reports it.
- [ ] **Dispatcher `<Map>` never passes `offline`** — console shows a bare grey
      box with no explanation when tiles fail.

---

## 3. Ticket work

**B7 — rate limiting** *(built and merged into its branch, gaps remain)*
- [ ] `.env.example` — **13 undocumented variables**
- [ ] `RedisRateLimitBackend` has **zero tests**; both Lua scripts unverified
- [ ] Test the config guard and `bool()` parsing
- [ ] `PATCH`/`DELETE` are unlimited — a second enumeration oracle, since both
      return an identical 404 for wrong-token and no-session
- [ ] `Retry-After` reports the full window, not the remainder

**B8 — audit log** *(not started)*
- [ ] `AuditEvent` type with **no position field**, so logging one is a compile
      error rather than a redaction rule
- [ ] Fix pino redaction as a second layer + regression test
- [ ] Separate pino instance → file; add `pino` as a direct dependency
- [ ] Record `request.ip` — currently absent from every audit line
- [ ] Log the 401 path — a bad API key currently produces **zero** audit record
- [ ] Audit sink records the **true** outcome, not the deliberately ambiguous
      HTTP one — "control room B tried to resolve A's code" is exactly what an
      audit trail is for
- [ ] Retention without a sweeper (rotation by file count, or the platform)

**B9 — docker-compose** *(blocked on npm publish)*
- [ ] Multi-stage Dockerfile, `node dist/index.js` not `tsx`
- [ ] `start:prod` script, `.dockerignore` — neither exists
- [ ] Healthcheck interval: `/health` does a full `SCAN`, so a 10s poll turns a
      documented diagnostic into a hot path

**C1 — PWA** *(icons done, rest outstanding)*
- [ ] `manifest.webmanifest`, manifest `<link>`, `apple-touch-icon`,
      `theme-color` — `index.html` has no icon links at all
- [ ] Service worker + registration; navigation fallback must keep `/resolve`
      surviving a reload
- [ ] Opportunistic tile caching only — **never pre-cache** (OSMF policy)

**B6 + D5 — SSE live sessions** *(unblocked, not started)*
- [ ] Fix the trail bug above first
- [ ] Stream-ticket auth (agreed): authenticated `POST` mints a single-use ~30s
      ticket, exchanged in the query string
- [ ] Expiry via per-connection timer, **not** Redis keyspace notifications
- [ ] Charge stream-open exactly like a resolve, or it becomes an unmetered
      enumeration oracle bypassing B7

**E1 / E2 / E3 — demo and deploy** *(not started)*
- [ ] Demo mode with a fake-position control (demoing indoors on a laptop)
- [ ] Deploy — HTTPS on a real domain; geolocation needs a secure context
- [ ] README + five-minute demo script

---

## 4. Still unverified visually

Five rounds of UI built without being seen. The design system adoption, Atkinson
Hyperlegible at real sizes, the corrected error colours, the offline code
document — all verified structurally, none visually. Worth an hour of clicking
before any of it is demoed.

---

## If you only do three things

1. **Merge the queue.** Eight branches is too much unlanded work to reason about.
2. **Fix the redaction + its README claim.** It is a shipped false statement
   about a safety property.
3. **`npm login`**, then publish — it unblocks B9 and makes the protocol
   package real.
