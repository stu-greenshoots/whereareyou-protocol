# whereareyou wordlist — build stats

> ⚠️ **HISTORICAL** — describes the *earlier* global grammatical lists (nouns
> 1499 etc.), not the current UK 5-word lists in `prototype/uk-sentence/`. Kept
> for reference. Current source of truth: `docs/WORD-CODES.md`.

## Final counts

| list | count | requirement | met |
|---|---|---|---|
| nouns | 1499 | exactly a prime, target 1499 | yes |
| adjectives | 534 | ≥ 256 | yes |
| verbs | 263 | ≥ 256 (transitive, 3sg) | yes |
| adverbs | 124 | ≥ 113 (manner, -ly) | yes |

## Constraints

- **nouns.length = 1499 is PRIME** (usable as checksum modulus)
- **capacity ADJ²·NOUN²·VERB = 534² · 1499² · 263 = 1.6852e+14 = 2^47.26**
- required ≥ 2^45 = 3.5184e+13 → **MET** (2.26 bits of headroom)

## Thresholds & method

**Universal filters (every list):** lowercase alphabetic only, length 3–9, single word; drop badwords.txt (single-token exact); drop Warriner valence < 4.5; drop category blocklist (weapons, violence, death, injury, medical, body parts, drugs/alcohol, religion, crime/police/prison, war/military, gambling/debt, general-alarming, fear-animals, people/roles, bodily); drop homophones/near-homophones (whole groups). Phonetic within-slot pruning: position-preserving phoneme-class code collapsing the E-set (b/p, d/t, c/k/g/q, f/v, s/z, m/n); words with equal code, or differing by exactly one phoneme (codes length ≥ 4), are collapsed keeping the higher-scoring representative.

**Nouns:** Dom_Pos=Noun, Conc.M ≥ 4.3, Percent_known ≥ 0.97, SUBTLEX ≥ 3. Scored to keep both common words and mid-frequency concrete variety, then trimmed to the prime 1499.
**Adjectives:** Dom_Pos=Adjective, Conc.M ≥ 3, Percent_known ≥ 0.97, SUBTLEX ≥ 2, plus extra charged-adjective block.
**Verbs:** curated transitive base list (532 bases, judged to take a direct object), validated as attested words, converted to 3rd-person singular, safety+phonetic filtered.
**Adverbs:** manner adverbs derived from a curated adjective base + attested Dom_Pos=Adverb -ly words with a manner stem; validated, safety+phonetic filtered.

## Cut tallies

**nouns** — shape: 0, badword: 21, homophone: 108, cat: 539, valence: 253, phonetic: 473, trim: 151

**adjectives** — shape: 0, badword: 5, homophone: 15, cat: 63, valence: 168, phonetic: 75

**verbs** — unknown: 10, shape: 4, badword: 1, homophone: 47, cat: 9, valence: 48, phonetic: 150

**adverbs** — unknown: 104, shape: 5, badword: 0, homophone: 10, cat: 2, valence: 46, phonetic: 26

## Random samples (seeded, 40 each)

**Nouns:** barbecue, bell, book, bucket, cashmere, chariot, city, couch, drapery, drums, duck, faucet, flannel, fluid, garden, goblet, groceries, intercom, keyboard, kickoff, leggings, longboat, mat, metal, mouthwash, octopus, pebble, pinkie, potion, rail, rock, seawater, shelving, sleigh, sparks, tub, washcloth, window, workshop, zucchini

**Adjectives:** analogue, blackened, cardboard, crispy, drippy, flowerbed, gentle, glittery, hazel, jeweled, lactated, liquid, lounger, manmade, marbled, movable, olive, outer, paralegal, peaceful, placid, powdered, powdery, rapid, remote, restful, roast, rust, secluded, smooth, soapy, solid, sweet, tabloid, talkative, uncut, unshaven, unwrapped, wet, wheezy

**Verbs:** arranges, balances, borrows, bottles, brushes, captures, cements, corks, covers, dangles, decants, filters, guards, harvests, irons, leashes, lodges, measures, paints, props, pulls, reaps, reheats, rinses, scrubs, sends, shreds, sifts, sketches, slathers, spools, sprays, stirs, stores, straps, sugars, tracks, trains, walks, watches

**Adverbs:** astutely, boldly, bravely, candidly, cleverly, cloudily, clumsily, crisply, daintily, deftly, dumpily, fondly, heartily, humbly, loudly, luckily, moistly, nimbly, oddly, ornately, proudly, quaintly, rigidly, ruggedly, sadly, safely, shaggily, slowly, snugly, soberly, solemnly, sorely, steadily, steeply, suddenly, tenderly, tepidly, tightly, truly, warmly

## Example encoded sentence shape

The <adj> <noun> <verb> the <adj> <noun> by the <noun>.
