import { RADIX, symbolOf, valueOf } from './alphabet.js';
import { CODE_LENGTH, PAYLOAD_LENGTH, checkSymbol, hasValidChecksum } from './checksum.js';
import { interpretToken, toPhonetic } from './phonetic.js';

export { CODE_LENGTH, PAYLOAD_LENGTH };

/**
 * Why 7 random symbols?
 *
 * 32^7 = 34,359,738,368 possible payloads. Enumeration is the central security
 * problem for this protocol: the namespace maps short codes to "a person in
 * distress, right now, at these coordinates", so a successful guess is a real
 * privacy breach, not a nuisance.
 *
 * With 10,000 sessions live at once the hit rate is ~1 in 3.4 million per
 * guess. An unthrottled attacker at 10 requests/second would expect roughly one
 * hit every four days; with the rate limits the resolver enforces it is far
 * beyond reach. Six symbols would give 1 in 107,000 — about eight harvested
 * emergencies per day at the same request rate — which is why this is 7 and not
 * 6. The eighth symbol is spent on a checksum rather than more entropy because
 * dispatcher mistyping is the *likely* failure and enumeration is only the
 * *adversarial* one.
 */
export const RANDOM_SYMBOLS = PAYLOAD_LENGTH;

/** Size of the code space, for documentation and tests. */
export const CODE_SPACE = RADIX ** PAYLOAD_LENGTH;

/**
 * Source of randomness. Defaults to the platform CSPRNG, which exists in both
 * Node 22+ and browsers, keeping this package dependency-free and isomorphic.
 */
export type RandomBytes = (length: number) => Uint8Array;

const defaultRandomBytes: RandomBytes = (length) =>
  crypto.getRandomValues(new Uint8Array(length));

/**
 * Generate a fresh session code.
 *
 * Byte values are taken modulo 32. This is unbiased because 256 is an exact
 * multiple of 32 — every symbol is produced by exactly eight byte values — so
 * no rejection sampling is needed.
 */
export function generateCode(randomBytes: RandomBytes = defaultRandomBytes): string {
  const bytes = randomBytes(PAYLOAD_LENGTH);
  if (bytes.length < PAYLOAD_LENGTH) {
    throw new Error(
      `random source returned ${bytes.length} bytes, need ${PAYLOAD_LENGTH}`,
    );
  }

  let payload = '';
  for (let i = 0; i < PAYLOAD_LENGTH; i++) {
    payload += symbolOf(bytes[i]! % RADIX);
  }
  return payload + checkSymbol(payload);
}

/** Why a candidate code was rejected. */
export type ParseFailure =
  | 'empty'
  | 'unreadable'
  | 'wrong-length'
  | 'bad-checksum';

export type ParseResult =
  | { ok: true; code: string }
  | { ok: false; reason: ParseFailure; normalised: string };

/**
 * Parse dispatcher or caller input into a canonical code.
 *
 * Deliberately permissive about presentation, because the input arrives via a
 * human on a phone call. All of these resolve to the same code:
 *
 *   X7K9P2Q4
 *   x7k9-p2q4
 *   X7K9 P2Q4
 *   X-ray Seven Kilo Nine Papa Two Quebec Four
 *   xray 7 kilo 9 papa 2 quebec 4
 *
 * Crockford aliases are folded too, so a typed letter O becomes a zero.
 */
export function parseCode(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty', normalised: '' };
  }

  let normalised = '';
  for (const token of trimmed.split(/\s+/)) {
    const interpreted = interpretToken(token);
    if (interpreted === undefined) {
      return { ok: false, reason: 'unreadable', normalised };
    }
    normalised += interpreted;
  }

  if (normalised.length === 0) {
    return { ok: false, reason: 'empty', normalised };
  }
  if (normalised.length !== CODE_LENGTH) {
    return { ok: false, reason: 'wrong-length', normalised };
  }
  if (!hasValidChecksum(normalised)) {
    return { ok: false, reason: 'bad-checksum', normalised };
  }

  return { ok: true, code: normalised };
}

/** True if `code` is already in canonical form and internally consistent. */
export function isValidCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  for (const char of code) {
    if (valueOf(char) === undefined) return false;
  }
  return hasValidChecksum(code);
}

/**
 * Group a canonical code for display: `X7K9P2Q4` -> `X7K9-P2Q4`.
 *
 * Chunking roughly halves transcription errors on strings of this length by
 * giving the reader a natural place to pause.
 */
export function formatCode(code: string): string {
  if (code.length !== CODE_LENGTH) return code;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export { toPhonetic };
