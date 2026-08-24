# ONIQ_VEO_AUDIO_COST_REPORT

**Status** RESOLVED — the "leak" is not closable on this surface, and the waste
is elsewhere · **Date** 2026-08-24 · **All figures USD**

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

| Route                                                         | Effect                                                                                                   | Whose call                               |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Move ONIQ's video to the **Gemini Enterprise Agent Platform** | `generateAudio:false` becomes sendable; Lite $0.05 → **$0.03/s (−40%)**, Fast $0.10 → **$0.08/s (−20%)** | **OWNER** — provider and account change  |
| Generate **fewer external seconds**                           | in-house is roughly two orders of magnitude cheaper per second than any external tier                    | engineering, already the routing default |

The absolute saving from a surface move is $0.02/s on either tier, so it is
worth twice as much in percentage terms on Lite as on Fast. Generating fewer
external seconds is worth far more than either — but the two compose, and a
Lite-heavy mix is exactly where a surface move pays best.

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
| CONSERVATIVE (billed)    | **$0.80**                     | **$1.60**                     |

`FILTERED_OUTPUT_BILLING = "UNKNOWN"` is a constant in `_shared/videoRouting.ts`
and asserted by test, so it cannot quietly become "free".

## 5. Corrections to the record

- The previous report's claim that `generateAudio: false` was an available
  saving is **withdrawn**. It was falsified by live probe on 2026-08-24 and is
  now confirmed by Google's own SDK.
- `story-clip`'s header said Veo Fast is "~$0.15/s, list". That was the price of
  a tier ONIQ had stopped calling. Removed; rates now live in
  `_shared/videoRouting.ts` with provenance and surface attached.
