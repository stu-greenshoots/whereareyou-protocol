/**
 * A bijective scramble over exactly 45 bits.
 *
 * This is the piece that makes an offline, content-addressable code *safer*
 * than what3words rather than merely equivalent to it.
 *
 * what3words' central safety claim was that confusable addresses are far
 * apart, so a mistake is obvious. That claim failed in practice because they
 * were solving two problems at once: the code had to satisfy a grid AND be
 * pronounceable. Adjacent squares ended up with adjacent-sounding words.
 *
 * We are not fighting linguistics, so we can simply impose the property. A
 * pseudo-random permutation over the grid index guarantees that neighbouring
 * squares map to unrelated codes — by construction, not by hope. Every input
 * still maps to exactly one output and back, so the code stays fully offline
 * and losslessly reversible.
 *
 * Combined with the checksum, this gives two independent layers:
 *   - a single mistyped character is *caught* and rejected outright;
 *   - anything that slips past lands somewhere obviously wrong (a different
 *     country) rather than subtly wrong (200m down the road).
 *
 * Subtle-but-plausible is the dangerous failure. Avalanche converts it into
 * obviously-broken, which a dispatcher will notice.
 *
 * Construction: alternating xor-shift and odd multiplication, both of which are
 * bijections modulo 2^45. Deliberately NOT a cryptographic primitive — there is
 * no secret here and nothing to protect. The grid is public by design; anyone
 * must be able to implement this from the spec. It exists purely for
 * diffusion.
 */

export const SCRAMBLE_BITS = 45n;
const MASK = (1n << SCRAMBLE_BITS) - 1n;

// Arbitrary odd constants. Odd is the only requirement: an odd multiplier is
// invertible modulo any power of two.
const MUL_A = 0x1f3a5c7e9b1dn;
const MUL_B = 0x15f4914f6cdn;

const SHIFT_1 = 23n;
const SHIFT_2 = 19n;
const SHIFT_3 = 27n;

/**
 * Modular inverse of an odd number mod 2^45, by Newton–Raphson iteration.
 * Each step doubles the number of correct bits, so five rounds covers 45.
 */
function inverseOdd(value: bigint): bigint {
  let inverse = value & MASK;
  for (let round = 0; round < 6; round++) {
    inverse = (inverse * (2n - ((value * inverse) & MASK))) & MASK;
  }
  return inverse & MASK;
}

const INV_A = inverseOdd(MUL_A);
const INV_B = inverseOdd(MUL_B);

/** `x ^= x >> shift` is a bijection; this reverses it. */
function unXorShift(value: bigint, shift: bigint): bigint {
  let result = value;
  // Each pass recovers another `shift` bits from the top down.
  for (let recovered = 0n; recovered < SCRAMBLE_BITS; recovered += shift) {
    result = (value ^ (result >> shift)) & MASK;
  }
  return result & MASK;
}

function xorShift(value: bigint, shift: bigint): bigint {
  return (value ^ (value >> shift)) & MASK;
}

/** Scramble a 45-bit index. */
export function scramble(index: bigint): bigint {
  let x = index & MASK;
  x = xorShift(x, SHIFT_1);
  x = (x * MUL_A) & MASK;
  x = xorShift(x, SHIFT_2);
  x = (x * MUL_B) & MASK;
  x = xorShift(x, SHIFT_3);
  return x;
}

/** Exact inverse of {@link scramble}. */
export function unscramble(scrambled: bigint): bigint {
  let x = scrambled & MASK;
  x = unXorShift(x, SHIFT_3);
  x = (x * INV_B) & MASK;
  x = unXorShift(x, SHIFT_2);
  x = (x * INV_A) & MASK;
  x = unXorShift(x, SHIFT_1);
  return x;
}
