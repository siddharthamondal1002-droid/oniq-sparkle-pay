# ONIQ search provider routing — audit

## Finding: search cannot trigger video generation. The premise is false.

`MEASURED.` Both search functions were scanned for any reference to a video
provider or generation endpoint:

| function                                  | matches for `veo | runway | story-clip | predictLongRunning` |
| ----------------------------------------- | ---------------- | ------ | ---------- | ------------------- |
| `supabase/functions/smart-scout/index.ts` | **0**            |
| `supabase/functions/hotel-scout/index.ts` | **0**            |

There is **no code path from search to video generation**. A search query
cannot spend a video-generation rupee, because no search function can name a
video model or reach a generation endpoint.

This is pinned by a regression test so it cannot regress silently.

## What search actually uses

Retrieval runs against its own providers; AI synthesis happens **after**
retrieval, through the shared LLM path (`_shared/llm.ts`) — Claude primary,
Gemini fallback. No generation model is involved at any stage.

`NOT_APPLICABLE` — the "stop search from calling Veo" work item has nothing to
fix.
