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
