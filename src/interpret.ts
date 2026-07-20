import { CODE_LENGTH } from './checksum.js';
import { parseCode } from './code.js';
import { OFFLINE_CODE_LENGTH, parseOffline, type OfflinePosition } from './offline.js';

/**
 * The two kinds of code, told apart by length alone.
 *
 * Session codes are 8 symbols, offline codes are 10, so a single input box can
 * accept either and route automatically. The user should never have to know
 * which kind they are holding — but the *dispatcher* must be told which one
 * arrived, because they carry very different guarantees:
 *
 *   session — minted moments ago by a live device, may be updating, expires,
 *             can carry a note and a third-party flag, can be revoked.
 *   offline — a permanent grid reference. No expiry, no provenance, no
 *             timestamp. It says where, and nothing else. It could have been
 *             written on a whiteboard last year.
 */
export type Interpretation =
  | { kind: 'session'; code: string }
  | { kind: 'offline'; code: string; position: OfflinePosition }
  | { kind: 'invalid'; reason: InterpretFailure; normalised: string };

export type InterpretFailure =
  | 'empty'
  | 'unreadable'
  | 'too-short'
  | 'too-long'
  | 'bad-checksum';

/**
 * Interpret human input as either kind of code.
 *
 * Accepts all the same presentation forms as the individual parsers: spoken,
 * spaced, hyphenated, lowercase, Crockford aliases, and mixtures.
 */
export function interpretCode(input: string): Interpretation {
  if (input.trim() === '') {
    return { kind: 'invalid', reason: 'empty', normalised: '' };
  }

  const asSession = parseCode(input);
  if (asSession.ok) return { kind: 'session', code: asSession.code };

  const asOffline = parseOffline(input);
  if (asOffline.ok) {
    return { kind: 'offline', code: asOffline.code, position: asOffline.position };
  }

  // Neither matched. Both parsers normalise identically, so either failure
  // carries the same canonical string — use it to give a specific reason.
  const normalised = asSession.normalised;

  if (asSession.reason === 'unreadable') {
    return { kind: 'invalid', reason: 'unreadable', normalised };
  }

  // A length that matches one of the two formats means the symbols were fine
  // and the check digit was not.
  if (normalised.length === CODE_LENGTH || normalised.length === OFFLINE_CODE_LENGTH) {
    return { kind: 'invalid', reason: 'bad-checksum', normalised };
  }

  return {
    kind: 'invalid',
    reason: normalised.length < CODE_LENGTH ? 'too-short' : 'too-long',
    normalised,
  };
}
