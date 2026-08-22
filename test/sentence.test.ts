import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import adjectives from '../src/wordlists/adjectives.js';
import nouns from '../src/wordlists/nouns.js';
import verbs from '../src/wordlists/verbs.js';
import {
  OFFLINE_ADDRESS_SPACE,
  SENTENCE_CAPACITY,
  SENTENCE_HAS_GLOBAL_COVERAGE,
  indexToWords,
  parseSentence,
  readIndex,
  renderIndex,
  toSentence,
  wordsToSentence,
} from '../src/sentence.js';
import { OFFLINE_RESOLUTION_M } from '../src/offline.js';

/** Great-circle distance in metres. */
function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// The fixed slot schedule, mirrored from sentence.ts, so the tests can pick a
// valid replacement word for any payload position without reaching inside.
const slotList = (slot: number): readonly string[] =>
  slot === 2 ? verbs : slot === 0 || slot === 3 ? adjectives : nouns;

// Random index anywhere the lists can address (word round-trip domain).
const arbIndex = fc.bigInt({ min: 0n, max: SENTENCE_CAPACITY - 1n });

// Only indices below the 2^45 offline address space decode to a real location;
// the sentence capacity can exceed it (the surplus is caught as out-of-range).
const locatableMax =
  SENTENCE_CAPACITY < OFFLINE_ADDRESS_SPACE ? SENTENCE_CAPACITY : OFFLINE_ADDRESS_SPACE;
const arbLocatableIndex = fc.bigInt({ min: 0n, max: locatableMax - 1n });

// The decoded cell centre is within the nominal ~4.8m cell of any point in it,
// at every latitude. `cellSizeM` reports only the east–west dimension, which
// shrinks toward the poles, so bound against the latitude-independent N–S size.
const cellBound = (cellSizeM: number) => Math.max(cellSizeM, OFFLINE_RESOLUTION_M) * 1.5;
const arbLat = fc.double({ min: -89.9, max: 89.9, noNaN: true });
const arbLon = fc.double({ min: -179.9, max: 179.9, noNaN: true });

describe('sentence codec — the same 45 bits, rendered as a sentence', () => {
  it('round-trips every index in [0, capacity) exactly', () => {
    fc.assert(
      fc.property(arbIndex, (index) => {
        const sentence = renderIndex(index);
        const read = readIndex(sentence);
        expect(read.ok).toBe(true);
        if (read.ok) expect(read.index).toBe(index);
      }),
      { numRuns: 2000 },
    );
  });

  it('produces the fixed six-word grammar frame', () => {
    const sentence = renderIndex(0n);
    expect(sentence).toMatch(/^The \w+ \w+ \w+ the \w+ \w+ by the \w+\.$/);
  });

  it('round-trips locations to within one cell', () => {
    // Each random in-capacity index defines a real location (via the offline
    // code it re-renders). toSentence -> parseSentence must return to the same
    // ~5m cell. This works for any list size, so it stands in for the arbitrary
    // lat/lon test below until the lists are full-size.
    fc.assert(
      fc.property(arbLocatableIndex, (index) => {
        const sentence = renderIndex(index);
        const parsed = parseSentence(sentence);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        // Re-encoding the decoded cell centre must reproduce the same sentence,
        // and re-parsing must land in the same cell.
        const roundTrip = toSentence(parsed.lat, parsed.lon);
        expect(roundTrip).toBe(sentence);

        const reparsed = parseSentence(roundTrip);
        expect(reparsed.ok).toBe(true);
        if (reparsed.ok) {
          expect(haversine(parsed.lat, parsed.lon, reparsed.lat, reparsed.lon)).toBeLessThan(
            cellBound(parsed.cellSizeM),
          );
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('round-trips arbitrary real-world lat/lon once the lists are full-size', () => {
    if (!SENTENCE_HAS_GLOBAL_COVERAGE) {
      // The stub lists cannot address the whole globe (capacity < 2^45), so an
      // arbitrary lat/lon has no five-word rendering. The index-derived
      // round-trip above covers the codec meanwhile; this assertion activates
      // automatically once the real lists push capacity past 2^45.
      expect(SENTENCE_CAPACITY).toBeLessThan(OFFLINE_ADDRESS_SPACE);
      return;
    }
    fc.assert(
      fc.property(arbLat, arbLon, (lat, lon) => {
        const parsed = parseSentence(toSentence(lat, lon));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          expect(haversine(lat, lon, parsed.lat, parsed.lon)).toBeLessThan(cellBound(parsed.cellSizeM));
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('checksum word — the crown jewel', () => {
  it('catches 100% of single-word substitutions', () => {
    let trials = 0;
    let detected = 0;

    fc.assert(
      fc.property(arbIndex, fc.nat(), fc.nat(), (index, slotSeed, replacementSeed) => {
        const words = indexToWords(index);
        const slot = slotSeed % words.payload.length;
        const list = slotList(slot);
        const originalIndex = words.payloadIndices[slot]!;

        // Any *different* valid word of the same slot.
        const replacementIndex = (originalIndex + 1 + (replacementSeed % (list.length - 1))) % list.length;
        expect(replacementIndex).not.toBe(originalIndex);

        const corruptedPayload = [...words.payload];
        corruptedPayload[slot] = list[replacementIndex]!;
        const corrupted = wordsToSentence(corruptedPayload, words.check);

        const result = parseSentence(corrupted);
        trials++;
        expect(result.ok).toBe(false);
        if (!result.ok && result.reason === 'bad-checksum') detected++;
      }),
      { numRuns: 4000 },
    );

    expect(trials).toBeGreaterThan(0);
    expect(detected).toBe(trials); // 100% detection, all as bad-checksum
  });

  it('catches 100% of adjacent word swaps', () => {
    let trials = 0;
    let detected = 0;

    fc.assert(
      fc.property(arbIndex, fc.nat(), (index, pairSeed) => {
        const words = indexToWords(index);
        const i = pairSeed % (words.payload.length - 1); // adjacent pair (i, i+1)
        const j = i + 1;
        if (words.payload[i] === words.payload[j]) return; // swap would be a no-op

        const swapped = [...words.payload];
        [swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!];
        const corrupted = wordsToSentence(swapped, words.check);

        const result = parseSentence(corrupted);
        trials++;
        if (!result.ok) detected++;
        expect(result.ok).toBe(false);
      }),
      { numRuns: 4000 },
    );

    expect(trials).toBeGreaterThan(0);
    expect(detected).toBe(trials); // 100% rejection
  });

  it('catches 100% of same-slot transpositions via the checksum itself', () => {
    // noun1<->noun2 and adj1<->adj2 leave both words valid for their slots, so
    // rejection can only come from the check word. This is the transposition
    // property the character checksum cannot guarantee.
    let trials = 0;
    let detected = 0;

    for (const [i, j] of [
      [1, 4], // noun1 <-> noun2
      [0, 3], // adj1  <-> adj2
    ] as Array<[number, number]>) {
      fc.assert(
        fc.property(arbIndex, (index) => {
          const words = indexToWords(index);
          if (words.payloadIndices[i] === words.payloadIndices[j]) return; // no-op

          const swapped = [...words.payload];
          [swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!];
          const corrupted = wordsToSentence(swapped, words.check);

          const result = parseSentence(corrupted);
          trials++;
          if (!result.ok && result.reason === 'bad-checksum') detected++;
          expect(result).toMatchObject({ ok: false, reason: 'bad-checksum' });
        }),
        { numRuns: 1500 },
      );
    }

    expect(trials).toBeGreaterThan(0);
    expect(detected).toBe(trials);
  });
});

describe('tolerant parsing', () => {
  const index = 123_456n % SENTENCE_CAPACITY;
  const canonical = renderIndex(index);
  const base = parseSentence(canonical);

  it('generates a well-formed canonical sentence', () => {
    expect(base.ok).toBe(true);
  });

  it('accepts case, dropped glue words and a stray plural — same location', () => {
    // Same sentence, lowercased.
    const lowercased = canonical.toLowerCase();

    // Same sentence without the leading "The" and without "by the".
    const withoutGlue = canonical.replace(/^The /, '').replace(/ by the /, ' ');

    // Same sentence with a stray plural on the noun2 payload word.
    const words = indexToWords(index);
    const pluralised = [...words.payload];
    pluralised[4] = `${pluralised[4]}s`;
    const strayPlural = wordsToSentence(pluralised, words.check);

    for (const variant of [lowercased, withoutGlue, strayPlural]) {
      const result = parseSentence(variant);
      expect(result.ok, `variant: ${variant}`).toBe(true);
      if (result.ok && base.ok) {
        expect(result.lat).toBe(base.lat);
        expect(result.lon).toBe(base.lon);
      }
    }
  });

  it('reports why a sentence was rejected', () => {
    expect(parseSentence('The bright beacon guards.')).toMatchObject({
      ok: false,
      reason: 'wrong-shape',
    });
    expect(parseSentence('The wobbly beacon guards the bright beacon by the beacon.')).toMatchObject({
      ok: false,
      reason: 'unreadable',
    });
  });
});
