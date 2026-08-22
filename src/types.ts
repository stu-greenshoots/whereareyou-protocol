/**
 * Where a position fix came from. Dispatchers need this to judge how much to
 * trust the accuracy figure — a GNSS fix with 8m accuracy means something very
 * different from a network fix claiming the same.
 */
export type PositionSource = 'gnss' | 'network' | 'manual';

/**
 * Whether the session describes where the sharer is, or somewhere else.
 *
 * `third-party` is the case AML structurally cannot serve: someone reporting an
 * incident they are not standing at. The dispatcher must see this distinction,
 * because it changes whether the location is a casualty or a witness.
 */
export type SessionSubject = 'self' | 'third-party';

/**
 * `static` captures a single fix. `live` keeps updating until expiry — a moving
 * casualty, a drifting boat, someone walking to find signal. No coordinate
 * encoding scheme can express this at all; it is only possible because the code
 * is a pointer rather than an encoded position.
 */
export type SessionMode = 'static' | 'live';

export interface Position {
  /** WGS84 latitude in degrees, -90..90. */
  lat: number;
  /** WGS84 longitude in degrees, -180..180. */
  lon: number;
  /** Radius of 95% confidence, in metres. */
  accuracyM: number;
  source: PositionSource;
  /** ISO 8601 timestamp of the fix itself, not of the request. */
  takenAt: string;
}

export interface CreateSessionRequest {
  position: Position;
  mode: SessionMode;
  subject: SessionSubject;
  /** Requested lifetime in seconds. Server clamps to its configured bounds. */
  ttlSeconds?: number;
  /** Free-text note from the sharer, e.g. "third floor, back stairwell". */
  note?: string;
  /**
   * Opaque encoded drawing (see `sketch.ts`). Resolvers store and return it
   * verbatim and are not expected to interpret it. Invalid or oversized
   * sketches are dropped silently — never a reason to refuse the mint.
   */
  sketch?: string;
  /**
   * A spot the sharer MARKED — "the incident is here" — as opposed to
   * `position`, which is where they are. Same validation as a position;
   * invalid markers are dropped silently, never a reason to refuse the mint.
   */
  marker?: Position;
}

export interface CreateSessionResponse {
  code: string;
  /** Grouped for display: `X7K9-P2Q4`. */
  display: string;
  /** Words to read aloud: `X-ray Seven Kilo Nine ...`. */
  phonetic: string;
  expiresAt: string;
  /**
   * Bearer secret authorising updates to and revocation of this session.
   * Held only by the sharer's device; never transits the voice channel.
   */
  updateToken: string;
}

export interface ResolvedSession {
  code: string;
  position: Position;
  mode: SessionMode;
  subject: SessionSubject;
  note?: string;
  /** The sharer's drawing, exactly as their device sent it. Opaque here. */
  sketch?: string;
  /** The spot the sharer marked — somewhere they pointed at, not where they are. */
  marker?: Position;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  /** Identifier of the resolver that claimed this code, if any. */
  claimedBy?: string;
}

export interface UpdatePositionRequest {
  position: Position;
  /**
   * When present, replaces the stored sketch — a caller adding an arrow after
   * the code is already out. Same validation and silent-drop semantics as
   * minting; an invalid sketch never blocks the position update.
   */
  sketch?: string;
  /** When present, replaces the stored marked spot. Same silent-drop rule. */
  marker?: Position;
}

/**
 * Error codes returned by a resolver node.
 *
 * `not-found` intentionally covers four distinct situations: the code never
 * existed, it expired, it was revoked, and it is claimed by a different
 * resolver. Distinguishing them would let an attacker confirm that a guessed
 * code is real, which is exactly the signal enumeration defence must deny.
 */
export type ProtocolErrorCode =
  | 'not-found'
  | 'invalid-code'
  | 'invalid-position'
  | 'unauthorised'
  | 'rate-limited'
  | 'not-live';

export interface ProtocolError {
  error: ProtocolErrorCode;
  message: string;
}
