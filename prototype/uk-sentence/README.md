# UK offline sentence — working prototype

The current direction for the **offline** code: render a location as a short,
memorable, self-checking sentence. This dir is the working prototype that the
`whereareyou-sentence-tester` map demo runs on. It is **not** wired into the
published package yet — `src/sentence.ts` on this branch is an *earlier,
superseded* design (see `docs/WORD-CODES.md`).

## What it is

A **UK-scoped, ~3 m, five-word headline sentence** with 100% single-word error
detection. Example: *"Orderly lark sweeps full pedestal."*

- Frame: `[Adjective] [noun] [verb] [adjective] [checknoun].` — singular, no
  articles, no plurals (headline grammar).
- **4 payload words carry the location** (adjective, noun, verb, adjective);
  the **5th word (a noun) is the checksum** — computed from the other four over
  a prime modulus, so every single misheard word and every word-swap is caught.
- **UK grid:** bounding box lat 49.8–61.0, lon −8.7–1.9, quantised to ~3 m.
  That is ~36.4 bits; the four clean payload words hold ~37.4, so it fits.
- Reversible scramble (multiply mod grid-size) so neighbouring cells get
  unrelated sentences — the anti-what3words property.

Measured (see `gen-uk-codec.mjs` self-test): round-trip 0 fails / 20 000, worst
~2.2 m from the click; single-word detection 100.0000% (0 / 100 000).

## Files

| File | What |
|---|---|
| `nouns.json` / `adjectives.json` / `verbs.json` | the CURATED word lists — the source of truth the codec is built from |
| `curation/curate.mjs` | rebuilds the lists: data pools → mechanical filters → **hand-curated drop/add sets** (edit these to veto/add words) → phonetic prune → prime trim |
| `params.json` | list sizes, payload bits, frame |
| `gen-uk-codec.mjs` | validates the lists (prime, capacity, dupes), measures round-trip + detection, prints sample sentences, emits `uk-codec.js` |
| `uk-codec.js` | the generated browser codec (`window.UK5.toSentence` / `parseSentence`) |
| `build-map.mjs` | assembles the map demo `index.html` from `uk-codec.js` + fonts |
| `index.html` | the served map demo (click a UK map → sentence; type one back) |

**Word-list quality pass (22 Jul 2026): done.** The lists are curated for: UK
spelling only (a dispatcher who hears "favourite" must be able to type it), no
homophone/near-homophone pairs in any slot (phonetic-skeleton + edit-distance
prune, plus an explicit homophone table), and — the product-specific rule —
**the sentence must never accidentally narrate an emergency**: no people, body
parts, or vital-signs words (body, pulse, breath), no injury/first-aid/rescue
vocabulary (gauze, flare, lifeboat, cliff), no car-crash vocabulary (airbag,
seatbelt), no wayfinding words a caller might say literally (road, river,
north), nothing charged or giggle-inducing on a 999 call. Plus ~150 UK/story
additions (hedgehog, scone, kettle, wonky, portly, dunks, fancies).

**Simplicity pass (23 Jul 2026): done.** The 22 Jul lists still contained
literary/formal words (medieval, glamorous, orderly, cosmic) and kitchen-jargon
verbs (garnishes, chisels) — nouns had a frequency window from the start, but
ADJ was an unwindowed hand-picked keep-list and VERB an alphabetical seed, so
neither had a commonness signal. Fix: adjectives now get the same
frequency-window treatment as nouns (against everyday spoken-English
frequency, `en_50k.txt` — OpenSubtitles-derived, closer to "words people
actually say" than book-corpus frequency), then a hand `ADJ_DROP` removes
register-wrong survivors (comparatives, medical/body/identity/political words,
literary/period words) that a frequency window alone can't catch. Verbs went
the opposite way — their 3rd-person `-s` form is inherently rare in that
corpus even for dead-simple verbs ("mows"/"tidies"/"glues" all rank outside
the top 50k) — so `VERB_POOL` is hand-authored from everyday-action categories
(cooking, cleaning, crafting, gardening, movement, care) instead of
frequency-gated. Also fixed several safety gaps the 22 Jul pass missed
(pregnant, wounded, stranded, colored, military, oriental, albino, and others)
by adding them to the categorised exclude sets. Final: adj 390, nouns 1553
(unchanged), verbs 475 — capacity 2^36.71 vs grid 2^36.45 (~18% headroom, up
from ~3.5%). Detection re-verified at 100%.

**Syllable cap (24 Jul 2026): done.** Stu wanted the sentence to roll off the
tongue faster, so every list is now mechanically capped at 2 syllables (a
vowel-group heuristic, `syllables()` in `curate.mjs`, applied inside `pool()`
plus to the hand-added/VERB_POOL lists). A strict 1-syllable-only list isn't
capacity-feasible — the full candidate pools only hold ~850 one-syllable nouns
and ~180 one-syllable adjectives, capping capacity around 2^33, short of the
grid's 2^36.45 even before safety cuts. Widening `NOUN_WINDOW`/`ADJ_RANK_CAP`
to backfill the words the syllable cut removed pulled in a fresh round of
junk from deeper in the frequency tail (gimpy, legless, scalded, witchy,
POS-tag glitches like "cymbal"/"waterbed" tagged Adjective) — same lesson as
the 23 Jul pass, reviewed and dropped by hand. Verbs needed padding too since
the phonetic-distinctness prune saturates hard once a list gets this dense
with short CVC(C) words (~15-20% of any new short-verb batch clashes with
something already in). Final: adj 356, nouns 1583, verbs 498 — capacity
2^36.54 vs grid 2^36.45 (~6.5% headroom). Round-trip 0/20k, detection 100%/100%
re-verified. To change a word: edit the drop/add sets in `curation/curate.mjs`,
re-run it, then re-run `gen-uk-codec.mjs` and `build-map.mjs`.

**Fuzzy typo matching (24 Jul 2026): done.** `parseSentence`/`parseWords` now
fuzzy-match each typed word to the closest list entry (edit distance <=2,
`fuzzyIndex()` in `gen-uk-codec.mjs`, mirrored in the emitted `uk-codec.js`)
before running the checksum — so a spelling slip ("snowarop") still resolves
("snowdrop"), instead of just failing. Deliberately does NOT fuzzy-match a
word that's a correctly-spelled member of a *different* slot's list (e.g. a
noun landing in the adjective position after a swap) — that's a structural
error, not a typo, and treating it as one dropped word-swap detection from
100% to 99.968% when first tried (measured, then fixed via `ALL_WORDS`
lookup). The checksum still runs exactly as before on the resolved words, so
a fuzzy "correction" that's actually wrong is caught the same way any other
substitution is. Measured: round-trip/single-word/word-swap all still
100%/100%/100%; typo tolerance ~92% (18,395/20,000 resolve despite a random
1-letter typo). Successful fuzzy corrections come back in `result.corrections`
(`[{pos, from, to}]`) — the demo shows "Read 'X' as 'Y' — worth
double-checking" rather than silently substituting.

**Spelling-difficulty pass (24 Jul 2026): done.** Stu spotted more words that
were common-ish and technically "regular" spelling but not actually simple —
perfumed, lozenge, vacuums, minnow, engrossed, varnishes, crabgrass, croquette,
applauds. Two different problems: (1) irregular double letters (vacuum's
"uu") and loanword endings (croquette, baguette, ballet, cello) that a naive
"flag every double letter" heuristic over-flags by 3x (it also flags "happy",
"cool", "bathroom" — completely regular short-vowel doubling and transparent
compounds, not hard at all); fixed by excluding the classic short-vowel+
doubled-consonant pattern and "ee"/"oo" digraphs before flagging. (2) Words
that are technically regular-spelling but just aren't common/simple
vocabulary (perfumed, engrossed) — caught by cross-checking against
everyday-speech frequency (en_50k) the same way ADJ already was, then hand-
reviewing the ~500 lowest-ranked nouns for niche/technical/jargon words
(automotive, construction, tech, cooking-show terms). This pass also turned
up genuine safety misses from earlier rounds that had nothing to do with
spelling — "labia" and "behead" in the noun list, "cowpox"/"lockjaw"/
"backache"/"sickroom" (medical), "hogtie"/"barbwire"/"dogfight" (violence-
adjacent) — now in the permanent exclude sets, not just this pass's drop
list. Final: adj 349, nouns 1409, verbs 549, capacity 2^36.46 ≥ grid 2^36.45.
All detection guarantees re-verified at 100%.

## Constraints the lists MUST keep

1. **`nouns.length` is PRIME** and is the **largest** list — it's the checksum
   modulus, so every payload word index must be `< nouns.length`.
2. **Capacity `adj² · nouns · verbs ≥ 2^36.5`** (UK 3 m). If curation shrinks the
   lists below that, precision drops (coarser than 3 m) — `gen-uk-codec.mjs`
   throws if the grid no longer fits, so watch its output.
3. Singular nouns, not ending in `s`. Transitive verbs, 3rd-person singular.
4. Concrete, common, neutral, **phonetically distinct within each slot**, no
   charged/embarrassing words, no homophones.

## Data sources (re-fetch these; not committed — ~5 MB)

```bash
# concreteness (Brysbaert): Word, Conc.M, Percent_known, SUBTLEX, Dom_Pos
curl -s https://raw.githubusercontent.com/ArtsEngine/concreteness/master/Concreteness_ratings_Brysbaert_et_al_BRM.txt | tr -d '\r' > conc.tsv
# valence (Warriner): col2 Word, col3 V.Mean.Sum (drop < ~5.0 = unpleasant)
curl -s https://raw.githubusercontent.com/JULIELab/XANEW/master/Ratings_Warriner_et_al.csv > warriner.csv
# profanity blocklist
curl -s https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en > badwords.txt
# everyday spoken-English frequency (OpenSubtitles-derived; used to window ADJ
# to genuinely common words — see the 23 Jul simplicity-pass note above)
curl -s https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt > en_50k.txt
```

`gen-uk-codec.mjs` reads `conc.tsv` + `warriner.csv` + a transitive-verb seed and
applies: concreteness ≥ 4.2 (nouns) / 2.6 (adj), valence ≥ 5.0, an `AWKWARD`
blocklist, a phonetic-key within-slot prune. **Edit the thresholds / `AWKWARD`
set there, or hand-edit the JSON lists directly, then regenerate.**

## Regenerate + test

```bash
# from this dir, with conc.tsv/warriner.csv fetched alongside (edit paths at top of the script)
node gen-uk-codec.mjs        # rebuilds lists + uk-codec.js, prints self-test + detection
node build-map.mjs           # rebuilds index.html from uk-codec.js
python3 -m http.server 8899  # then open http://localhost:8899
```

The map demo needs the Atkinson fonts (in the `whereareyou-design` skill:
`assets/fonts/`) and loads Leaflet + OpenStreetMap tiles from a CDN (fine on
localhost; would be blocked in a sandboxed artifact).
