# Story Worker Engine — audit

**Date:** 2026-08-16 · **Scope:** the Story pipeline, end to end · **Method:** source
inspection plus targeted web research. Nothing was executed against a paid API.

This is a first pass. It records what the engine _is_, what is measurably wrong
with it, and — importantly — which of the wrong things are mine to fix and which
are the owner's to decide. It does not claim the engine is production-ready.

---

## 1. Architecture as it actually stands

The engine is **not** a monolithic worker. It is a queue plus seven edge
functions plus a GitHub Actions renderer, and the split is deliberate:

```
StoryStudio (web)
      │  creates job
      ▼
story_jobs (Postgres)          ← the queue. status: queued → generating → assembling → done
      │
      ├─ story-plot            text → plan/shot list        Claude-first, Gemini fallback
      │
      ▼
story-dispatch  ──pg_net──▶  GitHub repository_dispatch
      │                              │
      │                              ▼
      │                    .github/workflows/story-worker.yml
      │                              │  ONE job per run, concurrency keyed per job
      │                              ▼
      │                    scripts/render-episode.mjs
      │                              │
      │        ┌─────────────────────┼─────────────────────┐
      │        ▼                     ▼                     ▼
      │   story-still           story-clip            story-voice
      │   (image)               (video)               (TTS)
      │        │                     │                     │
      │   Lovable gateway     Google direct          Lovable gateway
      │   LOVABLE_API_KEY     GOOGLE_AI_API_KEY      LOVABLE_API_KEY
      │        └─────────────────────┼─────────────────────┘
      │                              ▼
      │                    Remotion + headless Chromium + ffmpeg
      │                              ▼
      └──────────────── story-callback / story-deliver → mp4
                        story-sweep  → reaps stale jobs
```

**Why the renderer is a GitHub runner and not an edge function** is already
documented in the workflow and the reasoning holds: Remotion drives headless
Chromium and encodes with ffmpeg, which cannot run in a Supabase edge function.

### Provider split — an owner decision, already made

| Stage           | Function         | Provider            | Key                 | Model                           |
| --------------- | ---------------- | ------------------- | ------------------- | ------------------------------- |
| Text (plan)     | `_shared/llm.ts` | Anthropic           | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6`             |
| Text (tools)    | `_shared/llm.ts` | Anthropic           | `ANTHROPIC_API_KEY` | `claude-opus-5`                 |
| Text (fallback) | `_shared/llm.ts` | Google direct       | `GOOGLE_AI_API_KEY` | `gemini-3.6-flash`              |
| Image           | `story-still`    | **Lovable gateway** | `LOVABLE_API_KEY`   | `google/gemini-2.5-flash-image` |
| Voice           | `story-voice`    | **Lovable gateway** | `LOVABLE_API_KEY`   | `google/gemini-2.5-flash-tts`   |
| Video           | `story-clip`     | **Google direct**   | `GOOGLE_AI_API_KEY` | `veo-3.1-fast-generate-preview` |

This split is the 2026-08-14 owner directive recorded in `CLAUDE.md`, written
after an agent moved the pipeline onto the metered Google key without asking.
**No part of this audit changes it.**

---

## 2. What is already good, and should not be "improved"

Worth stating plainly, because a brief that says "upgrade everything" invites
rewriting things that are right:

- **The claim is atomic.** `queued → generating` moves in one statement and the
  second claimant gets a 409. That is the double-pay guard, and it is correct.
- **Concurrency is keyed per job, not globally.** A global gate was the scaling
  ceiling (one film at a time; everyone else aged into the stale sweep and
  died). The current form is right.
- **One job per run, no drain loop.** A worker that drains a queue turns one bad
  plan into a bill.
- **The text path is Claude-first with a Gemini fallback**, and the fallback has
  already earned itself once during a Gemini text outage.
- **`story-plot` degrades rather than fails**: a plan missing optional fields
  still renders a film the user paid for.
- **Refusal handling exists** — a safety refusal at submit time surfaces as a
  422 the worker's refusal ladder understands.
- **The stale-generating reaper exists** and its migration is applied.

---

## 3. Findings

### F1 — A fallback that could not succeed _(fixed in this pass)_

`story-clip` retried `veo-3.0-fast-generate-001` whenever the primary answered 404. Google deprecated that id on **2026-06-15** and shut it off on
**2026-06-30**. From July onward the ladder could only spend a wasted
round-trip and land on the same 502 it would have returned anyway.

Nobody noticed because _a fallback only runs when the primary is already
failing_ — precisely when nobody is reading logs carefully.

**Fixed.** The dead branch is removed and a 404 now fails fast and loudly.
Deleting it changes no price and no provider: a branch that always fails costs
nothing to remove. **Choosing a live replacement is a separate, owner-level
decision** — see §5.

### F2 — Model ids were scattered, with no lifecycle data _(fixed in this pass)_

Six ids across four files, none recording provider, credential, or shutdown
date. `supabase/functions/_shared/modelRegistry.ts` is now the single
declaration, and `src/lib/__tests__/modelRegistry.test.ts` **fails the build**
when a model is still wired past its recorded shutdown date. That converts
"someone must remember to read Google's deprecation page" into something the
build says out loud.

The test also pins the registry against the call sites, so a registry that has
drifted from reality fails rather than misleading — a stale registry is worse
than none, because it reads as authoritative.

### F3 — No version stamping anywhere _(partially addressed)_

`grep` for `model_version`, `prompt_version`, `engine_version`,
`generation_version` across `src/` and `supabase/` returned **zero hits**.

Given a finished mp4 there is currently **no way to tell which model, which
prompt, or which engine build produced it**. That makes a quality regression
impossible to attribute and a bad batch impossible to scope.

`ENGINE_VERSION` / `SCHEMA_VERSION` / `PROMPT_VERSION` and a `provenance()`
helper now exist in the registry. **They are not yet written onto assets** —
that needs a migration adding the columns and a change to the callback path,
which is a schema change and belongs in its own reviewed commit.

### F4 — `story-plot` is a 1,069-line function

It holds prompt construction, the retry/timeout ladder, JSON repair, cast
locks, and validation. It works and is well commented, so this is debt, not a
defect. The brief's "PromptEngineeringWorker / StoryStructureWorker /
CharacterWorker" split maps onto sections that already exist inside it —
splitting them out is a refactor with real regression risk and no user-visible
gain, and I have deliberately **not** done it in the same pass as everything
else.

### F5 — The image model has a published migration path, unresolved

Google recommends moving off Nano Banana (`gemini-2.5-flash-image`) to
`gemini-3.1-flash-image` or `gemini-3-pro-image`. But ONIQ reaches it through
the **Lovable gateway**, so what is actually served under `google/...` is
Lovable's to say, and the price is Lovable's too. See §5.

### F6 — Research could not be primary-sourced

This environment's egress proxy blocks `ai.google.dev` and
`docs.cloud.google.com` outright. Every model fact below is from **search
summaries of** those pages, not the pages. See `GOOGLE_AI_RESEARCH.md`, which
labels each claim's confidence. Treat a `shutdownOn` date as a prompt to go and
look, not as gospel.

---

## 4. Not audited, and honestly so

I did not execute the pipeline. No film was rendered, no API was called, no
queue was drained. Everything above is source inspection. In particular these
brief items are **unverified**, not passing:

- end-to-end story → scenes → media → mp4
- the ten synthetic test stories
- behaviour at 100 and 1,000 scenes
- concurrent multi-story behaviour
- what happens when an image succeeds and video fails

Running any of them spends real money on the owner's keys, which is a decision
I have not been given.

---

## 5. Decisions the owner has to make

These are blocked on a person, not on engineering. Each one moves a bill.

1. **Should the clip stage have a fallback at all, and at what price?**
   The dead one is gone. Surviving alternatives sit at a different $/second,
   and `storyCostModel.UNIT.usdPerVideoSecond` is derived from the current
   tier — so a new fallback moves the published price chart.

2. **Does the image stage migrate off Nano Banana?**
   Google says migrate. The gateway may or may not have. Needs a question to
   Lovable about what `google/gemini-2.5-flash-image` resolves to today and
   what the newer ids cost there.

3. **Does the clip stage stay on the metered Google key?**
   It is the only stage that does. Consolidating it onto the gateway would
   change whose credit burns — exactly the decision the 2026-08-14 directive
   was written about.

---

## 6. Recommended next steps, in value order

1. Write provenance onto assets (migration + callback change). Cheap, and it
   is the prerequisite for ever diagnosing a bad batch.
2. Answer the three questions in §5.
3. A dry-run mode for the pipeline that exercises every stage against recorded
   fixtures, so the end-to-end path can be tested without spending anything.
   This is the single biggest gap: today there is **no way to test the engine
   without paying for it**.
4. Only then consider splitting `story-plot`.
