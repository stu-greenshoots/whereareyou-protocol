import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatCode, generateCode } from '../src/code.js';
import {
  MARKER_REACHED_RADIUS_M,
  MAX_AVATAR_CHARS,
  MAX_CHAT_TEXT_CHARS,
  MAX_LIVE_NAME_CHARS,
  MAX_ZONE_NAME_CHARS,
  MAX_ZONE_RADIUS_M,
  ZONE_ENTER_CONSECUTIVE_FIXES,
  ZONE_LEAVE_SLACK_M,
  isValidLiveId,
  parseLiveClientMessage,
} from '../src/live.js';
import type { ChatMessage, LiveEvent, LiveServerMessage, Zone } from '../src/live.js';
import { MARKER_ICONS, MAX_MARKER_NAME_CHARS, MAX_SESSION_MARKERS } from '../src/types.js';
import type { Position, SessionMarker } from '../src/types.js';

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
          expect([
            'hello',
            'position',
            'marker',
            'markers',
            'sketch',
            'chat',
            'zone-create',
            'zone-remove',
          ]).toContain(message.type);
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

// A structurally fine fix, reused across the v2 cases below.
const FIX = { lat: 51.5, lon: -0.1, accuracyM: 8 };

describe('parseLiveClientMessage: v2 messages', () => {
  it('keeps a valid avatar on hello and drops an unusable one silently', () => {
    const good = parseLiveClientMessage(
      JSON.stringify({ type: 'hello', code: CODE, share: true, avatar: 'data:image/png;base64,iVBORw0KGgo=' }),
    );
    expect(good).toMatchObject({ type: 'hello', avatar: 'data:image/png;base64,iVBORw0KGgo=' });

    // A dropped avatar must never cost the join — the hello still parses.
    for (const avatar of [
      'data:image/svg+xml;base64,AAAA', // an SVG with an opinion
      'javascript:alert(1)',
      'data:image/png;base64,', // empty payload
      'data:image/png;base64,' + 'A'.repeat(MAX_AVATAR_CHARS), // over the cap
      42,
    ]) {
      const message = parseLiveClientMessage(JSON.stringify({ type: 'hello', code: CODE, share: true, avatar }));
      expect(message).not.toBeNull();
      expect('avatar' in (message as object)).toBe(false);
    }
  });

  it('parses chat, trimming and truncating rather than rejecting long text', () => {
    expect(parseLiveClientMessage(JSON.stringify({ type: 'chat', text: '  behind the boathouse  ' }))).toEqual({
      type: 'chat',
      text: 'behind the boathouse',
    });
    const long = parseLiveClientMessage(JSON.stringify({ type: 'chat', text: 'a'.repeat(2000) }));
    if (long?.type !== 'chat') throw new Error('unreachable');
    expect(long.text).toHaveLength(MAX_CHAT_TEXT_CHARS);
  });

  it('rejects blank or non-string chat', () => {
    expect(parseLiveClientMessage(JSON.stringify({ type: 'chat', text: '   ' }))).toBeNull();
    expect(parseLiveClientMessage(JSON.stringify({ type: 'chat', text: 42 }))).toBeNull();
    expect(parseLiveClientMessage(JSON.stringify({ type: 'chat' }))).toBeNull();
  });

  it('parses a marker list, and an empty list that clears every marker', () => {
    const message = parseLiveClientMessage(
      JSON.stringify({
        type: 'markers',
        markers: [
          { id: 'm-1', position: FIX, icon: 'tent', name: '  camp  ' },
          { id: 'm-2', position: FIX, icon: 'water' },
        ],
      }),
    );
    if (message?.type !== 'markers') throw new Error('unreachable');
    expect(message.markers).toHaveLength(2);
    expect(message.markers[0]).toMatchObject({ id: 'm-1', icon: 'tent', name: 'camp' });
    expect(message.markers[1]!.name).toBeUndefined();

    expect(parseLiveClientMessage(JSON.stringify({ type: 'markers', markers: [] }))).toEqual({
      type: 'markers',
      markers: [],
    });
  });

  it('falls back to a plain spot for an unknown marker icon, and caps names', () => {
    const message = parseLiveClientMessage(
      JSON.stringify({
        type: 'markers',
        markers: [{ id: 'm-1', position: FIX, icon: 'helipad', name: 'x'.repeat(200) }],
      }),
    );
    if (message?.type !== 'markers') throw new Error('unreachable');
    expect(message.markers[0]!.icon).toBe('spot');
    expect(message.markers[0]!.name).toHaveLength(MAX_MARKER_NAME_CHARS);
  });

  it('rejects marker lists that are malformed, over the cap, or repeat an id', () => {
    const marker = (id: string) => ({ id, position: FIX, icon: 'spot' });
    const tooMany = Array.from({ length: MAX_SESSION_MARKERS + 1 }, (_, i) => marker(`m-${i}`));
    for (const markers of [
      tooMany,
      [marker('m-1'), marker('m-1')], // duplicate id
      [marker('not a valid id!')],
      [{ id: 'm-1', position: { lat: 99, lon: 0, accuracyM: 1 }, icon: 'spot' }],
      [{ id: 'm-1', position: FIX, icon: 'spot', name: 42 }],
      'not-an-array',
    ]) {
      expect(parseLiveClientMessage(JSON.stringify({ type: 'markers', markers }))).toBeNull();
    }
  });

  it('parses a zone create, trimming and capping the name', () => {
    const message = parseLiveClientMessage(
      JSON.stringify({ type: 'zone-create', id: 'z-1', name: '  the weir  ', center: FIX, radiusM: 150 }),
    );
    expect(message).toEqual({
      type: 'zone-create',
      id: 'z-1',
      name: 'the weir',
      center: { lat: 51.5, lon: -0.1, accuracyM: 8 },
      radiusM: 150,
    });

    const long = parseLiveClientMessage(
      JSON.stringify({ type: 'zone-create', id: 'z-1', name: 'x'.repeat(200), center: FIX, radiusM: 150 }),
    );
    if (long?.type !== 'zone-create') throw new Error('unreachable');
    expect(long.name).toHaveLength(MAX_ZONE_NAME_CHARS);
  });

  it('rejects zone creates without a real name, radius, centre or id', () => {
    const zone = { type: 'zone-create', id: 'z-1', name: 'weir', center: FIX, radiusM: 150 };
    for (const bad of [
      { ...zone, name: '   ' }, // a zone without a name is just ink
      { ...zone, name: 7 },
      { ...zone, radiusM: 0.5 },
      { ...zone, radiusM: MAX_ZONE_RADIUS_M + 1 },
      { ...zone, radiusM: '150' },
      { ...zone, center: { lat: 99, lon: 0, accuracyM: 1 } },
      { ...zone, id: 'nope nope' },
    ]) {
      expect(parseLiveClientMessage(JSON.stringify(bad))).toBeNull();
    }
    expect(parseLiveClientMessage(JSON.stringify({ ...zone, radiusM: MAX_ZONE_RADIUS_M }))).not.toBeNull();
  });

  it('parses zone removes and holds their ids to the shared rule', () => {
    expect(parseLiveClientMessage(JSON.stringify({ type: 'zone-remove', id: 'z-1' }))).toEqual({
      type: 'zone-remove',
      id: 'z-1',
    });
    expect(parseLiveClientMessage(JSON.stringify({ type: 'zone-remove', id: 'z 1' }))).toBeNull();
    expect(parseLiveClientMessage(JSON.stringify({ type: 'zone-remove' }))).toBeNull();
  });
});

describe('isValidLiveId', () => {
  it('accepts a UUID and rejects everything outside the one charset', () => {
    expect(isValidLiveId('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
    expect(isValidLiveId('m_1')).toBe(true);
    expect(isValidLiveId('')).toBe(false);
    expect(isValidLiveId('a'.repeat(65))).toBe(false);
    expect(isValidLiveId('has space')).toBe(false);
    expect(isValidLiveId(42)).toBe(false);
  });
});

describe('live v2 contract constants', () => {
  it('pins the detection numbers the contract doc states verbatim', () => {
    // These three ARE the hysteresis contract. Changing one changes when
    // events fire on every deployed client — it needs the doc, not a tweak.
    expect(ZONE_ENTER_CONSECUTIVE_FIXES).toBe(2);
    expect(ZONE_LEAVE_SLACK_M).toBe(20);
    expect(MARKER_REACHED_RADIUS_M).toBe(25);
  });

  it('extends MARKER_ICONS append-only: the v1 six keep their places', () => {
    expect(MARKER_ICONS.slice(0, 6)).toEqual(['spot', 'warning', 'flag', 'cross', 'car', 'house']);
    for (const icon of ['tent', 'water', 'danger', 'meet', 'dog', 'camera', 'boat', 'tree']) {
      expect(MARKER_ICONS).toContain(icon);
    }
    expect(new Set(MARKER_ICONS).size).toBe(MARKER_ICONS.length);
  });
});

describe('live v2 server messages', () => {
  // Compile-time coverage for the pure types: every variant constructed,
  // every variant handled. The switch has no default, so a variant added to
  // LiveServerMessage without a case here fails to COMPILE — the cheap
  // version of the golden-vector trick for types with no runtime behaviour.
  it('constructs and discriminates every server message variant', () => {
    const position: Position = { lat: 51.5, lon: -0.1, accuracyM: 8, source: 'gnss', takenAt: '2026-08-22T12:00:00.000Z' };
    const marker: SessionMarker = { id: 'm-1', position, icon: 'tent', name: 'camp' };
    const chat: ChatMessage = { id: 'c-1', participantId: 'p-1', text: 'behind the boathouse', at: '2026-08-22T12:00:01.000Z' };
    const zone: Zone = { id: 'z-1', name: 'the weir', center: position, radiusM: 150, createdBy: 'p-1', createdAt: '2026-08-22T12:00:02.000Z' };
    const event: LiveEvent = { kind: 'entered', participantId: 'p-1', zoneId: 'z-1', at: '2026-08-22T12:00:03.000Z' };

    const messages: LiveServerMessage[] = [
      {
        type: 'welcome',
        participantId: 'p-1',
        expiresAt: '2026-08-22T13:00:00.000Z',
        roster: [
          {
            id: 'p-1',
            name: 'Sam',
            owner: true,
            avatar: 'data:image/png;base64,iVBORw0KGgo=',
            position,
            marker: marker.position,
            markerIcon: marker.icon,
            markers: [marker],
            joinedAt: '2026-08-22T11:50:00.000Z',
            lastSeenAt: '2026-08-22T12:00:00.000Z',
            trail: [position],
            updatedAt: '2026-08-22T12:00:00.000Z',
          },
        ],
        chat: [chat],
        zones: [zone],
        events: [event],
      },
      {
        type: 'participant',
        participant: { id: 'p-2', owner: false, joinedAt: '2026-08-22T12:01:00.000Z', lastSeenAt: '2026-08-22T12:01:00.000Z', updatedAt: '2026-08-22T12:01:00.000Z' },
      },
      { type: 'left', participantId: 'p-2' },
      { type: 'chat', ...chat },
      { type: 'zone-created', zone },
      { type: 'zone-removed', id: 'z-1' },
      { type: 'event', kind: 'reached', participantId: 'p-1', markerId: 'm-1', at: '2026-08-22T12:00:04.000Z' },
      { type: 'expiry', expiresAt: '2026-08-22T14:00:00.000Z' },
      { type: 'expired' },
      { type: 'refused', reason: 'room-full' },
    ];

    const describeMessage = (message: LiveServerMessage): string => {
      switch (message.type) {
        case 'welcome':
          return `welcome ${message.roster.length}/${message.chat.length}/${message.zones.length}/${message.events.length}`;
        case 'participant':
          return `participant ${message.participant.id}`;
        case 'left':
          return `left ${message.participantId}`;
        case 'chat':
          return `chat ${message.id}`;
        case 'zone-created':
          return `zone-created ${message.zone.id}`;
        case 'zone-removed':
          return `zone-removed ${message.id}`;
        case 'event':
          return `event ${message.kind}`;
        case 'expiry':
          return `expiry ${message.expiresAt}`;
        case 'expired':
          return 'expired';
        case 'refused':
          return `refused ${message.reason}`;
      }
    };

    expect(messages.map(describeMessage)).toEqual([
      'welcome 1/1/1/1',
      'participant p-2',
      'left p-2',
      'chat c-1',
      'zone-created z-1',
      'zone-removed z-1',
      'event reached',
      'expiry 2026-08-22T14:00:00.000Z',
      'expired',
      'refused room-full',
    ]);
  });
});
