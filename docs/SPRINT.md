# Sprint plan

Nine of the twelve remaining tickets can run unattended. Three cannot, for
reasons worth stating rather than discovering later.

## Shape: parallel across repos, sequential within them

The constraint that decides everything is **file conflicts**. Two agents editing
`whereareyou-api` at once will collide. So: one agent per repo, working its
tickets in order. Three tracks run concurrently, no shared files, no conflicts,
no worktree juggling.

```
Track A · whereareyou-api      B2 ──► B7 ──► B8 ──► B9
Track B · whereareyou-web      C7 ──► C1
Track C · whereareyou-protocol A4 ──► A5 ──► E4
```

Track A is the long pole and the highest value: B2 is the ticket that makes an
existing claim true.

---

## Track A — API

**B2 · Redis store with native TTL** *(highest priority in the whole project)*

The README claims expiry is *structural*. It is not — it is a sweeper over an
in-memory Map, which makes it policy-true only. Every privacy argument in the
pitch rests on this. Fixing it is not a feature; it is making a shipped claim
honest.

- `RedisSessionStore` behind the existing `SessionStore` interface
- Native `EXPIRE`; **no sweeper, no cleanup job anywhere in the codebase**
- Claim state shares the session TTL rather than outliving it
- `MemorySessionStore` retained for tests
- Selected by `REDIS_URL`; the API logs loudly which store is active
- Integration test proving a key actually vanishes

**B7 · Rate limiting** — Redis-backed, so it depends on B2 landing first.
Failed resolves must cost far more budget than successful ones: miss rate is
what separates an attacker from a dispatcher, so that is what to price. Mint
limits stay deliberately loose — throttling a real caller mid-emergency is a
worse failure than absorbing some abuse.

**B8 · Audit log** — records timestamp, code, resolver identity, outcome, IP.
**Never coordinates.** Assert that in a test. Full accountability, no location
history database.

**B9 · docker-compose** — api + redis, seeded demo key, `.env.example`.

## Track B — Web

**C7 · Offline-first minting** — the codec exists but the share screen still
assumes a network. Detect offline, promote the offline code to hero, say plainly
that it will not expire, and offer to mint a session code when signal returns.
The permanent/expiring distinction must never be hidden.

**C1 · PWA manifest and offline shell** — pairs with C7. A cached shell is what
makes offline minting real rather than theoretical. No third-party requests.

## Track C — Protocol and docs

**A4 · OpenAPI 3.1** — must document that `not-found` deliberately covers four
distinct situations, and why collapsing them is correct, so no future
implementer helpfully splits them.

**A5 · Threat model** — enumeration arithmetic, what claim-on-read does and does
not buy, the permanence of offline codes stated as a real privacy cost, and open
mode named as insecure by construction.

**E4 · Comparison page** — against AML, what3words, Plus Codes, raw lat/lon.
Fair on the axes where we lose, above all that a session code needs connectivity
and what3words does not. Includes the measured Plus Code typo data.

---

## Not running unattended, and why

**E2 · Deploy** — outward-facing and irreversible. `flyctl` is not installed and
deployment needs your authentication. Publishing a service to the internet is
not something to do while you are away.

**B6 + D5 · SSE live sessions** — spans the API and web repos simultaneously.
Two agents in two repos implementing halves of one protocol will diverge. Better
as a single focused piece of work afterwards.

**Fonts and visual design** — blocked on Claude Design output, and needs your
eye. I have built four rounds of UI without seeing any of it; that is exactly
where autonomous work is weakest.

---

## The Redis problem

B2 cannot be *verified* without Redis running, and Redis is not installed —
`redis-server` is absent and the Docker daemon is stopped. An agent can write
the store and unit-test it against the in-memory implementation, but cannot
prove a key genuinely vanishes on TTL expiry.

That matters more than usual here, because "the record cannot outlive its
expiry" is precisely the claim B2 exists to make true. Shipping it unverified
would repeat the problem rather than fix it.

## Definition of done, per ticket

1. `npm run typecheck` clean
2. `npm test` green, including new tests
3. `npm run build` succeeds
4. Committed on a branch with reasoning in the message
5. Anything unverifiable stated plainly in the summary rather than implied
