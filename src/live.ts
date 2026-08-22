import { parseCode } from './code.js';
import { isValidSketchPayload } from './sketch.js';
import type { Position } from './types.js';

/**
 * LIVE ROOMS — a session as a place people are, not just a record.
 *
 * A live session can be joined by anyone holding its code: joiners appear on
 * everyone's map, everyone can draw, and updates travel over a WebSocket as
 * the JSON messages typed here. The session record itself stays the source
 * of truth for the OWNER — their position and sketch are still written
 * through to the store, so a plain resolve never lies — while joiners are
 * ephemeral: they exist only while their socket is open.
 *
 * POC posture, stated plainly: the code grants presence and write access,
 * not just read. The deferred-security register lives in
 * docs/specs/live-sessions-build-plan.md §5.
 */

export const LIVE_PROTOCOL_VERSION = 1;
export const MAX_LIVE_NAME_CHARS = 40;
export const MAX_ROOM_PARTICIPANTS = 16;

export interface LiveParticipant {
  id: string;
  name?: string;
  owner: boolean;
  /** Present only for participants who chose to share their position. */
  position?: Position;
  /** Encoded sketch payload (see `sketch.ts`). Opaque here, as everywhere. */
  sketch?: string;
  /**
   * A point this participant PLACED — "the entrance is here" — as opposed to
   * `position`, which is where they ARE. The two must never be conflated:
   * one is a claim about the world, the other is a live fix.
   */
  marker?: Position;
  updatedAt: string;
}

export type LiveClientMessage =
  /**
   * First message on every connection. `share: false` joins as a watcher —
   * present in the roster, never a pin. `updateToken` marks the owner.
   */
  | { type: 'hello'; code: string; name?: string; updateToken?: string; share: boolean }
  | { type: 'position'; position: Position }
  /** Place (or with null, clear) this participant's single placed marker. */
  | { type: 'marker'; position: Position | null }
  | { type: 'sketch'; sketch: string };

export type LiveRefusalReason = 'not-found' | 'not-live' | 'room-full' | 'bad-message';

export type LiveServerMessage =
  | { type: 'welcome'; participantId: string; expiresAt: string; roster: LiveParticipant[] }
  /** A participant joined or changed — the whole participant, not a diff. */
  | { type: 'participant'; participant: LiveParticipant }
  | { type: 'left'; participantId: string }
  | { type: 'expired' }
  | { type: 'refused'; reason: LiveRefusalReason };

function isValidPosition(value: unknown): value is Position {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p['lat'] === 'number' &&
    Number.isFinite(p['lat']) &&
    p['lat'] >= -90 &&
    p['lat'] <= 90 &&
    typeof p['lon'] === 'number' &&
    Number.isFinite(p['lon']) &&
    p['lon'] >= -180 &&
    p['lon'] <= 180 &&
    typeof p['accuracyM'] === 'number' &&
    Number.isFinite(p['accuracyM']) &&
    p['accuracyM'] >= 0
  );
}

/**
 * Parse one raw client frame. Returns null on ANYTHING malformed and never
 * throws — the same contract as `decodeSketch`, for the same reason: these
 * arrive from the network, and one day from anyone who can open a socket.
 *
 * Normalisation happens here so the server never sees dirty input: the code
 * is canonicalised through the same parser dispatchers' typing goes through,
 * names are trimmed and capped, sketches are shape-checked (never decoded).
 */
export function parseLiveClientMessage(raw: string): LiveClientMessage | null {
  if (typeof raw !== 'string' || raw.length > 16_384) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const message = value as Record<string, unknown>;

  if (message['type'] === 'hello') {
    if (typeof message['code'] !== 'string') return null;
    const parsed = parseCode(message['code']);
    if (!parsed.ok) return null;
    if (typeof message['share'] !== 'boolean') return null;
    let name: string | undefined;
    if (message['name'] !== undefined) {
      if (typeof message['name'] !== 'string') return null;
      name = message['name'].trim().slice(0, MAX_LIVE_NAME_CHARS);
      if (name === '') name = undefined;
    }
    let updateToken: string | undefined;
    if (message['updateToken'] !== undefined) {
      if (typeof message['updateToken'] !== 'string' || message['updateToken'].length > 256) return null;
      updateToken = message['updateToken'];
    }
    return {
      type: 'hello',
      code: parsed.code,
      share: message['share'],
      ...(name !== undefined ? { name } : {}),
      ...(updateToken !== undefined ? { updateToken } : {}),
    };
  }

  if (message['type'] === 'position' || message['type'] === 'marker') {
    if (message['type'] === 'marker' && message['position'] === null) {
      return { type: 'marker', position: null };
    }
    if (!isValidPosition(message['position'])) return null;
    const p = message['position'];
    // Only the fields the wire promises — nothing smuggled through.
    const position = {
      lat: p.lat,
      lon: p.lon,
      accuracyM: p.accuracyM,
      ...(typeof p.source === 'string' ? { source: p.source } : {}),
      ...(typeof p.takenAt === 'string' ? { takenAt: p.takenAt } : {}),
    } as Position;
    return message['type'] === 'position' ? { type: 'position', position } : { type: 'marker', position };
  }

  if (message['type'] === 'sketch') {
    if (typeof message['sketch'] !== 'string' || !isValidSketchPayload(message['sketch'])) return null;
    return { type: 'sketch', sketch: message['sketch'] };
  }

  return null;
}
