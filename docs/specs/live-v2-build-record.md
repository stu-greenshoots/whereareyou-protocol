# Live v2 — build record

**Status: built, integration-tested against the real stack, and DEPLOYED,
2026-08-22 (evening).** This is the record of the release that built out the
whole [`IDEAS.md`](../IDEAS.md) backlog (supervised agents, one evening). The
wire contract is [`live-v2-contract.md`](live-v2-contract.md); per-idea status
lines live in IDEAS.md itself. Accounts & saved maps landed first in a
separate session (api `eead48e`, web `4550ad1` — record:
[`accounts-build-plan.md`](accounts-build-plan.md)) and deployed with this.

## What shipped

- **Wire (protocol v0.2.0):** chat, zones, events, `markers[]`, participant
  metadata incl. avatar, expiry fanout, +8 `MARKER_ICONS`. One batched
  release — one pin dance, not five.
- **Chat** — server 50-message ring with late-joiner replay; web composer
  with optimistic-send dedupe, unread badge, transient bubble over the
  sender's marker; read-only panel on the dispatcher console.
- **Zones & events** — named zones via the circle tool with ack-echo
  reconcile; server-side enter/leave/reached hysteresis engine; activity
  feed; user cards with joined/last-seen/accuracy and trails (fixing the
  dormant `Map.tsx` trail-removal bug on the way).
- **Multi-markers** — up to 20 with icon + name, full-list replace, legacy
  `marker` mirrored on both REST and WS.
- **Extend** — `{updateToken, addMinutes 1..180}`, 24h cumulative cap;
  +30m/+1h/+3h on the owner's code screen with countdown and clamp message;
  expiry fanout to joiners.
- **Push plumbing** — VAPID persisted in Redis (`push:vapid`, env override);
  subscriptions stored with the session's TTL so structural expiry holds by
  construction; resolve-notification, T-5min expiry warning, and
  joined/activity/chat pushes with a 60s per-kind throttle; hand-authored SW
  (generateSW→injectManifest) with push + notificationclick; Notify-me
  affordance, permission on tap only, hidden when unsupported.
- **Installed-app polish** — 17 iOS splash PNGs + link tags; offline gating
  audit (online-only affordances withheld behind quiet notes; offline mint +
  lookup stay first-class).
- **Compass view** — full-screen rose from the live bar, iOS
  permission-on-tap, `webkitCompassHeading`/absolute-alpha, low-pass
  smoothing, participants + markers at bearings with distances, desktop
  north-up fallback.
- **Map & markers** — CARTO tiles (Voyager public / Dark Matter console);
  OpenInMaps on share + console; bold restyle (circle = person, diamond =
  claim, colour-blind-safe); the marked-spot-survives-live fix (**measured**
  root cause: the hand-placed pin's stored position was overwritten by live
  GPS on go-live — fix promotes the placed pin to a marked spot).
- **Rejected, deliberately:** idea 10's restart-same-code — it re-arms a code
  spoken aloud in public, and resume-with-fresh-code already covers the
  story. Decision recorded in THREAT-MODEL.md (`80c3519`).

## Commit chain

**protocol** (pushed; 74 tests green):
- `115151d` — the v0.2.0 wire release above.
- `80c3519` — THREAT-MODEL addendum for the live-v2 + push surface, incl. the
  rejected restart-same-code decision.

**api** (`main` = `1c391e0`, pushed, deployed to Render via the deploy hook,
health verified; 180 tests green):
- `f40d7a9` — extend endpoint + web-push plumbing (VAPID/subscribe/resolve +
  expiry-warning pushes).
- `ad51962` — the live-v2 server: typed frames (the accounts avatar seam
  deleted — avatar is now protocol-owned), chat ring, zones ack-echo,
  hysteresis engine, `markers[]` with legacy mirror, pushes with throttle.
  Extended the pino redact list (marker/markers/subscription — closing a
  pre-existing `req.body.marker` gap; the B8 redaction work remains open).
- `1c391e0` — integration fixes (below).

**web** (`main` = `754909f`, pushed, deployed to Pages **from this exact
revision** with `VITE_API_BASE` + `VITE_DEMO_API_KEY`, CNAME intact):
- `1285b5f` — CARTO tiles, OpenInMaps, marked-spot fix, fitContent framing.
- `b9d90b6` + `5ab88d0` — the live-v2 UI (chat, zones, feed, cards + trails,
  multi-markers, bold restyle).
- `1f6888d` — injectManifest SW with push handlers; Notify-me.
- `586af05` — extend UI + expiry fanout handling.
- `f2898af` — iOS splash set; offline gating audit.
- `1fb67d1` — compass view.
- `754909f` — integration fixes (below).

## Integration pass

Full real stack: Redis + api + two/three browser tabs, injected geolocation,
fabricated coordinates. Verified: chat both ways incl. late-joiner replay;
zone create/remove from both sides; detection firing **exactly one**
entered/left/reached per contract (wire-probed); markers replace + legacy
mirror via curl; extend moving both countdowns; push subscribe 204 / junk
400 / TTL following the session incl. the post-extend bump; the dispatcher
watcher console; compass with real targets; trails on card open/close.

Three bugs found and fixed by measuring, none by reading:

1. **Newest state frame lost to rate limiting** — the per-type rate floor is
   now trailing-edge for state frames, so the latest markers/sketch/position
   always wins (api `1c391e0`).
2. **Zombie live rooms** — DELETE/revoke now expires the live room instead of
   leaving it running past the session (api `1c391e0`). The test harness also
   now shares one `LiveRooms` between REST and WS routes, as prod does.
3. **Owner presence + ended rooms** — code-screen presence now carries the
   account name/avatar, and an ended room says so instead of "Reconnecting…"
   (web `754909f`).

## Known open

- **Real push delivery is untested end to end** — subscribe/storage/trigger
  paths are exercised; delivery needs a phone.
- **Phone-eyeball list for Stu:** iOS splash set; compass real heading + iOS
  permission flow; push on an installed PWA; two-device live rooms with
  avatars; offline gating on a real network drop.
- **Live third-party sessions mislabel on the console** — the stored subject
  stays `third-party` while the position becomes the caller's live fix, so
  the REPORTED banner mislabels. Found during measurement, not yet fixed
  (Tier 2 in TODO.md). Also: owner pin is blue in the live room, amber on
  the resolve screen.
- **Compass label overlap** when a person stands exactly on a marker
  (cosmetic).
- **In-memory push throttles and T-5 expiry-warning timers don't survive an
  api restart** — documented POC posture, accepted.
- The B8 audit log / redaction false-claim and the silently-dropped
  live-update failures in `web/Share.tsx` predate this release and are
  **still open** (Tier 2 in TODO.md).
