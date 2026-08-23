# VIDEO GENERATOR — ENGINEERING REFERENCE INTEGRATION (2026-08-23)

Owner loop: integrate the frozen ONIQ visual-reference library's engineering
information into the Video Generator, as an engineering/product task —
**zero image generation, zero API/GPU spend, no M4**.

## What the "Video Generator" is (audit, §3)

`StoryStudio.tsx` (UI: prompt, seconds, verbatim, cast, plate) → RPC
`claim_story_seconds(_prompt, …)` → `story-plot` edge function (plan model +
`_shared/cinemaLexicon.ts`, the ~550-term research-verified cinema
vocabulary sampled per film by `paletteFor(prompt)`) → story worker
(`remotion/scripts/story-worker.mjs`): `directShots` (deterministic shot
size + lighting, weather-invisible), `vfxKindFor` → `particleField` (ONE
AUTHORITATIVE WEATHER from the shot's own words), `ambienceFor`/`scoreFor`
(sound stage), stills sliced to 1900 chars, motion via the provider fabric
(`motionProvider.ts` — frozen L3R home; ARAP CPU merged; Veo Select; Wan
held in PR #83).

## Engineering gap table (reference requirement → status)

| Reference requirement | Current implementation | Status | Action taken |
|---|---|---|---|
| Camera moves/rigs, lenses, framing, grade vocabulary | `cinemaLexicon.ts` (research-verified, sampled per film) | ALREADY IMPLEMENTED | connected, not duplicated |
| Shot-size variation enforcement | `shotDirector.ts` (merged owner brick, PR #69) | ALREADY IMPLEMENTED | untouched |
| Deterministic lighting register | `shotDirector` LIGHTING_PALETTE | ALREADY IMPLEMENTED | extended vocabulary added in the new module under the same invisibility contract |
| Weather → particle overlay | `vfxKindFor`/`particleField` (one-authoritative-weather) | ALREADY IMPLEMENTED | new weather picks emit measured trigger phrases (the bare word "thunderstorm" earns NOTHING — measured, worked around) |
| Structured scene/time/season/material/mood/composition/depth/scale/beat parameters | none — one free-text prompt | **MISSING** | **ADDED**: `src/lib/videoEngineering.ts` |
| User-facing engineering controls (progressive disclosure) | none | **MISSING** | **ADDED**: `CinematicPanel` (Basic = unchanged studio; Advanced; Engineering) |
| Reference-library provenance on requests | none | **MISSING** | **ADDED**: metadata registry + `provenanceFor` (fail-closed), reference pick in the panel |
| Camera MOTION control | still-based pipeline cannot honor it | NOT SUPPORTED | honestly not offered; recorded provider-dependent (§6) |
| Physics/FX controls | provider-side only | NOT SUPPORTED | recorded provider-dependent; nothing falsely advertised |
| Motion promotion | measured grammar (WALKING primary, knee ×0.50) | ALREADY IMPLEMENTED | mirrored read-only in `MOTION_GRAMMAR`, pinned by test — no promotion without evidence |
| Quality gates | aliveness ≥0.75 + pixel authority etc. | ALREADY IMPLEMENTED | untouched (loop §16: intact) |
| Story-plot / verbatim spine | owner-FROZEN (PHASE 3, 2026-08-20) | REQUIRES REVIEW | **not modified** — intent rides the prompt, the one channel the frozen plan already reads |

## What was added (all additive, default = byte-identical behavior)

1. **`src/lib/videoEngineering.ts`** — self-contained (no imports, worker-
   importable like `shotDirector`): 18-dimension support map with honest
   levels (`structured` / `plan-mediated` / `prompt-advisory` /
   `provider-dependent`); vocabularies for environment, scale, depth,
   camera angle, camera motion (declared, deliberately unwired),
   composition, lighting (vfx- AND ambience-invisible, pinned), time,
   weather (with the measured `WEATHER_PHRASE` trigger map), season (with
   measured season-word trigger classes powering an honest conflict
   warning), materials, mood, story beats; the measured `MOTION_GRAMMAR`;
   the frozen scene-library registry (ids + SHA-256 + category — metadata
   only, masters untouched) with fail-closed `provenanceFor`;
   `describeShotIntent` (deterministic serialization), `validateShotIntent`
   (fail-closed on vocabulary, advisory on physics), `attachIntentToPrompt`
   (drops the whole block rather than truncating the user's words at the
   5000-char pipeline budget).
2. **`src/components/stories/CinematicPanel.tsx`** — collapsed by default
   (BASIC = the studio exactly as it was), Advanced picks, Engineering-mode
   taxonomy + scene-reference provenance pick, live conflict/budget
   warnings, disabled in verbatim mode (the prompt IS the narration there).
3. **`StoryStudio.tsx`** (4 small edits) — `shotIntent` state, panel render,
   fail-closed prompt attach on submit, dependency added to the callback.
4. **`src/lib/__tests__/videoEngineering.test.ts`** — 14 tests: weather
   phrases earn exactly the promised overlay class against the LIVE
   `vfxKindFor`; season trigger classes pinned; lighting/mood invisible to
   BOTH classifiers; deterministic serialization; empty intent = untouched
   prompt; unknown vocabulary rejected; budget drop-not-truncate; registry
   hash shape/uniqueness; provenance round-trip and unknown-id refusal;
   support-level honesty; motion-grammar promotion pins.

## How structured parameters reach generation (verified code path)

`CinematicPanel` → `shotIntent` state → `generate()` calls
`attachIntentToPrompt(prompt.trim(), shotIntent)` → applied text becomes
`_prompt` of `claim_story_seconds` → stored on the job → `story-plot`
receives it (plan model reads the intent line; `paletteFor(prompt)` seeds
from it) → the plan's stills carry the vocabulary → `vfxKindFor` /
`directShots` / `ambienceFor` act on those words downstream. Verified by:
tsc clean, the 14 new tests (serialization + classifier contracts), the
full vitest suite, and lint:ci. No live render was commissioned (₹0 rule);
visual validation beyond the code path is the next paid render's job and is
NOT claimed here.

## Safety & §28 acceptance

- Frozen scene library UNCHANGED (metadata mirrored, media untouched,
  `generation_allowed=false` stands).
- story-plot, verbatim spine, motionProvider, shotDirector, ARAP, L3R, Veo,
  quality gates, fallback: all untouched.
- **PR #83 untouched — and that forced a branch decision**: the session's
  designated branch `claude/resume-3cpm82` IS PR #83's head (verified via
  the PR API: head.ref = claude/resume-3cpm82 @ 1f06aa15, OPEN, owner
  HOLD). Pushing there would have modified PR #83, which this loop forbids,
  so the work lives on **`claude/video-generator-engineering`** (branched
  from main @ 44756cee). No PR opened; owner decides.
- New image generation 0 · API cost ₹0 · GPU cost ₹0 · production config
  changes 0 (no deploy, no migration, no edge-function change).
