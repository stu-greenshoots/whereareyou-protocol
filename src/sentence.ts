import { RADIX, symbolOf, valueOf } from './alphabet.js';
import { checkSymbol } from './checksum.js';
import { OFFLINE_PAYLOAD_LENGTH, decodeOffline, encodeOffline } from './offline.js';
import adjectives from './wordlists/adjectives.js';
import adverbs from './wordlists/adverbs.js';
import nouns from './wordlists/nouns.js';
import verbs from './wordlists/verbs.js';

/**
 * SENTENCE CODEC — the offline code, rendered as a memorable sentence.
 *
 * This is a *different rendering of the same 45 bits* the offline code already
 * carries (see offline.ts). It is confined to the offline / no-signal fallback,
 * where a permanent, easy-to-hold, easy-to-say form pays off and the scramble
 * makes words safe. The live/pointer code stays lean NATO — words would only
 * weaken its single-error guarantee (see docs/WORD-CODES.md).
 *
 * The frame is fixed and grammatical for any legal word choice:
 *
 *     "The {adj1} {noun1} {verb} the {adj2} {noun2} by the {checknoun}."
 *
 * Five payload words carry the 45 bits by mixed-radix over part-of-speech-typed
 * lists; the sixth word — a noun — is the CHECKSUM word, computed from the other
 * five. It reads like an ordinary noun but lets the dispatcher's tool catch an
 * error.
 *
 * Because it is the same bits, the sentence round-trips to the exact same ~5m
 * cell, with no server and no signal.
 */

// The fixed slot schedule for the five payload words, in the order they appear
// in the frame. Each slot draws from one part-of-speech list; nouns appear
// twice, adjectives twice, the verb once. This is the single source of truth
// for both encode and decode.
const PAYLOAD_LISTS: readonly (readonly string[])[] = [
  adjectives, // adj1
  nouns, //      noun1
  verbs, //      verb
  adjectives, // adj2
  nouns, //      noun2
];

/** Number of bit-carrying words in the frame. */
export const PAYLOAD_WORD_COUNT = PAYLOAD_LISTS.length; // 5

const ADJ = adjectives.length;
const NOUN = nouns.length;
const VERB = verbs.length;
const ADV = adverbs.length;

/**
 * The checksum modulus is the noun count, and it MUST be prime.
 *
 *     check = (Σ weight[i] · payloadWordIndex[i]) mod P     over the 5 payload words
 *
 * with distinct nonzero weights [1,2,3,4,5]. The check word is `nouns[check]`.
 *
 * WHY THIS IS TOTAL. Because P is prime and every payload word index is < its
 * list length ≤ P (nouns is the largest list):
 *
 *   - Single-word substitution: one index changes by Δ with 0 < |Δ| < P. The
 *     check shifts by weight·Δ. Both factors are nonzero and below the prime P,
 *     so their product is never ≡ 0 (mod P). Every single-word substitution is
 *     caught — no exceptions.
 *   - Word transposition: swapping the words at positions i, j shifts the check
 *     by (weight[i] − weight[j])·(index[j] − index[i]). The weights are distinct
 *     so the first factor is nonzero and below P; a real swap makes the second
 *     nonzero and below P too. The product is never ≡ 0 (mod P). Every swap of
 *     two same-slot words is caught, and a cross-slot swap yields a word that is
 *     not valid for its new slot, so it is rejected as unreadable instead.
 *
 * This is *stronger* than the character checksum, which misses ~3% of
 * transpositions (see checksum.ts).
 */
const P = NOUN;
const WEIGHTS: readonly number[] = [1, 2, 3, 4, 5];

function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) {
    if (n % d === 0) return false;
  }
  return true;
}

// Invariants the checksum guarantee depends on. These are satisfiable by the
// stub lists and must stay true for the real ones. They throw at module load so
// a bad list can never ship silently.
if (!isPrime(P)) {
  throw new Error(`sentence checksum requires a prime-length noun list; got ${P}`);
}
if (WEIGHTS.length !== PAYLOAD_WORD_COUNT) {
  throw new Error(`expected ${PAYLOAD_WORD_COUNT} weights, got ${WEIGHTS.length}`);
}
if (new Set(WEIGHTS).size !== WEIGHTS.length || WEIGHTS.some((w) => w <= 0 || w >= P)) {
  throw new Error('weights must be distinct, nonzero, and below the modulus');
}
// Nouns must be the largest slot list so every payload word index is < P. The
// adverb reserve must obey the same bound so it can become a payload slot later
// without breaking the guarantee.
if (ADJ > P || VERB > P || ADV > P) {
  throw new Error(`noun list must be the largest slot: adj=${ADJ} verb=${VERB} adv=${ADV} noun=${P}`);
}

/**
 * How many distinct locations the five-word frame can address:
 *
 *     capacity = adj.length² · noun.length² · verb.length
 *
 * DESIGN INVARIANT: with the real lists this MUST be ≥ 2^45 so the frame covers
 * the whole offline address space. It is deliberately NOT asserted at module
 * load, because the stub lists are small (so the codec still compiles and its
 * tests run over [0, capacity)); instead {@link toSentence} guards each call and
 * {@link SENTENCE_HAS_GLOBAL_COVERAGE} exposes whether the current lists span the
 * globe.
 *
 * IF THE REAL LISTS COME IN SHORT — extend to a sixth payload word using the
 * reserved adverb list:
 *   1. append `adverbs` to PAYLOAD_LISTS (slot schedule) — frame becomes
 *      "... {noun2} {adverb} by the {checknoun}.";
 *   2. extend WEIGHTS to [1,2,3,4,5,6];
 *   3. teach the parser the extra glue-free slot.
 * The checksum stays total as long as nouns remain the prime maximum (≥ every
 * slot length), which the invariants above already enforce for the adverb list.
 */
export const SENTENCE_CAPACITY = BigInt(ADJ) ** 2n * BigInt(NOUN) ** 2n * BigInt(VERB);

/** The offline code's address space: 2^45 cells (matches SCRAMBLE_BITS). */
export const OFFLINE_ADDRESS_SPACE = 1n << 45n;

/** True when the current lists can address the whole 45-bit offline space. */
export const SENTENCE_HAS_GLOBAL_COVERAGE = SENTENCE_CAPACITY >= OFFLINE_ADDRESS_SPACE;

// ---------------------------------------------------------------------------
// Base32 payload <-> 45-bit index. This is the bridge to the existing offline
// code: not grid math (that stays in offline.ts), just the same least-
// significant-symbol-first packing offline.ts uses, factored out so the sentence
// re-renders the identical bits.
// ---------------------------------------------------------------------------

/** Σ value(payload[i]) · 32^i — the 45-bit index behind an offline payload. */
export function payloadToIndex(payload: string): bigint {
  let index = 0n;
  for (let i = payload.length - 1; i >= 0; i--) {
    const value = valueOf(payload[i]!);
    if (value === undefined) {
      throw new RangeError(`offline payload contains non-alphabet symbol at index ${i}`);
    }
    index = index * BigInt(RADIX) + BigInt(value);
  }
  return index;
}

/** Inverse of {@link payloadToIndex}: emit the 9 base32 symbols, LSB first. */
export function indexToPayload(index: bigint): string {
  let remaining = index;
  let payload = '';
  for (let i = 0; i < OFFLINE_PAYLOAD_LENGTH; i++) {
    payload += symbolOf(Number(remaining % BigInt(RADIX)));
    remaining /= BigInt(RADIX);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// The word layer: 45-bit index <-> five payload words + a check word.
// ---------------------------------------------------------------------------

export interface SentenceWords {
  /** The five payload words, in frame order: adj1, noun1, verb, adj2, noun2. */
  payload: readonly string[];
  /** Their indices into the corresponding slot lists, same order. */
  payloadIndices: readonly number[];
  /** The checksum word (a noun). */
  check: string;
  /** Its index into the noun list. */
  checkIndex: number;
}

function wordAt(list: readonly string[], index: number): string {
  const word = list[index];
  if (word === undefined) {
    throw new RangeError(`word index ${index} is out of range for a list of ${list.length}`);
  }
  return word;
}

/** check = (Σ weight[i] · payloadIndices[i]) mod P. */
function checksumOf(payloadIndices: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < WEIGHTS.length; i++) {
    sum += WEIGHTS[i]! * payloadIndices[i]!;
  }
  return sum % P;
}

/**
 * Decompose a 45-bit index into its five payload words by mixed-radix over the
 * slot lists, then compute the check word. Throws if the index is outside what
 * the current lists can address (only reachable with under-sized stub lists;
 * see SENTENCE_CAPACITY).
 */
export function indexToWords(index: bigint): SentenceWords {
  if (index < 0n || index >= SENTENCE_CAPACITY) {
    throw new RangeError(
      `index ${index} is outside the sentence capacity ${SENTENCE_CAPACITY}; ` +
        'the word lists are too small to address it (see the capacity note in sentence.ts)',
    );
  }

  const payloadIndices: number[] = [];
  let remaining = index;
  for (const list of PAYLOAD_LISTS) {
    const radix = BigInt(list.length);
    payloadIndices.push(Number(remaining % radix));
    remaining /= radix;
  }

  const payload = payloadIndices.map((i, slot) => wordAt(PAYLOAD_LISTS[slot]!, i));
  const checkIndex = checksumOf(payloadIndices);
  return { payload, payloadIndices, check: wordAt(nouns, checkIndex), checkIndex };
}

/** Recompose the 45-bit index from the five payload word indices. */
function wordsToIndex(payloadIndices: readonly number[]): bigint {
  let index = 0n;
  for (let slot = PAYLOAD_LISTS.length - 1; slot >= 0; slot--) {
    index = index * BigInt(PAYLOAD_LISTS[slot]!.length) + BigInt(payloadIndices[slot]!);
  }
  return index;
}

/** Drop the six words into the fixed grammar frame. */
export function wordsToSentence(payload: readonly string[], check: string): string {
  return `The ${payload[0]!} ${payload[1]!} ${payload[2]!} the ${payload[3]!} ${payload[4]!} by the ${check}.`;
}

/** Render a 45-bit index as its sentence. */
export function renderIndex(index: bigint): string {
  const words = indexToWords(index);
  return wordsToSentence(words.payload, words.check);
}

// ---------------------------------------------------------------------------
// Tolerant parsing. Input arrives from a human reading a sentence aloud (or a
// paraphrase of it), so the parser lowercases, strips punctuation, ignores the
// fixed glue words, and forgives a trailing plural / simple variant.
// ---------------------------------------------------------------------------

/** Glue words that carry no bits and are ignored on input. */
const GLUE = new Set(['the', 'a', 'an', 'by']);

/** Reduce a token to letters only, lowercased. */
function normalise(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, '');
}

/** Normalised word -> index, built once per slot list. */
function buildIndex(list: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < list.length; i++) {
    const key = normalise(list[i]!);
    if (map.has(key)) {
      throw new Error(`word list has two entries normalising to "${key}"`);
    }
    map.set(key, i);
  }
  return map;
}

const ADJ_INDEX = buildIndex(adjectives);
const NOUN_INDEX = buildIndex(nouns);
const VERB_INDEX = buildIndex(verbs);
const SLOT_INDEXES: readonly Map<string, number>[] = [
  ADJ_INDEX,
  NOUN_INDEX,
  VERB_INDEX,
  ADJ_INDEX,
  NOUN_INDEX,
];

/** Candidate singular forms of a possibly-pluralised word. */
function depluralise(word: string): string[] {
  const forms: string[] = [];
  if (word.endsWith('ies') && word.length > 3) forms.push(`${word.slice(0, -3)}y`);
  if (word.endsWith('es') && word.length > 2) forms.push(word.slice(0, -2));
  if (word.endsWith('s') && word.length > 1) forms.push(word.slice(0, -1));
  return forms;
}

/** Resolve a token to its index in `index`, forgiving a trailing plural. */
function lookup(index: Map<string, number>, token: string): number | undefined {
  const key = normalise(token);
  const exact = index.get(key);
  if (exact !== undefined) return exact;
  for (const form of depluralise(key)) {
    const hit = index.get(form);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export type SentenceParseFailure = 'unreadable' | 'bad-checksum' | 'wrong-shape';

/**
 * Parse a sentence back to its 45-bit index.
 *
 *   'wrong-shape'  — not six content words after glue is stripped.
 *   'unreadable'   — a content word is not a valid entry for its slot.
 *   'bad-checksum' — the words are all valid but the check word disagrees.
 */
export function readIndex(
  input: string,
): { ok: true; index: bigint } | { ok: false; reason: SentenceParseFailure } {
  const tokens = input
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !GLUE.has(token));

  if (tokens.length !== PAYLOAD_WORD_COUNT + 1) {
    return { ok: false, reason: 'wrong-shape' };
  }

  const payloadIndices: number[] = [];
  for (let slot = 0; slot < PAYLOAD_WORD_COUNT; slot++) {
    const resolved = lookup(SLOT_INDEXES[slot]!, tokens[slot]!);
    if (resolved === undefined) return { ok: false, reason: 'unreadable' };
    payloadIndices.push(resolved);
  }

  const checkResolved = lookup(NOUN_INDEX, tokens[PAYLOAD_WORD_COUNT]!);
  if (checkResolved === undefined) return { ok: false, reason: 'unreadable' };

  if (checksumOf(payloadIndices) !== checkResolved) {
    return { ok: false, reason: 'bad-checksum' };
  }

  return { ok: true, index: wordsToIndex(payloadIndices) };
}

// ---------------------------------------------------------------------------
// Public API — location <-> sentence. Reuses encodeOffline / decodeOffline for
// all grid math; only the base32 packing and the word layer live here.
// ---------------------------------------------------------------------------

export type SentenceParseResult =
  | { ok: true; lat: number; lon: number; cellSizeM: number }
  | { ok: false; reason: SentenceParseFailure };

/**
 * Render a position as a memorable sentence.
 *
 * Pure and deterministic — no network, no state, no clock. Throws only if the
 * word lists are too small to address the offline space (see SENTENCE_CAPACITY);
 * the real lists satisfy the ≥ 2^45 invariant, so this never throws in
 * production.
 */
export function toSentence(lat: number, lon: number): string {
  const code = encodeOffline(lat, lon);
  const payload = code.slice(0, OFFLINE_PAYLOAD_LENGTH);
  return renderIndex(payloadToIndex(payload));
}

/**
 * Parse a spoken or written sentence back to the centre of its ~5m cell.
 *
 * Tolerant of case, punctuation, dropped glue words and a stray plural.
 */
export function parseSentence(input: string): SentenceParseResult {
  const read = readIndex(input);
  if (!read.ok) return { ok: false, reason: read.reason };

  // A well-formed sentence whose index lands outside the offline address space
  // cannot correspond to any location. Only reachable when the real lists give a
  // capacity above 2^45 and the input has been corrupted; treat it as malformed.
  if (read.index >= OFFLINE_ADDRESS_SPACE) {
    return { ok: false, reason: 'wrong-shape' };
  }

  const payload = indexToPayload(read.index);
  const position = decodeOffline(payload + checkSymbol(payload));
  return { ok: true, lat: position.lat, lon: position.lon, cellSizeM: position.cellSizeM };
}
