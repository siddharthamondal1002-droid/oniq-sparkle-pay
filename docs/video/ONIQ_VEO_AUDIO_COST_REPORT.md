# ONIQ_VEO_AUDIO_COST_REPORT

**Status** RESOLVED — the "leak" is not closable on this surface, and the waste
is elsewhere · **Date** 2026-08-24

---

## 1. What the leak was believed to be

> Veo generates audio → ONIQ mutes and discards it → ONIQ pays a premium for
> nothing.

Half right. ONIQ does generate audio and discard it. The half that is wrong is
"pays a premium": on the Gemini Developer API there is **no cheaper option to
choose**. `generateAudio` is rejected by that surface (see
ONIQ_VIDEO_AUDIO_ARCHITECTURE §1 for the SDK evidence), so every Veo second ONIQ
has ever bought was billed at the with-audio rate, and no parameter change makes
it cheaper.

## 2. So where is the waste?

**In the discard, not in the bill.** The audio is paid for at generation time.
Throwing it away buys nothing back. That reframes the fix:

- It is **not** "turn audio off" — impossible here.
- It is **use it wherever the scene can take it**, and where it cannot, record
  why. Which is what the three-mode architecture now does.

At the margin, **native audio on this surface is free**. A shot routed to
VEO_NATIVE_AUDIO costs exactly what the same shot would have cost muted.

## 3. The two ways to actually reduce the audio bill

| Route                               | Effect                                                                                   | Whose call                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| Move ONIQ's video to **Vertex AI**  | `generateAudio:false` becomes sendable; Lite drops $0.05 → $0.03/s, Fast $0.10 → $0.08/s | **OWNER** — provider and account change  |
| Generate **fewer external seconds** | in-house at ₹0.64/finished second vs ₹4.78/s for Lite                                    | engineering, already the routing default |

The second is worth roughly 7× more per second than the first, which is why the
routing work in this loop targets it.

## 4. Filtered generations

Two prompts in the 2026-08-24 run returned HTTP 200, `done: true`, no error and
**no video** — the responsible-AI pass removed the sample. On **both** Lite and
Fast.

**Does Google bill them? UNKNOWN.** Anthropic publishes the equivalent rule for
web search ("if an error occurs during web search, the web search will not be
billed"); Google publishes no such line for a filtered video, and this container
cannot reach an invoice or a pricing page (`ai.google.dev` is blocked by the
egress policy).

So both economics are carried, and the conservative one is what reserves:

|                          | 8 s Lite, 2 filtered attempts | 8 s Fast, 2 filtered attempts |
| ------------------------ | ----------------------------- | ----------------------------- |
| LOWER_BOUND (not billed) | $0.00                         | $0.00                         |
| CONSERVATIVE (billed)    | $0.80 (₹76.55)                | $1.60 (₹153.09)               |

`FILTERED_OUTPUT_BILLING = "UNKNOWN"` is a constant in `_shared/videoRouting.ts`
and asserted by test, so it cannot quietly become "free".

## 5. Corrections to the record

- The previous report's claim that `generateAudio: false` was an available
  saving is **withdrawn**. It was falsified by live probe on 2026-08-24 and is
  now confirmed by Google's own SDK.
- `story-clip`'s header said Veo Fast is "~$0.15/s, list". That was the price of
  a tier ONIQ had stopped calling. Removed; rates now live in
  `_shared/videoRouting.ts` with provenance and surface attached.
