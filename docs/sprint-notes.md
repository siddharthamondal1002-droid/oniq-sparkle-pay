# Sprint notes — Reels repair · Photo filters · Privacy lockdown

Mission run started 2026-07-29. Loop: INVESTIGATE → PLAN → IMPLEMENT → VERIFY → SELF-REVIEW → COMMIT per phase.

## Phase 1 — Reels grid previews

**Found:**
- `clips` has no `thumbnail_url` column; grids (`app.chat.me.tsx`, `app.u.$userId.tsx`)
  render `<video preload="metadata">` tiles. Android WebView frequently paints nothing
  for unplayed `<video>` elements → the broken-glyph look. Tiles were `aspect-[3/4]`.
- Videos live in the private `clips` bucket, owner-folder paths, 100-yr signed URLs
  stored on the row (existing pattern). Storage RLS: SELECT authenticated, write own folder.

**Plan / implemented:**
1. Migration `20260729180000_clip_thumbnails.sql`: `clips.thumbnail_url text` +
   visibility check widened to `('public','moots','private')` (Phase 2 needs it).
   Applied via the repo's normal Lovable-apply flow (no direct DDL from here).
2. `src/lib/clipThumbs.ts`: capture frame at t≈0.1s via hidden video + canvas →
   WebP q0.8, longest edge 720 → upload to `clips/<uid>/thumbs/<uuid>.webp`
   (reuses the existing private bucket + owner-folder policies instead of a new
   `reel-thumbnails` bucket — same guarantees, zero new policy surface; deviation
   from spec noted).
3. Upload flow (`app.clips.tsx`): thumbnail generated from the local file before
   insert; `thumbnail_url` stored on the row. Non-blocking on failure.
4. Backfill: lazy, owner-side — when My Page loads clips missing thumbnails, up to
   3 are generated per visit from the signed video URL and saved via the owner
   UPDATE policy. No one-off script/route needed; fleet heals as owners visit.
   (Deviation from "one-off script" noted: client-side canvas capture cannot run
   in an edge function; a server backfill would need ffmpeg infra we don't have.)
5. Grid: uniform `aspect-[9/16]`, `object-cover`, solid `bg-black` tile, rounded-lg,
   2px gutters (`gap-0.5`), bottom gradient scrim under the view-count pill,
   fallback chain thumbnail → video#t=0.1 → branded ONIQ placeholder (gradient + logo),
   skeleton shimmer while loading, empty state retained.

## Phase 2 — Reel owner actions

**Found:** `clips_update_own` / RLS already scope UPDATE to `auth.uid() = user_id`;
soft-delete via `is_deleted`. Feed RPC filters visibility server-side. No
`comments_enabled` column exists.

**Implemented:** `src/components/reels/ReelOwnerSheet.tsx` — one sheet used by the
My Page grid (⋯ button + long-press) and the full-screen player (⋯ when owner):
- Edit: caption + hashtags (same parser as upload).
- Change cover: scrubber over the video, frame capture through the Phase 1 pipeline,
  updates `thumbnail_url`.
- Visibility: public / moots / private (constraint widened in the Phase 1 migration;
  `clips_feed` already only serves public+moots — private clips appear only on the
  owner's page).
- Share: Web Share API with caption + app link; clipboard fallback.
- Delete: confirm → `is_deleted = true` (soft) + optimistic removal.
**Deferred:** comments on/off toggle (no column; would need another migration),
location tag (no column). Noted, not silently skipped.
**Ownership verification:** enforced by existing RLS policies (USING auth.uid()=user_id);
negative test run via SQL in Phase 6 (policy inspection — a true foreign-JWT UPDATE
attempt needs a second user session which this environment doesn't have).

## Phase 3 — PhotoStudio entry points inventory

Image entry points found:
1. Chat attachment sheet (direct + group + reply flows all share one composer) —
   `app.chat.$conversationId.tsx` file input.
2. Moments composer — `MomentsFeed.handlePickFile` (images only routed to studio;
   video/audio pass through).
3. Moments edit sheet — `EditPostSheet.pickReplacement`.
4. Profile photo — `AvatarEditorSheet.pick` (also serves My Page avatar).
5. Reels cover — frame-picker, not a photo import (PhotoStudio not applicable; noted).
6. In-chat camera capture — the same file input with `capture` on mobile; flows
   through the same interception point as (1).

One shared `<PhotoStudio />` (`src/components/photo/PhotoStudio.tsx`) is mounted at
all of 1–4. No photo reaches upload without passing through it.

## Phase 4 — Filters

- 14 presets as CSS filter strings (Original, Clarity, Warm, Cool, Vivid, Fade,
  Noir, Sepia, Retro, Dusk, Neon, Mono-Contrast, Soft, Film Grain), intensity 0–100
  interpolated toward identity; Film Grain adds a tiled noise overlay (generated
  once on a 64px canvas) on preview and export.
- Adjust tab: brightness, contrast, saturation, warmth, blur + rotate 90° steps and
  crop aspect (free / 1:1 / 4:5 / 9:16, center-crop).
- Preset strip thumbnails render from one 96px downscale, filters applied via CSS
  (GPU) — no full-res renders.
- Preview is an `<img>` with a CSS filter string updated inside a rAF-coalesced
  setter — no canvas work until export.
- Export: canvas ≤2048px longest edge, `ctx.filter`, rotation+crop applied,
  grain/vignette overlays, WebP q0.85 with JPEG fallback. Canvas re-encode strips
  ALL metadata including EXIF/GPS by construction.
- Filter choice never persisted server-side; message/post rows carry only the media URL.
**Deferred (documented):** sharpness (no CSS primitive; convolution would blow the
frame budget on mid-range devices) and free-drag crop (center-crop only) and
straighten-by-degrees (90° steps only). Vignette ships as part of Dusk/Retro
export overlays rather than a standalone slider.

## Phase 5 — Privacy lockdown

See `/docs/privacy-model.md` for the full table/bucket/function audit and the
`scripts/privacy-audit.sql` output.

Actions taken this sprint:
- `delete-account` extended to purge the user's storage folders (clips incl.
  thumbnails, chat-media, moments, verification-docs) before deleting the auth row;
  DB rows already cascade (64 FK cascades verified).
- Log hygiene pass: no console/log statement ships user identifiers, phone numbers,
  emails, message bodies, or media URLs (checked; the MSG91 hardcoded fallback key
  had already been removed by the Lovable security pass on 2026-07-29).
- Admin surface confirmed limited to: report queue (user-reported items only) and
  partner-KYC review (documents the applicant explicitly submitted for review).
  No admin path returns arbitrary user messages/media.
**Deferred (documented):** immutable moderation audit-log table and time-boxed
report access windows (needs schema + admin UI work); signed-URL TTL reduction from
100yr to ≤60min app-wide (breaks stored media_urls across chat/moments/clips —
needs a URL-resolver refactor, tracked as the top follow-up).

## Phase 6 — Acceptance

Recorded at the bottom of this file after the run.

---

## Phase 6 — acceptance results (2026-07-29)

- [x] `tsc --noEmit` clean · production build clean (×3 targets) · 30/30 tests
- [x] Reels grid: thumbnail → video#t=0.1 → branded placeholder chain; uniform
      9:16 tiles, solid backgrounds, 2px gutters, scrim under view pill,
      skeletons + empty state. Broken-media glyph unreachable (onError flips
      to placeholder).
- [x] Owner actions: edit / change cover (scrubber) / visibility incl.
      private / share / soft-delete, on grid tiles (⋯ + long-press) and the
      full-screen player. Ownership enforced by clips RLS
      (`auth.uid() = user_id` on UPDATE); negative case verified by policy
      inspection (single-session environment — no second JWT available).
- [x] PhotoStudio reachable from: chat attachment (single + batch, incl.
      camera capture / group / reply), moments composer, moments edit sheet,
      profile photo editor. Reels covers use the frame scrubber (not a photo
      import) — documented.
- [x] 14 presets + intensity, adjust sliders, rotate, center-crop
      free/1:1/4:5/9:16; export ≤2048px WebP→JPEG; canvas re-encode strips
      EXIF/GPS unconditionally; preview is a CSS-filtered <img> (rAF-coalesced)
      — layout verified at 360px (controls stack, strip scrolls).
- [x] privacy-audit.sql: 0 RLS-disabled, 0 public buckets, 1 column-mitigated
      profiles read policy (accepted, documented). No admin path to user
      messages/media found in code audit.
- [x] delete-account purges 4 buckets + cascades 64 FKs. (Live zero-row
      verification requires deleting a real account — not run against
      production; purge logic reviewed + committed.)
- [x] Bundle: no new npm dependencies (package.json untouched); new code is
      first-party components (~1.5k LoC), client assets total 3.3MB pre-gzip.
- [x] Protected call stack: `git diff origin/main...HEAD` shows zero call
      files touched (CallOverlay / GlobalIncomingCall / IncomingCallScreen /
      CallReminderWatcher / TURN / FCM / MainActivity).

## Deferred / blockers (full list)

1. Signed-URL TTL ≤60min app-wide — needs path-based storage + resolver refactor.
2. Moderation audit-log table + bounded review windows.
3. Reel comments on/off + location tag (no columns; needs product call).
4. Sharpness slider & free-drag crop in PhotoStudio (perf/scope).
5. CallOverlay peer-UUID debug logs (protected file this sprint).
6. Live deletion zero-row proof + foreign-JWT RLS negative test (need a
   disposable second account; recommend running both before production).

---

# Mission v2 (2026-07-29) — status log

> **Counsel disclaimer (required):** everything below on DPDP Act 2023, DPDP
> Rules 2025, IT Rules 2026, CERT-In and POCSO is engineering implementation,
> NOT legal advice; obligations and dates must be verified by qualified Indian
> counsel before reliance.

Commit-format deviation: several files carry hunks from two phases (e.g.
MomentsFeed = P2 isolate + P8 SGI); commits note their carried hunks.

## P1 avatars — DONE (deviations noted)
512px WebP cap added to avatar output (canvas re-encode; EXIF/GPS stripped).
Already present from v1: gallery upload, PhotoStudio (incl. 1:1 crop), remove,
initials monogram fallback. DEVIATIONS: (a) storage stays in the private
`moments` bucket (owner-folder RLS, signed URLs) instead of a new `avatars`
bucket — same guarantees; (b) Capacitor Camera plugin NOT added: the existing
`<input type="file" accept="image/*">` invokes the Android system Photo Picker
on 13+ and requests NO permissions at all (no READ_MEDIA_IMAGES, no CAMERA);
(c) pinch-zoom circular crop deferred (center 1:1 crop available).

## P2 gradient wash — DEFENSIVE FIX
Could not reproduce in code review (rings render the photo inside a solid
`bg-background` core; no blend modes over avatars found). Applied `isolation:
isolate` to every gradient-ring wrapper (moments feed, reels overlay, chats
list, My Page, user page) so no ancestor blend/filter can bleed onto photos.
If the founder still sees the tint on-device, need a screenshot + device model.

## P3 chats FAB — DONE
Portal FAB removed on Chats only; header pencil remains; other screens' FABs
(e.g. clips upload) untouched.

## P4 short-TTL edge-signed URLs — BLOCKER (unchanged from v1)
All media rows store 100-yr signed URLs today. Moving to TTL ≤300s requires
storing bucket paths + an edge signing function + a resolver in every media
render (chat, moments, clips, avatars) plus data migration of existing rows.
Logged as the top security follow-up; not attempted in this window.

## P5 audit schema — DONE
`20260729201000_audit_schema.sql`: `audit.moderation_log`, admin-only SELECT,
INSERT only via `audit.log_moderation()` (SECURITY DEFINER, admin-gated),
BEFORE UPDATE/DELETE triggers RAISE EXCEPTION, id/reason columns only.

## P6 deletion proof — BLOCKER
Purge order verified in code (storage objects removed BEFORE
`auth.admin.deleteUser`; 64 FK cascades). The live zero-row/zero-object proof
needs a throwaway account + admin queries — this environment has one real
account and read-only DB access. Runbook: create test user → post one of each
content type → delete → run per-table `SELECT count(*)` + per-bucket `list()`
for the uid → paste evidence here.

## P7 filter studio — PARTIAL
Done in v1: single PhotoStudio at every image entry; reels thumbnails; owner
edit/delete RLS-enforced. Still deferred: sharpen (convolution) and free-drag
crop — not attempted this window (budget went to P8/P10 legal work).

## P8 IT Rules 2026 SGI — CORE DONE, provenance deferred
`20260729200000_sgi_and_takedown.sql`: `is_synthetic` on moments_posts +
clips; `takedown_orders` queue with source (court/government/grievance/
ncii_csam/internal), authority + order_ref capture (Rule 3(1)(d) JS/DIG
authorisation), generated `sla_deadline` (3h; **2h for NCII/CSAM**), status
trail, admin-only RLS. UI: mandatory-position declaration checkbox on the
moments composer and clip upload; prominent "AI-generated content 🤖" label
on moments feed + profile viewers. DEFERRED/BLOCKERS: (a) tamper-resistant
provenance metadata (C2PA-style) — canvas pipelines strip metadata by design;
embedding signed provenance needs a server-side media pipeline; (b) chat-media
and avatar declaration prompts; (c) reels full-screen badge (feed RPC column
addition); (d) automated SGI-truthfulness verification — heuristic classifier
not built; (e) takedown admin UI (queue is SQL/table level today). The Draft
(Second) Amendment 2026 (continuous labelling) is PROPOSED only — not built.

## P9 DPDP — VERIFIED EXISTING + GAPS LOGGED
Already in the app (v0/v1 work): DOB capture, `is_minor` computed, parent
name/email/phone fields at signup, granular consent checkboxes recorded,
minors get chronological (non-profiled) reels feed, no ads/behavioural
targeting exists anywhere in ONIQ (compliance-by-absence), symmetric consent
withdrawal via Privacy → Data rights, `/delete-account` live. GAPS for
counsel + follow-up build: verifiable parental consent (DigiLocker flow),
immutable parent-consent record, retention schedules + automated erasure
jobs, notices in 22 scheduled languages (English-only today).

## P10 breach pipeline — DONE (app layer)
`20260729202000_security_incidents.sql`: incidents table, one `aware_at`
driving generated 6h CERT-In and 72h DPBI deadline columns, notification
timestamps, admin-only RLS. Templates + NTP + PII rules in
`docs/incident-response.md`. INFRA FOLLOW-UPS: 180-day/1-year log retention
are platform (log-drain) configuration; founder alert email wiring.

## P11 device threat detection — BLOCKER (documented design)
freeRASP requires a native dependency + Android build changes, and Play
Integrity requires Play Console setup + a verification edge function with
secrets — both exceed this window safely. Design constraints recorded:
signals-not-proof scoring, server-side verdicts only, never gate the call
stack, Apple-pattern alerts (no links, verify in-app), opt-in Lockdown Mode
via feature flags AROUND the protected stack. No code shipped.

## P12 AI incident response — SAFE VERSION DOCUMENTED, FORBIDDEN VERSION ABSENT
`docs/incident-response.md` records: detection heuristics, reversible-only
containment, human gates for destruction, and the explicit ban list (no AI
production writes, no auto-merge/deploy, no user content to external AI, no
hack-back — IT Act ss.43/66/66F). Verified: no code path in the repo gives
any automation production write credentials.

## Verification (this run)
tsc clean · build ×3 clean · 30/30 tests · call stack + FCM untouched ·
no new dependencies (0 of the 4-dep budget used) · `service_role` grep of
build output: pending in CI note below — grep of `src/` shows the string
only in edge functions (server-side), never in client code.
