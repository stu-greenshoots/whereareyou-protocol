# Word codes — a memorable sentence for the offline code

_Design + status + handoff. Last updated 24 Jul 2026._

## Status & handoff — read this first

**Where we are:** the **offline** code becomes a short, memorable, self-checking
**sentence**; the **live/share** code is unchanged (letter code + NATO). We have
a **working, verified UK prototype** and a **map demo**. The mechanism is done
and the word lists have been through four curation passes. Sentences now read
like *"Wee steam follows grey princess."* **Next: Stu eyeballs the
lists / demo, then the read-aloud trial (`docs/WORD-CODES-TRIAL.md`), then port
the UK codec into `src/` and wire into the offline web screen.**

**Spelling-difficulty pass (24 Jul 2026): done.** Stu spotted words that were
common-ish and "regular" spelling but not actually simple (perfumed, lozenge,
vacuums, minnow, engrossed, varnishes, crabgrass, croquette, applauds) —
fixed via a tightened irregular-double-letter/loanword-ending heuristic plus
an everyday-speech-frequency check on nouns (same idea as the ADJ frequency
window). Also turned up genuine safety misses unrelated to spelling ("labia",
"behead", medical terms like cowpox/lockjaw, violence-adjacent terms like
hogtie/barbwire) — now in the permanent exclude sets. Final: adj 349, nouns
1409, verbs 549, capacity 2^36.46 ≥ grid 2^36.45. Full detail in
`prototype/uk-sentence/README.md`.

**Syllable cap (24 Jul 2026): done.** Every word in every list is now <=2
syllables (mechanical `syllables()` heuristic in `curate.mjs`), so the
sentence reads faster and rolls off the tongue more easily — a strict
1-syllable-only list was checked and isn't capacity-feasible (~2^33 max vs the
grid's 2^36.45 needed). Full rationale in `prototype/uk-sentence/README.md`.

**Fuzzy typo matching (24 Jul 2026): done.** Typing back a sentence now
tolerates spelling slips — each word fuzzy-matches to the nearest list entry
(edit distance <=2) before the checksum runs, so "snowarop" still resolves to
"snowdrop" instead of just failing. Correctly-spelled words from the *wrong*
slot (e.g. after a word-swap) are deliberately excluded from fuzzy-matching —
otherwise word-swap detection quietly dropped from 100% to 99.968% (caught by
measuring, not assumed). Typo tolerance measured at ~92%; all three original
detection guarantees remain 100%. Full detail in
`prototype/uk-sentence/README.md`.

**Simplicity pass (23 Jul 2026): done.** Stu flagged that the 22 Jul lists were
still too literary — *"Medieval starch garnishes crooked flute"* — words like
"medieval", "garnishes", "crooked" don't read as common vernacular even though
the 22 Jul pass had already screened for safety. Root cause: nouns had a
frequency window from the start, but adjectives were an unwindowed hand-picked
keep-list and verbs an alphabetical seed — neither had a commonness signal, so
both drifted toward rare/formal words. Fix: adjectives now get the same
frequency-window treatment as nouns, scored against everyday spoken-English
frequency (`en_50k.txt`, OpenSubtitles-derived — closer to "words people
actually say" than book-corpus frequency), then a hand-drop list removes the
register-wrong survivors frequency alone can't catch (comparatives, medical/
body/identity/political words, literary/period words). Verbs went the
opposite way — their 3rd-person `-s` form is inherently rare in that corpus
even for dead-simple verbs ("mows"/"tidies"/"glues" all rank outside the top
50k) — so the verb list is hand-authored from everyday-action categories
(cooking, cleaning, crafting, gardening, movement, care) instead of
frequency-gated. This pass also caught several safety gaps the 22 Jul pass
missed (pregnant, wounded, stranded, colored, military, oriental, albino, and
others), now added to the categorised exclude sets. Final: adj 390, nouns 1553
(unchanged), verbs 475 — capacity 2^36.71 vs grid 2^36.45 (~18% headroom, up
from ~3.5%). Round-trip and detection re-verified at 100%; see
`prototype/uk-sentence/README.md` for full detail and how to change a word.

**The demo:** `prototype/uk-sentence/index.html`, served locally
(`python3 -m http.server 8899` from that dir → http://localhost:8899). Click a UK
map point → a five-word sentence; type one back → it resolves or is rejected.

**What's real vs superseded:**
- ✅ **Current direction — UK 5-word headline sentence** (`prototype/uk-sentence/`):
  *"Orderly lark sweeps full pedestal."* — UK-scoped, ~3 m, 100% error detection.
  Verified. This is what the demo runs.
- ⚠️ **`src/sentence.ts` + `src/wordlists/` on this branch are the EARLIER design**
  — a *global, grammatical, ~6-content-word* sentence ("The … the … by the …")
  that proved **too long** (~12 spoken words). Tests pass (38/38) but it is
  **superseded**. Keep for reference or rework; the demo does **not** use it.

**Word-list quality pass — DONE (22 Jul 2026).** The old auto-curated lists
("Adrenal winery pulls balmy stewpot", plus real horrors: "fucking" in the
adjectives, US spellings that break UK dispatcher typing, homophone traps) are
replaced by hand-curated lists built in
**`prototype/uk-sentence/curation/curate.mjs`** — explicit, auditable drop/add
sets over the Brysbaert/Warriner pools. Veto or add a word by editing those
sets and re-running. Superseded by the 23 Jul simplicity pass and 24 Jul
syllable cap + spelling-difficulty pass (see above) — current final: adj 349,
nouns 1409 (prime), verbs 549, capacity 2^36.46 ≥ grid 2^36.45; all detection
guarantees re-measured at 100%.

**Do NOT change without care** (from the README): `nouns.length` must stay prime
and the largest list; capacity `adj²·nouns·verbs ≥ 2^36.5` or precision drops
below 3 m (`gen-uk-codec.mjs` throws if the grid stops fitting).

---

## The decision

**Only the offline code becomes a sentence. The live/share code stays as it is —
the 8-character code read aloud in NATO.**

- **Share code ("I'm here now").** A pointer to a live server record; used once,
  then gone in ~30 min. Memorability buys nothing; its job is reliable one-shot
  delivery, which the short checksummed NATO code already does. Like a postcode.
  **No words here.**
- **Offline code ("this spot, forever").** The no-signal fallback. Permanent, so
  memorability pays off, and words are *safe* here because of the scramble. **This
  is where the sentence lives.**

Why the split is right, in one extra line: turning a code into words *weakens* the
single-error guarantee unless you add a check word — fine on the offline fallback,
not something to risk on the safety-critical live path.

## Current design — the UK 5-word headline sentence

Frame: **`[Adjective] [noun] [verb] [adjective] [checknoun].`** — singular, no
articles, no plurals. e.g. *"Orderly lark sweeps full pedestal."*

- **Four payload words carry the location; the fifth (a noun) is the checksum.**
  The check is computed from the other four over a **prime modulus** (= the noun
  list length), so **every single misheard word and every word-swap is caught**.
- **UK-scoped, ~3 m.** A box over Britain at 3 m is ~36.4 bits; four clean,
  phonetically-distinct words hold ~37.4, so it fits. (Global would need ~45 bits
  — see "Going global" below.)
- **Scramble:** the grid index is run through a reversible multiply-mod-N before
  becoming words, so neighbouring 3 m cells get unrelated sentences — the
  what3words "one slip lands you nearby" failure is absent by construction.

### Why five words, and why not fewer (measured)

A location is just bits: **UK 3 m ≈ 36 bits; global 3 m ≈ 46 bits.** A clean,
distinct, singular word carries ~9–11 bits.

- **4 words, no check word** → no room for the checksum → only **~19%** of misheard
  words caught (measured). That *is* the what3words failure — rejected.
- **5 words** = 4 for the location + 1 check → **100%** caught. This is the floor
  for "3 m + UK + provably-safe + non-confusable words." Fewer words means giving
  up one of those.
- Five *feels* long only because the current words are awful. Clean words make
  five feel effortless (what3words' three feel short because they're clean). **The
  lever for "shorter-feeling" is word quality, not word count.**

### How what3words does 3 m in 3 words

They use a ~40,000-word list (~15 bits/word), so 3 words ≈ 46 bits ≈ global 3 m.
That huge list is exactly why their words are confusable — the flaw we avoid. We
trade two extra words for a checksum + distinct words, and get error-catching they
structurally cannot.

## What's verified (measured, not asserted)

On the UK prototype (`gen-uk-codec.mjs` self-test + browser check):
- **Round-trip:** 0 fails / 20,000 clicks; worst ~2.2 m from the click.
- **Single-word detection:** 100.0000% (0 / 100,000).
- **In the browser:** click → sentence → 3 m round-trip; a mistyped word triggers
  *"That doesn't look right — read it again"* instead of a wrong location.

## What the user sees

**Offline / no-signal screen:** the sentence leads ("OFFLINE CODE — READ THIS
ALOUD"), with the letter code + lat/long demoted to the fallback panel.
**Live / share screen:** unchanged — big `4Y8E-3TY7`, NATO breakdown.

## The word-list curation (done — how it works now)

- **Lists:** `prototype/uk-sentence/{nouns,adjectives,verbs}.json` (nouns 1409
  prime, adj 349, verbs 549, all words <=2 syllables) — generated by
  `prototype/uk-sentence/curation/curate.mjs`, which layers hand-curated
  drop/add sets (with per-category rationale comments) on top of the
  Brysbaert/Warriner candidate pools. **To change words: edit the sets there,
  re-run, then re-run `gen-uk-codec.mjs` + `build-map.mjs`.**
- **Criteria enforced:** concrete & picturable, common, neutral-to-positive,
  3–9 letters, UK spelling only, phonetically distinct within each slot
  (consonant-skeleton + edit-distance prune), no homophones across any slot,
  and no words that could read as part of a real 999 call — no people/body
  parts/vital signs, no injury/rescue/hazard/wayfinding vocabulary, nothing
  charged or embarrassing read aloud.
- **Then:** the read-aloud trial (`docs/WORD-CODES-TRIAL.md`) — real voices, the
  one test code can't run for us.

_Note: `docs/wordlist-build-stats.md` and `docs/wordlist-review-notes.md` describe
the **earlier** global grammatical lists, not the current UK lists — treat as
historical._

## Going global (parked — one extra word)

Global 3 m needs ~10 more bits than UK ≈ one more word. Make the **first word a
region name** ("Scotland — orderly lark sweeps full pedestal"): a ~1,024 equal-area
region list carries the extra bits, the rest encode the local spot. UK build = 5
words; global build = 6. Nothing here gets rewritten — it's a strict superset. The
region word also gives a human sanity-check (wrong country = obviously wrong).

## Parked idea — draw-on-map for the SHARE code

Let the sharer sketch on their map (the entrance, the route from the station) and
have it ride along with the session so the dispatcher sees it. Natural fit: the
share code points to a server record, so a drawing is just more data in it — no
code-length cost — and it's a capability only the online code can have (an offline
code *is* the location; it can't carry a route). Tracked in `docs/TODO.md`.
