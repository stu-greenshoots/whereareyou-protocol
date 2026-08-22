# Epic A — Protocol

The `@whereareyou/protocol` package is the actual deliverable of this project.
Everything else is a reference implementation of it. It stays **zero-dependency
and isomorphic** so that someone implementing the protocol in another language
can read one file and port it.

---

## A1 — Repo scaffold ✅ done

npm workspaces (not pnpm — lowest common denominator, no install step, matters
for something people will clone), TypeScript 5.7 with `strict` plus
`noUncheckedIndexedAccess`, vitest, fast-check.

**Done when:** `npm install && npm test` works from a fresh clone.

---

## A2 — Code codec ✅ done

`X7K9-P2Q4` — 7 random Crockford base32 symbols + 1 check symbol.

**Delivered:**
- `alphabet.ts` — Crockford base32, input aliases (O→0, I/L→1)
- `checksum.ts` — odd-weighted mod-32 sum
- `phonetic.ts` — NATO rendering and spoken-input parsing
- `code.ts` — generate, parse, validate, format
- `types.ts` — wire types
- 15 tests, property-based via fast-check

**Design decisions worth not re-litigating:**

*Why 7 random symbols.* 32^7 = 34.4 billion. With 10k live sessions that is
~1 in 3.4M per guess. Six symbols would be 1 in 107k — roughly eight harvested
emergencies a day at 10 req/s. Do the multiplication; "it's a big random space"
is not analysis.

*Why the 8th symbol is a checksum, not more entropy.* Dispatcher mistyping is
the likely failure; enumeration is only the adversarial one. The check symbol
buys more real-world safety per character.

*Why all checksum weights are odd.* 32 is a power of two, so an odd multiplier
is coprime with the modulus — meaning **every single-symbol substitution is
caught**, provably, with no exceptions. Documented limitation: adjacent
transposition of symbols exactly 16 apart is undetected (~3% of transpositions).
Catching both classes needs a Damm quasigroup; not worth it.

*Why phonetics are a separate layer.* Crockford solves a screen problem (0/O,
1/I/L). The voice problem is the E-set — B/C/D/E/G/P/T/V/Z all rhyme — and no
alphabet choice fixes it. Compact on the wire, verbose in the mouth.

---

## A3 — OpenAPI 3.1 document ⬜

Machine-readable spec at `packages/protocol/openapi.yaml`, covering the five
endpoints in Epic B.

**Acceptance criteria:**
- [ ] Validates against the OpenAPI 3.1 meta-schema in CI
- [ ] Every error response documents `ProtocolErrorCode`
- [ ] Explicitly documents that `not-found` covers *never existed*, *expired*,
      *revoked* and *claimed by another resolver* — and says why collapsing
      them is deliberate, so no future implementer "helpfully" splits them
- [ ] Exported from the package so implementers get it via npm

**Note:** write this *after* B1–B5 exist, not before. The spec should describe a
thing that works, not predict one.
