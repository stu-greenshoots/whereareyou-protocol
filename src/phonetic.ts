import { ALPHABET, canonicaliseChar } from './alphabet.js';

/**
 * Phonetic rendering of the alphabet.
 *
 * This is the layer that makes the protocol safe over voice. The code itself
 * stays compact (8 symbols) because machines handle it; the *presentation* is
 * verbose because humans speak it. Separating the two means we never have to
 * trade transmission safety against code length.
 *
 * Letters use the NATO/ICAO spelling alphabet, which is designed precisely to
 * break up the "E-set" (B/C/D/E/G/P/T/V/Z rhyme; Bravo/Charlie/Delta do not).
 *
 * Digits are spoken plainly rather than in ICAO radio style ("tree", "fower",
 * "niner"). Radio procedure words help trained operators on a noisy channel,
 * but the person reading a code here is a frightened member of the public on a
 * phone call. Plain digits are what they will say unprompted, and the
 * dispatcher's parser accepts them either way.
 */
const PHONETIC: Record<string, string> = {
  '0': 'Zero',
  '1': 'One',
  '2': 'Two',
  '3': 'Three',
  '4': 'Four',
  '5': 'Five',
  '6': 'Six',
  '7': 'Seven',
  '8': 'Eight',
  '9': 'Nine',
  A: 'Alpha',
  B: 'Bravo',
  C: 'Charlie',
  D: 'Delta',
  E: 'Echo',
  F: 'Foxtrot',
  G: 'Golf',
  H: 'Hotel',
  J: 'Juliett',
  K: 'Kilo',
  M: 'Mike',
  N: 'November',
  P: 'Papa',
  Q: 'Quebec',
  R: 'Romeo',
  S: 'Sierra',
  T: 'Tango',
  V: 'Victor',
  W: 'Whiskey',
  X: 'X-ray',
  Y: 'Yankee',
  Z: 'Zulu',
};

/** Alternative spellings we accept on input but never emit. */
const PHONETIC_ALIASES: Record<string, string> = {
  juliet: 'J',
  alfa: 'A',
  xray: 'X',
  whisky: 'W',
  niner: '9',
  tree: '3',
  fower: '4',
  fife: '5',
};

/** Lookup from a normalised spoken word to its symbol. */
const WORD_TO_SYMBOL = new Map<string, string>();
for (const symbol of ALPHABET) {
  WORD_TO_SYMBOL.set(normaliseWord(PHONETIC[symbol]!), symbol);
}
for (const [word, symbol] of Object.entries(PHONETIC_ALIASES)) {
  WORD_TO_SYMBOL.set(normaliseWord(word), symbol);
}

/** Strip anything that is not a letter or digit, and lowercase. */
function normaliseWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The spoken form of a single canonical symbol. */
export function phoneticFor(symbol: string): string {
  const word = PHONETIC[symbol];
  if (word === undefined) {
    throw new RangeError(`no phonetic spelling for ${JSON.stringify(symbol)}`);
  }
  return word;
}

/**
 * Render a code as the words a caller should read aloud.
 *
 * `X7K9P2Q4` -> `"X-ray Seven Kilo Nine Papa Two Quebec Four"`
 */
export function toPhonetic(code: string): string {
  return [...code].map(phoneticFor).join(' ');
}

/**
 * Resolve a single spoken word to its symbol, or `undefined` if the word is
 * not a recognised phonetic spelling.
 */
export function symbolForWord(word: string): string | undefined {
  return WORD_TO_SYMBOL.get(normaliseWord(word));
}

/**
 * Interpret one whitespace-delimited token from dispatcher input.
 *
 * A token is either a phonetic word ("Kilo" -> "K") or a run of raw symbols
 * ("X7K9" -> "X7K9"). Returns `undefined` if the token cannot be interpreted
 * at all, so the caller can decide whether to reject or ignore it.
 */
export function interpretToken(token: string): string | undefined {
  const asWord = symbolForWord(token);
  if (asWord !== undefined) return asWord;

  let out = '';
  for (const char of token) {
    const symbol = canonicaliseChar(char);
    // Punctuation inside a token (hyphens in "X7K9-P2Q4") is separator noise.
    if (symbol === undefined) {
      if (/[\s\-_.,/]/.test(char)) continue;
      return undefined;
    }
    out += symbol;
  }
  return out.length > 0 ? out : undefined;
}
