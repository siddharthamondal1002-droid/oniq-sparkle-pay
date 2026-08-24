# ONIQ VIDEO GENERATOR — ENGINEERING COMPLETENESS REPORT (2026-08-23)

BASE COMMIT: 3129a993 (claude/video-generator-engineering)
PARALLEL BRANCH: claude/video-generator-engineering-completeness
WORKTREE: scratchpad/cmx (original trees untouched)

## Traced call graph (audit §3 — real path, not metadata)

USER REQUEST → StoryStudio.tsx (prompt + CinematicPanel shotIntent)
→ attachIntentToPrompt (videoEngineering.ts; fail-closed, verbatim-excluded)
→ claim_story_seconds RPC (_prompt) → story_jobs row
→ worker claim (story-worker.mjs) → story-plot (frozen; paletteFor lexicon)
→ directShots (shotDirector.ts) → composeVideoPrompt (1900-char slice)
→ story-still / story-clip via the motion-provider fabric
→ render → validate (aliveness) → deliver; rejection → STILL_PARALLAX
with MOTION_CONTRACT. Every arrow has a file+function and a covering test
in the suite; the plan/verbatim spine remains owner-FROZEN and untouched.

## Engineering details (§4 — repository-verified, not claimed)

Total 1,000 authored (ENG-0001..1000; unique 1,000; duplicates 0; OPEN 15)
+ 5,000 camera + 5,000 lighting programmatic combinations + 10,000-pair
matrix, all frozen on val-charlib with recorded hashes. The category list
in §4 that has no ONIQ implementation (running, jumping, sitting, social
situations, etc.) is NOT claimed: those exist only as poster reference
vocabulary; motion grammar remains WALKING/IDLE only.

## What this loop added (isolated, narrow)

1. src/lib/shotPlan.ts — the §14 structured ShotPlan:
   {character, action, emotion, motion, scene, environment, camera, lens,
   composition, lighting, weather, materials, engineeringConstraints,
   negativeConstraints, referenceProvenance, fallback,
   explicitGenerationRequired: true}. Constraints come only from measured
   constants; lens stays null (no measured lens control exists — honesty
   over completeness).
2. Emotion engineering (§10): 25 whole-body emotion readings
   (face/gaze/posture/gesture/body-state/context), REFERENCE-class,
   identity-free (pinned).
3. §12 retrieval discipline: REFERENCE_UNCERTAIN + safe fallback for
   no-hit and unknown-grammar requests; unknown provenance ids fail closed.
4. §15 negative constraints: 24 measured rejection classes carried by
   every plan; never generation targets.
5. One real retrieval bug found BY the new tests and fixed: the motion
   shelf rule missed plural forms ("walks") — widened, test-pinned.

## Verification

- §11 example ("An exhausted character walks slowly through a rainy modern
  city street at night") produces the full structured plan: exhaustion
  posture reading, WALKING/PRIMARY, urban street + wet-pavement
  environment, rain, night, streetlight-register lighting note,
  frontal/near-frontal lane, measured constraints incl. knee damping 0.50.
- Boundary (§13): pinned twice — every plan carries
  explicitGenerationRequired, and a source-level test bans fetch/supabase/
  job-client symbols from the module. Reference retrieval cannot render.
- Gates (§16/§17): untouched and re-pinned (0.70 rig confidence, fill<=90,
  no border, no 65% mechanism, aliveness 0.75 necessary-not-sufficient).
- Determinism (§19): PER-HOST policy intact; this session's live
  regression re-run byte-matched the recorded this-host hashes and did NOT
  re-baseline the frozen set.
- Real pixels (§21): no new renders needed — this session's M3 round
  provides the standing decoded-frame evidence (12 walks pixel-reviewed,
  frozen at cdacca47); nothing here altered rendering.
- Reference SHA integrity (TEST T): 13 registered masters re-verified
  against manifests, 0 mismatches.

## Statuses

Reference shelves 11/11 resolve · camera/lighting/scene/character/motion/
emotion/negative retrieval PASS · multi-category retrieval PASS · shot plan
PASS · explicit-generation boundary PASS · pre/post gates INTACT · fallback
FAIL-CLOSED · provenance SURVIVES (64-hex pinned) · determinism INTACT ·
reference hashes UNCHANGED · CAPACITOR CHANGES 0 · NEW IMAGE GENERATION 0 ·
API ₹0 · GPU ₹0 · PRODUCTION CHANGES 0.

Recommended next action: owner review of the two feature-branch commits
plus this completeness commit as one reviewable unit (no PR opened, no
merge performed — per the stop rule).
