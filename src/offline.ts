import { RADIX, symbolOf, valueOf } from './alphabet.js';
import { checkSymbol, hasValidChecksumOfLength } from './checksum.js';
import { interpretToken } from './phonetic.js';
import { SCRAMBLE_BITS, scramble, unscramble } from './scramble.js';

/**
 * OFFLINE CODES — content-addressable, no server, no connectivity.
 *
 * A session code (see `code.ts`) is a *pointer*: the location lives in a
 * record, so the code can expire, track a moving casualty, carry a note, and be
 * revoked. It cannot work without a network, because the code contains nothing.
 *
 * An offline code is the opposite trade. The location is encoded *into* the
 * code, so it works with no connectivity at all, in either direction, forever —
 * and gives up expiry, live updates, notes and revocation in exchange.
 *
 * Both exist because they fail in different circumstances. Use a session code
 * when there is signal; fall back to this when there is not.
 *
 * ---
 *
 * FORMAT — 10 symbols: 9 payload + 1 checksum.
 *
 * 9 base32 symbols carry 45 bits, split 22 bits of latitude and 23 of
 * longitude over an equirectangular grid. That yields cells of roughly 4.8m
 * north–south and 4.8m east–west at the equator, narrowing with latitude
 * (~3.0m at UK latitudes).
 *
 * WHY ~5m AND NOT 3m. A 3m grid square is false precision when the underlying
 * GNSS fix is ±10m on a good day. what3words markets 3m squares because it
 * sounds impressive, not because a phone can resolve one. Sizing the grid to
 * roughly the accuracy of real input is the honest choice, and it buys the
 * checksum symbol that actually prevents mistakes.
 */

/** Bits of latitude index. 2^22 steps across 180°. */
const LAT_BITS = 22n;
/** Bits of longitude index. 2^23 steps across 360°. */
const LON_BITS = 23n;

const LAT_STEPS = 1n << LAT_BITS;
const LON_STEPS = 1n << LON_BITS;

export const OFFLINE_PAYLOAD_LENGTH = 9;
export const OFFLINE_CODE_LENGTH = OFFLINE_PAYLOAD_LENGTH + 1; // 10

/** Nominal cell size at the equator, in metres. */
export const OFFLINE_RESOLUTION_M = (180 / Number(LAT_STEPS)) * 111_320;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Encode a position as a 10-character offline code.
 *
 * Pure and deterministic — no network, no state, no clock.
 */
export function encodeOffline(lat: number, lon: number): string {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new RangeError(`lat must be between -90 and 90, got ${lat}`);
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new RangeError(`lon must be between -180 and 180, got ${lon}`);
  }

  const latIndex = BigInt(
    clamp(Math.floor(((lat + 90) / 180) * Number(LAT_STEPS)), 0, Number(LAT_STEPS) - 1),
  );
  const lonIndex = BigInt(
    clamp(Math.floor(((lon + 180) / 360) * Number(LON_STEPS)), 0, Number(LON_STEPS) - 1),
  );

  const index = (latIndex << LON_BITS) | lonIndex;
  let scrambled = scramble(index);

  // Emit least-significant symbol first; order is arbitrary but must match
  // the decoder.
  let payload = '';
  for (let i = 0; i < OFFLINE_PAYLOAD_LENGTH; i++) {
    payload += symbolOf(Number(scrambled % BigInt(RADIX)));
    scrambled /= BigInt(RADIX);
  }

  return payload + checkSymbol(payload);
}

export interface OfflinePosition {
  /** Centre of the grid cell. */
  lat: number;
  lon: number;
  /** Nominal cell size at this latitude, in metres. */
  cellSizeM: number;
}

export type OfflineParseFailure = 'wrong-length' | 'unreadable' | 'bad-checksum';

export type OfflineParseResult =
  | { ok: true; code: string; position: OfflinePosition }
  | { ok: false; reason: OfflineParseFailure; normalised: string };

/** Decode a canonical 10-symbol offline code to the centre of its cell. */
export function decodeOffline(code: string): OfflinePosition {
  let scrambled = 0n;
  for (let i = OFFLINE_PAYLOAD_LENGTH - 1; i >= 0; i--) {
    const value = valueOf(code[i]!);
    if (value === undefined) throw new RangeError(`bad symbol at index ${i}`);
    scrambled = scrambled * BigInt(RADIX) + BigInt(value);
  }

  const index = unscramble(scrambled);
  const latIndex = index >> LON_BITS;
  const lonIndex = index & (LON_STEPS - 1n);

  // Return the centre of the cell, not its corner — the corner would bias every
  // decoded position consistently south-west by half a cell.
  const lat = ((Number(latIndex) + 0.5) / Number(LAT_STEPS)) * 180 - 90;
  const lon = ((Number(lonIndex) + 0.5) / Number(LON_STEPS)) * 360 - 180;

  return {
    lat,
    lon,
    cellSizeM: OFFLINE_RESOLUTION_M * Math.cos((lat * Math.PI) / 180),
  };
}

/**
 * Parse permissive human input as an offline code.
 *
 * Accepts the same presentation forms as a session code: spoken, spaced,
 * hyphenated, lowercase, and Crockford aliases.
 */
export function parseOffline(input: string): OfflineParseResult {
  const trimmed = input.trim();
  let normalised = '';
  for (const token of trimmed.split(/\s+/)) {
    if (token === '') continue;
    const interpreted = interpretToken(token);
    if (interpreted === undefined) {
      return { ok: false, reason: 'unreadable', normalised };
    }
    normalised += interpreted;
  }

  if (normalised.length !== OFFLINE_CODE_LENGTH) {
    return { ok: false, reason: 'wrong-length', normalised };
  }
  if (!hasValidChecksumOfLength(normalised, OFFLINE_CODE_LENGTH)) {
    return { ok: false, reason: 'bad-checksum', normalised };
  }

  return { ok: true, code: normalised, position: decodeOffline(normalised) };
}

/** True if `code` is a well-formed offline code. */
export function isValidOfflineCode(code: string): boolean {
  if (code.length !== OFFLINE_CODE_LENGTH) return false;
  for (const char of code) if (valueOf(char) === undefined) return false;
  return hasValidChecksumOfLength(code, OFFLINE_CODE_LENGTH);
}

/** Group an offline code for display: `X7K9P2Q4M3` -> `X7K9-P2Q4-M3`. */
export function formatOfflineCode(code: string): string {
  if (code.length !== OFFLINE_CODE_LENGTH) return code;
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

/** Total number of addressable cells. */
export const OFFLINE_CELL_COUNT = 1n << SCRAMBLE_BITS;
