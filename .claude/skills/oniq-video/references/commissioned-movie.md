# Building a commissioned movie — the Episode 4 procedure

How "Aladdin and the Ember King" (ep4) is being built, recorded AS IT RUNS so
the job can be repeated — or resumed mid-flight — by a future session. This is
the ep3 procedure (`making-an-episode.md`, video variant) executed for an
owner-commissioned film, plus every lesson this build added. Read that runbook
and `assembling-generated-clips.md` first; this file records what they don't.

## The commission, and the cost answer that matters

The owner asked for "a movie like episode 3" after the Story pipeline's
movie grade (Veo on the app's own `GOOGLE_AI_API_KEY`) produced films that
looked worse and billed real rupees to their Google project. The correction
that reframed everything: **episode 3 cost the owner nothing visible because
its generation ran through the LOVABLE AGENT** — stills, clips and voices on
Lovable workspace credits, transfers on GitHub free minutes, storage on the
Lovable Cloud plan. When the owner commissions a movie, that is the cost
model to quote: *Lovable credits, flat Google bill.* Do not route a
commissioned film through `story-clip`/the Google key.

**Measured on ep4 (owner-confirmed): ~50 Lovable credits for the whole
build** — 76 image generations, 56 ten-second clips, ~28 agent turns —
against the owner's stated cap of **2,000 credits/month**, i.e. one
movie costs ~2.5% of the month. Movie volume is effectively not
credit-constrained; wall-clock (~5-6 hours of generation per film) and
review attention are the real limits. The identical film through the
Google key would be ~₹7,250 cash — and is blocked anyway by that key's
tiny Veo daily quota (~75s/day, measured 2026-08-13).

## Phase order, with what each phase actually produced

### 1. Scenes + narration (this container, committed)

- 14 scenes in `src/data/originals.ts` as `episode4`, `ORIGINALS` gains it.
- Narration in `src/data/originalsScript.ts` (~940 words at the season's
  140wpm; every scene under the 50s hold ceiling; dialogue as `segments`
  that MUST rejoin the prose exactly — a test enforces it).
- Guards that demand updating when an episode is added, in the order they
  fired: the pinned scene count in `originalsScript.test.ts` (44 → 58), the
  per-episode style table in `originalsStyle.test.ts`, and — easy to forget,
  already missed once in this repo's history — `AI_CONTENT_MODULES` in
  `src/config/playCompliance.ts` must declare the new shot-list module
  BEFORE anything renders it.

### 2. Shot list (this container, committed)

`src/data/ep4Shots.ts`: 56 shots, ~8.5/minute, same type and helpers as
ep3Shots (`shotPromptFor` = style → frame → cast locks → prop locks; never
hand-assemble). `src/data/__tests__/ep4Shots.test.ts` is ep3's guard suite
re-pointed — allocation into the 1.5–10s window, contiguous cut order,
lock resolution, coverage < 50% cast, dissolves only where time jumps
(ep4: two, both in S6), derived lamp-locking. The derived lamp guard threw
three times on GENERIC lamps in shot text ("lamps beginning to prick on");
the fix is rewording to "lights"/"lanterns", not locking a prop that is
not the story's lamp.

### 3. THE RECAST LESSON — read every lock you reuse

ep4 declared `cast: EP3_CAST` on the theory "same world, same people". The
probe exposed it: **EP3_CAST.lampJinni is a blue-violet night-sky being
locked to "NO fire, NO smoke"**, and this film's jinni is titled for fire
and smoke. Handed the contradiction, the image model OBEYED THE LOCK and
returned a starfield. Fix: cast is per-episode, so `EP4_CAST` spreads
EP3_CAST with one override — THE EMBER KING (banked coals, slow smoke,
crown of low flames, "an unbroken king" with distinctness notes against
ep1's jar jinni, the season's only other ember being). The rule: when a
new film reuses a cast record, READ EVERY LOCK IT WILL RESOLVE, especially
for characters the new script describes in its own words.

### 4. The probe gate (2 stills, owner approves)

Per the runbook: two extremes before the set is paid for. ep4 probed
`ep4_s03b` (Ember King, fire palette — caught the recast) and `ep4_s12a`
(moonlit rooftops, cold palette — passed first try). The owner approved on
the probes. Known and fine: the Lovable image generator returns
**1088×1920** for a 1080×1920 ask; the ingest step corrects it.

### 5. Stills in batches (Lovable agent, driven from here)

- Files: `/mnt/documents/ep4/stills/<shotId>.jpg` on the AGENT'S box (not
  the repo). Batches sized to survive one agent turn: 1 = s01–s04 (15),
  2 = s05–s08 (16), 3 = s09–s11 (13), 4 = s12–s14 (12).
- Message shape that works (short, ask first): which shots; resolve via
  `shotPromptFor` from main (name the commit); sequential; **"if a file
  already exists, keep it and skip"** — this idempotence guard is what
  makes a resend after a dropped turn safe instead of a double-buy;
  reply with a table; flag failures/off-style rather than silently
  regenerating; do NOT edit repo files, do NOT revert, do NOT start clips.
- **Queue discipline** (all measured this build): `send_message` times out
  client-side at 60s but the message is queued — never resend on timeout.
  Poll `list_messages` with `limit` 1–2. A turn that ends `stopped` with
  empty content means anything queued behind it may be gone — resend ONCE
  with the keep-existing guard. **A human typing into the Lovable chat
  stops a running turn** — that is how batch 1's turn died; steer from
  here, not there. And a "stopped" turn may still have DONE the work:
  batch 1's stills were all on disk despite the stop, and the resend
  found them and generated nothing.
- Agent QA flags ride to the contact-sheet gate, not to immediate fixes
  (so far: minor Aladdin face drift in s01b; an "empty" balustrade shot
  that is empty by design).

### 6. The driver loop

The owner said "drive it": a `send_later` self-check-in (~10 min) polls
the agent, advances one step per firing, re-arms itself, and STOPS
re-arming at gates that belong to the owner. Gates so far: probe approval
(passed), and the **contact sheet of all 56 stills** — built by the agent
as one grid jpg, shown to the owner, approved BEFORE any clip is bought.
Each wake-up message carries the full state (batch plan, what's done,
what's next) so it survives context summarization.

### 7–11. Clips, transfer, assembly, render, delivery (NOT YET RUN)

**OWNER RULE (2026-08-13, stated twice — treat as standing): the final
video is NEVER rendered on Lovable.** Lovable's box only generates assets
(stills, clips). The finished film is made by running the GitHub transfer
workflow, rendering HERE in this container, verifying, and only then
uploading the finished file to Lovable. If a future session finds itself
asking the Lovable agent to assemble or render video, it has left the
procedure.

Follow `making-an-episode.md` video-variant + `assembling-generated-clips.md`
verbatim; nothing ep4-specific is known yet beyond the plan:

- Clips: image-to-video from each still as starting frame, `motion` text
  only (never names, never locks — both the ep3 and run-72 lessons), 10s
  asks via the agent's generator, batched like the stills, raws kept.
- Transfer to this container via the release-asset workflow
  (`ep3-clip-transfer.yml`, episode-agnostic scripts take `EPISODE=ep4`).
- TTS per `VOICES` (narrator ash; aladdin echo; magician ballad; lampJinni
  onyx) from `segmentsFor` — measured durations drive the manifest.
- Composition `remotion/src/ep4/`: outer dissolves between scenes, inner
  hard cuts, NO Ken Burns over clips; render halves under node with
  `FRAME_RANGE`; `verify-episode.mjs --expect <measured>` gates upload.
- Delivery: presigned upload (`get_file_upload_url`, PUT, file_id). THEN
  ASK THE OWNER where it lands — the Originals hub (register in
  `src/data/lores.ts` with measured runtime + provenance comment, then the
  publish loop per oniq-ship) or their private Your videos. Do not assume.
  **DECIDED for ep4 (owner, 2026-08-13): BOTH** — the hub registration AND
  the owner's Your videos, in that order after verify-episode.mjs passes.

## Resume ledger (update this section as the build advances)

- 2026-08-13: phases 1–4 complete and on main (episode data `b67f209`).
- 2026-08-13 ~14:10Z: **PHASE 5 (STILLS) COMPLETE — 56/56** on the agent's
  box at `/mnt/documents/ep4/stills/`, contact sheet at
  `/mnt/documents/ep4/contact_sheet.jpg`. Fifteen shots needed a second
  take; every failure traced to the same disease — an under-anchored
  prompt (generic "lamps", "the city", "stone fruit", unnamed rooms and
  roofs) — and every fix was naming the thing in the shot text on main,
  then regenerating. The Ember King's climax (s13d) needed the lock
  restated in the ask. Residual judgment items awaiting the OWNER's
  stills gate: s12c is a fast-tier frame (standard refused twice on
  safety), slightly softer than neighbours; s01b minor Aladdin face
  drift; s08d boyish hero in married-man beats (the season's locked
  design). Next: owner approval → PHASE 6, clips (image-to-video from
  each still, motion text only, batched like the stills, raws kept).
- 2026-08-13 ~15:10Z: owner approved the contact sheet and said "drive
  it" — PHASE 6 (CLIPS) running under a self-re-arming driver (~12 min
  one-shots), batches C1–C7 sequential, keep-and-skip, refusal→one
  verbatim retry then flag-and-continue.
- 2026-08-13 18:0xZ: **PHASE 6 at 47/56.** C1 s01–s02 (7/7), C2 s03–s04
  (8/8), C3 s05–s06 (8/8), C4 s07–s08 (8/8), C5 s09–s10 (9/9, one
  refusal s10e cleared on its single retry), C6 s11–s12 (7/7,
  owner-confirmed). C7 s13–s14 (9, the final batch) accepted by the
  agent 18:00:46Z. All raws 1088×1920 24fps 10.04s video-only at
  `/mnt/documents/ep4/clips/`. SOFT-FLAG LIST for the one cleanup batch
  after C7 (overwrite-in-place is the cleanup pass's deliberate
  exception to keep-and-skip): s05d smile fades instead of holding,
  s08a greenery grows on the bare hill, s08c crowd barely gathers, s09c
  Aladdin skews younger than his lock, s09d road silhouette illegible,
  s10c window flame balloons on the push-in — plus whatever C6/C7's
  verdict tables add. Queue discipline held all day: a send_message 60s
  client timeout means QUEUED (never resend), confirm by artifact.
  Parallel but separate: the movie-grade LAUNCH web build deployed from
  main 16:50Z (bundle verification owed when this queue idles), and the
  story engine gained rungs 1–2 on main (mid depth plane `9fafd17`,
  eleven measured rigs `8adc7a7`) — engine work for user movies, no
  effect on this episode's render path. Next after cleanup: close this
  phase, then the render sitting (transfer → TTS → manifest →
  Episode4.tsx → halves → verify → upload → ASK where it lands).
- 2026-08-13 ~19:00Z: **PHASE 6 CLOSED — 56/56 + cleanup.** C7 9/9 no
  refusals. Cleanup batch: 10 overwrite-in-place retries, 8 better, 2
  same (s08c thin crowd, s09d faint silhouette — shipped), s09c retry
  came back 8.00s/1080-wide — VERIFIED sufficient because its snapped
  allocation is 223 frames (7.43s): check the allocation before
  demanding a spec-perfect raw. Owner waived the report gate ("Just
  render and workflow") and decided delivery: BOTH hub and Your videos.
  Launch publish VERIFIED live (production serves the movie-grade
  studio copy; crawl the route chunks, not just the homepage bundle).
- 2026-08-13 21:06Z: **PHASES 7–9 CLOSED — THE FILM VERIFIES.**
  TTS: 14 scenes, 366.9s measured; all 13 joins cover TRANSITION=0.25
  (tightest 0.273s). Allocation closed first try: 56 shots, 11,029
  generated frames, EP4_TOTAL=10901 (363.37s). Raw upload: 966MB, 56
  pointers, sizes byte-verified. Transfer run: raws fetched in 53s,
  conform 19min on the 2-core runner, both bundles published. GOTCHA:
  on a private repo the release `browser_download_url` 404s from this
  container — download via `api.github.com/...\/releases/assets/<id>`
  with `Accept: application/octet-stream`, which the proxy
  authenticates. Tarball sha256 + all 56 inner checksums verified.
  RENDER LESSONS, both expensive: (1) **FRAME_RANGE is INCLUSIVE** —
  last frame is TOTAL−1; `0-5366` + `5367-10900` partition 10901
  frames. (2) **This container is 4-core/8GB: parallel halves THRASH**
  (load 12, kswapd swapping, one encoder silently wedged 28 min at 46%)
  — the runbook's parallel-halves figure was measured on 64 cores. Run
  halves SEQUENTIALLY here: ~19 min each at CONCURRENCY=4, and arm a
  stall monitor on the pre-encode mtime (>4 min silent = wedged).
  Concat `-c copy`, verify: 363.43s vs 363.37 expected (+0.06s ok),
  105.6MB, h264+AAC, RMS healthy at three points. Uploaded via
  presigned PUT: 110,733,231 bytes, HTTP 200, 8.8s, sha256
  08243c4628c96e376051b69b8647acd3ffe3065102bf964f354403ac3d6ae8bb.
  Delivery in flight: agent registering `src/assets/oniq-ep4.mp4.asset.json`
  + owner's Your videos row (file attached via send_message `files` —
  an ARRAY OF OBJECTS `{file_id, file_name}`, not bare strings); then
  lores.ts wiring here, publish, hub verification per oniq-ship.
- 2026-08-13 22:35Z: **COMMISSION CLOSED — EPISODE 4 DELIVERED, BOTH
  DESTINATIONS.** Your videos: `story_jobs` row `4bdef35b`, bytes
  verified in the private bucket, replay/send/delete live; note the row
  rides the 30-day sweep — the CDN asset is the permanent copy.
  Hub: asset `4d617c81-075b-440f-8925-ed1d9bf009d6` (110,733,231 bytes,
  byte-exact against the upload sha256), pointer
  `src/assets/oniq-ep4.mp4.asset.json` + `lores.ts` wiring done BY THE
  LOVABLE AGENT (owner-directed, to skip the Lovable→GitHub sync wait —
  a publish builds from Lovable's own tree, so nothing GitHub-side
  gates it). Deploy called 22:26Z, published from `9dda385` — the same
  sha the sync then delivered to main, so main and production agree.
  PROCESS NOTES: (1) send_message can report a 60s MCP timeout and
  still deliver — check `list_messages` before resending, or you'll
  double-instruct the agent. (2) This container's egress policy now
  403s `lovable.app` (curl AND WebFetch) — production verification must
  be delegated to the Lovable agent's sandbox (shell-only message:
  crawl index-*.js for the asset id). Final figures: 363.43s (6:03),
  110.7MB, ~50–60 credits of the 2000/month cap for the whole build
  (76 stills incl. retries, 56 clips, 14 TTS scenes); transfer conform
  19 min; two sequential half-renders ~19 min each. The engine keeps
  lip sync (rung 1), mid-plane parallax and eleven measured rigs
  (rung 2) from the same push.
- 2026-08-13 22:45Z: **HUB VERIFIED LIVE.** `oniqhub.com` serves
  `lores-Bc3Hsmc9.js` (200) containing `4d617c81`, `6:03` and
  `ep4:{url:o.url,runtime:"6:03"}`; entry bundle hash matches a fresh
  local build of the tree, so the FIRST publish had been good — two
  LIVE-OK-no reports were false negatives from grepping the entry and
  route chunks while the marker lived in a Vite data chunk (lesson
  recorded in oniq-ship). Episode 4 plays in the Originals hub beside
  episodes 1–3. Commission complete, both destinations verified.
