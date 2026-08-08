---
name: oniq-video
description: How ONIQ makes video — the Remotion motion-graphics path (promos, the app trailer) and the Runway image-to-video path (Lores / ONIQ Originals episodes), plus the cost guards, admin gates and AI-labelling rules that apply to both. Use this skill whenever the work touches video generation, ONIQ Originals, the Lores hub, Runway, Remotion, the admin video tool, episode assembly, scene stills, motion prompts, or a promo/trailer — including when the user just says "make a video", "new episode", "render the promo", or asks why a queued render never finished. Also use it before adding any new AI-generated media to the app, because the Play labelling requirement is easy to miss and has already been missed once.
---

# Making video in ONIQ

There are **two separate pipelines** plus **one gap**. Reaching for the wrong
one wastes an afternoon, so establish which job you are doing first.

| Want                                 | Use                       | State                                          |
| ------------------------------------ | ------------------------- | ---------------------------------------------- |
| Promo / trailer / motion graphics    | **Remotion**              | Works. Produced the shipped promo.             |
| Animate one illustrated still        | **Runway** image-to-video | Built, admin-gated, **never yet run** (0 jobs) |
| Full episode from stills + narration | Episode assembler         | **Queues only — no renderer exists**           |

## Ground truth, checked 2026-08-08

Do not assume the shipped clips came from the pipelines. They did not.

- `video_jobs` has **0 rows** — the Runway path has never generated anything
  in production. It is infrastructure, not the source of what is live.
- `episode_jobs` has **2 rows** and nothing drains them. `episode.server.ts`
  points at `remotion/scripts/render-episode.mjs`, **which does not exist**.
  Queue an episode today and it sits there forever.
- Both live clips are static uploads in Lovable's asset store
  (`src/assets/*.mp4.asset.json` → `/__l5e/assets-v1/...`). `oniq-promo.mp4`
  matches the Remotion renderer's output name. `lores-firefly-forest.mp4` has
  **no provenance in the repo** — treat its origin as unknown until someone
  confirms it.

Re-check these counts before relying on them; they are the fastest way to tell
what is real:

```sql
select (select count(*) from video_jobs)   as runway_jobs,
       (select count(*) from episode_jobs) as episode_jobs,
       (select enabled::text || ' cap=' || daily_cap from video_gen_config) as cfg;
```

---

## Path 1 — Remotion (the one that works)

Hand-authored React compositions rendered to mp4. This made the 0:23 promo.

```
remotion/
├── src/MainVideo.tsx      composition: TransitionSeries of 6 scenes
├── src/scenes/            SceneHook, SceneWorlds, SceneStudy,
│                          ScenePay, SceneConnect, SceneClose
├── src/components/        Backdrop, Kit (shared visual furniture)
├── src/theme.ts           colours and type
└── scripts/render-remotion.mjs
```

Scenes are sequenced in frames with spring-timed `wipe` / `slide` transitions.
To change the promo, edit a scene component or the durations in `MainVideo.tsx`.

**Render** (Bun, per `remotion/CLAUDE.md` — not npm):

```bash
cd remotion && bun install
OUT=/absolute/path/out.mp4 bun scripts/render-remotion.mjs
```

It launches Chromium with `--no-sandbox` and `concurrency: 1`. Two things bite:

- The output path defaults to `/mnt/documents/oniq-promo.mp4`. **Always set
  `OUT`** — the default is someone's machine, not yours.
- `muted: true` is hardcoded. Adding audio means changing the renderer, not
  just the composition.

Then upload the mp4 as a Lovable asset and reference the generated
`*.asset.json` from `src/data/lores.ts`. Do not commit mp4 binaries into
`src/` — the asset store is what the existing clips use.

## Path 2 — Runway image-to-video

For animating a single illustrated still. Built and guarded; unused so far, so
**expect first-run surprises and verify against a real response** rather than
trusting the happy path.

**The shot list is the source of truth.** `src/data/originals.ts` holds season
one (_The Fisherman and the Jinni_, _Ali Baba_, _Aladdin_). Each scene carries
two prompts, and the split is deliberate:

- `stillPrompt` — what the frame **is**. Feeds image generation.
- `motionPrompt` — what **moves**. Camera and movement only.

Runway takes the frame as given and adds motion, so a motion prompt that
re-describes the subject fights the image and produces drift. `HOUSE_STYLE` is
prepended to every still prompt so the season looks like one season.

**Flow:** generate the still externally from `stillPromptFor(scene)` → upload it
through the admin tool (`/app/admin/video`) → submit a Runway job → poll → the
output is stored in the `video-gen` bucket.

Settings are allowlisted in `runway.server.ts`: `gen4_turbo`, ratios including
the season's `720:1280`, durations `[5, 10]`, ~5 credits/second.

## The gap — episode assembly

`episodeTimeline.ts` plans a real timeline: Ken Burns pan/zoom at 6% travel,
transitions, 1080×1920 @ 30fps, narration audio overriding planned duration.
`episode.server.ts` validates and enqueues. The admin UI submits.

**Nothing renders it.** The worker is missing by design — the Worker runtime
this app deploys to cannot run ffmpeg or Chromium and has a wall-clock limit
far below a 20-minute render, so the renderer has to be an out-of-band process
holding the service role. It was never written.

If asked to "finish episodes", that worker is the work: drain `episode_jobs`,
render via Remotion using the stored `timeline`, upload to
`video-gen/episodes/`, write back `stored_path` and `status`.

---

## Guards that must survive any change

These are load-bearing. Read `references/guardrails.md` before relaxing one.

**Cost.** Order is enforced as _admin gate → kill switch → daily cap →
validation → billable call_, with the cap checked **before** any charge.
There is deliberately no batching and no retry: a loop over an array is how a
month of credits disappears in an hour, and a failing prompt fails identically
every time. The kill switch is a config row, so it flips without a deploy.

**Admin.** `requireAdmin()` re-derives the caller from their JWT and checks
`is_admin`. The screen being unlinked is cosmetic and is not the control.
`RUNWAY_API_KEY` is read in `runway.server.ts` only — never returned to the
browser, logged, or put in an error message.

**Uploads.** Stills are validated by name, size and a **magic-byte sniff** on a
bounded slice. Never read a whole media file into memory.

**AI labelling — this has already been missed once.** Any screen showing
generated media must appear in `AI_SURFACES` and render `AI_OUTPUT_LABEL` plus
`<AiOutputReport />`. Adding a new module of generated content means adding it
to `AI_CONTENT_MODULES` in `src/config/playCompliance.ts`; the guard in
`src/data/__tests__/playCompliance.test.ts` then fails until the surface is
declared. Play names AI-Generated Content as one of the three policies that
actually bite an app shaped like ONIQ.

**Content rules for the season**, carried in `originals.ts` and not to be
quietly relaxed: no prophet, no divine figure, no scripture; the jar's seal is
an unreadable mark, never attributed; jinn are folkloric wonder-beings with no
theological framing; violence is implied and never depicted.

**Watch stays a link-out directory.** ONIQ playing its _own_ originals is fine
and is why Lores exists. Playing third-party video is not — `watchDirectory.ts`
explains what that would cost, and the tests there assert the absence of a
player rather than the correctness of one.

## Rights

Originals are safe because they are ONIQ's own: original retellings, stills
from ONIQ's prompts, animation commissioned from Runway. Arabian Nights source
material is public domain — but **specific translations and adaptations are
not**. Burton, Lane and Payne are public domain; Haddawy and Lyons are not, and
Amar Chitra Katha's artwork and Disney's _Aladdin_ are firmly in copyright.
Write the retelling, or use a public-domain translation with attribution.
Never source video.

## Where things live

| Thing                      | Path                                                           |
| -------------------------- | -------------------------------------------------------------- |
| Shot list / prompts        | `src/data/originals.ts`                                        |
| Hub data (episode → url)   | `src/data/lores.ts`                                            |
| Hub screen                 | `src/routes/_authenticated/app.lores.tsx`                      |
| Admin tool                 | `src/routes/_authenticated/app.admin.video.tsx`                |
| Runway API + gate          | `src/lib/runway.server.ts`                                     |
| Cost guard / orchestration | `src/lib/runwayOps.server.ts`                                  |
| Still upload + validation  | `src/lib/runwayStills.server.ts`, `src/lib/stillValidation.ts` |
| Episode queue              | `src/lib/episode.server.ts`                                    |
| Timeline planner (pure)    | `src/lib/episodeTimeline.ts`                                   |
| Remotion project           | `remotion/`                                                    |
| Storage bucket             | `video-gen` (`stills/`, `audio/`, `episodes/`)                 |
| Tables                     | `video_jobs`, `episode_jobs`, `video_gen_config`               |
