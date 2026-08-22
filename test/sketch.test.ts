import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_PEN_POINTS,
  MAX_SKETCH_CHARS,
  MAX_SKETCH_SHAPES,
  decodeSketch,
  encodeSketch,
  isValidSketchPayload,
  simplifyStroke,
  sketchBounds,
} from '../src/sketch.js';
import type { Sketch, SketchColour, SketchPoint, SketchShape } from '../src/sketch.js';

const METRES_PER_DEGREE = 111_320;

/**
 * Ground distance between two points, using the SAME equirectangular
 * projection as the codec so projection error cancels and what is measured is
 * purely quantisation. The codec quantises to decimetres, so the worst case
 * per point is 0.05 m per axis — ~0.08 m diagonally, asserted here at 0.2 m
 * to leave room for float wobble.
 */
function distanceM(anchorLat: number, a: SketchPoint, b: SketchPoint): number {
  const cosLat = Math.max(Math.cos((anchorLat * Math.PI) / 180), 1e-6);
  const east = (a.lon - b.lon) * METRES_PER_DEGREE * cosLat;
  const north = (a.lat - b.lat) * METRES_PER_DEGREE;
  return Math.hypot(east, north);
}

// Positions stay off the exact poles, matching what a GNSS fix can produce.
const arbLat = fc.double({ min: -89.9, max: 89.9, noNaN: true });
const arbLon = fc.double({ min: -179.9, max: 179.9, noNaN: true });
const arbColour = fc.integer({ min: 0, max: 3 }) as fc.Arbitrary<SketchColour>;

// Shape geometry is offsets from the anchor of up to ~0.02° — a couple of
// kilometres, the realistic span of a sketch.
const arbOffset = fc.double({ min: -0.02, max: 0.02, noNaN: true });

function arbShapes(anchor: fc.Arbitrary<SketchPoint>): fc.Arbitrary<Sketch> {
  return anchor.chain((a) => {
    const point = fc
      .tuple(arbOffset, arbOffset)
      .map(([dLat, dLon]) => ({ lat: a.lat + dLat, lon: a.lon + dLon }));
    const shape: fc.Arbitrary<SketchShape> = fc.oneof(
      fc
        .record({ colour: arbColour, points: fc.array(point, { minLength: 1, maxLength: 40 }) })
        .map((s) => ({ kind: 'pen' as const, ...s })),
      fc
        .record({ colour: arbColour, from: point, to: point })
        .map((s) => ({ kind: 'arrow' as const, ...s })),
      fc
        .record({
          colour: arbColour,
          centre: point,
          radiusM: fc.double({ min: 0, max: 2000, noNaN: true }),
        })
        .map((s) => ({ kind: 'circle' as const, ...s })),
    );
    return fc
      .array(shape, { maxLength: 10 })
      .map((shapes) => ({ anchor: a, shapes }));
  });
}

const arbSketch = arbShapes(fc.record({ lat: arbLat, lon: arbLon }));

/**
 * Raw payload builder, deliberately NOT sharing the encoder's primitives —
 * hostile-input tests must not trust the code under test to build the attack.
 */
function rawVarint(value: number): number[] {
  const out: number[] = [];
  let n = value;
  while (n >= 128) {
    out.push((n % 128) + 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}
function rawZigzag(value: number): number[] {
  return rawVarint(value >= 0 ? 2 * value : -2 * value - 1);
}
function rawBase64url(bytes: number[]): string {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) out += B64[c & 63]!;
  }
  return out;
}
/** Version byte + a (0,0) anchor, then whatever the test wants to append. */
function rawPayload(shapeBytes: number[]): string {
  return rawBase64url([1, ...rawZigzag(0), ...rawZigzag(0), ...shapeBytes]);
}

describe('golden vectors — the wire format, frozen', () => {
  // A failing test here means the WIRE FORMAT changed. That needs a version
  // bump and a decoder that still reads version 1 — not an updated expectation.
  // The first two vectors are hand-derived from the format spec, so they also
  // prove the varint/zigzag/base64url pipeline against something other than
  // itself.
  it('encodes the empty sketch at (0,0) as AQAA (hand-derived)', () => {
    expect(encodeSketch({ anchor: { lat: 0, lon: 0 }, shapes: [] })).toBe('AQAA');
  });

  it('encodes the empty sketch at (51.5, -0.1) as AeDU9ASfnAE (hand-derived)', () => {
    expect(encodeSketch({ anchor: { lat: 51.5, lon: -0.1 }, shapes: [] })).toBe('AeDU9ASfnAE');
  });

  it('encodes a single arrow stably', () => {
    const sketch: Sketch = {
      anchor: { lat: 51.5, lon: -0.1 },
      shapes: [
        {
          kind: 'arrow',
          colour: 0,
          from: { lat: 51.5, lon: -0.1 },
          to: { lat: 51.5, lon: -0.09985562 },
        },
      ],
    };
    expect(encodeSketch(sketch)).toBe('AeDU9ASfnAEgAADIAQA');
  });

  it('decodes a fixed pen + circle payload to known geometry', () => {
    const decoded = decodeSketch('AeDU9ASfnAESAwDeAYoB4AGWAgAzqQSbBfoB');
    expect(decoded).not.toBeNull();
    expect(decoded!.anchor).toEqual({ lat: 51.5, lon: -0.1 });
    expect(decoded!.shapes).toHaveLength(2);
    const [pen, circle] = decoded!.shapes;
    expect(pen).toMatchObject({ kind: 'pen', colour: 2 });
    expect(circle).toMatchObject({ kind: 'circle', colour: 3, radiusM: 25 });
    if (pen!.kind !== 'pen') throw new Error('unreachable');
    expect(pen!.points).toHaveLength(3);
    expect(distanceM(51.5, pen!.points[0]!, { lat: 51.5001, lon: -0.1 })).toBeLessThan(0.2);
  });
});

describe('encodeSketch / decodeSketch', () => {
  it('round-trips all geometry to within 0.2 m', () => {
    fc.assert(
      fc.property(arbSketch, (sketch) => {
        const decoded = decodeSketch(encodeSketch(sketch));
        expect(decoded).not.toBeNull();
        expect(decoded!.shapes).toHaveLength(sketch.shapes.length);
        // The anchor itself is quantised to 1e-5°, not decimetres.
        expect(Math.abs(decoded!.anchor.lat - sketch.anchor.lat)).toBeLessThanOrEqual(1e-5);
        expect(Math.abs(decoded!.anchor.lon - sketch.anchor.lon)).toBeLessThanOrEqual(1e-5);

        const near = (a: SketchPoint, b: SketchPoint) =>
          expect(distanceM(sketch.anchor.lat, a, b)).toBeLessThan(0.2);
        for (let i = 0; i < sketch.shapes.length; i++) {
          const original = sketch.shapes[i]!;
          const roundTripped = decoded!.shapes[i]!;
          expect(roundTripped.kind).toBe(original.kind);
          expect(roundTripped.colour).toBe(original.colour);
          if (original.kind === 'pen' && roundTripped.kind === 'pen') {
            expect(roundTripped.points).toHaveLength(original.points.length);
            original.points.forEach((p, j) => near(p, roundTripped.points[j]!));
          } else if (original.kind === 'arrow' && roundTripped.kind === 'arrow') {
            near(original.from, roundTripped.from);
            near(original.to, roundTripped.to);
          } else if (original.kind === 'circle' && roundTripped.kind === 'circle') {
            near(original.centre, roundTripped.centre);
            expect(Math.abs(roundTripped.radiusM - original.radiusM)).toBeLessThanOrEqual(0.05);
          }
        }
      }),
    );
  });

  it('is deterministic — the same sketch always encodes identically', () => {
    fc.assert(
      fc.property(arbSketch, (sketch) => {
        expect(encodeSketch(sketch)).toBe(encodeSketch(sketch));
      }),
    );
  });

  it('every encoder output passes the resolver-side payload check', () => {
    fc.assert(
      fc.property(arbSketch, (sketch) => {
        expect(isValidSketchPayload(encodeSketch(sketch))).toBe(true);
      }),
    );
  });

  it('handles anchors near the poles and the antimeridian', () => {
    for (const anchor of [
      { lat: 89.9, lon: 0 },
      { lat: -89.9, lon: 0 },
      { lat: 51.5, lon: 179.9995 },
      { lat: 51.5, lon: -179.9995 },
    ]) {
      const sketch: Sketch = {
        anchor,
        shapes: [
          {
            kind: 'arrow',
            colour: 1,
            from: anchor,
            to: { lat: anchor.lat + 0.0005, lon: anchor.lon + 0.0002 },
          },
        ],
      };
      const decoded = decodeSketch(encodeSketch(sketch));
      expect(decoded).not.toBeNull();
      const to = decoded!.shapes[0]!;
      if (to.kind !== 'arrow') throw new Error('unreachable');
      expect(Number.isFinite(to.to.lat)).toBe(true);
      expect(Number.isFinite(to.to.lon)).toBe(true);
      expect(distanceM(anchor.lat, to.to, { lat: anchor.lat + 0.0005, lon: anchor.lon + 0.0002 })).toBeLessThan(0.2);
    }
  });

  it('rejects out-of-cap and non-finite input with RangeError', () => {
    const anchor = { lat: 51.5, lon: -0.1 };
    const arrow = (colour: number): SketchShape => ({
      kind: 'arrow',
      colour: colour as SketchColour,
      from: anchor,
      to: anchor,
    });
    expect(() =>
      encodeSketch({ anchor, shapes: Array.from({ length: MAX_SKETCH_SHAPES + 1 }, () => arrow(0)) }),
    ).toThrow(RangeError);
    expect(() =>
      encodeSketch({
        anchor,
        shapes: [
          {
            kind: 'pen',
            colour: 0,
            points: Array.from({ length: MAX_PEN_POINTS + 1 }, () => anchor),
          },
        ],
      }),
    ).toThrow(RangeError);
    expect(() => encodeSketch({ anchor, shapes: [arrow(4)] })).toThrow(RangeError);
    expect(() => encodeSketch({ anchor: { lat: NaN, lon: 0 }, shapes: [] })).toThrow(RangeError);
    expect(() => encodeSketch({ anchor: { lat: 91, lon: 0 }, shapes: [] })).toThrow(RangeError);
  });
});

describe('decodeSketch — hostile input', () => {
  // The wire format has no shape count — shapes run to the end of the buffer,
  // so a truncation that happens to land on both a base64 group boundary and
  // a shape boundary decodes as a VALID sketch with fewer shapes. The honest
  // invariant is therefore not "every truncation is null"; it is: never
  // throws, and returns either null or a clean prefix of the original shapes.
  it('decodes every truncation to null or a clean shape prefix, never throwing', () => {
    fc.assert(
      fc.property(arbSketch, (sketch) => {
        const encoded = encodeSketch(sketch);
        for (let length = 0; length < encoded.length; length++) {
          const decoded = decodeSketch(encoded.slice(0, length));
          if (decoded !== null) {
            expect(decoded.shapes.length).toBeLessThanOrEqual(sketch.shapes.length);
            decoded.shapes.forEach((shape, i) => {
              expect(shape.kind).toBe(sketch.shapes[i]!.kind);
              expect(shape.colour).toBe(sketch.shapes[i]!.colour);
            });
          }
        }
      }),
      { numRuns: 25 },
    );
  });

  it('never throws on arbitrary strings, and any non-null result obeys the caps', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (junk) => {
        const decoded = decodeSketch(junk);
        if (decoded !== null) {
          expect(decoded.shapes.length).toBeLessThanOrEqual(MAX_SKETCH_SHAPES);
          expect(Math.abs(decoded.anchor.lat)).toBeLessThanOrEqual(90);
          expect(Math.abs(decoded.anchor.lon)).toBeLessThanOrEqual(180);
        }
      }),
    );
  });

  it('rejects an unknown version', () => {
    expect(decodeSketch(rawBase64url([2, 0, 0]))).toBeNull();
  });

  it('rejects an unknown shape kind and an unknown colour', () => {
    expect(decodeSketch(rawPayload([(4 << 4) | 0]))).toBeNull();
    expect(decodeSketch(rawPayload([(1 << 4) | 5]))).toBeNull();
  });

  it('rejects one shape over the cap', () => {
    const arrowAtAnchor = [(2 << 4) | 0, 0, 0, 0, 0];
    const atCap = rawPayload(Array.from({ length: MAX_SKETCH_SHAPES }, () => arrowAtAnchor).flat());
    const overCap = rawPayload(Array.from({ length: MAX_SKETCH_SHAPES + 1 }, () => arrowAtAnchor).flat());
    expect(decodeSketch(atCap)).not.toBeNull();
    expect(decodeSketch(overCap)).toBeNull();
  });

  it('rejects one pen point over the cap', () => {
    const pen = (count: number) => [
      (1 << 4) | 0,
      ...rawVarint(count),
      ...Array.from({ length: count * 2 }, () => 0),
    ];
    expect(decodeSketch(rawPayload(pen(MAX_PEN_POINTS)))).not.toBeNull();
    expect(decodeSketch(rawPayload(pen(MAX_PEN_POINTS + 1)))).toBeNull();
    expect(decodeSketch(rawPayload([(1 << 4) | 0, 0]))).toBeNull(); // zero points
  });

  it('rejects geometry outside the sanity bounds', () => {
    // A cursor past the circumference of the Earth, and a 1000 km circle:
    // varints can carry 2^53, so without these caps hostile geometry would
    // make a fitted map zoom to the planet.
    expect(decodeSketch(rawPayload([(2 << 4) | 0, ...rawZigzag(5e8), 0, 0, 0]))).toBeNull();
    expect(decodeSketch(rawPayload([(3 << 4) | 0, 0, 0, ...rawVarint(1e7 + 1)]))).toBeNull();
  });

  it('rejects oversized and mis-charactered payloads without decoding', () => {
    expect(isValidSketchPayload('A'.repeat(MAX_SKETCH_CHARS))).toBe(true);
    expect(isValidSketchPayload('A'.repeat(MAX_SKETCH_CHARS + 1))).toBe(false);
    expect(isValidSketchPayload('')).toBe(false);
    expect(isValidSketchPayload('abc+/=')).toBe(false);
    expect(isValidSketchPayload('abc def')).toBe(false);
    expect(decodeSketch('A'.repeat(MAX_SKETCH_CHARS + 1))).toBeNull();
  });
});

describe('simplifyStroke', () => {
  it('keeps endpoints and only ever removes points', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ lat: arbLat, lon: arbLon }), { minLength: 1, maxLength: 100 }),
        (points) => {
          const simplified = simplifyStroke(points);
          expect(simplified.length).toBeLessThanOrEqual(points.length);
          expect(simplified[0]).toEqual(points[0]);
          expect(simplified[simplified.length - 1]).toEqual(points[points.length - 1]);
          // Every survivor is one of the originals — no invented geometry.
          for (const p of simplified) expect(points).toContainEqual(p);
        },
      ),
    );
  });

  it('collapses a straight line to its two ends', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({
      lat: 51.5 + i * 0.0001,
      lon: -0.1 + i * 0.0001,
    }));
    expect(simplifyStroke(line)).toHaveLength(2);
  });

  it('keeps a deliberate corner', () => {
    const corner = [
      { lat: 51.5, lon: -0.1 },
      { lat: 51.5005, lon: -0.1 }, // ~55 m north
      { lat: 51.5005, lon: -0.0995 }, // then ~35 m east
    ];
    expect(simplifyStroke(corner)).toHaveLength(3);
  });
});

describe('sketchBounds', () => {
  it('is null for an empty sketch', () => {
    expect(sketchBounds({ anchor: { lat: 51.5, lon: -0.1 }, shapes: [] })).toBeNull();
  });

  it('contains every point of every shape, including circle extents', () => {
    fc.assert(
      fc.property(arbSketch, (sketch) => {
        const bounds = sketchBounds(sketch);
        if (sketch.shapes.length === 0) {
          expect(bounds).toBeNull();
          return;
        }
        const [[south, west], [north, east]] = bounds!;
        const inside = (p: SketchPoint) => {
          expect(p.lat).toBeGreaterThanOrEqual(south - 1e-9);
          expect(p.lat).toBeLessThanOrEqual(north + 1e-9);
          expect(p.lon).toBeGreaterThanOrEqual(west - 1e-9);
          expect(p.lon).toBeLessThanOrEqual(east + 1e-9);
        };
        for (const shape of sketch.shapes) {
          if (shape.kind === 'pen') shape.points.forEach(inside);
          else if (shape.kind === 'arrow') {
            inside(shape.from);
            inside(shape.to);
          } else {
            inside(shape.centre);
            // The rim must fit too, not just the centre.
            const dLat = shape.radiusM / METRES_PER_DEGREE;
            expect(shape.centre.lat + dLat).toBeLessThanOrEqual(north + 1e-9);
            expect(shape.centre.lat - dLat).toBeGreaterThanOrEqual(south - 1e-9);
          }
        }
      }),
    );
  });
});

describe('size in practice', () => {
  it('keeps a single arrow around a dozen characters', () => {
    const encoded = encodeSketch({
      anchor: { lat: 51.5, lon: -0.1 },
      shapes: [
        {
          kind: 'arrow',
          colour: 0,
          from: { lat: 51.5, lon: -0.1 },
          to: { lat: 51.5002, lon: -0.0998 },
        },
      ],
    });
    expect(encoded.length).toBeLessThanOrEqual(24);
  });

  it('keeps a heavy realistic sketch under the ~2000-char encoder target', () => {
    // Six simplified freehand strokes of 60 points spaced ~5 m, four arrows,
    // two circles — a busier sketch than any real incident needs.
    const shapes: SketchShape[] = [];
    for (let s = 0; s < 6; s++) {
      const points: SketchPoint[] = [];
      for (let i = 0; i < 60; i++) {
        points.push({
          lat: 51.5 + s * 0.001 + i * 0.000045,
          lon: -0.1 + Math.sin(i / 5) * 0.0004,
        });
      }
      shapes.push({ kind: 'pen', colour: (s % 4) as SketchColour, points });
    }
    for (let i = 0; i < 4; i++) {
      shapes.push({
        kind: 'arrow',
        colour: (i % 4) as SketchColour,
        from: { lat: 51.5 + i * 0.0005, lon: -0.099 },
        to: { lat: 51.5 + i * 0.0005, lon: -0.098 },
      });
    }
    shapes.push({ kind: 'circle', colour: 0, centre: { lat: 51.501, lon: -0.1 }, radiusM: 40 });
    shapes.push({ kind: 'circle', colour: 1, centre: { lat: 51.502, lon: -0.1 }, radiusM: 250 });

    const encoded = encodeSketch({ anchor: { lat: 51.5, lon: -0.1 }, shapes });
    expect(encoded.length).toBeLessThan(2000);
  });
});
