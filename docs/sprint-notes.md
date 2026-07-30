> **COUNSEL DISCLAIMER (applies to this entire file):** all statements below
> about BNS, BNSS, BSA, DPDP Act/Rules, IT Act, IT Rules, CERT-In directions
> and POCSO are practical engineering implementation notes, NOT legal advice.
> Every obligation, date, SLA and statutory reading must be verified by
> qualified Indian counsel before being relied upon. Where counsel disagrees
> with anything here, counsel wins.

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

---

# Mission v3 (2026-07-29) — status log

Branch `claude/app-build-4rwenh` on top of PR #37. One commit per phase,
`feat(phaseN):` format. Counsel disclaimer for this section: see the top of
this file (moved there per the v3 mission requirement).

## Retained phases R1–R12 — carried, no regressions
All twelve retained phases were delivered in missions v1/v2 (see the two
sections above). This run re-verified: tsc clean, build clean, 30/30 tests,
call stack + FCM untouched (diff vs origin/main shows no edits under the
protected files), `service_role` appears only in edge functions and the two
new server-side scripts — never in `src/` client code or the built bundle.
R4 is superseded by B1 below; R6 by B2; R7 by B3; R8 by B4; R9 by B5 (open).

## B1 media resolver — FOUNDATION DONE, migration = blocker
DONE: `supabase/functions/sign-media` (caller-JWT-scoped client — storage
RLS decides access, NO service-role use in this function; TTL hard-capped
300s, bucket allow-list, path traversal rejected) +
`src/lib/media/resolveMedia.ts` (legacy full URLs pass through; bare paths
signed via sign-media; in-memory cache, re-sign ~30s before expiry; never
persisted) + ESLint `no-restricted-syntax` fence blocking direct
`createSignedUrl`/`createSignedUrls`/`getPublicUrl` in `src/`.
BLOCKER (logged, top security follow-up): 7 legacy files still sign
directly (listed + exempted in eslint.config.js) and existing rows store
multi-year signed URLs. Full closure = refactor those call sites to store
bare paths + data-migrate stored URLs → paths + verify a captured URL 403s
after expiry. Takedown "path rotation" also lands with that refactor.

## B2 deletion-proof harness — DONE, TWO LIVE GREEN RUNS
`scripts/deletion-proof.ts`: creates delete-proof+<ts>@oniqhub.com, seeds
user tables + one object in each of 4 buckets, runs the production order
(storage purge BEFORE auth.admin.deleteUser), asserts zero rows across 15
user tables + zero objects across 4 buckets + auth user gone, writes
`docs/deletion-proofs/<ts>.json` with report SHA-256, exits non-zero on any
residue.
UPDATE (same day): the founder is phone-only and the DB is Lovable-Cloud
managed (no service-role key obtainable by them), so PR #39 added the same
harness as an admin-gated `deletion-proof` edge function + a one-tap
"proofs" tab in the admin panel; reports persist in `deletion_proofs`
(admin-only read, function-write only). The AI still holds no production
write credentials — the founder triggers runs from their own admin session.
LIVE RESULTS (founder-run, 2026-07-29): two consecutive PASS runs, zero
residue across 15 tables + 4 buckets + auth row; reports committed at
`docs/deletion-proofs/2026-07-29T20-53-13-140Z.json` and
`docs/deletion-proofs/2026-07-29T20-53-49-299Z.json` (SHA-256 in each).

## B3 sharpen + free-drag crop — DONE
PhotoStudio: sharpen 0–100 (unsharp mask at export: base + 0.8·k·(base −
box-blur), radius scales with image size; CSS preview untouched for 60fps)
and free-drag crop pan (drag repositions the crop window in locked and
aspect-free modes; export offsets are rotation-aware). Output still goes
through the WebP re-encode (EXIF/GPS stripped by construction), 512px cap
for avatars, full-res elsewhere.

## B4 provenance + takedown admin UI — DONE (2 sub-items deferred)
`media_provenance` table (uploader, content type/id, SHA-256 of original
bytes, origin, declared_synthetic; insert-own + own-or-admin read; NO
update/delete policies = tamper-evident at the policy layer) +
`src/lib/provenance.ts` (crypto.subtle SHA-256) wired into clips upload and
moments photos. Takedown admin UI in `app.admin.tsx`: order logging
(source/authority/order_ref), SLA countdown with breach state, execute =
`admin_takedown_content` RPC (soft-delete moment/clip) + audit row via
`log_moderation_action` — ids only, no content preview anywhere.
DEFERRED: (a) server-side signing of provenance records (needs an edge
function + key custody decision); (b) C2PA marker detection (no library
within the zero-dep budget; self-declaration + label shipped in v2);
(c) storage object deletion + path rotation on takedown (lands with B1
closure — soft-delete + short-TTL expiry is the interim).

## B5 DigiLocker consent / erasure jobs / 22-language notices — NOT BUILT (blocker)
Requires: DigiLocker partner onboarding (government approval process, org
credentials — cannot be created by engineering), pg_cron (or external
scheduler) enabled on production for retention/erasure jobs, and
professionally translated legal notices in 22 scheduled languages (machine
translation of consent notices is a legal-risk decision for counsel, not
engineering). DPDP Rules core obligations phase in ~May 2027 — runway
exists. Logged as the top compliance follow-up. Groundwork already live:
DOB/is_minor capture, parent contact fields, granular consent checkboxes,
non-profiled minor feeds, delete-account flow, and L2 holds that erasure
jobs must respect (`has_active_legal_hold`).

## B6 → native track (see N1/N2 below).

## L1 lawful-request intake — DONE
`legal_requests` table: issuer/order_ref/target/records_sought/window
capture, state machine received→validated→flagged_overbroad→approved→
fulfilled→closed/rejected, admin-only RLS, `distinct_approvers` CHECK +
`legal_request_guard` trigger (no approval without two distinct approvers;
no fulfilment unless approved; flagged_overbroad can never be approved or
fulfilled). Intake checklist + overbroad flags + conservative
user-notification rule in `docs/legal-ops.md`. Audit: every disclosure goes
through the L3 tool which marks the row fulfilled; moderation actions write
to the append-only `audit.moderation_log` (v2).

## L2 legal holds — DONE
`legal_holds`: scoped, time-bounded (`expires_at` NOT NULL), mandatory
`override_reason` (DPDP s.17 basis recorded), admin-only RLS, zero new read
paths (retention layer only). `has_active_legal_hold()` SECURITY DEFINER;
`delete-account` now returns 409 with a user-facing preservation notice
while a hold is active (fail-open if the check itself errors, protecting
the erasure right). Future B5 erasure jobs must call the same function.

## L3 BSA s.63 evidence export — DONE
`scripts/evidence-export.ts <legal_request_id>`: refuses unless status =
approved AND two distinct approvers (defence in depth with the DB trigger).
Emits records.json (scope-limited, empty scaffold by default — no fishing),
hash-report.txt (SHA-256, BSA-Schedule algorithm), certificate-63.md
(Part A populated for ONIQ; Part B expert scaffold, 2026 Pune Bar Assn
clarification noted as counsel-reviewed), custody-note.md (re-hash on every
transfer). Signatures left to humans. Exports must be moved off-repo to
sealed storage — never committed.

## L4 self-harm care-first — DONE
On-device regex detection (en/hi/bn) in `src/lib/selfHarm.ts`; nothing sent
to any server or external AI; fires AFTER the post publishes normally (no
blocking, no flagging, no auto-deletion — preservation is the default since
nothing is removed). `CrisisSupportSheet`: Tele-MANAS 14416 /
1-800-891-4416 primary, KIRAN 1800-599-0019 (consolidation noted),
tap-to-call, explicit "this is not a moderation action" copy, easy dismiss.
Escalation remains human-gated (none is automated).

## L5 NCII / voyeurism / impersonation — DONE (flow), timers configurable
ReportSheet now carries NCII, voyeurism/hidden-camera, child-safety and
(already present) impersonation categories; in-app copy commits to the
IT Rules 3(2)(b) 24h NCII takedown and 24h ack / 15-day disposal.
`takedown_orders` SLA timers (v2 trigger): 2h for `ncii_csam` source, 3h
otherwise — the stricter 2026-amendment windows, applied as self-imposed
config since the 2h tier is contested. Takedown execution + audit row via
the B4 admin panel. Operational steps in `docs/legal-ops.md` §L5.
Interim limitation: report → takedown is admin-manual (single-founder
moderation), and object deletion/path rotation lands with B1 closure.

## L6 CSAM escalation — RUNBOOK DONE, automation deferred
`docs/legal-ops.md` §L6: mandatory-reporting duty (POCSO ss.19–21, 2024
INSC 716 — NCMEC alone insufficient, Indian authorities required), same-day
report to SJPU/local police + National Cyber Crime Reporting Portal,
immediate removal via takedown, evidence preserved under an L2 hold (never
purge the object), no tip-off, audit logging. DEFERRED: automated
"report-not-filed" alerting (needs a scheduler; pairs with B5 jobs).

## N1/N2 Play Integrity + freeRASP — DEFERRED (independent native sprint, by design)
The v3 mission itself scopes these out of the web loop: they need the
Android release keystore SHA-256, Google Cloud project linking in Play
Console, a native build, and the only two authorised dependencies
(`@capacitor-community/play-integrity`, `freerasp-react-native`, pinned).
None of that is reachable from this web workflow. Design constraints for
that sprint were recorded in v2 §P11 (signals-not-proof, server-side
verdicts, never gate the call stack, opt-in Lockdown Mode around the
protected stack).

## Verification (this run)
- tsc clean; build ×3 "✓ built"; 30/30 tests green.
- `service_role` grep: absent from `src/` and from `dist/` client bundle
  (present only in supabase/functions/* and scripts/* — server-side only).
- Protected stack: `git diff origin/main` touches no CallOverlay/signaling/
  TURN/get-turn-credentials/FCM files.
- New runtime dependencies: 0.
- New migrations awaiting production apply (Lovable flow, human-approved):
  `20260729210000_media_provenance.sql`, `20260729211000_takedown_actions.sql`,
  `20260729212000_legal_requests_holds.sql`. Edge functions to deploy:
  `sign-media` (new), `delete-account` (updated with hold guard).

## Final acceptance checklist
- [x] tsc clean; build passing; tests green (30/30)
- [x] service_role absent from client bundle (grep run this window)
- [x] Protected call stack + FCM untouched (diff proof)
- [x] Zero unauthorised new dependencies
- [x] R1–R12 exit gates (v1/v2 deliveries re-verified; R4/R6/R7/R8 rolled into B-phases)
- [~] B1 foundation shipped + lint fence active; legacy call-site/data migration = logged blocker
- [x] B2 harness complete + exits non-zero on residue; two live founder-run PASS reports committed (2026-07-29)
- [x] B3 sharpen + free-drag crop on touch
- [~] B4 SGI label + provenance SHA-256 + content-free takedown UI (server-signed provenance + path rotation deferred)
- [ ] B5 DigiLocker consent / erasure jobs / 22-language notices — blocked on external prerequisites (logged)
- [x] L1 dual-control export; overbroad blocked; audit trail
- [x] L2 hold suspends erasure, no read access, time-bounded, reason recorded
- [x] L3 s.63 export: hash report + Part A/B scaffold + custody note
- [x] L4 crisis surface with correct Tele-MANAS/KIRAN numbers; zero auto-deletion
- [~] L5 categories + 24h/3h/2h SLA timers + audit row (execution admin-manual; rotation with B1)
- [~] L6 escalation path + preservation + Indian-authority reporting (runbook; report-not-filed alert deferred)
- [ ] N1/N2 — separate native sprint (mission-sanctioned deferral)

Legend: [x] pass · [~] delivered with a logged, bounded deferral · [ ] blocked, logged above.

---

# LOOP fix (2026-07-30) — PhotoStudio chips/tabs "dead"

**Probe result (Playwright/Chromium, 360px touch, per the loop's Step 1):**
Branch **A variant** — taps LAND and handlers FIRE. `elementFromPoint`
returned the chip itself and `PROBE:filter-select clarity` logged in both
mount contexts. In a clean mount (moments composer, chat attachment) the
highlight moved and FILTERS⇄ADJUST switched — the component was never
broken. In a hosted mount the same tap ALSO bubbled to the host sheet's
click-to-dismiss overlay (`onClick={onClose}` fired right after the chip
handler), unmounting the entire studio on the first tap.

**Root cause:** PhotoStudio's root did not stop click propagation, and two
hosts render it inside click-anywhere-to-close overlays: AvatarEditorSheet
and EditPostSheet. Every tap in the studio closed the host (and the studio
with it). Chat + moments-composer mounts were unaffected (no dismissing
ancestor). Side effect explained: tapping DONE in the avatar flow closed
the sheet while export/upload kept running detached — the orphaned webp
uploads found in the moments bucket during the avatar-bug investigation.

**Fix (minimum diff):** `onClick={(e) => e.stopPropagation()}` on
PhotoStudio's root — same idiom the codebase already uses for inner sheet
cards. Verified by re-running the probe: hosted mount now keeps the studio
open, highlight moves, panels switch; clean mount unchanged. All temporary
instrumentation, the probe route, and the probe script were removed.

---

# LOOP — view counts + viewer lists (2026-07-30)

## P1 inventory — eye-icon surfaces and why they're stale

| # | Surface | Component | Number comes from | Root cause of staleness |
|---|---------|-----------|-------------------|------------------------|
| 1 | For You reels player | `app.clips.tsx` ClipCard | `clips.view_count` via `clips_feed` RPC; `record_clip_view` on IntersectionObserver ≥0.6 | View = impression (no dwell time) so scroll-past counts; owner's own views counted; number only moves via local optimistic +1, never refetched |
| 2 | Moments-world reels | `app.chat.reels.tsx` ReelCard | same column | This surface recorded NOTHING until 2026-07-30 (views from here were invisible); same impression semantics |
| 3 | My Page reel modal | `app.chat.me.tsx` | `clips.view_count` from one-shot select | Fetched once, never refetched while open; eye not tappable |
| 4 | User-page reel modal | `app.u.$userId.tsx` | same | same (correct as plain count for non-owners) |
| 5 | Updates/status viewer | `app.chat.updates.tsx` | `status_views` raw insert on open + `count(*)` per status | Insert fires with zero dwell; count fetched once per open; identity stored but NO viewer list UI |
| 6 | Moments posts | `MomentsFeed.tsx` | — | No views table, no column, no icon — never built |

Confirmed: `clips_views(clip_id,user_id)` and `status_views(status_id,viewer_id)`
exist (write-time counter only for clips); moments has nothing; counts are
write-time counters (not count(*)), never refetched on focus; RLS is not the
cause (counts are plain columns readable with the row).
