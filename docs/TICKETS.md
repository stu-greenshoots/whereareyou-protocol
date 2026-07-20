# whereareyou — ticket index

**Status as of the current build. 18 of 30 done.**

The prototype works end to end: mint a code, read it aloud, resolve it, watch it
expire — plus offline codes that resolve with no server at all.

## What is actually built and running

| | |
|---|---|
| Session codes | 8 chars, checksummed, phonetic, mint/resolve/live/revoke |
| Offline codes | 10 chars, content-addressable, zero network, avalanche-scrambled |
| API | Fastify, both auth modes, claim-on-read, validation |
| Share screen | one-button mint, third-party pin, live mode, all coordinate formats |
| Dispatcher console | both code types in one input, map, CAD copy, shift history |
| Visual system | public app as issued document (light), console as control-room tool (dark) |

## What is NOT true yet

⚠️ **Sessions live in memory.** Restarting the API drops every live code, and
expiry runs off a sweeper rather than being structurally impossible. The README
claims expiry is structural — **that claim is false until B2 lands.** This is
the single most important remaining ticket.

⚠️ **No rate limiting.** In `open` mode the resolver is genuinely enumerable.

---

## Remaining work, in priority order

**To make the claims true:** B2 → B7 → B8
**To finish the story:** C7 → E4
**To show people:** E1 → E2

---

## Epic A — Protocol

| # | Ticket | Status |
|---|--------|--------|
| A1 | Repo scaffold, npm workspaces, TS config | ✅ |
| A2 | Session code codec — base32, checksum, phonetics, parser | ✅ |
| A3 | Offline code codec — 45-bit grid, PRP scramble, checksum | ✅ |
| A4 | OpenAPI 3.1 document | ⬜ |
| A5 | Threat model document | ⬜ |

## Epic B — API

| # | Ticket | Status |
|---|--------|--------|
| B1 | Fastify skeleton, config, health, log redaction | ✅ |
| B2 | **Redis store with native TTL** — makes expiry structural | ⬜ |
| B3 | `POST /v1/sessions` — mint | ✅ |
| B4 | `GET /v1/sessions/{code}` — resolve + claim-on-read | ✅ |
| B5 | `PATCH` / `DELETE` — live update and revoke | ✅ |
| B6 | SSE stream for live sessions | ⬜ |
| B7 | **Rate limiting and enumeration defence** | ⬜ |
| B8 | Audit log — events, never coordinates | ⬜ |
| B9 | docker-compose: api + redis | ⬜ |

## Epic C — Share screen

| # | Ticket | Status |
|---|--------|--------|
| C1 | PWA manifest and offline app shell | ⬜ |
| C2 | One-button mint and code document | ✅ |
| C3 | Fallback panel — offline code, lat/lon, Plus Code, OS grid | ✅ |
| C4 | Third-party pin mode | ✅ |
| C5 | Live mode | ✅ |
| C6 | Expiry countdown and revoke | ✅ |
| C7 | **Offline-first minting** — detect no network, lead with offline code | ⬜ |

## Epic D — Dispatcher console

| # | Ticket | Status |
|---|--------|--------|
| D1 | Scaffold, API key entry, open-mode banner | ✅ |
| D2 | Code entry — routes session and offline codes in one input | ✅ |
| D3 | Map, pin, accuracy circle, third-party distinction | ✅ |
| D4 | All-formats panel and copy-for-CAD | ✅ |
| D5 | Live session subscription via SSE | ⬜ |
| D6 | Shift history — client-side only | ✅ |

## Epic E — Demo and pitch

| # | Ticket | Status |
|---|--------|--------|
| E1 | Demo mode, seeded keys, fake-position control | ⬜ |
| E2 | Deploy — HTTPS, real domain | ⬜ |
| E3 | README and five-minute demo script | ⬜ |
| E4 | Comparison page vs w3w / AML / Plus Codes | ⬜ |

---

## Decisions already made — do not re-litigate

**No federation, no issuer prefix.** "Anyone can host a resolver node" needs a
registry to answer "which node do I ask?", which is a governance problem wearing
a technology costume. The usual argument for reserving a prefix does not apply
either: codes live 30 minutes, so **there is never an installed base** and
format migration is permanently free.

**Two code types, told apart by length.** 8 = session (pointer; expires, tracks,
carries a note, revocable, needs network). 10 = offline (content-addressable;
permanent, no metadata, works anywhere). They fail in different circumstances,
which is why both exist.

**Offline codes are permanent.** No expiry, no revocation, no provenance — the
same privacy property we criticise in what3words, and unavoidable, because
content-addressable means the location *is* the code. The session code stays the
primary path; this is the fallback for no signal.

**~5m grid, not 3m.** A 3m square is false precision when the GNSS fix is ±10m.
The character saved buys the checksum instead.

**Plus Codes stay, for a different job.** Measured: 209/209 single-character
typos produce a *valid* Plus Code, 44 of them landing within 100m — one at 2m.
No checksum, and prefix locality puts typos nearby. They are an excellent
*interchange* format (already in Google Maps) and a poor *voice* format. Ours is
the reverse. Keep both.

**Web is one package, not two.** `/` and `/resolve` share a build. A real deploy
should split them — the console should not sit on the public origin.

## Out of scope

**Native mobile apps.** The whole point is that the sharer needs no app.

**CAD integration.** The thing that would actually drive adoption, and entirely
a partnerships problem. Copy-for-CAD is the prototype's stand-in.
