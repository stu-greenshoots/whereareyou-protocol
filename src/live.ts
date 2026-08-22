import { parseCode } from './code.js';
import { isValidSketchPayload } from './sketch.js';
import { MARKER_ICONS, MAX_MARKER_NAME_CHARS, MAX_SESSION_MARKERS } from './types.js';
import type { MarkerIcon, Position, SessionMarker } from './types.js';

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
 * Version 2 makes the room a place people can also TALK and AGREE: chat,
 * named zones with enter/leave events, several markers with "reached"
 * events, participant history, and a live expiry that can move. All of the
 * new state lives in room memory and dies with the session; none of it may
 * ever reach a log — chat bodies, zone names, trails and avatars are user
 * content, and the audit posture is the same as for positions: record THAT
 * things happened, never WHAT or WHERE.
 *
 * POC posture, stated plainly: the code grants presence and write access,
 * not just read. The deferred-security register lives in
 * docs/specs/live-sessions-build-plan.md §5.
 *
 * THE TOLERANCE RULE — load-bearing, both directions. A receiver MUST
 * silently ignore any message whose `type` it does not recognise, and any
 * unknown fields on messages it does. The three repos pin this package at
 * different commits at different times (the "pin dance"), so an old client
 * WILL meet a new server and vice versa; ignoring the unrecognised is what
 * makes that skew survivable instead of fatal. Never close a connection or
 * surface an error over a message type you do not know.
 */

export const LIVE_PROTOCOL_VERSION = 2;
export const MAX_LIVE_NAME_CHARS = 40;
export const MAX_ROOM_PARTICIPANTS = 16;

/** Longest chat message, in UTF-16 code units. Longer text is truncated. */
export const MAX_CHAT_TEXT_CHARS = 500;
/** Chat messages the room retains for late joiners. Oldest drop first. */
export const MAX_CHAT_HISTORY = 50;
/** Most zones a session may carry. Creates beyond this are dropped. */
export const MAX_SESSION_ZONES = 20;
/** Longest zone name, in UTF-16 code units. Longer names are truncated. */
export const MAX_ZONE_NAME_CHARS = 60;
/** Zone radius bounds in metres. Outside them the create is malformed. */
export const MIN_ZONE_RADIUS_M = 1;
export const MAX_ZONE_RADIUS_M = 10_000;
/** Events the room retains for late joiners. Oldest drop first. */
export const MAX_EVENT_HISTORY = 50;
/** Recent fixes carried per participant in the welcome roster. */
export const MAX_TRAIL_FIXES = 20;
/**
 * Longest avatar payload, in UTF-16 code units. An avatar is a
 * `data:image/(png|jpeg|webp);base64,...` URL and nothing else; anything
 * unusable is dropped silently — decoration must never cost the join.
 * 10KB sits well inside the 16KB frame cap with room for the rest of hello.
 */
export const MAX_AVATAR_CHARS = 10_240;

/**
 * ZONE AND MARKER DETECTION — the numbers both ends must agree on.
 *
 * Detection runs SERVER-side, in the room relay: positions already flow
 * through it, and one authority means one consistent event stream. GPS
 * jitter at a boundary would fire enter/leave/enter/leave forever, so the
 * contract is hysteresis, verbatim:
 *
 *   ENTER a zone:   distance < radiusM on ZONE_ENTER_CONSECUTIVE_FIXES
 *                   consecutive fixes from that participant.
 *   LEAVE a zone:   distance > radiusM + max(fix accuracyM,
 *                   ZONE_LEAVE_SLACK_M) on a single fix, only after an enter.
 *   REACH a marker: the enter test with an effective radius of
 *                   max(MARKER_REACHED_RADIUS_M, fix accuracyM), fired at
 *                   most once per participant per marker id.
 *
 * The full contract, including what happens when zones and markers are
 * removed mid-detection, is docs/specs/live-v2-contract.md.
 */
export const ZONE_ENTER_CONSECUTIVE_FIXES = 2;
export const ZONE_LEAVE_SLACK_M = 20;
export const MARKER_REACHED_RADIUS_M = 25;

export interface LiveParticipant {
  id: string;
  name?: string;
  owner: boolean;
  /**
   * Small identity image as a data URL — see MAX_AVATAR_CHARS. Supplied at
   * hello by logged-in participants; anonymous ones have none.
   */
  avatar?: string;
  /** Present only for participants who chose to share their position. */
  position?: Position;
  /** Encoded sketch payload (see `sketch.ts`). Opaque here, as everywhere. */
  sketch?: string;
  /**
   * A point this participant PLACED — "the entrance is here" — as opposed to
   * `position`, which is where they ARE. The two must never be conflated:
   * one is a claim about the world, the other is a live fix.
   *
   * LEGACY MIRROR since v2: `marker`/`markerIcon` are always
   * `markers[0].position` and `markers[0].icon`, or absent when there are
   * no markers. Old readers keep working; new readers use `markers`.
   */
  marker?: Position;
  markerIcon?: MarkerIcon;
  /** All markers this participant has placed, ≤ MAX_SESSION_MARKERS. */
  markers?: SessionMarker[];
  /** ISO 8601, server clock — when this participant's hello was accepted. */
  joinedAt: string;
  /** ISO 8601, server clock — refreshed on every frame received from them. */
  lastSeenAt: string;
  /**
   * Recent fixes, oldest first, ≤ MAX_TRAIL_FIXES. Sent in the WELCOME
   * roster only, so a late joiner sees where people have been; omitted from
   * `participant` fanout to keep every later frame small. Entries missing a
   * `takenAt` were stamped with the server's receipt time. Never logged.
   */
  trail?: Position[];
  updatedAt: string;
}

/**
 * One chat message, as the room retains and fans it out. `id` and `at` are
 * server-assigned. Bodies are user content: rendered as plain text, capped
 * at MAX_CHAT_TEXT_CHARS, and NEVER logged — the audit posture excludes a
 * content field by construction, the same trick as positions.
 */
export interface ChatMessage {
  id: string;
  participantId: string;
  text: string;
  /** ISO 8601, server clock. */
  at: string;
}

/**
 * A named circle on the world — the existing circle tool, given a name and
 * made a first-class object instead of sketch ink. Zones are session-level
 * and shared: any participant may create or remove one (the POC write
 * posture). `createdBy` and `createdAt` are server-stamped.
 */
export interface Zone {
  /** Client-generated id, same rule as marker ids — see `isValidLiveId`. */
  id: string;
  /** 1..MAX_ZONE_NAME_CHARS chars. The name is the point — never logged. */
  name: string;
  /** A placed claim about the world, not a fix. */
  center: Position;
  /** MIN_ZONE_RADIUS_M..MAX_ZONE_RADIUS_M. */
  radiusM: number;
  createdBy: string;
  /** ISO 8601, server clock. */
  createdAt: string;
}

export type LiveEventKind = 'entered' | 'left' | 'reached';

/**
 * One detection outcome, emitted by the server under the hysteresis
 * contract above. `zoneId` is present for 'entered'/'left', `markerId` for
 * 'reached'; ids may refer to zones or markers since removed.
 */
export interface LiveEvent {
  kind: LiveEventKind;
  participantId: string;
  zoneId?: string;
  markerId?: string;
  /** ISO 8601, server clock. */
  at: string;
}

/**
 * CLIENT → SERVER. Receivers MUST ignore unrecognised message types — see
 * the tolerance rule in the header. Everything here is validated by
 * `parseLiveClientMessage` before the server acts on it.
 */
export type LiveClientMessage =
  /**
   * First message on every connection. `share: false` joins as a watcher —
   * present in the roster, never a pin. `updateToken` marks the owner.
   * `avatar` is optional identity decoration; an unusable one is dropped,
   * never a reason to refuse the join.
   */
  | { type: 'hello'; code: string; name?: string; updateToken?: string; share: boolean; avatar?: string }
  | { type: 'position'; position: Position }
  /**
   * LEGACY single-marker form: place one marker (or with null, clear all of
   * this participant's markers). Kept for old clients; treated as a
   * `markers` message with zero or one entry whose id the server assigns.
   */
  | { type: 'marker'; position: Position | null; icon?: MarkerIcon }
  /** Replace this participant's whole marker list, ≤ MAX_SESSION_MARKERS. */
  | { type: 'markers'; markers: SessionMarker[] }
  | { type: 'sketch'; sketch: string }
  /** Say something to the room. Fanned back out as a server `chat`. */
  | { type: 'chat'; text: string }
  /** Create a zone. `createdBy`/`createdAt` are stamped by the server. */
  | { type: 'zone-create'; id: string; name: string; center: Position; radiusM: number }
  | { type: 'zone-remove'; id: string };

export type LiveRefusalReason = 'not-found' | 'not-live' | 'room-full' | 'bad-message';

/**
 * SERVER → CLIENT. Receivers MUST ignore unrecognised message types — see
 * the tolerance rule in the header. That single rule is what lets a v1
 * client sit in a v2 room: the chat, zone, event and expiry traffic passes
 * straight through it, harmlessly.
 */
export type LiveServerMessage =
  /**
   * First message after a successful hello. `chat`, `zones` and `events`
   * are the room's retained history (capped at MAX_CHAT_HISTORY /
   * MAX_SESSION_ZONES / MAX_EVENT_HISTORY); a v2 server always sends them,
   * but clients should treat absence as empty — a v1 server won't.
   */
  | {
      type: 'welcome';
      participantId: string;
      expiresAt: string;
      roster: LiveParticipant[];
      chat: ChatMessage[];
      zones: Zone[];
      events: LiveEvent[];
    }
  /** A participant joined or changed — the whole participant, not a diff. */
  | { type: 'participant'; participant: LiveParticipant }
  | { type: 'left'; participantId: string }
  /** One chat message — the fields of `ChatMessage`, flattened. */
  | { type: 'chat'; id: string; participantId: string; text: string; at: string }
  | { type: 'zone-created'; zone: Zone }
  | { type: 'zone-removed'; id: string }
  /** One detection outcome — the fields of `LiveEvent`, flattened. */
  | { type: 'event'; kind: LiveEventKind; participantId: string; zoneId?: string; markerId?: string; at: string }
  /** The owner extended the session; everyone learns the new expiry. */
  | { type: 'expiry'; expiresAt: string }
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

/** Only the fields the wire promises — nothing smuggled through. */
function sanitisePosition(value: unknown): Position | null {
  if (!isValidPosition(value)) return null;
  return {
    lat: value.lat,
    lon: value.lon,
    accuracyM: value.accuracyM,
    ...(typeof value.source === 'string' ? { source: value.source } : {}),
    ...(typeof value.takenAt === 'string' ? { takenAt: value.takenAt } : {}),
  } as Position;
}

/**
 * The id rule shared by markers and zones: 1..64 characters of
 * `A-Z a-z 0-9 _ -`, so a UUID fits and nothing needs escaping anywhere.
 * Ids are client-generated and must be unique within the session — events
 * refer to zones and markers by id alone. Exported so the REST side can
 * validate `markers` payloads against the same rule without restating it.
 */
export function isValidLiveId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/**
 * An avatar is a small raster data URL and nothing else. Anchored, one
 * charset, no commas beyond the one in the scheme — a payload matching this
 * can still be a hostile image, but it cannot be a script, a URL to fetch,
 * or an SVG with an opinion.
 */
const AVATAR_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

function sanitiseAvatar(value: unknown): string | undefined {
  // Dropped, never fatal: the avatar is decoration, and it is the one hello
  // field that arrives from storage rather than from the user's fingers —
  // a stale or corrupt cached avatar must not cost anyone the join.
  if (typeof value !== 'string') return undefined;
  if (value.length > MAX_AVATAR_CHARS) return undefined;
  return AVATAR_RE.test(value) ? value : undefined;
}

function sanitiseMarker(value: unknown, seen: Set<string>): SessionMarker | null {
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;
  const id = m['id'];
  if (!isValidLiveId(id) || seen.has(id)) return null;
  seen.add(id);
  const position = sanitisePosition(m['position']);
  if (position === null) return null;
  // An unknown icon becomes a plain spot rather than a refusal — the
  // marker's position is worth more than its glyph, and this is exactly the
  // fallback renderers already promise.
  const icon =
    typeof m['icon'] === 'string' && (MARKER_ICONS as readonly string[]).includes(m['icon'])
      ? (m['icon'] as MarkerIcon)
      : 'spot';
  let name: string | undefined;
  if (m['name'] !== undefined) {
    if (typeof m['name'] !== 'string') return null;
    name = m['name'].trim().slice(0, MAX_MARKER_NAME_CHARS);
    if (name === '') name = undefined;
  }
  return { id, position, icon, ...(name !== undefined ? { name } : {}) };
}

/**
 * Parse one raw client frame. Returns null on ANYTHING malformed and never
 * throws — the same contract as `decodeSketch`, for the same reason: these
 * arrive from the network, and one day from anyone who can open a socket.
 *
 * Normalisation happens here so the server never sees dirty input: the code
 * is canonicalised through the same parser dispatchers' typing goes through,
 * names and chat are trimmed and capped, sketches are shape-checked (never
 * decoded), marker and zone ids are held to one charset, and avatars either
 * match the data-URL rule or vanish.
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
    const avatar = sanitiseAvatar(message['avatar']);
    return {
      type: 'hello',
      code: parsed.code,
      share: message['share'],
      ...(name !== undefined ? { name } : {}),
      ...(updateToken !== undefined ? { updateToken } : {}),
      ...(avatar !== undefined ? { avatar } : {}),
    };
  }

  if (message['type'] === 'position' || message['type'] === 'marker') {
    const icon =
      typeof message['icon'] === 'string' && (MARKER_ICONS as readonly string[]).includes(message['icon'])
        ? (message['icon'] as MarkerIcon)
        : undefined;
    if (message['type'] === 'marker' && message['position'] === null) {
      return { type: 'marker', position: null };
    }
    const position = sanitisePosition(message['position']);
    if (position === null) return null;
    return message['type'] === 'position'
      ? { type: 'position', position }
      : { type: 'marker', position, ...(icon !== undefined ? { icon } : {}) };
  }

  if (message['type'] === 'markers') {
    const raw = message['markers'];
    if (!Array.isArray(raw) || raw.length > MAX_SESSION_MARKERS) return null;
    const seen = new Set<string>();
    const markers: SessionMarker[] = [];
    for (const entry of raw) {
      const marker = sanitiseMarker(entry, seen);
      if (marker === null) return null;
      markers.push(marker);
    }
    // An empty list is valid — it clears every marker, like `marker: null`.
    return { type: 'markers', markers };
  }

  if (message['type'] === 'sketch') {
    if (typeof message['sketch'] !== 'string' || !isValidSketchPayload(message['sketch'])) return null;
    return { type: 'sketch', sketch: message['sketch'] };
  }

  if (message['type'] === 'chat') {
    if (typeof message['text'] !== 'string') return null;
    // Truncated, not rejected — the same rule as the session note: text
    // that is too long should not cost someone their message.
    const text = message['text'].trim().slice(0, MAX_CHAT_TEXT_CHARS);
    if (text === '') return null;
    return { type: 'chat', text };
  }

  if (message['type'] === 'zone-create') {
    const id = message['id'];
    if (!isValidLiveId(id)) return null;
    if (typeof message['name'] !== 'string') return null;
    const name = message['name'].trim().slice(0, MAX_ZONE_NAME_CHARS);
    // A zone without a name is just ink — the name is the whole point.
    if (name === '') return null;
    const center = sanitisePosition(message['center']);
    if (center === null) return null;
    const radiusM = message['radiusM'];
    if (typeof radiusM !== 'number' || !Number.isFinite(radiusM)) return null;
    if (radiusM < MIN_ZONE_RADIUS_M || radiusM > MAX_ZONE_RADIUS_M) return null;
    return { type: 'zone-create', id, name, center, radiusM };
  }

  if (message['type'] === 'zone-remove') {
    const id = message['id'];
    if (!isValidLiveId(id)) return null;
    return { type: 'zone-remove', id };
  }

  return null;
}
