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

### Tier 1 — finish "truly usable" (nearly there)
- [x] **C1 PWA service worker + offline shell** — done.
- [ ] **Captive-portal probe bug** (`web/connectivity.ts:81`, `if (online) return`
      short-circuits the case its own comment describes). Directly affects
      offline detection — worth fixing now the offline path matters.
- [ ] **Dispatcher map never passes `offline`** — tiles failing show a bare grey
      box in the console with no explanation. One-line fix.

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

---

## Recommended next step

Tier 1's two small fixes (captive-portal probe, dispatcher offline prop) close
out the offline story cleanly, then Tier 2's redaction/audit is the thing to do
before this is shown as anything more than a tester.
