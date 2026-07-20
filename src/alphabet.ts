/**
 * Crockford base32 alphabet: excludes I, L, O and U.
 *
 * I/L/O are excluded because they are *visually* confusable with 1/1/0.
 * U is excluded to reduce the chance of a code spelling something obscene.
 *
 * Note that this alphabet solves a *screen* problem, not a *voice* problem.
 * Over a degraded phone line the dominant confusion is the "E-set" — B, C, D,
 * E, G, P, T, V, Z all rhyme — and no choice of alphabet fixes that. That is
 * handled separately by rendering codes phonetically (see `phonetic.ts`).
 */
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const RADIX = ALPHABET.length; // 32

/** Reverse lookup: symbol -> value. */
const VALUES = new Map<string, number>();
for (let i = 0; i < ALPHABET.length; i++) {
  VALUES.set(ALPHABET[i]!, i);
}

/**
 * Crockford's decoding aliases. On input we accept the visually confusable
 * characters and fold them onto their intended digit, so a dispatcher who
 * types a letter O where a zero was meant still resolves the right session.
 */
const ALIASES: Record<string, string> = {
  I: '1',
  L: '1',
  O: '0',
};

/** Value of a symbol, or `undefined` if it is not in the alphabet. */
export function valueOf(symbol: string): number | undefined {
  return VALUES.get(symbol);
}

export function symbolOf(value: number): string {
  const symbol = ALPHABET[value];
  if (symbol === undefined) {
    throw new RangeError(`value ${value} is outside the base32 alphabet`);
  }
  return symbol;
}

/**
 * Fold a single character to its canonical alphabet symbol, applying case
 * folding and Crockford aliases. Returns `undefined` for characters that
 * cannot be interpreted.
 */
export function canonicaliseChar(char: string): string | undefined {
  const upper = char.toUpperCase();
  const aliased = ALIASES[upper] ?? upper;
  return VALUES.has(aliased) ? aliased : undefined;
}
