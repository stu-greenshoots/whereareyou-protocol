# @whereareyou/protocol

**Short, checksummed, phonetically-safe location codes for emergency dispatch.**

Zero dependencies. Isomorphic — runs in Node and in a browser. This package is
the reference implementation of the protocol; the spec is the code.

```bash
npm install @whereareyou/protocol
```

---

## The problem

An emergency call is a **voice** channel. Someone frightened has to get a
position to a stranger by reading characters aloud down a bad line. Every
existing option handles that badly:

| | Offline | Checksum | Typo lands |
|---|---|---|---|
| what3words | app required | ✗ | **nearby** — >1 in 25 in some UK cities |
| Plus Codes | ✓ | ✗ | **nearby** — measured: 44 of 196 within 100m |
| Lat/long | ✓ | ✗ | anywhere |
| **This** | ✓ | ✓ | **rejected outright** |

The measured Plus Code figure is worth restating: **every single-character typo
of a Plus Code is still a valid Plus Code.** 209 out of 209. One landed 2 metres
from the original. There is no error detection at all.

## Two kinds of code

```ts
import { generateCode, encodeOffline, interpretCode } from '@whereareyou/protocol';
```

### Session code — 8 characters, `X7K9-P2Q4`

A **pointer**. The location lives in a record on a resolver, so the code can
expire, follow a moving casualty, carry a note, mark a third-party report, and
be revoked. Needs a network.

```ts
const code = generateCode();            // 'X7K9P2Q4'
formatCode(code);                       // 'X7K9-P2Q4'
toPhonetic(code);                       // 'X-ray Seven Kilo Nine Papa Two Quebec Four'
```

### Offline code — 10 characters, `FTSE-MP0F-1M`

**Content-addressable.** The position is encoded into the code itself, so it
works with no connectivity in either direction, forever — and gives up expiry,
live updates and revocation in exchange.

```ts
const code = encodeOffline(51.50809, -0.12789);  // 'FTSEMP0F1M'
decodeOffline(code);                             // { lat, lon, cellSizeM }
```

Both are accepted by one parser, told apart by length:

```ts
interpretCode('x-ray seven kilo nine papa two quebec four');
// { kind: 'session', code: 'X7K9P2Q4' }

interpretCode('FTSE-MP0F-1M');
// { kind: 'offline', code: 'FTSEMP0F1M', position: { lat: 51.50809, ... } }

interpretCode('X7K9-P2Q5');
// { kind: 'invalid', reason: 'bad-checksum', normalised: 'X7K9P2Q5' }
```

---

## Design

### Every single-character error is caught

The final symbol is a checksum with **odd positional weights over a
power-of-two modulus**. An odd multiplier is coprime with 32, so a single-symbol
substitution can never leave the sum unchanged. This is provable, not
statistical — and it holds at any code length.

A dispatcher who mishears gets *"that code has a typo"*, never a confident pin
in the wrong place.

*Known limitation:* odd minus odd is even, so adjacent transposition of two
symbols differing by exactly 16 is undetected — roughly 3% of transpositions.
Catching both classes needs a Damm quasigroup; not worth the complexity when
transposition requires hearing correctly but typing out of order.

### Neighbouring places get unrelated codes

what3words' central safety claim was that confusable addresses sit far apart, so
mistakes are obvious. It failed because they were solving two problems at once:
the code had to satisfy a grid **and** be pronounceable, and adjacent squares
ended up with adjacent-sounding words.

This protocol isn't fighting linguistics, so it can simply impose the property.
Offline codes run the grid index through a **bijective scramble** before
encoding. Four *adjacent* 5m cells:

```
FTSE-MP0F-1M    1XVM-DMWF-NE    3J7R-ZSW5-VG    WN4Z-D0PK-3B
```

Checksum and avalanche do different jobs, and you want both: the checksum
*catches* the error, and avalanche means anything slipping past lands in a
different country rather than 200m down the road. Subtle-but-plausible is the
dangerous failure.

### Compact on the wire, verbose in the mouth

Crockford base32 excludes `I`, `L`, `O` and `U` — that solves a *screen* problem
(`0`/`O`, `1`/`I`). The *voice* problem is different: B, C, D, E, G, P, T, V and
Z all rhyme down a phone line, and **no alphabet choice fixes that.**

So the code stays 8 or 10 characters for machines, and is always *rendered*
phonetically for humans. Both ends accept either form, plus common real-world
variants ("Juliet", "Niner", "Alfa").

### ~5m grid, not 3m

A 3m square is false precision when the underlying GNSS fix is ±10m on a good
day. Sizing the grid to roughly the accuracy of real input is the honest choice,
and the character it saves buys the checksum instead.

---

## API

| Function | Purpose |
|---|---|
| `generateCode(randomBytes?)` | Mint a session code |
| `parseCode(input)` | Parse a session code from permissive human input |
| `encodeOffline(lat, lon)` | Encode a position as an offline code |
| `decodeOffline(code)` | Decode an offline code to a cell centre |
| `parseOffline(input)` | Parse an offline code from permissive input |
| `interpretCode(input)` | Accept either kind, routed by length |
| `formatCode` / `formatOfflineCode` | Group for display |
| `toPhonetic(code)` | Render as spoken words |
| `phoneticFor(symbol)` | Spoken form of one symbol |
| `isValidCode` / `isValidOfflineCode` | Validate including checksum |

All parsers accept spoken, spaced, hyphenated, lowercase and mixed input, and
fold Crockford aliases so a typed letter `O` becomes a zero.

## Implementing this in another language

Everything you need is in five files, in this order: `alphabet.ts`,
`checksum.ts`, `scramble.ts`, `offline.ts`, `phonetic.ts`. The scramble is
deliberately **not** a cryptographic primitive — there is no secret here and
nothing to protect. The grid is public by design; it exists purely for
diffusion, and it must stay simple enough to reimplement from the source.

## Development

```bash
npm install
npm test        # 28 tests, property-based via fast-check
npm run build
```

## Related

- [`whereareyou-api`](https://github.com/stu-greenshoots/whereareyou-api) — reference resolver node
- [`whereareyou-web`](https://github.com/stu-greenshoots/whereareyou-web) — share screen and dispatcher console

## A note on scope

This does not replace AML (Advanced Mobile Location), and anyone claiming to
replace AML is selling something. AML is the correct primary channel for
emergency location: OS-level, zero interaction, mandatory on phones sold in the
EU. This exists for the gaps AML structurally cannot fill — third-party
reporting above all, where the caller is not at the incident — and to replace
what3words in the fallback slot it currently occupies.

## Licence

MIT.
