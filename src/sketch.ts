/**
 * SKETCHES — the caller's drawing, as an opaque payload on a session.
 *
 * A code carries a position; a sketch carries *how to get in* — an arrow to
 * the right door, a circle round the landmark, the route from the station.
 * It rides the session record, not the code: there is no room and no voice
 * channel for arrows in eight spoken characters, and an offline code cannot
 * carry one at all (the code *is* the location; there is no server behind it).
 *
 * The resolver never parses this format. It stores and returns the encoded
 * string verbatim, checking only length and charset (`isValidSketchPayload`).
 * That keeps the server dumb about geometry — nothing to validate, no drawing
 * semantics to get wrong — and means the sketch is a single scalar field in
 * every store, inheriting the session TTL structurally.
 *
 * Both ends of this codec therefore live in the web app, and they can be
 * years apart: the encoder runs in a cached PWA on a caller's phone, the
 * decoder in a dispatcher's freshly deployed console. Version skew is
 * structural, which is why the format is FROZEN at version 1 — a change means
 * a new version byte and a decoder that still reads every old one. The golden
 * vectors in `sketch.test.ts` exist to make an accidental change fail loudly.
 *
 * ---
 *
 * WIRE FORMAT, version 1. Compact binary, then base64url, no padding.
 *
 *   byte 0        version = 1
 *   zigzag varint round(anchor.lat * 1e5)
 *   zigzag varint round(anchor.lon * 1e5)
 *   then shapes, repeated until the end of the buffer:
 *     byte        (kind << 4) | colour     kind: 1=pen 2=arrow 3=circle
 *                                          colour: 0..3
 *     pen         varint N, then N × (zigzag dEast, zigzag dNorth)
 *     arrow       2 × (zigzag dEast, zigzag dNorth)      [from, then to]
 *     circle      1 × (zigzag dEast, zigzag dNorth)      [centre]
 *                 varint radius (decimetres)
 *
 * Points are deltas in DECIMETRES from a single running cursor that starts at
 * (0, 0) — the anchor — and is set by every point in the buffer, across shape
 * boundaries. Freehand is what makes a sketch expensive, and consecutive
 * samples are near each other, so deltas keep a stroke to about a byte per
 * coordinate.
 *
 * The anchor is a COMPRESSION ORIGIN, not a position. Everything decodes back
 * to absolute lat/lon, so an arrow keeps pointing at the real place when the
 * pin is dragged and does not follow a live session as the caller walks away.
 *
 * Metres from the anchor are equirectangular:
 *
 *   east  = (lon - anchor.lon) * 111320 * cos(anchor.lat)
 *   north = (lat - anchor.lat) * 111320
 *
 * The approximation is well inside drawing tolerance over the few kilometres
 * a sketch spans, and both ends use the same projection, so it cancels on the
 * round trip. The anchor is quantised to 1e-5° BEFORE deltas are computed —
 * deltas against the unquantised anchor would silently cost up to half a
 * metre of reconstruction error.
 */

export interface SketchPoint {
  lat: number;
  lon: number;
}

/**
 * An index into the app's ink palette, not a colour. The palette hexes live
 * with the renderer; the wire carries only which of the four inks was used.
 * Ink has NO defined meaning — colour groups strokes, the note field carries
 * meaning — so nothing here names or orders the colours semantically.
 */
export type SketchColour = 0 | 1 | 2 | 3;

export type SketchShape =
  | { kind: 'pen'; colour: SketchColour; points: SketchPoint[] }
  | { kind: 'arrow'; colour: SketchColour; from: SketchPoint; to: SketchPoint }
  | { kind: 'circle'; colour: SketchColour; centre: SketchPoint; radiusM: number };

export interface Sketch {
  anchor: SketchPoint;
  shapes: SketchShape[];
}

export const SKETCH_VERSION = 1;

/**
 * Hard caps, enforced by BOTH ends. The encoder throws (a caller exceeding
 * them is a programming error — the UI refuses shapes at the cap); the
 * decoder returns null (hostile input is a real case: this arrives from a
 * server response and, one day, from anyone who can mint a session).
 */
export const MAX_SKETCH_CHARS = 4096;
export const MAX_SKETCH_SHAPES = 64;
export const MAX_PEN_POINTS = 512;

/** Metres per degree of latitude; matches the constant used by offline.ts. */
const METRES_PER_DEGREE = 111_320;

const KIND_PEN = 1;
const KIND_ARROW = 2;
const KIND_CIRCLE = 3;

/**
 * Decoder sanity bounds, beyond the caps above. A varint can carry 2^53, so
 * without these a hostile payload could put "geometry" light-years from the
 * anchor and a map that fits to it would zoom to the whole planet — or NaN.
 * 4e8 decimetres is the full circumference of the Earth; 1e7 decimetres is a
 * 1000 km circle. Nothing a finger draws on a phone gets near either.
 */
const MAX_CURSOR_DECIMETRES = 4e8;
const MAX_RADIUS_DECIMETRES = 1e7;

/**
 * cos(anchor.lat) appears as a divisor when decoding, and is zero at the
 * poles. Clamp it to a floor instead: east–west metres become meaningless
 * that close to a pole anyway, but the arithmetic must not divide by zero.
 */
function clampedCos(latDegrees: number): number {
  return Math.max(Math.cos((latDegrees * Math.PI) / 180), 1e-6);
}

// --- varint / zigzag ------------------------------------------------------

/**
 * 7 bits per byte, little-endian, high bit is the continuation flag.
 *
 * Division, not bit-shifting: `>>>` truncates to 32 bits, and the anchor
 * values reach ~1.8e7 after zigzag — safe today, but a trap waiting for
 * anyone who raises the precision. Float division is exact for integers up
 * to 2^53, which is the real ceiling here.
 */
function pushVarint(bytes: number[], value: number): void {
  let remaining = value;
  while (remaining >= 128) {
    bytes.push((remaining % 128) + 128);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
}

function pushZigzag(bytes: number[], value: number): void {
  pushVarint(bytes, value >= 0 ? 2 * value : -2 * value - 1);
}

// --- base64url ------------------------------------------------------------

// Hand-rolled rather than btoa/Buffer: this file must run identically in a
// browser, a worker and Node, and depend on nothing.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_VALUE = new Map([...B64].map((char, index) => [char, index]));

function toBase64url(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) out += B64[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) out += B64[c & 0x3f];
  }
  return out;
}

function fromBase64url(encoded: string): number[] | null {
  // A base64 group of 4 chars is 3 bytes; a trailing group of 2 or 3 chars is
  // 1 or 2 bytes; a trailing group of 1 char cannot encode anything.
  if (encoded.length % 4 === 1) return null;
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i += 4) {
    const values: number[] = [];
    for (let j = i; j < Math.min(i + 4, encoded.length); j++) {
      const value = B64_VALUE.get(encoded[j]!);
      if (value === undefined) return null;
      values.push(value);
    }
    bytes.push((values[0]! << 2) | (values[1]! >> 4));
    if (values.length > 2) bytes.push(((values[1]! & 0x0f) << 4) | (values[2]! >> 2));
    if (values.length > 3) bytes.push(((values[2]! & 0x03) << 6) | values[3]!);
  }
  return bytes;
}

// --- encode ---------------------------------------------------------------

function requireFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${what} must be finite, got ${value}`);
}

function requireColour(colour: number): void {
  if (colour !== 0 && colour !== 1 && colour !== 2 && colour !== 3) {
    throw new RangeError(`colour must be 0..3, got ${colour}`);
  }
}

/**
 * Encode a sketch. Pure and deterministic — no clock, no randomness, and no
 * silent simplification: what goes in is what comes out, so the app can show
 * exactly what it will send. Run `simplifyStroke` on pen strokes BEFORE
 * encoding; a raw 20-second scribble is thousands of points.
 *
 * Throws RangeError on out-of-cap or non-finite input — exceeding the caps is
 * the caller's bug, and the UI enforces them at stroke commit. The lenient
 * end of this codec is `decodeSketch`.
 */
export function encodeSketch(sketch: Sketch): string {
  const { anchor, shapes } = sketch;
  requireFinite(anchor.lat, 'anchor.lat');
  requireFinite(anchor.lon, 'anchor.lon');
  if (anchor.lat < -90 || anchor.lat > 90) {
    throw new RangeError(`anchor.lat must be between -90 and 90, got ${anchor.lat}`);
  }
  if (anchor.lon < -180 || anchor.lon > 180) {
    throw new RangeError(`anchor.lon must be between -180 and 180, got ${anchor.lon}`);
  }
  if (shapes.length > MAX_SKETCH_SHAPES) {
    throw new RangeError(`at most ${MAX_SKETCH_SHAPES} shapes, got ${shapes.length}`);
  }

  // Quantise the anchor first, then measure everything from the quantised
  // value — see the header comment on reconstruction error.
  const latQ = Math.round(anchor.lat * 1e5);
  const lonQ = Math.round(anchor.lon * 1e5);
  const anchorLat = latQ / 1e5;
  const anchorLon = lonQ / 1e5;
  const cosLat = clampedCos(anchorLat);

  const bytes: number[] = [SKETCH_VERSION];
  pushZigzag(bytes, latQ);
  pushZigzag(bytes, lonQ);

  // The running cursor, in integer decimetres east/north of the anchor.
  let cursorEast = 0;
  let cursorNorth = 0;
  const pushPoint = (point: SketchPoint): void => {
    requireFinite(point.lat, 'point.lat');
    requireFinite(point.lon, 'point.lon');
    const east = Math.round((point.lon - anchorLon) * METRES_PER_DEGREE * cosLat * 10);
    const north = Math.round((point.lat - anchorLat) * METRES_PER_DEGREE * 10);
    pushZigzag(bytes, east - cursorEast);
    pushZigzag(bytes, north - cursorNorth);
    cursorEast = east;
    cursorNorth = north;
  };

  for (const shape of shapes) {
    requireColour(shape.colour);
    if (shape.kind === 'pen') {
      if (shape.points.length < 1 || shape.points.length > MAX_PEN_POINTS) {
        throw new RangeError(`pen stroke must have 1..${MAX_PEN_POINTS} points, got ${shape.points.length}`);
      }
      bytes.push((KIND_PEN << 4) | shape.colour);
      pushVarint(bytes, shape.points.length);
      for (const point of shape.points) pushPoint(point);
    } else if (shape.kind === 'arrow') {
      bytes.push((KIND_ARROW << 4) | shape.colour);
      pushPoint(shape.from);
      pushPoint(shape.to);
    } else {
      requireFinite(shape.radiusM, 'radiusM');
      if (shape.radiusM < 0) throw new RangeError(`radiusM must be >= 0, got ${shape.radiusM}`);
      bytes.push((KIND_CIRCLE << 4) | shape.colour);
      pushPoint(shape.centre);
      pushVarint(bytes, Math.round(shape.radiusM * 10));
    }
  }

  const encoded = toBase64url(bytes);
  if (encoded.length > MAX_SKETCH_CHARS) {
    throw new RangeError(`encoded sketch is ${encoded.length} chars; the cap is ${MAX_SKETCH_CHARS}`);
  }
  return encoded;
}

// --- decode ---------------------------------------------------------------

/**
 * The cheap validity check the resolver uses: length and charset, no decode.
 * The server has no business knowing what a sketch contains.
 */
export function isValidSketchPayload(encoded: string): boolean {
  return (
    typeof encoded === 'string' &&
    encoded.length >= 1 &&
    encoded.length <= MAX_SKETCH_CHARS &&
    /^[A-Za-z0-9_-]+$/.test(encoded)
  );
}

/**
 * Decode a sketch. Returns null on ANY malformed input and never throws —
 * truncated buffer, unknown version, unknown shape kind, counts over the
 * caps, geometry outside the sanity bounds. A dispatcher losing the position
 * because a sketch failed to parse would be a bad trade, so the contract is:
 * this either returns a well-formed sketch or tells you quietly that there
 * isn't one.
 */
export function decodeSketch(encoded: string): Sketch | null {
  if (!isValidSketchPayload(encoded)) return null;
  const bytes = fromBase64url(encoded);
  if (bytes === null) return null;

  let offset = 0;
  const readByte = (): number | null => (offset < bytes.length ? bytes[offset++]! : null);

  const readVarint = (): number | null => {
    let value = 0;
    let scale = 1;
    // 8 bytes = 56 bits, past Number's 2^53 of exact integers. A varint that
    // long is either hostile or corrupt; a real delta fits in five.
    for (let i = 0; i < 8; i++) {
      const byte = readByte();
      if (byte === null) return null;
      value += (byte % 128) * scale;
      if (byte < 128) return value;
      scale *= 128;
    }
    return null;
  };

  const readZigzag = (): number | null => {
    const value = readVarint();
    if (value === null) return null;
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
  };

  const version = readByte();
  if (version !== SKETCH_VERSION) return null;

  const latQ = readZigzag();
  const lonQ = readZigzag();
  if (latQ === null || lonQ === null) return null;
  if (Math.abs(latQ) > 90e5 || Math.abs(lonQ) > 180e5) return null;

  const anchorLat = latQ / 1e5;
  const anchorLon = lonQ / 1e5;
  const cosLat = clampedCos(anchorLat);

  let cursorEast = 0;
  let cursorNorth = 0;
  const readPoint = (): SketchPoint | null => {
    const dEast = readZigzag();
    const dNorth = readZigzag();
    if (dEast === null || dNorth === null) return null;
    cursorEast += dEast;
    cursorNorth += dNorth;
    if (Math.abs(cursorEast) > MAX_CURSOR_DECIMETRES) return null;
    if (Math.abs(cursorNorth) > MAX_CURSOR_DECIMETRES) return null;
    return {
      lat: anchorLat + cursorNorth / 10 / METRES_PER_DEGREE,
      lon: anchorLon + cursorEast / 10 / (METRES_PER_DEGREE * cosLat),
    };
  };

  const shapes: SketchShape[] = [];
  while (offset < bytes.length) {
    if (shapes.length >= MAX_SKETCH_SHAPES) return null;
    const head = readByte();
    if (head === null) return null;
    const kind = head >> 4;
    const colour = head & 0x0f;
    if (colour > 3) return null;

    if (kind === KIND_PEN) {
      const count = readVarint();
      if (count === null || count < 1 || count > MAX_PEN_POINTS) return null;
      const points: SketchPoint[] = [];
      for (let i = 0; i < count; i++) {
        const point = readPoint();
        if (point === null) return null;
        points.push(point);
      }
      shapes.push({ kind: 'pen', colour: colour as SketchColour, points });
    } else if (kind === KIND_ARROW) {
      const from = readPoint();
      const to = readPoint();
      if (from === null || to === null) return null;
      shapes.push({ kind: 'arrow', colour: colour as SketchColour, from, to });
    } else if (kind === KIND_CIRCLE) {
      const centre = readPoint();
      if (centre === null) return null;
      const radius = readVarint();
      if (radius === null || radius > MAX_RADIUS_DECIMETRES) return null;
      shapes.push({ kind: 'circle', colour: colour as SketchColour, centre, radiusM: radius / 10 });
    } else {
      return null;
    }
  }

  return { anchor: { lat: anchorLat, lon: anchorLon }, shapes };
}

// --- geometry helpers -----------------------------------------------------

/**
 * Ramer–Douglas–Peucker at a metre tolerance, for pen strokes before
 * encoding. 1.5 m keeps every deliberate wiggle a finger can make and throws
 * away sampling noise — a stroke sampled every few pixels for 20 seconds is
 * thousands of points, nearly all of them on straight lines.
 *
 * Endpoints are always kept. Two points or fewer come back as-is.
 */
export function simplifyStroke(points: SketchPoint[], toleranceM = 1.5): SketchPoint[] {
  if (points.length <= 2) return points.slice();

  // Project once into metres around the first point; RDP wants a metric
  // space, and degrees are not one (a degree of longitude shrinks with
  // latitude).
  const first = points[0]!;
  const cosLat = clampedCos(first.lat);
  const xy = points.map((p) => ({
    x: (p.lon - first.lon) * METRES_PER_DEGREE * cosLat,
    y: (p.lat - first.lat) * METRES_PER_DEGREE,
  }));

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  // Explicit stack, not recursion: a pathological stroke would otherwise
  // recurse once per point.
  const ranges: Array<[number, number]> = [[0, points.length - 1]];
  while (ranges.length > 0) {
    const [start, end] = ranges.pop()!;
    if (end - start < 2) continue;

    const a = xy[start]!;
    const b = xy[end]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;

    let worst = -1;
    let worstDistSq = 0;
    for (let i = start + 1; i < end; i++) {
      const p = xy[i]!;
      let distSq: number;
      if (lengthSq === 0) {
        distSq = (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
      } else {
        // Perpendicular distance to the segment, clamping to its ends.
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
        distSq = (p.x - (a.x + t * dx)) ** 2 + (p.y - (a.y + t * dy)) ** 2;
      }
      if (distSq > worstDistSq) {
        worstDistSq = distSq;
        worst = i;
      }
    }

    if (worst !== -1 && worstDistSq > toleranceM * toleranceM) {
      keep[worst] = true;
      ranges.push([start, worst], [worst, end]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

/**
 * South-west / north-east bounds of a sketch's content, as [lat, lon] pairs
 * (Leaflet's corner order), or null for an empty sketch. Circles contribute
 * their full extent, not just their centres — a map fitted to centres would
 * clip a big circle at the edge.
 *
 * The anchor is deliberately NOT included: it is a compression origin, and a
 * sketch drawn far from where the code was minted should fit to the drawing.
 */
export function sketchBounds(sketch: Sketch): [[number, number], [number, number]] | null {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;

  const include = (lat: number, lon: number): void => {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  };

  for (const shape of sketch.shapes) {
    if (shape.kind === 'pen') {
      for (const point of shape.points) include(point.lat, point.lon);
    } else if (shape.kind === 'arrow') {
      include(shape.from.lat, shape.from.lon);
      include(shape.to.lat, shape.to.lon);
    } else {
      const dLat = shape.radiusM / METRES_PER_DEGREE;
      const dLon = shape.radiusM / (METRES_PER_DEGREE * clampedCos(shape.centre.lat));
      include(shape.centre.lat - dLat, shape.centre.lon - dLon);
      include(shape.centre.lat + dLat, shape.centre.lon + dLon);
    }
  }

  return south === Infinity ? null : [[south, west], [north, east]];
}
