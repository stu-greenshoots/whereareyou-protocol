# Comparison

An honest comparison of this protocol against AML, what3words, Plus Codes and
raw latitude/longitude.

Two things to establish before anything else, because they frame everything
below:

1. **AML is the correct primary channel for emergency location, and this does
   not replace it.** Anyone claiming to replace AML is selling something.
2. **A session code needs connectivity to mint. A what3words address does
   not.** That is the axis on which this protocol most clearly loses, and it is
   not a small one.

Everything that follows should be read with those two sentences in force.

---

## The axes that matter

The question is not "which scheme is best". These things do different jobs and
fail in different circumstances. The question is what each one is *for*.

| | AML | what3words | Plus Codes | Lat/long | This |
|---|---|---|---|---|---|
| Needs no user action | ✅ | ✗ | ✗ | ✗ | ✗ |
| Share side works offline | ✅ | ✅ | ✅ | ✅ | offline code only |
| Resolve side works offline | n/a | ✗ | ✅ | ✅ | offline code only |
| Needs no app | ✅ | ✗ | ✅ | ✅ | ✅ (browser) |
| Error detection | n/a | ✗ | ✗ | ✗ | ✅ |
| Where a single typo lands | n/a | **nearby** | **nearby** | anywhere | **rejected** |
| Speakable over a bad line | n/a | ✅ | ✗ | ✗ | ✅ |
| Memorable | n/a | ✅ | ✗ | ✗ | ✗ |
| Expires | ✅ | ✗ | ✗ | ✗ | session only |
| Revocable | n/a | ✗ | ✗ | ✗ | session only |
| Live tracking | ✗ | ✗ | ✗ | ✗ | ✅ |
| Third-party reporting | ✗ | ✅ | ✅ | ✅ | ✅ |
| Open specification | n/a | ✗ | ✅ | ✅ | ✅ |
| Existing tool support | ✅ | partial | ✅ | ✅ | ✗ |
| Deployed installed base | ✅ | ✅ | ✅ | ✅ | **none** |

The last row is not a technicality. Every other scheme in this table is in
production somewhere and this one is not. That is the single biggest practical
argument against it and no amount of design quality offsets it.

---

## The measured result

The strongest evidence in this project is a single experiment, run against real
Plus Code and offline-code implementations.

### Plus Codes have no error detection at all

**Every single-character typo of a Plus Code produces a still-valid Plus Code:
209 out of 209 tested.** Not most. All of them. There is no checksum in the
format, so there is nothing that *could* reject a corruption — a mistyped Plus
Code is simply a different, equally legitimate Plus Code.

Of the 209, **196 decoded to a position**. Of those 196:

- **44 landed within 100 metres** of the original (22.4%)
- **73 landed within 1 kilometre** of the original (37.2%)
- **the closest wrong answer was 2 metres away**

That last figure is the one that matters. Two metres. A dispatcher who mistypes
one character can be handed a location two metres from the right one — or, just
as easily, 400 metres away — and the system will report success with full
confidence either way. There is no signal that anything went wrong, because from
the format's point of view nothing did.

The near-misses are not bad luck. They are structural: Plus Code prefixes encode
progressively finer subdivisions of the same area, so changing a character
towards the end of the code moves you a short distance within the same cell. The
locality that makes Plus Codes pleasant to work with — nearby places have
similar codes, and you can truncate one to get a coarser area — is exactly the
property that makes a typo land nearby.

### The same sweep against an offline code

**All 310 single-character corruptions of a whereareyou offline code were
rejected.**

Both sweeps are exhaustive rather than sampled, which is worth spelling out so
the 100% figures are not mistaken for a small-sample artifact: 310 is every one
of the 10 character positions against each of the 31 alternative base32 symbols,
and 209 is every one of the 11 positions of a Plus Code string against each of
the 19 alternative symbols in its 20-character alphabet. Each result is complete
for the code it was run against.

The mechanism is not clever, it is just present: the final character is a
checksum with odd positional weights over a power-of-two modulus. An odd
multiplier is coprime with 32, so a single-symbol substitution cannot leave the
sum unchanged. This is provable rather than statistical and it holds at any code
length (see `docs/THREAT-MODEL.md` §6, including the transposition case it does
*not* cover, which is ~3% of adjacent transpositions).

The dispatcher outcome differs completely. Plus Code: a confident pin, possibly
2m away, possibly 400m away, with no way to tell which. Here: *"that code has a
typo, please read it again."*

**This is not an argument that Plus Codes are badly designed.** They were
designed as an interchange format, and interchange formats travel through
copy-paste and URLs, where single-character corruption is not the dominant
failure. Judging them by voice-channel criteria is judging them against a
problem they never claimed to solve. The argument is only that they should not
be used in the fallback slot on an emergency call, which is a use they were not
built for.

---

## what3words

### What it gets right

Three memorable words are genuinely easier to say and to hold in your head than
any alphanumeric string, and that is not a trivial advantage — it is the reason
the format got traction where Plus Codes did not. It works offline on the share
side with a cached app. It handles third-party reporting. It has real emergency
service integrations already deployed, which this protocol does not.

**And it does not need connectivity to produce an address.** Someone with no
signal, standing in a field with the app installed, gets a usable address. A
whereareyou *session* code cannot be minted in that situation at all. Our answer
is the offline code — a real answer, but a lesser one, since it gives up expiry,
revocation, live tracking, notes and the third-party flag.

### Where the safety claim broke

what3words' central safety argument was that confusable addresses sit far apart,
so a mistake is obvious — get a word wrong and you end up in Peru, which nobody
will mistake for a street in Manchester.

Two independent analyses found the claim does not hold as stated.

**Andrew Tierney, writing as Cybergibbons and at Pentest Partners**, reverse-
engineered the address algorithm and found flaws in the linear-congruence
construction used to assign words to grid squares, producing **predictable runs
of similar words** rather than the uniform scattering the safety argument
depends on. Once the structure is known, the "you'd end up in Peru" claim is not
something the design guarantees; it is something it happens to do most of the
time.

**The Montreal AI Ethics Institute**, analysing error behaviour, found a
**better than 1-in-25 probability in some UK cities that a simple typo lands in
the same metropolitan area** rather than thousands of miles away. That is
precisely the dangerous case: a wrong answer close enough to be plausible. A
dispatcher sent to the wrong side of Birmingham does not know they have been
sent to the wrong side of Birmingham.

*(Both are secondary sources cited as reported, not reproduced by us — unlike the
Plus Code figures above, which are our own measurement. Findable at
`cybergibbons.com`, `pentestpartners.com` and `montrealethics.ai`. The Plus Code
experiment is the only measurement in this document that this project ran
itself.)*

### Why the failure was structural

This is the part worth understanding, because it is not a story about
carelessness.

what3words was solving two problems simultaneously: the code had to satisfy a
grid *and* be pronounceable and memorable. Those requirements fight. A 40,000-
word list is a fixed, awkwardly-shaped resource; making the words feel natural
constrains how they can be assigned; and the result is that adjacent squares
ended up with adjacent-sounding words. The safety property was a *hoped-for
consequence* of the construction rather than something imposed on it.

This protocol is not fighting linguistics, so it can simply impose the property.
Offline codes run the grid index through a bijective scramble before encoding,
which guarantees neighbouring cells get unrelated codes by construction. Four
*adjacent* 5m cells:

```
FTSE-MP0F-1M    1XVM-DMWF-NE    3J7R-ZSW5-VG    WN4Z-D0PK-3B
```

Checksum and scramble do different jobs and you want both: the checksum *catches*
the error, and the scramble means anything slipping past lands somewhere
obviously wrong rather than 200m down the road. Subtle-but-plausible is the
dangerous failure.

The honest framing: **we get this for free by refusing the harder problem.** We
gave up memorability, which is a real cost — nobody holds `X7K9-P2Q4` in their
head — and bought a provable safety property with it. That is a trade, not a
demonstration of superior engineering.

### Where else it loses

Proprietary and licensed, with a history of legal action against
reverse-engineering — which is a poor fit for public safety infrastructure,
where the ability to audit the thing your emergency services depend on ought to
be non-negotiable. It needs an app or a website. Its addresses are permanent and
carry no expiry, revocation, or provenance.

That last point applies to us too, and is dealt with plainly below rather than
quietly.

### The privacy property we share

**Offline codes never expire and cannot be revoked.** Anyone who ever sees or
hears one — from a screenshot, a call recording, an incident report, a
photograph of a phone screen — can decode it to a ~5m cell, forever, with no
server and no permission. This is exactly the property criticised in what3words.

It is unavoidable. Content-addressable and revocable are contradictory:
revocation needs state, state needs a server, and a server is what the offline
path exists to do without. **The location *is* the code**, so there is nothing to
take back.

The difference from what3words is scope, not kind. Theirs is permanent by design
for every location on earth and is the primary product; ours exists only as a
fallback for when a session code cannot be minted, and the session code — which
expires by default in 30 minutes — is the intended path. That distinction is
real and it is not an exoneration. See `docs/THREAT-MODEL.md` §4.

---

## Plus Codes

Open, well-specified, no licence, no vendor, offline in both directions, and
already supported in Google Maps and OpenStreetMap. Genuinely good work, and the
existing tool support is an advantage this protocol does not have and will not
have for a long time.

Two weaknesses in the emergency-call context specifically:

**No checksum.** 209/209, as above.

**Poor over voice.** `8FVC9G8F+6W` is not something to read to a stranger on a
bad line under stress. The alphabet is chosen to be unambiguous on a screen, not
in a mouth; there is no phonetic rendering convention; and the `+` has no
natural spoken form.

The right conclusion is a division of labour, not a winner:

> **Plus Codes are an excellent interchange format and a poor voice format. This
> protocol is the reverse.**

Plus Codes travel well between systems because those systems already understand
them. Our codes travel well between *people* because they are checksummed and
phonetically rendered, and travel badly between systems because nothing else
understands them yet.

Which is exactly why both belong in the fallback panel, alongside lat/long and
OS grid. The share screen shows all of them, and that is the correct design
rather than a hedge: the sharer does not know what the receiving system speaks,
so give them every dialect. Removing Plus Codes to make this protocol look
better would make the product worse.

---

## Raw latitude and longitude

The universal fallback, understood by everything, needing no codec and no
vendor, and working entirely offline. It should always be available and this
protocol does not attempt to displace it.

It fails on voice, badly. `51.50809, -0.12789` is fifteen digits, two signs and a
decision about how many decimals matter, with no checksum, no chunking, no
phonetic convention, and multiple competing formats (decimal degrees,
degrees-minutes-seconds, degrees-decimal-minutes) that are easy to confuse and
differ by kilometres when confused. A single mistyped digit is silently
accepted, and depending on which digit, moves the pin by anything from a metre
to hundreds of kilometres.

Its one real advantage over both this protocol and Plus Codes for an error case:
a badly wrong lat/long often lands in the sea or another continent, which is
*visibly* wrong. That is the same argument the scramble makes deliberately, and
lat/long gets it by accident and only sometimes.

---

## AML

**AML is the right answer for the case it covers, and this protocol does not
compete with it.**

Advanced Mobile Location sends a handset-derived position automatically when an
emergency call connects. No app, no interaction, no code to read, nothing
required from a caller who may be unable to speak, unable to see the screen, or
unable to operate a phone at all. It is OS-level on both major platforms and
mandated for handsets sold in the EU. On the path AML covers, **every property
of this protocol is worse** — it needs the caller to act, to read something
aloud, and to be capable of doing so.

A design that requires a frightened person to press a button and read out
characters is strictly inferior to one that requires nothing, whenever the second
is available.

So this exists for the gaps AML structurally cannot fill:

**Third-party reporting.** The strongest case. AML sends the *caller's* position
by construction, so it cannot express "the incident is over there, and I am not
at it" — a witness reporting a crash on the other carriageway, someone calling
about a person on a cliff path, a relative calling from another city. This is not
a gap in AML's implementation; it is what AML *is*. The session code carries a
`subject: third-party` flag precisely so a dispatcher can see the difference
between a casualty and a witness.

**Live tracking.** AML sends a fix at call connection. It does not follow a
moving casualty, a drifting boat, or someone walking to find signal. A session
code can, because it is a pointer to a record rather than an encoded position —
and no coordinate-encoding scheme, what3words and Plus Codes included, can
express this at all.

**Non-call channels.** Text relay, deaf and hard-of-hearing users, a third party
relaying from another country, control-room-to-control-room handover. AML is
triggered by a voice call.

**The fallback slot.** When AML fails or is unavailable — old handset, disabled
location services, carrier or PSAP without support, indoor fix too poor to be
useful — something has to fill the gap, and today that something is often
what3words. **That slot is the substitution actually being proposed here.** Not
AML's slot. The fallback slot.

---

## Where this protocol loses, collected

Scattered through the sections above; gathered here so it cannot be skimmed
past.

1. **A session code needs connectivity to mint.** what3words and Plus Codes do
   not. The moment someone is in trouble is disproportionately likely to be
   somewhere with poor coverage, which is exactly when this weakness bites.
   Offline codes contain the problem; they do not solve it, and they cost expiry,
   revocation, live tracking, notes and the third-party flag.
2. **No installed base.** Nothing supports these codes. Plus Codes are in Google
   Maps; what3words is integrated with real emergency services. Adoption is the
   whole game in this category and this protocol has none of it.
3. **Not memorable.** `X7K9-P2Q4` cannot be held in the head or written on a
   hand the way three words can.
4. **Offline codes are permanent and unrevocable.** The same privacy criticism
   we make of what3words applies to our fallback path.
5. **Session codes add a dependency and a single point of failure.** A resolver
   must be reachable and trusted. Plus Codes and lat/long need nobody.
6. **The operator sees plaintext coordinates.** No end-to-end encryption is
   possible while a dispatcher must resolve a code without the sharer's
   involvement.
7. **~3% of adjacent transpositions are undetected.** The substitution guarantee
   is total; the transposition guarantee is not.
8. **Unproven.** No deployment, no real dispatch data, no measured transcription
   error rates from actual emergency calls. Every claim here is a design
   argument or a synthetic measurement, not field evidence.

---

## Summary

- **Use AML.** It is the primary channel and this does not replace it.
- **Keep Plus Codes and lat/long** in the fallback panel. They are better
  interchange formats than this one and always will be.
- **This protocol's claim is narrow:** in the fallback slot, on a voice call,
  where a frightened person reads characters to a stranger over a bad line, a
  checksummed and phonetically-rendered code fails safe where what3words and
  Plus Codes fail silently — 209 out of 209 versus 310 out of 310, and a closest
  wrong answer of 2 metres.

That is the entire argument. It does not need help.
