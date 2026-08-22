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

**C1 (PWA) — DONE.** Manifest, icons, favicon, and now the service worker:
the shell (HTML/JS/CSS/fonts/icons, ~600 KB, 17 entries) is precached, so the
app installs to a home screen and opens with no signal. Offline, a failed mint
falls through to the offline codec, so the whole no-signal path is coherent.

---

## Plan going forward

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

  _Both implemented and building clean (`npm run build` = tsc + vite + PWA).
  Not yet deployed, and the offline map states + captive-portal downgrade still
  need eyeballing on a real device — the UI can't be seen from the CLI._

### Tier 2 — trustworthy for real use (before it's more than a tester)
- [ ] **B8 audit log + fix the broken log redaction.** The redaction never
      worked and the API README still implies it does — a false claim about a
      safety property. Make `AuditEvent` have no position field so a leak is a
      compile error.
- [ ] **Live-update failures are silently dropped** (`web/Share.tsx`) — a live
      session that loses signal mid-stream never reports it.

### Tier 3 — depth features
- [ ] **B6 + D5 — live sessions over SSE** (moving casualty tracking). Fix the
      **trail-polyline removal bug** (`Map.tsx:159`, no `else` branch) as part
      of this — it's dormant only because nothing passes `trail` yet. Auth via a
      short-lived stream ticket (decided in the spec).
- [ ] **E1 — demo mode** (fake-position control for indoor demos). Partly
      covered now by manual-pin placement.

### Tier 4 — open-source + pitch
- [ ] **B9 — docker-compose.** Unblocked: the protocol is public, so `npm ci`
      needs no credentials.
- [ ] **E3 — README that leads with the problem + a 5-minute demo script.**
- [ ] Publish the **comparison** (vs AML / w3w / Plus Codes) as a public page,
      with the measured Plus Code typo data.

### Word codes — a memorable sentence for the OFFLINE code (22 Jul)

**Decision:** the **offline** code becomes a short, memorable **sentence**; the
**live/share** code stays exactly as it is (8-char + NATO — like a postcode).
**The live app path is untouched.** Full design + status + handoff:
**`docs/WORD-CODES.md`** (read its "Status & handoff" first).

**Current direction — UK 5-word headline sentence** ("Orderly lark sweeps full
pedestal"): UK-scoped, ~3m, 100% error detection. Verified. Working map demo in
`prototype/uk-sentence/` (serve it → localhost:8899).

- [x] **Codec mechanism** — done + verified. NOTE: `src/sentence.ts` on this
      branch is the *earlier* global ~6-word grammatical version (too long, ~12
      spoken words — **superseded**, tests still pass). The current UK 5-word
      codec lives in `prototype/uk-sentence/uk-codec.js` (round-trip clean, 100%
      single-word detection). Porting it into `src/` is part of the next work.
- [ ] **Word-list quality pass — NEXT.** Auto-curated words are still awkward
      ("Adrenal winery pulls balmy stewpot"). Make them clean/concrete/neutral.
      Lists + criteria + constraints + data sources: `prototype/uk-sentence/README.md`.
- [ ] **Port the UK 5-word codec into `src/`** (replacing the superseded version)
      once the words are good.
- [ ] **Read-aloud trial** — protocol drafted (`docs/WORD-CODES-TRIAL.md`); needs
      real voices. The make-or-break test code can't run for us.
- [ ] **Wire into the offline screen only** (sentence leads; letters/lat-long
      demoted). Live screen unchanged. Touches web + deploy — hold for sign-off.
- [ ] **(Later) Global via a leading region word** — one extra word, strict
      superset of the UK build. See `docs/WORD-CODES.md`.

### Draw-on-map annotations for the SHARE code — PLANNED (22 Aug)

**No longer parked.** A full implementation plan now exists:
**`whereareyou-web` branch `claude/map-drawing-share-8t97sb`, `docs/map-drawing-plan.md`.**
Plan only — nothing implemented. It spans all three repos: a `sketch.ts` codec
here, an opaque `sketch` field through the API store and routes, and a Leaflet
drawing layer plus toolbar in the web app.

Key decisions already taken in it: the drawing rides the **session**, not the
link or the code; the resolver stores an **opaque base64url string it never
parses**, so the sketch inherits the session TTL structurally; drawing stays
usable offline but must say plainly that it cannot be sent.

Sequencing hazard, per the plan and confirmed here: the codec must land on
protocol `main` before the other two repos can typecheck against it. Note the
plan understates this slightly — `web` and `api` **pin protocol at a commit in
their lockfiles** (`a73eac2`), so landing on `main` is not enough on its own;
both lockfiles need refreshing too. See the workspace `CLAUDE.md`.

Also note this repo's `word-codes` branch is 5 commits ahead of `main` and
unpushed. Both tracks touch `src/index.ts` exports.

The original idea, for context:

- **Draw-on-map annotations for the SHARE code.** Let the sharer sketch on their
  map — the entrance, an arrow, the route from the nearest station — and have it
  ride along with the session so the dispatcher sees it on resolve. Natural fit:
  the share code is a *pointer to a server record*, so a drawing is just more data
  in that record — no impact on code length, and it's a capability only the
  online code can have (an offline code *is* the location, it can't carry a
  route). Addresses a real gap: a pin says *where*, not *how to get in*. (Stu, 22 Jul.)

---

## Recommended next step

Tier 1's two small fixes (captive-portal probe, dispatcher offline prop) close
out the offline story cleanly, then Tier 2's redaction/audit is the thing to do
before this is shown as anything more than a tester.

Parallel track now in flight: the **offline word/sentence code** — start with the
word-list curation (`docs/WORD-CODES.md`).
