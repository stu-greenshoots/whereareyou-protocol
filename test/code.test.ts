import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ALPHABET,
  CODE_LENGTH,
  PAYLOAD_LENGTH,
  RADIX,
  formatCode,
  generateCode,
  isValidCode,
  parseCode,
  symbolForWord,
  toPhonetic,
} from '../src/index.js';

/** Arbitrary that produces valid codes via the real generator. */
const arbCode = fc
  .uint8Array({ minLength: PAYLOAD_LENGTH, maxLength: PAYLOAD_LENGTH })
  .map((bytes) => generateCode(() => bytes));

describe('generateCode', () => {
  it('produces canonical, self-consistent codes', () => {
    fc.assert(
      fc.property(arbCode, (code) => {
        expect(code).toHaveLength(CODE_LENGTH);
        expect(isValidCode(code)).toBe(true);
      }),
    );
  });

  it('only emits alphabet symbols', () => {
    fc.assert(
      fc.property(arbCode, (code) => {
        for (const char of code) expect(ALPHABET).toContain(char);
      }),
    );
  });

  it('maps byte values onto symbols without modulo bias', () => {
    // 256 is an exact multiple of 32, so each symbol must be reachable from
    // exactly eight byte values. If this ever fails, entropy has been lost.
    const counts = new Map<string, number>();
    for (let byte = 0; byte < 256; byte++) {
      const code = generateCode(() => new Uint8Array(PAYLOAD_LENGTH).fill(byte));
      const symbol = code[0]!;
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
    expect(counts.size).toBe(RADIX);
    for (const count of counts.values()) expect(count).toBe(256 / RADIX);
  });

  it('rejects a short read from the random source', () => {
    expect(() => generateCode(() => new Uint8Array(3))).toThrow(/need 7/);
  });
});

describe('checksum', () => {
  it('catches every single-symbol substitution', () => {
    // The headline safety claim: because all positional weights are odd and the
    // modulus is a power of two, no single-symbol error can survive. Checked
    // exhaustively over every position and every replacement symbol.
    fc.assert(
      fc.property(arbCode, (code) => {
        for (let index = 0; index < CODE_LENGTH; index++) {
          for (const replacement of ALPHABET) {
            if (replacement === code[index]) continue;
            const corrupted =
              code.slice(0, index) + replacement + code.slice(index + 1);
            expect(isValidCode(corrupted)).toBe(false);
          }
        }
      }),
      { numRuns: 25 },
    );
  });

  it('catches adjacent transpositions except the documented 16-apart case', () => {
    // Odd minus odd is even, so this scheme cannot catch transpositions whose
    // symbol values differ by exactly 16. The test pins that boundary so the
    // limitation stays visible rather than being quietly discovered later.
    fc.assert(
      fc.property(arbCode, (code) => {
        for (let i = 0; i < CODE_LENGTH - 1; i++) {
          const a = code[i]!;
          const b = code[i + 1]!;
          if (a === b) continue;

          const swapped = code.slice(0, i) + b + a + code.slice(i + 2);
          const differBySixteen =
            Math.abs(ALPHABET.indexOf(a) - ALPHABET.indexOf(b)) === 16;

          if (!differBySixteen) {
            expect(isValidCode(swapped)).toBe(false);
          }
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe('parseCode', () => {
  it('round-trips a generated code', () => {
    fc.assert(
      fc.property(arbCode, (code) => {
        const result = parseCode(code);
        expect(result).toEqual({ ok: true, code });
      }),
    );
  });

  it('accepts every presentation form of the same code', () => {
    fc.assert(
      fc.property(arbCode, (code) => {
        const forms = [
          code,
          code.toLowerCase(),
          formatCode(code),
          `${code.slice(0, 4)} ${code.slice(4)}`,
          toPhonetic(code),
          toPhonetic(code).toLowerCase(),
          `  ${code}  `,
        ];
        for (const form of forms) {
          expect(parseCode(form), `form: ${form}`).toEqual({ ok: true, code });
        }
      }),
    );
  });

  it('folds Crockford aliases so O reads as zero and I/L read as one', () => {
    const withZero = parseCode('0'.repeat(PAYLOAD_LENGTH) + '0');
    expect(withZero.ok).toBe(true);

    const typedAsLetterO = parseCode('O'.repeat(PAYLOAD_LENGTH) + 'O');
    expect(typedAsLetterO).toEqual(withZero);

    const ones = parseCode('1'.repeat(PAYLOAD_LENGTH) + '1');
    expect(parseCode('I'.repeat(PAYLOAD_LENGTH) + 'I')).toEqual(ones);
    expect(parseCode('L'.repeat(PAYLOAD_LENGTH) + 'L')).toEqual(ones);
  });

  it('reports why input was rejected', () => {
    expect(parseCode('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseCode('   ')).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseCode('X7K9')).toMatchObject({ ok: false, reason: 'wrong-length' });
    expect(parseCode('X7K9P2Q4X')).toMatchObject({
      ok: false,
      reason: 'wrong-length',
    });
    expect(parseCode('what3words!!')).toMatchObject({
      ok: false,
      reason: 'unreadable',
    });
  });

  it('rejects a code whose checksum does not match', () => {
    const code = generateCode();
    const wrongCheck = ALPHABET[(ALPHABET.indexOf(code[7]!) + 1) % RADIX]!;
    const corrupted = code.slice(0, 7) + wrongCheck;
    expect(parseCode(corrupted)).toMatchObject({
      ok: false,
      reason: 'bad-checksum',
    });
  });
});

describe('presentation', () => {
  it('groups codes into two blocks of four', () => {
    expect(formatCode('X7K9P2Q4')).toBe('X7K9-P2Q4');
  });

  it('renders phonetically with one word per symbol', () => {
    expect(toPhonetic('X7K9P2Q4')).toBe(
      'X-ray Seven Kilo Nine Papa Two Quebec Four',
    );
    fc.assert(
      fc.property(arbCode, (code) => {
        expect(toPhonetic(code).split(' ')).toHaveLength(CODE_LENGTH);
      }),
    );
  });

  it('accepts spoken variants a caller might actually use', () => {
    // "Juliet" (one T), "Niner" and "Alfa" are common real-world spellings that
    // differ from what we emit. They must still normalise, independently of
    // whether the resulting code happens to carry a valid checksum.
    expect(symbolForWord('Juliet')).toBe('J');
    expect(symbolForWord('Juliett')).toBe('J');
    expect(symbolForWord('Niner')).toBe('9');
    expect(symbolForWord('Alfa')).toBe('A');
    expect(symbolForWord('Alpha')).toBe('A');
    expect(symbolForWord('xray')).toBe('X');
    expect(symbolForWord('X-ray')).toBe('X');

    const spoken = parseCode('Juliet X-ray Niner Mike Four Tango Two Zulu');
    const normalised = spoken.ok ? spoken.code : spoken.normalised;
    expect(normalised).toBe('JX9M4T2Z');
  });

  it('interprets mixed spoken and typed input', () => {
    // Dispatchers rarely type one clean form: they transcribe as they listen.
    const spoken = parseCode('X7K9 papa Two quebec 4');
    const normalised = spoken.ok ? spoken.code : spoken.normalised;
    expect(normalised).toBe('X7K9P2Q4');
  });
});
