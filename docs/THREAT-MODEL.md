# Threat model

What this protocol protects, what it does not, and where the arguments actually
run out. Numbers are shown with their working so they can be checked rather than
believed.

Status note up front, because several mitigations below are specified but not
yet built: **rate limiting (B7) does not exist in the reference resolver, and
sessions live in an in-memory `Map` rather than a store with native TTL (B2).**
Where this document describes a control that is not yet implemented, it says so
at that point. Nothing here should be read as a description of a deployed
system.

---

## 1. What is being protected

The asset is not a coordinate. It is the binding:

> *this code* → *a specific person, in trouble, right now, at these coordinates*

That framing drives everything else. A successful attack here is not the leak of
a map reference; it is learning where a person in distress is, at the moment
they are most vulnerable, with a strong prior that they are alone, frightened,
or incapacitated. The harm per successful guess is high, which is why "the
namespace is large" is not on its own an acceptable answer.

Secondary assets:

- **`updateToken`** — the bearer secret that can move or revoke a session. An
  attacker holding one can walk a dispatcher's pin away from the casualty, which
  is worse than simply denying service.
- **Resolver API keys** — identity for claim binding and the audit log.
- **The audit log itself** — records that a lookup happened, never where.

### Adversaries considered

| | Capability | Motive |
|---|---|---|
| **Opportunistic enumerator** | Unauthenticated or one API key, commodity bandwidth | Curiosity, scraping, resale |
| **Rogue resolver** | A *valid* API key issued by the operator | Harvesting at scale from inside |
| **Voice-channel eavesdropper** | Hears the code spoken | Targeting a specific individual |
| **Network observer** | Sees traffic | Bulk collection |
| **Operator / host** | Full access to the store | Compelled disclosure, insider abuse |

### Explicitly out of scope

Endpoint compromise (if the sharer's phone is owned, the location is gone
regardless), GNSS spoofing, and coercion of the sharer. Also: **the protocol
makes no attempt to verify that a reported position is true.** A sharer can lie,
and in `third-party` mode the position is a human's belief about somewhere they
are not standing. Dispatchers must treat `subject` and `source` as provenance,
not as attestation.

---

## 2. Enumeration

The central problem. A session code is 8 characters: 7 random base32 symbols
plus a checksum.

### The arithmetic

The checksum symbol is fully determined by the other seven, so it contributes
**zero** entropy. An attacker computes it as easily as we do. The space is:

```
32^7 = 34,359,738,368 codes
```

With `N` sessions live at any instant, a single blind guess hits with
probability `N / 32^7`, and the expected number of guesses to a first hit is
`32^7 / N`.

| Live sessions `N` | Hit rate per guess | Expected guesses per hit |
|---|---|---|
| 100 | 1 in 343,597,384 | 343,597,384 |
| 1,000 | 1 in 34,359,738 | 34,359,738 |
| 10,000 | 1 in 3,435,974 | 3,435,974 |
| 100,000 | 1 in 343,597 | 343,597 |

Translated into an attacker's actual day, at `N = 10,000`:

| Request rate | Requests/day | Expected hits/day | Time to first hit |
|---|---|---|---|
| 10/s | 864,000 | 0.25 | ~4 days |
| 100/s | 8,640,000 | 2.5 | ~10 hours |
| 1,000/s | 86,400,000 | 25 | ~1 hour |

Two things follow, and only one of them is comfortable.

**The comfortable one:** this is why the payload is 7 symbols and not 6. At
`32^6 = 1,073,741,824` and `N = 10,000`, the hit rate is 1 in 107,374 — about
**8 harvested emergencies per day** at a trivial 10 requests/second. One symbol
is the difference between "needs real infrastructure to attack" and "a laptop
does it before lunch".

**The uncomfortable one:** at 1,000 requests/second — which is not an
extraordinary capability, it is one rented machine — an unthrottled resolver
carrying 10,000 live sessions leaks roughly **25 people's locations per day.**
34 billion is a large number and it is *not sufficient on its own.* Anyone
quoting the size of the space as the security argument has stopped the analysis
one step too early.

Note also that `N` scales against us: success makes the system easier to attack.
A deployment carrying 100,000 concurrent sessions has a hit rate ten times
better than one carrying 10,000, for the same attacker effort. Enumeration
resistance degrades exactly as adoption grows.

### What actually mitigates it

**Rate limiting priced on the miss rate — the primary control, and not yet
built (B7).** The distinguishing signal is *not* request volume. A busy control
room and an attacker can issue similar numbers of requests. The difference is
the outcome distribution: a dispatcher is reading codes off a phone call and
almost always hits; an enumerator misses 3,435,973 times out of 3,435,974.
Budget must therefore be consumed by *misses*, with exponential backoff on
repeated failure from one source.

The effect is decisive. At `N = 10,000`, one expected hit costs ~3.44 million
guesses. If a source is allowed roughly 100 misses per hour before backoff
(2,400/day):

```
3,435,974 misses ÷ 2,400 misses/day = ~1,432 source-days per expected hit
```

An attacker wanting one hit per day needs to sustain ~1,432 distinct sources
indefinitely. That is a botnet, not a script — and the required scale is now
visible in metrics, which is the point. Tighten to 240 misses/day/source and it
is ~14,300 source-days.

**Short TTL — the structural control.** The default lifetime is 30 minutes
(clamped to 60s–4h). This matters more than it first appears, because it denies
the attacker *accumulation*. Against a permanent identifier space, guesses chip
away at a fixed target and results compound forever. Here, a code guessed after
its session expired is worth nothing, and every hit decays to worthless within
the hour. There is no growing database to build.

⚠️ **This control is currently policy, not structure.** Expiry is enforced by a
sweeper over an in-memory `Map`. "We delete after 30 minutes" and "the record
cannot outlive 30 minutes" are different claims and only the second survives an
audit. B2 (native TTL in the store) is what makes the sentence above true; until
it lands, treat the README's "structural expiry" claim as aspirational.

**Checksum rejection before the datastore.** Malformed guesses are rejected by
local arithmetic and never become a lookup. This is a cost and availability
control, not a security one — it does not reduce the attacker's success rate at
all, since they will only ever send well-formed codes.

**Uniform `404`.** Covered in §3.

### The oracle problem

Every mitigation above is undone by a resolver that tells the caller *why* a
lookup failed. `expired`, `revoked` and `claimed-elsewhere` each confirm the
guessed code was **real**. That confirmation is worth more than the record
behind it: it turns a blind search into a verified hit that can be logged,
correlated, retried, or used to estimate `N` for the deployment.

So `404 not-found` deliberately collapses four cases — never existed, expired,
revoked, claimed by a different resolver — and on `PATCH`/`DELETE` a fifth,
wrong `updateToken`. Identical status, identical body, identical message. See
`openapi.yaml`, which repeats this at every affected response because it is the
single most likely thing for a future implementer to "fix".

Timing is part of the same surface. Constant-time token comparison is used
(`timingSafeEqual` against a stored hash), but a store that answers "absent"
faster than "present but claimed elsewhere" reintroduces the oracle through the
side door. This has not been measured, and is an open weakness.

### Residual risk

Non-zero and permanent. A patient, distributed attacker with many source
addresses will eventually resolve some codes. The design goal is not prevention
— it is making the required scale expensive, visible in metrics, and low-yield
because of TTL decay. **Enumeration is mitigated, not solved.**

---

## 3. Harvesting, and what claim-on-read buys

Enumeration is about guessing codes. Harvesting is about what a party who *can*
resolve codes does at volume — most importantly a **rogue holder of a valid API
key**, who does not have to guess at all.

**Claim on first read:** in `apikey` mode, the first resolver identity to read a
code is bound to it. Every later read by a different identity returns the same
`404` as a code that never existed.

### What it buys

- A resolver cannot silently re-read the namespace. Each success is bound and
  attributed.
- Bulk sweeping by one key becomes self-evident: a key claiming thousands of
  codes it never had a call for is a visible, attributable pattern.
- It converts an invisible read into an accountable act. Combined with the audit
  log (records timestamp, code, resolver identity, outcome, IP — **never
  coordinates**), it gives post-incident accountability without a database of
  where anyone was.

### What it does not buy

- **It does not protect the first read.** The rogue key's *first* resolve of any
  code succeeds and returns full coordinates. Claiming detects and attributes
  harvesting; it does not prevent the harvest. If the attacker only wants the
  data, they get it.
- **It creates a denial-of-service.** Claiming is first-come, not
  first-*legitimate*. A rogue resolver reaching a code before the real control
  room locks the real control room out of a live emergency. This is a genuine
  harm, accepted because unlimited silent re-reads are worse at scale — but it
  is a real cost and it is not hypothetical.
- **It does not survive key sharing.** Identity is per-key, not per-operator or
  per-human. A key shared across a control room is one identity, and claim
  binding cannot see inside it.
- **It does nothing against a legitimate resolver abusing a real call.** A
  dispatcher entitled to resolve a code can do whatever they like with the
  result. That is a personnel and audit problem, not a protocol one, and the
  audit log is the only answer offered.

### ⚠️ It is disabled entirely in `open` mode

An unauthenticated caller has no identity to bind a code to, so claiming is
**off**. A node in `open` mode has no anti-harvest control at all. It says so in
a `warning` field on every successful resolve; consoles must surface that rather
than swallow it.

---

## 4. Offline codes are permanent

Stated plainly, because it is the worst privacy property in the design and it is
not fixable.

**An offline code never expires, cannot be revoked, and carries no provenance.**
A 10-character offline code encodes the position *into itself*. Anyone who ever
sees or hears one — now or in ten years, from a screenshot, a CAD record, a
call recording, an incident report, a photograph of a phone screen — can decode
it to a ~5m cell with no server, no key, and no permission. There is no
mechanism by which we could take it back, because there is nothing to take back:
**the location is the code.**

This is precisely the property criticised in what3words, and criticising it
there while carrying it here would be dishonest. The difference is scope, not
kind: what3words' addresses are permanent *by design* for every location on
earth, whereas ours is a fallback that exists only when a session code cannot be
minted. That is a real distinction and it is not an exoneration.

It is unavoidable. Content-addressable and revocable are contradictory
requirements: expiry needs state, state needs a server, and a server is exactly
what the offline path exists to do without. Any scheme that works with no
connectivity in either direction has this property. We chose it consciously,
because a person with no signal getting a usable code beats a person with no
signal getting an error.

Consequences to hold onto:

- The scramble is **not** cryptographic and is not a secret. It is public,
  documented, and reimplementable from the source — it exists for diffusion, so
  that neighbouring cells get unrelated codes. It provides **no**
  confidentiality. Anyone can decode any offline code.
- There is no rate limit and can be none, because decoding touches no server.
- Enumerating the 2^45 = 35,184,372,088,832 cells offline is unlimited and
  free — but it is also pointless: it yields locations with no link to any
  person or incident. The privacy loss is confined to codes that were actually
  shared, which is the whole loss and is permanent.
- **The UI must never let a permanent code look like an expiring one.** This is
  a real safety requirement, not polish, and it is the substance of ticket C7.

Session codes remain the primary path. Offline codes are the fallback for no
signal, and the trade should be made deliberately and visibly every time.

---

## 5. `open` mode is insecure by construction

Not "less secure". Insecure, deliberately, and it is the default in the
reference config — which is a footgun and should be reconsidered.

In `open` mode:

- Any caller may resolve any code. No credential, no identity.
- Claim-on-read is **disabled**, so there is no anti-harvest control.
- There is no resolver identity, so the audit log cannot attribute anything.
- Combined with the absence of rate limiting (B7), the resolver is **genuinely
  enumerable** — the §2 table applies with no mitigation whatsoever. At 1,000
  requests/second against 10,000 live sessions, that is ~25 people's locations
  per day, for the cost of one rented machine.

It exists so demos work without key distribution. It must not be used for
anything real. `apikey` is the documented default for any deployment carrying
genuine sessions, and a node in `open` mode should be loud about it in health
output, console banners, and logs.

---

## 6. Checksum: what it guarantees and what it misses

**Guaranteed:** every single-symbol substitution is detected. Provably, at any
code length. The check symbol is `Σ (2i+1) · value[i] mod 32`; an odd weight is
coprime with a power-of-two modulus, so changing one symbol always changes the
result. Verified empirically at 4,960,000 substitutions across random codes:
**0 undetected.** This is the dominant real-world failure — a dispatcher typing
what they misheard — and it fails closed, giving "that code has a typo" rather
than a confident pin somewhere wrong.

**Not guaranteed: adjacent transposition.** Swapping neighbouring symbols shifts
the sum by `(weight_i − weight_j) · (v_i − v_j)`. Odd minus odd is even, so the
scheme cannot catch every transposition; specifically, swapping two adjacent
symbols whose values differ by **exactly 16** is undetected.

The size of the gap:

- Analytically, ordered adjacent pairs with a difference of exactly 16 are
  32 of 992 distinct-value pairs = **3.23%**.
- Empirically, over 135,607 adjacent transpositions on random valid codes,
  4,252 passed the checksum = **3.14%**.

So roughly 1 in 32 transposition errors survives, and produces a code that looks
valid. **In an emergency context that is a real failure mode, not a rounding
error.** The honest defence is not that the residual is small but that the
error class is rare: transposition requires hearing both symbols correctly and
entering them out of order, whereas mishearing one symbol over a degraded line
is the common case and is caught 100% of the time. Chunked display
(`X7K9-P2Q4`) and phonetic rendering both push further against transposition, in
the presentation layer rather than the code.

**The tradeoff we took:** catching both classes needs a Damm quasigroup — a
32×32 table that must be reproduced exactly in every reimplementation, in every
language, with no way to derive it from first principles. This protocol is meant
to be reimplementable from a page of arithmetic. We judged that a scheme people
can actually get right beats a stronger scheme they get subtly wrong, and spent
the complexity budget on the scramble instead, which converts an
undetected error into an *obviously* wrong answer in a different country rather
than a plausible one 200m down the road. Subtle-but-plausible is the dangerous
failure; that is the layer doing the work when the checksum misses.

This is a judgement call and a reasonable person could take the other side. If
this protocol were ever deployed at scale, revisiting it with real transcription
error data from actual dispatch would be the right move.

---

## 7. Other exposures, briefly but honestly

**The voice channel is unprotected and always will be.** The code is read aloud.
Anyone in earshot, on the line, or listening to a recording has it. Nothing in
the protocol can help; TTL is the only limit on the damage, and it does not
apply to offline codes at all.

**`updateToken` handling.** Returned once, stored only as a SHA-256 hash,
compared in constant time, and kept out of URLs by putting it in the request
body — including on `DELETE`, which is unusual and is done to keep it out of
access logs, proxy logs and browser history. It is not rotatable and there is no
revocation short of deleting the session. A leaked token lets an attacker move a
dispatcher's pin, which is worse than deletion.

**Transport.** Everything above assumes TLS. There is no application-layer
confidentiality; a plaintext deployment exposes both codes and coordinates
wholesale. HTTPS is also a hard functional requirement, since browser
geolocation needs a secure context.

**Operator access.** The node holds plaintext coordinates for the life of each
session. There is no end-to-end encryption and the operator can read everything
live. This is a deliberate trade — a dispatcher must be able to resolve a code
without the sharer's involvement, which forecloses E2E — and it means the threat
model rests on TTL and on trusting the operator. Compelled disclosure is limited
by retention, which is limited by TTL, which is why B2 matters beyond tidiness.

**`GET /health` leaks `liveSessions`.** That is `N`, the numerator of the hit
rate. An attacker who can poll it learns exactly how favourable enumeration
currently is, and can time an attempt for peak load. Exposed anyway because
operators need it and it does not help locate any individual code; drop the
field if that trade is wrong for a given deployment.

**Logging.** Application logs record codes and outcomes, never coordinates, and
the audit sink must keep that property (B8, with a test asserting it). A code in
a log is a live capability until it expires — log retention longer than TTL
quietly extends the exposure window.

---

## 8. What we chose not to solve

**No federation, no issuer prefix.** "Anyone can host a resolver node" requires
answering "which node do I ask?", which needs a registry — and a registry is a
governance problem wearing a technology costume. Who runs it, who is admitted,
who is removed, and under what authority are not questions a codec can answer,
and pretending otherwise would produce a spec that cannot be deployed. The usual
counter-argument, that you should reserve a prefix now to keep migration
possible later, does not apply: codes live 30 minutes, so there is never an
installed base and format migration is permanently free.

**A session code needs connectivity to mint.** This is the protocol's worst
structural weakness and the axis on which what3words genuinely wins — a
what3words address can be read off a cached map with no signal at all, whereas a
session code requires a successful round trip to a resolver at the exact moment
someone is in trouble, which is disproportionately likely to be somewhere with
poor coverage. Offline codes are the answer and they are a real one, but they
are a *lesser* answer: permanent, unrevocable, no live tracking, no note, no
third-party flag. We did not solve this. We contained it.

**No end-to-end encryption.** See §7. Forecloses the primary use case.

**No position attestation.** There is no proof the reported location is real.
Adding one needs either hardware attestation (excludes most devices) or a trust
authority (see the federation problem). `source` and `subject` are provenance
hints for a human to weigh, nothing more.

**No transposition-complete checksum.** See §6.

**We do not replace AML, and we do not try to.** Advanced Mobile Location is the
correct primary channel for emergency location: OS-level, zero interaction,
automatic on call connection, mandatory on phones sold in the EU, and requiring
nothing whatsoever from a caller who may be unable to operate a phone at all.
Every property of this protocol is worse than AML on the path AML covers.

This exists for the gaps AML *structurally* cannot fill:

- **third-party reporting**, where the caller is not at the incident — AML sends
  the caller's position by construction, so it cannot express this at all;
- **live tracking** of a moving casualty after the initial fix;
- **non-call channels** — text, relay, a third party on a different continent;
- **the fallback slot currently occupied by what3words**, which is the
  substitution actually being proposed here.

Anyone claiming to replace AML is selling something. See `docs/COMPARISON.md`.

---

## Summary of known weaknesses

| Weakness | Status |
|---|---|
| Rate limiting absent — resolver is genuinely enumerable | ⬜ B7, not built |
| Expiry is a sweeper over memory, not structural | ⬜ B2, not built |
| Audit log not yet a separate append-only sink | ⬜ B8, not built |
| `open` mode has no auth, no claiming, no attribution | By design; must not be used for real deployments |
| Offline codes permanent and unrevocable | Unavoidable; inherent to content addressing |
| ~3% of adjacent transpositions undetected | Accepted tradeoff (§6) |
| Session minting requires connectivity | Structural; contained, not solved |
| Operator sees plaintext coordinates | Deliberate; no E2E possible |
| Store timing side channel on `404` | Unmeasured; open |
| `liveSessions` discloses `N` | Accepted; drop the field if unwanted |
| Voice channel unprotected | Out of scope for any protocol |


---

## Live rooms (22 Aug 2026) — accepted-for-POC exposures, deliberately open

Multi-party live sessions shipped as a POC with these KNOWN exposures,
deferred on purpose (source: `specs/live-sessions-build-plan.md` §5), so
that deferral never becomes forgetting:

1. **The code now grants presence and write access**, not just read — anyone
   holding it can join the room, appear as a participant, draw, and place
   markers. Future: owner approval of joins, per-participant tokens.
2. **Nothing binds a joiner to an identity** — any joiner can claim any name
   and any position; pins other than the owner's are unauthenticated claims.
3. **Enumeration now finds rooms, not just positions** — the WS upgrade path
   needs to join the rate-limit story.
4. **Room state is single-instance, in-memory** — fine on one Render node,
   breaks on scale-out.
5. **No abuse controls on drawings/markers beyond size and rate caps.**

---

## Live v2 + push (22 Aug 2026) — chat, trails, zones, extend, push

Live v2 (`specs/live-v2-contract.md`) widens the surface: in-session chat,
named zones with enter/leave/reached events, per-participant trails, avatars,
multiple markers, session extend over REST, and Web Push. The five POC
exposures above all still stand, and the first now covers more — the code
grants presence and write access, and that write access now includes chat,
zones, and marker lists. As with the rest of this document, this describes
the contract, not necessarily what is deployed on any given day.

### The logging rule first, because it covers everything below

Live v2 introduces four new kinds of user content — chat bodies, zone names,
trails, avatars — plus push endpoints, which are identifiers rather than
content. **None of them may ever reach a log**, joining coordinates under the
rule in §7. Enforcement is the B8 trick applied by construction: the audit
event type has **no content field at all**, so a leaked chat body is a
compile error, not a code-review catch. A rule that relies on every future
contributor remembering it is not a rule; a type that cannot express the leak
is.

### Chat

Message bodies are user content relayed through the server in plaintext
(transport is TLS, §7; there is no E2E, §8, and the same reasoning applies).
The server keeps a capped ring (`MAX_CHAT_HISTORY`, 50) in room memory so
late joiners get context; it dies with the session and is never written to
any store. Two consequences worth stating:

- **A late joiner sees prior chat.** Anyone who obtains the code mid-session
  reads what was said before they arrived. That is the same trust boundary as
  the room itself — the code is the capability — but it makes chat
  room-scoped, not moment-scoped: participants should assume everything they
  type is visible to whoever holds the code, for the life of the session.
- **Abuse containment is structural, not moderated.** No report button, no
  filter, no operator. The containment is that rooms are small, participants
  joined knowingly via a code or link from someone they are coordinating
  with, messages are truncated at `MAX_CHAT_TEXT_CHARS` (500) and rendered as
  text only, and everything expires with the session. For an ephemeral
  emergency tool that is judged sufficient; for anything longer-lived it
  would not be.

### Trails and zone events — the escalation from position to history

The item in this batch that changes the shape of what the room holds. Until
v2 a position was transient: the latest fix, overwritten by the next. A
trail is **in-session movement history, shared with the whole room** — where
each participant has been, not only where they are — and zone events
(`entered` / `left` / `reached`) are derived, more legible summaries of the
same thing: the server now announces where people are relative to *named*
places.

The mitigations are bounds and lifetime, not access control:

- Trails are capped at `MAX_TRAIL_FIXES` (20) per participant and delivered
  in the welcome roster only; the event ring is capped at
  `MAX_EVENT_HISTORY` (50).
- Everything lives in room memory and dies at expiry. No store, no export,
  nothing survives a cold start.
- Participants joined knowingly, by presenting the code or following the
  share link. Nobody's movement is retained who did not enter the room.
- None of it reaches logs (the rule above).

Defensible — bounded, ephemeral, consensual — but call it what it is: the
room now holds a short movement history of everyone in it, and anyone
holding the code holds that too. Detection running server-side adds no new
data at rest, since positions already flow through the relay; it adds
interpretation.

### Zones

A zone name is user content attached to a location — "the weir", "back
gate" — which is exactly the pairing the logging rule exists for. Names are
capped (`MAX_ZONE_NAME_CHARS`, 60), fanned out to the room, retained in room
memory, and never logged.

⚠️ **Zone create and remove are open to any participant** — any joiner can
name a place, and any joiner can delete anyone's zone. That is the POC write
posture (exposure 1 above) extended to a new object type, accepted with the
same eyes open: a malicious joiner can vandalise the shared picture, as they
already could with drawings and markers. Per-participant write control is
future work, not a v2 property.

### Push subscriptions

A `PushSubscription` endpoint URL is a routable, per-device identifier —
quasi-PII, closer to a device serial than to content. The handling:

- **Stored under the session's Redis TTL**, so the same structural expiry
  that ends the session ends the ability to notify: an expired session
  *cannot* ping anyone, by construction rather than by cleanup job. Extend
  bumps this TTL with the rest.
- **Payloads say that something happened and which session — never
  positions, chat bodies, or zone names.** The interesting data stays behind
  the code; the push is a knock, not a message. This is by design, not an
  optimisation, and it is what keeps the push path off the list of places a
  location can leak.
- **Endpoints are never logged** (the rule above).
- Subscribing requires only the code — the same POC posture as joining the
  room. The cap (16 per session) drops silently at the limit, returning the
  same `204`, so the cap is not a probing oracle.

One honest residual: Web Push routes through a third party (FCM, APNs,
Mozilla's autopush). Payloads are encrypted to the browser (RFC 8291), so
the push service reads nothing — but it observes timing and volume, which is
metadata about when a session is active. Accepted; that is how the platform
works.

### Extend, and the rejected restart-same-code

**Extend is safe because it moves a deadline that has not yet passed.** The
owner authenticates with the `updateToken` (hashed, constant-time, wrong
token → the uniform `404` of §2), the *stated* expiry changes before it is
reached, the dispatcher sees the new `expiresAt` on resolve, and the room is
told via an `expiry` fanout. Nobody is relying on the old deadline in a way
the change betrays.

It does weaken §2's TTL argument at the margin, and that should be said
plainly: minting clamps lifetime to 60s–4h, and extend raises the achievable
lifetime to a **cumulative 24 h cap** (`createdAt` → `expiresAt`, clamped at
the endpoint; at the cap `expiresAt` comes back unchanged). A code spoken
aloud can now be live for a day, not an afternoon. The cap is the control —
without it, "extend" decays into "permanent code", which would put session
codes on the wrong side of §4's own criticism.

**Restart-same-code is rejected, and the rejection is a decision of
record.** The proposal — after expiry, re-mint the *same* code for a new
session — fails the threat model on its face: expiry is the only limit on
the voice channel (§7), and restarting **re-arms a code that was spoken
aloud in public**. Anyone who overheard it, wrote it down, or has it in a
call recording gets a second window into a fresh session they were never
part of. Binding restart to a logged-in account does not help:
**account-binding limits who can trigger the restart, not who can exploit
the re-armed code.** The legitimate story is already served by share
history + resume, which re-shares the same content under a fresh code and
costs the attacker everything. If a concrete need ever appears, it reopens
here first — this section is the record of why the answer was no.

### Avatars

A small user-supplied image, relayed to everyone in the room. Containment is
at the edges: format-locked by pattern to `data:image/(png|jpeg|webp)` — no
SVG, so no script-bearing image format — and capped at `MAX_AVATAR_CHARS`
(10,240). Anything failing either check is **dropped silently, never a
reason to refuse the join**: an avatar is decoration, and a join must not
fail over decoration. The residual is content, not code — a joiner can show
the room an offensive image, contained the same way as chat: small rooms,
known joiners, session expiry. Avatars are never logged.

### Summary of new weaknesses

| Weakness | Status |
|---|---|
| Chat, zones, markers writable by any code-holder | POC posture (exposure 1 above); per-participant control is future work |
| Room retains movement history (trails, events) | Accepted: bounded, in-session only, dies at expiry, never logged |
| Cumulative lifetime now up to 24 h via extend | Accepted; the cap is the control — no permanent codes |
| Restart-same-code | **Rejected** — re-arms an overheard code; recorded above |
| Push service sees traffic timing/volume | Accepted; payloads encrypted and content-free by design |
| Offensive chat/avatar content | Accepted for POC: capped, ephemeral, small known rooms |
