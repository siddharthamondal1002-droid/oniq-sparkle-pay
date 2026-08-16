# Google AI model research — 2026-08-16

## Read this first: the sourcing is second-hand

The brief asks for official Google sources and says not to treat blogs or
third-party pages as authoritative. I agree with that rule and **could not
fully satisfy it**, so here is exactly what happened rather than a tidy claim.

This environment's egress proxy **blocks direct fetches** of Google's
documentation:

```
WebFetch https://ai.google.dev/gemini-api/docs/models          → EGRESS_BLOCKED
WebFetch https://ai.google.dev/gemini-api/docs/changelog.md.txt → EGRESS_BLOCKED
WebFetch https://docs.cloud.google.com/.../veo/3-1-generate     → EGRESS_BLOCKED
```

What _does_ work is web search restricted to official domains, which returns
**summaries of** those pages rather than the pages. So every model fact below
is one step removed from the primary source. Each row carries a confidence
level, and nothing below has been written into code as a live model id on the
strength of a search summary alone.

**Anyone acting on this file should open the deprecation page themselves.**

Sources reached (as search results, not fetched):

- [Gemini API release notes](https://ai.google.dev/gemini-api/docs/changelog)
- [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
- [Gemini API models](https://ai.google.dev/gemini-api/docs/models)
- [Veo 3.1 — Gemini API](https://ai.google.dev/gemini-api/docs/models/veo-3.1-generate-preview)
- [Veo 3.1 — Cloud docs](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate)
- [Introducing Veo 3.1 — Google Developers Blog](https://developers.googleblog.com/introducing-veo-3-1-and-new-creative-capabilities-in-the-gemini-api/)
- [Gemini 2.5 Flash Image (Nano Banana)](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image)

---

## Findings

### Video (Veo)

| Fact                                                                        | Confidence                                                                             | Notes                                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `veo-3.0-fast-generate-001` deprecated 2026-06-15, **shut down 2026-06-30** | **High** — two independent searches agreed, one quoting the deprecations page directly | This is the id ONIQ used as its clip fallback. Acted on.                 |
| `veo-2.0-generate-001`, `veo-3.0-generate-001` also shut down 2026-06-30    | High                                                                                   | Not used by ONIQ.                                                        |
| `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview` exist           | High                                                                                   | `veo-3.1-fast-generate-preview` is ONIQ's current clip model.            |
| Veo 3.1 has **GA** ids on the Gemini Enterprise Agent Platform              | Medium — asserted, exact ids not returned                                              | Would need checking before use.                                          |
| "Veo 3.1 Lite Preview" launched                                             | Medium                                                                                 | Possible cheaper tier. Price unknown.                                    |
| One result claimed "preview endpoints deprecated and removed April 2, 2026" | **Low — likely wrong or about something else**                                         | It contradicts Veo 3.1 preview ids being current. Flagged, not acted on. |

**Consequence for ONIQ:** the primary (`veo-3.1-fast-generate-preview`) appears
live. The fallback was dead and has been removed. Whether to add a new fallback
is a price decision — see `ENGINE_AUDIT.md` §5.

### Image

| Fact                                                                                                           | Confidence                                                                    | Notes                                                                                 |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Imagen 4 ids (`imagen-4.0-generate-001` etc.) deprecated 2026-06-15, shutdown **2026-08-17**                   | Medium-High                                                                   | **Tomorrow.** ONIQ does not use Imagen — confirmed by grep. No action.                |
| `gemini-2.5-flash-image` ("Nano Banana") is legacy; migration recommended                                      | Medium-High                                                                   | This is ONIQ's image model, via the gateway.                                          |
| Recommended replacements: `gemini-3.1-flash-image` ("Nano Banana 2"), `gemini-3-pro-image` ("Nano Banana Pro") | Medium — the summary was internally muddled about which name maps to which id | Do not paste these into code without checking.                                        |
| Nano Banana 2 claims 4K, better multi-reference consistency, **lower** price                                   | Low-Medium                                                                    | "Lower price" is a claim worth verifying — it would change the cost model favourably. |

**Consequence for ONIQ:** the image model is reached through the **Lovable
gateway** (`google/gemini-2.5-flash-image`), not Google directly. A Google
deprecation does not automatically apply — what the gateway serves under that
name, and what it charges, is Lovable's to answer. That question is in
`ENGINE_AUDIT.md` §5 and has not been guessed at.

### Text

| Fact                                                               | Confidence  | Notes                                                        |
| ------------------------------------------------------------------ | ----------- | ------------------------------------------------------------ |
| `gemini-3.6-flash` and `gemini-3.5-flash-lite` generally available | Medium-High | `gemini-3.6-flash` is ONIQ's text fallback. Appears current. |
| `gemini-2.5-flash` / `gemini-2.5-pro` deprecated around June 2026  | Medium      | ONIQ does not use them for text. No action.                  |

### Capabilities not currently used

| Thing                                                                       | Status                      | Relevance                                                                 |
| --------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------- |
| "Gemini Omni API" — multimodal video generation/editing, announced I/O 2026 | Low confidence; one mention | Potentially relevant to the clip stage. Needs primary research.           |
| Reference-image-guided video generation                                     | Medium                      | Directly relevant to the character-consistency goal. Worth real research. |
| Google Search grounding                                                     | N/A                         | Not obviously useful for fiction.                                         |

---

## Registry rows this produced

Recorded in `supabase/functions/_shared/modelRegistry.ts`. `shutdownOn` is
populated **only** where confidence is High.

| Entry                 | Id                              | Provider        | Status       | shutdownOn     |
| --------------------- | ------------------------------- | --------------- | ------------ | -------------- |
| `TEXT_PRIMARY`        | `claude-sonnet-4-6`             | anthropic       | current      | null           |
| `TEXT_TOOLS`          | `claude-opus-5`                 | anthropic       | current      | null           |
| `TEXT_FALLBACK`       | `gemini-3.6-flash`              | google-direct   | current      | null           |
| `IMAGE_STILL`         | `google/gemini-2.5-flash-image` | lovable-gateway | deprecated   | null           |
| `VOICE_TTS`           | `google/gemini-2.5-flash-tts`   | lovable-gateway | unknown      | null           |
| `VIDEO_CLIP`          | `veo-3.1-fast-generate-preview` | google-direct   | current      | null           |
| `VIDEO_CLIP_FALLBACK` | `veo-3.0-fast-generate-001`     | google-direct   | **shutdown** | **2026-06-30** |

The last row is a tombstone: the id is no longer sent, and the registry test
fails the build if anything wires it back in.

---

## What I did not do, and why

- **I did not update any live model id** on the strength of these summaries.
  Hallucinating a model id is one of the brief's absolute rules, and a search
  summary is exactly the kind of source that produces a plausible wrong string.
- **I did not migrate the image model.** It is a gateway question and a money
  question, neither of which is mine.
- **I did not verify Veo 3.1's parameter surface** (duration, resolution,
  reference images, audio). The existing code sends `aspectRatio`,
  `durationSeconds` and `resolution` with a 400-driven fallback that drops
  unsupported fields — a reasonable defensive shape, and I have no primary
  source to improve it against.
