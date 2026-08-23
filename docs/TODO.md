# Where things are + what's left

Reconciled 2026-07-21, against the original 30 tickets plus everything built
since.

## ✅ Live and working

- **App:** https://whereareyou.stu-bot.uk (installable PWA, offline-capable)
- **API:** https://whereareyou-api.onrender.com (apikey, Redis, structural
  expiry, rate limiting — all confirmed on the deployment; kept warm by a
  Cloudflare cron)
- **way.stu-bot.uk** → redirects to the app (Cloudflare)
- Safe Browsing cleared; Locator-o logo, favicon, icons; protocol + web repos
  public.

## Ticket reconciliation

**Done (25):** A1 A2 A3 A4 A5 · B1 B2 B3 B4 B5 B7 · C1 C2 C3 C4 C5 C6 C7 ·
D1 D2 D3 D4 D6 · E2 E4

**Built beyond the tickets:** the deployment itself, both custom domains, the
logo/identity, GPS accuracy refinement + poor-fix prompt, zoom-based manual-pin
accuracy, the locate-me control, scroll-to-top on mint.

**Accounts & saved maps (22 Aug evening)** — optional accounts (local by
default, server-backed by choice), named map saving from every surface, a
profile drawer, and avatar map markers. Record:
[`specs/accounts-build-plan.md`](specs/accounts-build-plan.md). Built and
verified locally, then **deployed the same evening** with live-v2 (api
`eead48e`, web `4550ad1`).

**Live v2 (22 Aug evening) — the whole [`IDEAS.md`](IDEAS.md) backlog, built
and deployed.** One batched wire release (protocol v0.2.0, `115151d`): chat,
named zones, enter/leave/reached events, `markers[]`, participant metadata
incl. avatars, expiry fanout, +8 marker icons. The contract is
[`specs/live-v2-contract.md`](specs/live-v2-contract.md); the build record —
commit chain per repo, what the integration pass verified and fixed (three
real bugs), and the honest open list — is
[`specs/live-v2-build-record.md`](specs/live-v2-build-record.md). api
`1c391e0` deployed to Render (hook + health verified), web `754909f` to
Pages; lockfile pins refreshed to protocol `80c3519` in both consumers.
Restart-same-code (idea 10) was **rejected**, recorded in THREAT-MODEL.md.

_Verification owed from live-v2: **real push delivery is untested end to
end** — subscribe/storage/trigger paths are exercised, delivery needs a
phone. Phone-eyeball list for Stu: the iOS splash set, compass real heading +
iOS permission flow, push on an installed PWA, two-device live rooms with
avatars, offline gating on a real network drop._

**C1 (PWA) — DONE.** Manifest, icons, favicon, and now the service worker:
the shell (HTML/JS/CSS/fonts/icons, ~600 KB, 17 entries) is precached, so the
app installs to a home screen and opens with no signal. Offline, a failed mint
falls through to the offline codec, so the whole no-signal path is coherent.

---

## Plan going forward

> **Unticketed ideas live in [`IDEAS.md`](IDEAS.md)** — 11 from Stu on
> 22 Aug (chat, zones/arrival tracking, routes, push, compass, extend, map
> upgrade, …), each thought through against the code but deliberately not
> scheduled. Graduate them into tiers here when picked up.

### Tier 1 — finish "truly usable" (NEXT — do these first)

Both are in `whereareyou-web`. Deploy after: see `whereareyou-web/DEPLOY.md`
(the 3-env-var build + gh-pages force-push — don't skip the env vars). Verify on
a real phone where possible; the UI can't be seen from the CLI.

- [x] **C1 PWA service worker + offline shell** — done.

- [x] **Captive-portal probe never runs** — `src/connectivity.ts`. Fixed: the
      probe effect now gates on `verified === 'reachable'` (not `online`), so it
      runs in the optimistic `verified === 'unknown'` state too, and a failed
      probe now records `'unreachable'` so a silent network death downgrades
      instead of leaving the app believing it's connected. Comment + README
      updated to describe the probe that now actually runs. (Side effect: one
      lightweight `/health` GET on load, which promotes optimism to proof.)

- [x] **Dispatcher map shows a bare grey box offline** — `src/Resolve.tsx`.
      Fixed: `Resolve` now calls `useConnectivity()` once and threads
      `offline={!online}` down to both the `SessionView` and `OfflineView`
      `<Map>`s, matching the Share screen.

  _Both implemented and building clean; since deployed. The real-device
  eyeball of the offline states is folded into the live-v2 phone list above —
  the UI can't be seen from the CLI._

### Tier 2 — trustworthy for real use (before it's more than a tester)
- [ ] **B8 audit log + fix the broken log redaction.** The redaction never
      worked and the API README still implies it does — a false claim about a
      safety property. Make `AuditEvent` have no position field so a leak is a
      compile error. _(En route, live-v2 did extend the pino redact list —
      marker/markers/subscription fields, closing a pre-existing
      `req.body.marker` gap (api `ad51962`) — but the audit log is not built
      and the README's false claim still stands.)_
- [ ] **Live-update failures are silently dropped** (`web/Share.tsx`) — a live
      session that loses signal mid-stream never reports it.
- [x] **Live third-party sessions mislabel on the console — FIXED 23 Aug**
      by the marker-share redesign (Stu's spec: a different location is a
      *named marker*, never a person pin). The code resolves to the marker;
      going live flips subject `third-party`→`self` one-way on the upgrade
      (api `46d7f79`) while the marker stays put, and the console banner now
      describes the marker (web `ba2a74b`). Reproduced before fixing.
      Still open from the original finding: the owner pin is blue in the
      live room but amber on the resolve screen (cosmetic inconsistency).

### Tier 3 — depth features
- [x] **B6 + D5 — live sessions** (moving casualty tracking) — shipped 22 Aug
      over WebSockets rather than SSE (record:
      `specs/live-sessions-build-plan.md`), extended by live-v2. The
      **trail-polyline removal bug** (`Map.tsx`) was fixed when live-v2's user
      cards started actually passing `trail` (web `b9d90b6`+`5ab88d0`).
- [ ] **E1 — demo mode** (fake-position control for indoor demos). Partly
      covered now by manual-pin placement.
- [ ] **Compass label overlap** — labels collide when a person stands exactly
      on a marker. Cosmetic live-v2 leftover.

### Tier 4 — open-source + pitch
- [ ] **B9 — docker-compose.** Unblocked: the protocol is public, so `npm ci`
      needs no credentials.
- [ ] **E3 — README that leads with the problem + a 5-minute demo script.**
- [ ] Publish the **comparison** (vs AML / w3w / Plus Codes) as a public page,
      with the measured Plus Code typo data.

---

## Recommended next step

The outstanding verification first: Stu's phone pass over the live-v2 eyeball
list, including a real push delivery — nothing there has been seen on real
hardware. Then Tier 2 is the thing to do before this is shown as anything
more than a tester: the redaction/audit work (the README's false claim is
still standing) and the new third-party mislabel on the console.
