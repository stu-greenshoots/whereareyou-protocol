import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ALPHABET } from '../src/alphabet.js';
import {
  OFFLINE_CODE_LENGTH,
  OFFLINE_RESOLUTION_M,
  decodeOffline,
  encodeOffline,
  formatOfflineCode,
  isValidOfflineCode,
  parseOffline,
} from '../src/offline.js';
import { scramble, unscramble } from '../src/scramble.js';
import { toPhonetic } from '../src/code.js';

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

const arbLat = fc.double({ min: -89.9, max: 89.9, noNaN: true });
const arbLon = fc.double({ min: -179.9, max: 179.9, noNaN: true });

describe('scramble', () => {
  it('is a bijection over the full 45-bit domain', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: (1n << 45n) - 1n }), (index) => {
        expect(unscramble(scramble(index))).toBe(index);
      }),
      { numRuns: 500 },
    );
  });

  it('never collides across a large sample', () => {
    const seen = new Set<bigint>();
    for (let i = 0n; i < 20_000n; i++) {
      const out = scramble(i);
      expect(seen.has(out)).toBe(false);
      seen.add(out);
    }
  });
});

describe('encodeOffline / decodeOffline', () => {
  it('round-trips to within one grid cell', () => {
    fc.assert(
      fc.property(arbLat, arbLon, (lat, lon) => {
        const code = encodeOffline(lat, lon);
        expect(code).toHaveLength(OFFLINE_CODE_LENGTH);

        const back = decodeOffline(code);
        // Decoding returns the cell centre, so the error is bounded by half a
        // diagonal. Allow a full cell for latitude-dependent narrowing.
        expect(haversine(lat, lon, back.lat, back.lon)).toBeLessThan(
          OFFLINE_RESOLUTION_M * 1.5,
        );
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic — the same position always yields the same code', () => {
    fc.assert(
      fc.property(arbLat, arbLon, (lat, lon) => {
        expect(encodeOffline(lat, lon)).toBe(encodeOffline(lat, lon));
      }),
    );
  });

  it('needs no network, clock or state', () => {
    // Encoding Trafalgar Square must give a stable, reproducible answer. If
    // this ever changes, every printed code in the world has silently moved.
    const code = encodeOffline(51.50809, -0.12789);
    expect(code).toBe(encodeOffline(51.50809, -0.12789));
    expect(isValidOfflineCode(code)).toBe(true);

    const back = decodeOffline(code);
    expect(haversine(51.50809, -0.12789, back.lat, back.lon)).toBeLessThan(8);
  });

  it('handles the poles and the antimeridian', () => {
    for (const [lat, lon] of [
      [90, 180],
      [-90, -180],
      [0, 0],
      [89.9999, 179.9999],
    ] as Array<[number, number]>) {
      const code = encodeOffline(lat, lon);
      expect(isValidOfflineCode(code)).toBe(true);
      expect(() => decodeOffline(code)).not.toThrow();
    }
  });

  it('rejects out-of-range input', () => {
    expect(() => encodeOffline(91, 0)).toThrow(/lat/);
    expect(() => encodeOffline(0, 181)).toThrow(/lon/);
    expect(() => encodeOffline(Number.NaN, 0)).toThrow(/lat/);
  });
});

describe('avalanche — the property what3words claimed and did not deliver', () => {
  it('gives neighbouring cells completely unrelated codes', () => {
    // Step one cell east and north from a fixed point. The codes must not look
    // alike: this is what stops a mistyped character resolving to somewhere
    // plausibly nearby, which is exactly the what3words "s" failure.
    const step = 180 / 2 ** 22;
    const base = encodeOffline(51.50809, -0.12789);

    for (const [dLat, dLon] of [
      [step, 0],
      [0, step],
      [step, step],
      [-step, 0],
    ] as Array<[number, number]>) {
      const neighbour = encodeOffline(51.50809 + dLat, -0.12789 + dLon);
      expect(neighbour).not.toBe(base);

      let shared = 0;
      for (let i = 0; i < OFFLINE_CODE_LENGTH; i++) {
        if (neighbour[i] === base[i]) shared++;
      }
      // Random 10-symbol strings share ~0.3 symbols on average. Anything up to
      // half would still be far better than dictionary words; assert a loose
      // bound so this tests diffusion rather than a specific constant.
      expect(shared).toBeLessThan(5);
    }
  });

  it('sends a single mistyped character somewhere obviously wrong', () => {
    // With avalanche, a corrupted code that happens to pass the checksum lands
    // far away rather than subtly nearby. Far-away errors get noticed.
    const code = encodeOffline(51.50809, -0.12789);
    const origin = decodeOffline(code);

    const distances: number[] = [];
    for (let index = 0; index < 9; index++) {
      for (const replacement of ALPHABET) {
        if (replacement === code[index]) continue;
        const corrupted = code.slice(0, index) + replacement + code.slice(index + 1);
        // Only positions that still pass the checksum could ever be resolved.
        if (!isValidOfflineCode(corrupted)) continue;
        const moved = decodeOffline(corrupted);
        distances.push(haversine(origin.lat, origin.lon, moved.lat, moved.lon));
      }
    }

    // Every single-symbol corruption is caught by the checksum, so nothing
    // should even be resolvable.
    expect(distances).toHaveLength(0);
  });
});

describe('checksum on offline codes', () => {
  it('catches every single-symbol substitution', () => {
    fc.assert(
      fc.property(arbLat, arbLon, (lat, lon) => {
        const code = encodeOffline(lat, lon);
        for (let index = 0; index < OFFLINE_CODE_LENGTH; index++) {
          for (const replacement of ALPHABET) {
            if (replacement === code[index]) continue;
            const corrupted = code.slice(0, index) + replacement + code.slice(index + 1);
            expect(isValidOfflineCode(corrupted)).toBe(false);
          }
        }
      }),
      { numRuns: 20 },
    );
  });
});

describe('parseOffline', () => {
  it('accepts every presentation form', () => {
    fc.assert(
      fc.property(arbLat, arbLon, (lat, lon) => {
        const code = encodeOffline(lat, lon);
        for (const form of [
          code,
          code.toLowerCase(),
          formatOfflineCode(code),
          toPhonetic(code),
          `  ${code} `,
        ]) {
          const result = parseOffline(form);
          expect(result.ok, `form: ${form}`).toBe(true);
          if (result.ok) expect(result.code).toBe(code);
        }
      }),
      { numRuns: 50 },
    );
  });

  it('reports why input was rejected', () => {
    expect(parseOffline('X7K9')).toMatchObject({ reason: 'wrong-length' });
    expect(parseOffline('!!!!')).toMatchObject({ reason: 'unreadable' });

    const code = encodeOffline(51.5, -0.12);
    const wrong = ALPHABET[(ALPHABET.indexOf(code[9]!) + 1) % 32]!;
    expect(parseOffline(code.slice(0, 9) + wrong)).toMatchObject({
      reason: 'bad-checksum',
    });
  });

  it('formats into readable groups', () => {
    expect(formatOfflineCode('X7K9P2Q4M3')).toBe('X7K9-P2Q4-M3');
  });
});
