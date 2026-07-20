import { RADIX, symbolOf, valueOf } from './alphabet.js';

/**
 * Positional weight for index `i` — always odd, and that is the whole trick.
 * The checksum is
 *
 *     check = (Σ weight(i) * value[i]) mod 32
 *
 * If a single symbol changes from v to v', the sum shifts by
 * `weight(i) * (v - v')`. Because 32 is a power of two, an odd multiplier is
 * coprime with the modulus, so that product is congruent to zero only when
 * `v == v'`. Therefore **every single-symbol substitution changes the check
 * digit** — no exceptions, at any payload length.
 *
 * Single-symbol substitution is the error we care about: a dispatcher typing
 * what they misheard. It is the dominant real-world failure mode.
 *
 * KNOWN LIMITATION — adjacent transposition. Swapping two symbols shifts the
 * sum by `(weight(i) - weight(j)) * (v_i - v_j)`. Odd minus odd is always even,
 * so this scheme cannot catch every transposition; specifically, swapping two
 * adjacent symbols whose values differ by exactly 16 is undetected. That is
 * ~3% of adjacent transpositions. We accept it: transposition requires hearing
 * the symbols correctly but typing them out of order, which is far less likely
 * than mishearing one over a bad line. Catching both classes needs a Damm
 * quasigroup, which is not worth the complexity here.
 */
function weightAt(index: number): number {
  return 2 * index + 1;
}

/** Session codes: 7 payload symbols + 1 check symbol. */
export const PAYLOAD_LENGTH = 7;
export const CODE_LENGTH = PAYLOAD_LENGTH + 1; // 8

/**
 * Compute the check symbol for a payload of any length.
 *
 * @param payload Canonical alphabet symbols.
 */
export function checkSymbol(payload: string): string {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const value = valueOf(payload[i]!);
    if (value === undefined) {
      throw new RangeError(`payload contains non-alphabet symbol at index ${i}`);
    }
    sum += weightAt(i) * value;
  }
  return symbolOf(sum % RADIX);
}

/**
 * Verify that a canonical code of `totalLength` carries a valid check symbol
 * in its final position.
 */
export function hasValidChecksumOfLength(code: string, totalLength: number): boolean {
  if (code.length !== totalLength) return false;
  const payload = code.slice(0, totalLength - 1);
  const expected = code[totalLength - 1]!;
  try {
    return checkSymbol(payload) === expected;
  } catch {
    return false;
  }
}

/** Verify an 8-symbol session code. */
export function hasValidChecksum(code: string): boolean {
  return hasValidChecksumOfLength(code, CODE_LENGTH);
}
