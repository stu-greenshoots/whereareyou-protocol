# Remaining tickets

Twelve left. Ordered by what makes the project's own claims true, then by what
makes it demonstrable. Each is scoped to be independently shippable.

---

## B2 — Redis store with native TTL ⬜ **highest priority**

**Why first:** the README and the pitch both claim expiry is *structural* — the
record cannot outlive its TTL. Right now it is enforced by a sweeper over an
in-memory Map, which makes it *policy*-true only. "We delete after 30 minutes"
and "it cannot persist past 30 minutes" are different claims, and only one
survives an audit. Every other privacy argument rests on this one.

**Acceptance criteria**
- [ ] `RedisSessionStore` implementing the existing `SessionStore` interface
- [ ] Session as a Redis hash under `sess:{code}`, expiry via native `EXPIRE`
- [ ] No sweeper, no cleanup job, no scheduled delete anywhere in the codebase
- [ ] Claim state shares the session's TTL rather than outliving it
- [ ] `updateToken` stored hashed (already true — preserve it)
- [ ] `MemorySessionStore` kept for tests so the suite needs no Redis
- [ ] Selected by `REDIS_URL`; absent means memory, and the API logs loudly
      which one it is using
- [ ] Integration test proving a key actually vanishes after its TTL

**Files:** `packages/api/src/store.ts`, new `store-redis.ts`, `index.ts`

---

## B7 — Rate limiting and enumeration defence ⬜ **highest priority**

**Why:** in `open` mode the resolver is genuinely enumerable. 34.4 billion
session codes is a big space, but "big" is not a control.

**Acceptance criteria**
- [ ] Per-IP and per-resolver-key limits, Redis-backed
- [ ] **Failed resolves cost far more budget than successful ones.** The signal
      that separates an attacker from a dispatcher is the miss rate, so price
      that, not raw request volume
- [ ] Exponential backoff on repeated misses from one source
- [ ] Mint limits deliberately loose — throttling a real caller in an emergency
      is a worse failure than absorbing some abuse
- [ ] Offline codes need no limit at all: they never touch the server
- [ ] Metrics: resolve attempts, miss rate, throttle events

---

## B8 — Audit log ⬜

**Why:** this is the best property in the design and it should be real. Full
post-incident accountability — who resolved what, when — with no database of
where anyone was.

**Acceptance criteria**
- [ ] Records timestamp, code, resolver identity, outcome, source IP
- [ ] **Never records coordinates.** Assert this in a test.
- [ ] Append-only, separate sink from application logs
- [ ] Configurable retention, default 90 days

---

## C7 — Offline-first minting ⬜

**Why:** completes the offline story. The codec exists; the share screen still
assumes a network. Someone with no signal should get a usable code, not an error.

**Acceptance criteria**
- [ ] Detect offline (`navigator.onLine` plus a failed mint) and fall back
      without the user having to understand what happened
- [ ] When offline, the **offline code becomes the hero** and the UI says plainly
      that it will not expire
- [ ] When back online, offer to mint a proper session code
- [ ] The distinction is never hidden — a permanent code must not look like an
      expiring one

---

## A4 — OpenAPI 3.1 document ⬜

- [ ] Covers all five endpoints; validates against the meta-schema in CI
- [ ] Documents that `not-found` deliberately covers *never existed*, *expired*,
      *revoked* and *claimed by another resolver* — and why collapsing them is
      correct, so no future implementer helpfully splits them
- [ ] Exported from the package

---

## A5 — Threat model ⬜

- [ ] Enumeration: the arithmetic, and what actually mitigates it
- [ ] Harvesting: what claim-on-read buys and what it does not
- [ ] Offline codes are permanent — state the privacy cost plainly
- [ ] Open mode is insecure by construction; say so
- [ ] What we chose *not* to solve, and why

---

## B6 / D5 — Live sessions over SSE ⬜

Two halves of one feature; do them together.

- [ ] `GET /v1/sessions/{code}/stream`, same auth as resolve
- [ ] Position updates plus a terminal `expired` / `revoked` event
- [ ] Heartbeat comments to survive proxy idle timeouts
- [ ] Redis pub/sub so it works across multiple API instances
- [ ] Console subscribes automatically for live sessions
- [ ] Pin animates, breadcrumb trail, "last updated Ns ago" going stale-visible
- [ ] Reconnects after a dropped connection

---

## B9 — docker-compose ⬜

- [ ] `docker compose up` gives working api + redis
- [ ] Seeded demo API key, `.env.example` documenting every variable
- [ ] Fresh clone to running in under two minutes, verified by doing it

---

## C1 — PWA manifest and offline shell ⬜

- [ ] Installable; app shell cached so it opens with no network
- [ ] Loads in under 1s on simulated 3G — measured
- [ ] No third-party requests at all, verifiable in the network tab
- [ ] Pairs with C7: the shell being cached is what makes offline minting real

---

## E1 — Demo mode ⬜

- [ ] `DEMO_MODE=true` seeds a known key and relaxes limits
- [ ] Pre-seeded sessions at recognisable UK locations
- [ ] **Fake-position control** so the app can be demoed indoors on a laptop
      without spoofing device GPS — this is the one that matters
- [ ] Loudly visible; impossible to mistake for real

---

## E2 — Deploy ⬜

- [ ] API + Redis on Fly.io, web on static hosting
- [ ] HTTPS on a real domain — geolocation needs a secure context, so this is a
      hard blocker rather than polish
- [ ] Documented well enough that someone else can stand up a node

---

## E3 — README and demo script ⬜

- [ ] Leads with the problem, not the architecture
- [ ] Clone to running in under two minutes
- [ ] Five-minute demo script with a narrative arc:
      1. Mint a code, read it aloud, dispatcher resolves it. *The whole idea.*
      2. Mistype it → instant "that's a typo", not a wrong location.
      3. Drag the pin across the road. *AML structurally cannot do this.*
      4. Go live and walk. *No coordinate encoding can do this at all.*
      5. Kill the API, resolve an offline code. *Still works.*
      6. Let it expire. *Gone, and not because a job deleted it.*

---

## E4 — Comparison page ⬜

An honest comparison against AML, what3words, Plus Codes and raw lat/lon.

- [ ] Fair on the axes where we lose — above all, **a session code needs
      connectivity to mint and what3words does not**
- [ ] States plainly that AML is the correct primary channel and this does not
      replace it
- [ ] Includes the measured Plus Code typo data (209/209 valid, 44 within 100m,
      closest 2m) — it is the strongest single piece of evidence in the project
- [ ] Cites Cybergibbons' reverse-engineering and the Montreal AI Ethics
      Institute analysis
- [ ] No marketing language. The argument is strong enough unhelped, and
      overclaiming would make us the thing we are criticising.
