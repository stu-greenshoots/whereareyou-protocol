import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatCode, generateCode } from '../src/code.js';
import { MAX_LIVE_NAME_CHARS, parseLiveClientMessage } from '../src/live.js';

// A genuinely valid code (the checksum is real), plus the messy way a phone
// keyboard would type it, plus a single-symbol corruption — which the
// checksum is proven (in code.test.ts) to always catch.
const CODE = generateCode();
const TYPED = formatCode(CODE).toLowerCase();
const CORRUPT = (CODE[0] === 'X' ? 'Y' : 'X') + CODE.slice(1);

describe('parseLiveClientMessage', () => {
  it('never throws on arbitrary strings, and any non-null result is well-formed', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (junk) => {
        const message = parseLiveClientMessage(junk);
        if (message !== null) {
          expect(['hello', 'position', 'sketch']).toContain(message.type);
        }
      }),
    );
  });

  it('parses a full hello and canonicalises the code through the real parser', () => {
    const message = parseLiveClientMessage(
      JSON.stringify({ type: 'hello', code: TYPED, name: '  Sam  ', share: true }),
    );
    // The lowercase, hyphenated form a phone keyboard produces comes out as
    // the canonical code the store is keyed by.
    expect(message).toEqual({ type: 'hello', code: CODE, name: 'Sam', share: true });
  });

  it('caps names and drops empty ones', () => {
    const long = parseLiveClientMessage(
      JSON.stringify({ type: 'hello', code: CODE, name: 'a'.repeat(200), share: false }),
    );
    expect(long).not.toBeNull();
    expect((long as { name?: string }).name).toHaveLength(MAX_LIVE_NAME_CHARS);

    const empty = parseLiveClientMessage(
      JSON.stringify({ type: 'hello', code: CODE, name: '   ', share: false }),
    );
    expect(empty).not.toBeNull();
    expect('name' in (empty as object)).toBe(false);
  });

  it('rejects a hello whose code fails the checksum', () => {
    expect(
      parseLiveClientMessage(JSON.stringify({ type: 'hello', code: CORRUPT, share: true })),
    ).toBeNull();
  });

  it('rejects positions outside the world or with junk fields', () => {
    for (const position of [
      { lat: 91, lon: 0, accuracyM: 5 },
      { lat: 0, lon: 181, accuracyM: 5 },
      { lat: 0, lon: 0, accuracyM: -1 },
      { lat: Number.NaN, lon: 0, accuracyM: 5 },
      { lat: '51.5', lon: 0, accuracyM: 5 },
      null,
    ]) {
      expect(parseLiveClientMessage(JSON.stringify({ type: 'position', position }))).toBeNull();
    }
  });

  it('accepts a valid position and strips fields the wire does not promise', () => {
    const message = parseLiveClientMessage(
      JSON.stringify({
        type: 'position',
        position: { lat: 51.5, lon: -0.1, accuracyM: 8, source: 'gnss', extra: 'smuggled' },
      }),
    );
    expect(message).not.toBeNull();
    if (message?.type !== 'position') throw new Error('unreachable');
    expect('extra' in message.position).toBe(false);
    expect(message.position.lat).toBe(51.5);
  });

  it('parses markers, including the null that clears one', () => {
    expect(
      parseLiveClientMessage(JSON.stringify({ type: 'marker', position: { lat: 51.5, lon: -0.1, accuracyM: 10 } })),
    ).toMatchObject({ type: 'marker', position: { lat: 51.5 } });
    expect(parseLiveClientMessage(JSON.stringify({ type: 'marker', position: null }))).toEqual({
      type: 'marker',
      position: null,
    });
    expect(parseLiveClientMessage(JSON.stringify({ type: 'marker', position: { lat: 99, lon: 0, accuracyM: 1 } }))).toBeNull();
  });

  it('accepts only charset-valid sketches', () => {
    expect(parseLiveClientMessage(JSON.stringify({ type: 'sketch', sketch: 'AQAA' }))).toEqual({
      type: 'sketch',
      sketch: 'AQAA',
    });
    expect(parseLiveClientMessage(JSON.stringify({ type: 'sketch', sketch: 'not+valid==' }))).toBeNull();
    expect(parseLiveClientMessage(JSON.stringify({ type: 'sketch', sketch: 'A'.repeat(5000) }))).toBeNull();
  });

  it('rejects unknown types and oversized frames', () => {
    expect(parseLiveClientMessage(JSON.stringify({ type: 'admin', code: CODE }))).toBeNull();
    expect(parseLiveClientMessage('x'.repeat(20_000))).toBeNull();
  });
});
