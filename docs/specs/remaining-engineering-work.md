# Remaining Engineering Work — Implementation Spec

Consolidates research findings for B7, B8, B9, C1 and B6+D5. Working reference
for implementation sessions.

**Repos:** `whereareyou-protocol`, `whereareyou-api`, `whereareyou-web`
**Last Updated:** 2026-07-20

---

## Problem Statement

Five tickets remain across three repos. Research surfaced four blockers that
were not visible from the tickets, two of which invalidate acceptance criteria
as written, and two of which are **defects in already-pushed code**.

Nothing further should be implemented until §1 (merge order) is resolved.

---

## 1. BLOCKER — Both dependent branches are built on the wrong base

`git merge-base` puts `b7-rate-limiting` and `c1-pwa-offline-shell` on the
**initial commit of their repos**, not on the branches they depend on.

| Branch | Depends on | Actually branched from |
|---|---|---|
| `b7-rate-limiting` | `b2-redis-store` | initial commit |
| `c1-pwa-offline-shell` | `c7-offline-first-minting` | `main` |

**Cause:** the agent instruction said *"branch from main for each ticket so they
are independently reviewable."* Correct in isolation, wrong for a dependent
chain. Independent reviewability and dependency ordering were in tension and
only one was stated.

### Consequences

`b7-rate-limiting` has no Redis session store. It hand-copied B2's
`vitest.config.ts` and `tsconfig.test.json` verbatim but none of the store code,
and opens **its own** Redis connection. `rate-limit.ts:170` documents the class
as *"Shares the connection with the session store"* — that describes the
intended post-merge state, not the code.

`c1-pwa-offline-shell` has the pre-C7 app: `src/connectivity.ts` does not exist
on disk. Continuing there means building against an app with no offline minting,
then conflicting across 400 changed lines of `Share.tsx`.

### Conflicts to hand-resolve (API)

| File | B2 | B7 |
|---|---|---|
| `src/routes.ts` | adds 4th param `runtime: RuntimeInfo` | adds 4th param `limiter?: RateLimiter` |
| `src/index.ts` | `await createStore(...)`, fail-fast | keeps `MemorySessionStore`, adds limiter |
| `src/config.ts` | rewrites `redisUrl` doc comment | adds `rateLimit`, `int`/`bool` helpers |
| `.env.example` | documents `REDIS_URL` | (untouched — 13 vars undocumented) |

### ADR-001: `registerRoutes` takes an options object

Both branches added a positional 4th parameter, and B6 needs a third. All
tickets converge on:

```ts
registerRoutes(app, config, store, { limiter, runtime, publisher })
```

Settle this before merging so three tickets don't each invent a signature.

### Recommended sequence

```
api:  main ← b2-redis-store ← rebase b7 onto it ← B8 ← B9
web:  main ← c7-offline-first-minting ← rebase c1 onto it ← D5
```

B2 also anticipated the shared connection: `RedisSessionStore.size()` uses
`SCAN` rather than `DBSIZE` with a comment that the keyspace is shared with
rate-limit counters. Post-merge there will be **three** Redis connections (store,
rate limiter, SSE subscriber) created three different ways — consolidate during
the merge, not after.

---

## 2. BLOCKER — The log redaction does not work, and the README claims it does

`src/index.ts:16-30` configures:

```ts
redact: {
  paths: ['req.body.position', 'res.body.position', 'req.body.updateToken'],
  censor: '[redacted]',
}
```

**All three paths are dead and can never match.** Pino applies serializers
*before* redaction stringifiers (`pino/lib/tools.js:169-175`). Fastify installs
default `req`/`res` serializers that reduce them to
`{method, url, version, host, remoteAddress, remotePort}` and `{statusCode}` —
neither contains `body`. By the time redaction runs, the paths don't exist.

Verified empirically, not inferred. Every realistic leak shape passes through
uncensored:

```
log.info({ session })              → position emitted in full
log.info({ position })             → emitted in full
log.info({ body: { position } })   → emitted in full
log.error({ err })                 → err.body.position emitted in full
```

Coordinates don't reach the logs today only because **no line of code currently
logs one**. That is discipline, not a mechanism. The `index.ts` comment and
README line 65 both assert a mechanism. The first person to write
`request.log.info({ session })` in good faith, trusting the comment, leaks
coordinates.

### ADR-002: Make the leak a compile error, not a redaction rule

Redaction is a backstop, not the control. The `AuditEvent` interface must have
**no position field at all**, so logging one fails to compile.

Then fix redaction as a genuine second layer — pino supports leading wildcards:

```ts
paths: ['*.position', 'position', '*.position.*', 'err.body',
        'session', '*.updateToken', '*.updateTokenHash']
```

Plus a regression test asserting a whole session object logged directly comes
out censored.

**Note:** error *messages* that echo request content cannot be caught by any
path-based redaction. A malformed body produces
`Unexpected token 'l', "lat=51.507"... is not valid JSON` — V8 embeds ~10
characters of input. Narrow, but it is the general class: the leak is inside a
string, not at a path.

**Also update the README** — it currently states a guarantee that does not hold.

---

## 3. BLOCKER — B9's acceptance criterion is unmeetable as written

> *"`docker compose up` gives working api + redis"*

`@whereareyou/protocol` is a **private** git dependency. Three compounding
problems, all verified:

1. **The repo is genuinely private.** With the credential helper disabled,
   `git ls-remote` fails outright.
2. **The lockfile pins it over SSH.** npm rewrote `github:` to
   `git+ssh://git@github.com/...#a73eac2`, so `npm ci` in a container needs an
   SSH key with private-repo access, plus `git` and `openssh-client` in the
   build image (neither present in `node:*-alpine`).
3. **The package has a `prepare` script** (`npm run build`), so npm must clone
   *and* build it at install time — a full nested dev install inside the
   Docker build.

The pinned SHA `a73eac2` is also already behind HEAD (`148f7f5`).

### ADR-003: Publish `@whereareyou/protocol` before B9

| Option | Verdict |
|---|---|
| **Publish to a registry** | **Recommended.** Kills SSH, kills install-time build (published tarball ships `dist/`), makes `npm ci --omit=dev` trivially reproducible. The package is MIT with a public README and keywords — it reads as intended for publication. `whereareyou-protocol` is free on npm. |
| BuildKit SSH forwarding | Compromise. Breaks plain `docker compose up`, fails in most CI without key plumbing. |
| BuildKit secret + URL rewrite | Same, plus fiddly lockfile URL rewriting. |
| Vendor `dist/` | Short-term unblock; duplicates source of truth. |
| Key in a layer / PAT in Dockerfile | Never. |

**Only publishing or vendoring actually satisfies the stated criterion.** This
determines whether B9 is a half-day ticket or a multi-day one with an upstream
dependency. Needs deciding up front.

---

## 4. BLOCKER — `EventSource` cannot send an `Authorization` header

B6 requires *"same auth as resolve"*. Resolve auth is `Authorization: Bearer`.
**The browser `EventSource` API cannot set custom headers.** As stated, the
requirement is not implementable for browser clients.

| Option | Cost |
|---|---|
| Token in query string | **Puts the API key in `req.url`, which Fastify logs on every request** — directly contradicts B8. Needs URL scrubbing. |
| Short-lived single-use stream ticket | Standard answer. More moving parts, doesn't leak the long-lived key. |
| `HttpOnly` cookie | Needs CORS `credentials: true` and a tightened `CORS_ORIGINS` — `*` and credentials are mutually exclusive per spec. |
| `fetch` + `ReadableStream` | Headers work; lose automatic reconnection, hand-roll SSE framing. Gains `AbortController`. |

**Recommendation: stream ticket.** Minted by an authenticated `POST`, exchanged
in the query string, single-use, ~30s validity. Keeps the long-lived key out of
URLs and logs.

This is the single item most likely to blow B6's estimate.

---

## 5. Defects in already-pushed code

### 5a. C7 — the captive-portal probe never runs

`connectivity.ts:57-61` says the `online` event should *"drop back to 'unproven'
and let the probe below decide — this is exactly the captive-portal case."*

But the probe effect starts `if (online) return;`, and after `cameOnline()` the
state is `linkUp = true, verified = 'unknown'`, which line 76 evaluates as
`online === true`. **The probe never runs in the case the comment names.**

Behaviour is defensible (optimistic, fails fast on mint) but the code does not
do what it claims. Also: no probe while believed online, so a silent network
death with no `offline` event leaves the app believing it is connected
indefinitely.

**Fix:** either make the probe run when `verified === 'unknown'`, or correct the
comment and README to describe optimistic-until-proven-otherwise.

### 5b. Map — the trail polyline is never removed

`Map.tsx:134` is `if (trail !== undefined && trail.length > 1)` with **no `else`
branch**. Once created the polyline persists.

Resolve a live code with a trail, then resolve a static one, and **the first
caller's track stays drawn over the second caller's position.** Same family of
error as confusing a third-party report with the caller's own location. Does not
reproduce today only because nothing passes `trail` yet — it becomes live the
moment D5 lands.

**Fix in D5:** `else { trailRef.current?.remove(); trailRef.current = null }`.

### 5c. Live-mode update failures are silently dropped

`Share.tsx:208` fires `void updatePosition(...)` and ignores the result. A live
session losing connectivity mid-stream never calls `reportUnreachable()`, so the
"lost connection" notice only appears if the browser fires an `offline` event.

---

## 6. Ticket breakdown

### B7 — Rate limiting  *(implementation complete, needs rebase + gaps)*

Already built and passing: fixed-window counter with a cost function, two axes
(IP and resolver key), `resolveMissCost: 30` vs `resolveHitCost: 1`, a boot-time
guard refusing to start if `missCost <= hitCost`, exponential backoff
2→4→8→…→300s, extend-only blocks so a later cheap miss can't shrink a penalty.
29 tests, typecheck clean.

Remaining:
- [ ] Rebase onto `b2-redis-store`; share one Redis connection
- [ ] `.env.example` — **13 undocumented variables** (all `RATE_*`, plus
      `RATE_LIMIT_ENABLED`, `TRUST_PROXY`, `REDIS_URL`)
- [ ] `RedisRateLimitBackend` has **zero tests** — both Lua scripts unverified.
      Redis is running locally, so this is a gap in the work, not the environment.
- [ ] Test the config guard and `bool()` parsing
- [ ] `PATCH`/`DELETE` are unlimited — both return an identical 404 for
      wrong-token and no-session, a **second enumeration oracle with no budget
      on it**
- [ ] `Retry-After` reports the full window, not the remainder

### B8 — Audit log

- [ ] `AuditEvent` interface with **no position field** (ADR-002)
- [ ] Fix pino redaction as a second layer + regression test
- [ ] Separate pino instance → file via `pino.destination`. Add `pino` as a
      **direct** dependency (currently only transitive via Fastify).
- [ ] Record `request.ip` — **currently absent from every audit line**
- [ ] Log the 401 path — a bad API key currently produces **zero audit record**,
      and "someone tried to resolve with a bad key" is exactly what an audit
      trail is for
- [ ] Log `PATCH` (currently nothing) and add identity+IP to `DELETE`
- [ ] Explicit ISO timestamp independent of the log framework
- [ ] **ADR-004: the audit sink records the TRUE outcome.** `deny()` collapses
      four cases into `not-found` — correct and load-bearing for the HTTP
      response, destructive in an audit log. "Control room B tried to resolve a
      code owned by control room A" is precisely the event an audit log exists
      to capture. External ambiguity must not propagate inward.
- [ ] Retention: **do not add an in-process sweeper.** B2 states that if you
      find yourself adding one, the structural claim is already lost. Use
      rotation-by-file-count (`pino-roll`) or delegate to the platform.
- [ ] Define "append-only" honestly — `O_APPEND` from a process that can also
      `unlink` is not tamper-evident. Either scope the claim or specify the real
      control.
- [ ] New vars: `AUDIT_ENABLED`, `AUDIT_LOG_PATH`, `AUDIT_RETENTION_DAYS`

**Note:** Fastify already logs the full URL on every request, and codes are path
parameters — so the application log *already* contains code + IP + timestamp, a
partial shadow audit trail in the wrong sink with the wrong retention.

### B9 — docker-compose

Blocked on ADR-003.

- [ ] Multi-stage Dockerfile: build with `tsc`, run `node dist/index.js`.
      **Not `tsx`** — it is a devDependency, ships the whole dev tree into the
      runtime image, and does not typecheck.
- [ ] Add a `start:prod` script (none exists)
- [ ] `.dockerignore` (none exists)
- [ ] Compose sets `RESOLVER_MODE=apikey` with `API_KEYS=demo-key-alpha:control-room-a`
      so `up` demonstrates the *secure* configuration
- [ ] Two config landmines: `RATE_RESOLVE_MISS_COST` must exceed
      `RATE_RESOLVE_HIT_COST` or the process throws; `apikey` with empty
      `API_KEYS` throws
- [ ] **Healthcheck interval:** `/health` calls `store.size()`, which on the
      Redis store is a full `SCAN` — explicitly commented as
      *"a diagnostic, not something to put on a hot path."* A 10s healthcheck
      makes it a hot path. Use a long interval or add a cheap mode.

### C1 — PWA offline shell

- [ ] Rebase onto `c7-offline-first-minting`
- [ ] `scripts/make-icons.mjs` exists and is complete — a zero-dependency PNG
      encoder — but **has never been run**; `public/icons/` is empty and no npm
      script invokes it. Wire up `"icons"` + a `prebuild` hook.
- [ ] `manifest.webmanifest`, manifest `<link>`, `apple-touch-icon`,
      `theme-color` — `index.html` has **no icon links at all**
- [ ] Service worker + registration. Navigation fallback must preserve
      `/resolve` surviving a reload.
- [ ] `theme-color` is per-surface (`theme-public`/`theme-console` swap on
      `<body>` at runtime); a manifest carries one static value.

**ADR-005: map tiles are decorative offline, and that is correct.** Tiles come
from `tile.openstreetmap.org` — unbounded coverage, OSMF policy forbids bulk
pre-fetching, third-party origin. **Do not attempt to pre-cache.** C7 already
renders *"Map pictures need a connection. Your position is still exact — it is
written out below."* Opportunistic runtime caching of visited tiles
(CacheFirst, ~200 entries, 7-day expiry) is policy-compliant and materially
improves the walked-into-a-basement case.

Audit result: **no CDN fonts, no analytics, Leaflet marker images already
inlined as data URIs.** Tiles are the only external request.

- [ ] The dispatcher's two `<Map>` usages never pass `offline`, so the console
      shows a bare grey box with no explanation

### B6 + D5 — SSE live sessions

Blocked on ADR §4.

**Server (`whereareyou-api`)** — put in new files to minimise merge surface:
`src/stream.ts`, `src/session-events.ts`, optionally `src/routes-stream.ts`.

- [ ] `reply.hijack()`, write to `reply.raw`. Headers: `text/event-stream`,
      `no-cache, no-transform`, `keep-alive`, **`X-Accel-Buffering: no`**
      (nginx otherwise buffers the whole stream)
- [ ] `socket.setNoDelay(true)`; `retry: 5000` on connect
- [ ] Heartbeat comment every 15–30s, below the shortest proxy idle timeout
      (ALB and nginx both default to 60s). `.unref()` the interval.
- [ ] Cleanup on `request.raw.on('close')` — **every connection must drop its
      subscription and its timer or you leak both**
- [ ] Publish hooks: `routes.ts:316` (after `store.update`) and `routes.ts:333`
      (after `store.delete`, for `revoked`)
- [ ] Export `toResolved` and `identifyResolver` (both currently module-private)
      or move to shared modules
- [ ] `redis.duplicate()` — a subscriber connection cannot issue normal commands
- [ ] **Charge stream-open exactly like a resolve.** A stream on a non-existent
      code is a miss and must cost 30 units, or the endpoint becomes an
      unmetered enumeration oracle that bypasses B7 entirely.

**ADR-006: expiry via per-connection timer, not keyspace notifications.**

Keyspace notifications look like the obvious answer and are the wrong one:
`notify-keyspace-events` is **off by default** (so the feature silently doesn't
work on any Redis where an operator hasn't set it, and managed Redis may forbid
it); pub/sub is fire-and-forget with **no replay**, so a momentarily
disconnected subscriber loses the `expired` event forever; timing lags by an
unbounded amount; the event carries only the key name; and it fires for **every**
expiring key including all `rl:*` rate-limit counters — a firehose on every
instance.

Instead: on stream open you already hold the session (you fetched it to
authorise), so you have `expiresAt`. `setTimeout(expiresAt - Date.now())` →
emit `expired`, close. Precise, needs no Redis configuration, cannot be lost in
transit, works identically on the memory store.

**This is safe precisely because of an existing deliberate decision** — writes
never extend the TTL (`routes.ts:314-316`), so `expiresAt` never moves. Client
inference from `expiresAt` as a belt-and-braces backstop.

**Client (`whereareyou-web`)**

Already present: `trail` prop plumbed through `Map.tsx`, polyline maintained,
auto-pan written *for* live sessions, marker/circle updating in place, StrictMode
lifecycle correctly solved (map in state, refs nulled on teardown), and a 1s
`forceTick` interval already running that a "last updated Ns ago" readout can
reuse as-is.

- [ ] Fix 5b (trail removal) **before** anything passes `trail`
- [ ] `trail` must be referentially stable — it is in the `Map.tsx:145`
      dependency array, so an inline `.map()` in JSX creates a new identity every
      render and re-runs the layer effect 60×/min, replacing the DivIcon and
      restarting any CSS animation. `useMemo` or hold in state.
- [ ] A pulsing pin fights `setIcon` — guard behind an actual colour change, or
      move the animation to a separate layer
- [ ] Effect keyed on `session?.code` tearing down the previous stream —
      `lookup()` currently overwrites `session` with no cleanup path
- [ ] Auto-pan never adjusts zoom, so a long trail runs off-screen. **Do not
      `fitBounds` by default** — zooming out under a dispatcher mid-call is
      hostile. Add an explicit "fit to trail" control.
- [ ] Define the wire event shape in `@whereareyou/protocol` alongside
      `UpdatePositionRequest`, not locally in the web app

---

## Testing

Patterns established by B2, reuse them:

- `TEST_REDIS_URL`, `redisAvailable()`, `redisCli()` via `execFileSync` —
  assertions go through `redis-cli`, *outside* the app's own ioredis connection,
  so an expiry test is not partly checking our own code's honesty
- `describe.skipIf(!available)` with a **loud module-scope `console.warn`** — a
  skipped structural-expiry suite means the central claim went unverified, and
  that should be obvious rather than buried in a "0 failures" summary
- `vitest.config.ts`: `testTimeout: 20_000` (real wall-clock TTL waits),
  `fileParallelism: false` (shared keyspace)

---

## Current Status

### Complete and pushed
`b2-redis-store`, `c7-offline-first-minting`, `a4-openapi`, `a5-threat-model`,
`e4-comparison`

### Uncommitted, wrong base
`b7-rate-limiting` (implementation complete), `c1-pwa-offline-shell` (icon
generator only)

### Decisions needed before implementation resumes

1. **Merge order** — rebase both dependent branches (§1)
2. **Publish `@whereareyou/protocol`?** — gates B9 (ADR-003)
3. **SSE auth mechanism** — gates B6/D5 (§4)
4. **Redaction** — fix the mechanism, and correct the README either way (§2)

### Ticket status

| Ticket | Status | Note |
|---|---|---|
| B7 | 🟡 Built, wrong base | Rebase + `.env.example` + Redis backend tests |
| B8 | ⬜ Not started | Blocked on redaction fix being scoped in |
| B9 | 🔴 Blocked | Needs ADR-003 |
| C1 | 🟡 Started, wrong base | Icons generated but never run |
| B6/D5 | 🔴 Blocked | Needs SSE auth decision |
