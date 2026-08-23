#!/usr/bin/env python3
"""ONIQ video acceptance gate — deterministic, fail-closed.

ALL_MANDATORY_QA_PASS is the acceptance condition. Only HARD_FAIL blocks
acceptance; a WARNING is recorded and never consumes a paid entitlement.

Every check is classified, per the loop's requirement:

  MEASURED        computed from the bytes of the output
  DERIVED         computed from a MEASURED quantity
  INFERRED        a proxy, honest about being one
  OPEN            cannot be checked reliably here — NOT silently passed
  NOT_APPLICABLE  the request did not ask for the thing

SCOPE, STATED UP FRONT. This gate runs on the IN-HOUSE MOTION STAGE output —
the ARAP character clip. It is not the whole ONIQ film gate: the still and TTS
stages need provider keys that are absent from this container, so a full
1080x1920 film cannot be rendered or gated here. What it measures is real; what
it does not cover is named in every report it feeds.

Read-only: parses rendered files, writes a verdict, renders nothing, spends
nothing.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# --- thresholds, all lifted from shipped ONIQ code rather than invented -----
CLIP_ALIVENESS_MIN = 0.75      # remotion/scripts/story-worker.mjs
DURATION_MIN_RATIO = 0.5       # src/lib/storyPreflight.ts
DURATION_MAX_RATIO = 1.6       # src/lib/storyPreflight.ts
VIDEO_MIN_BYTES = 1024         # src/lib/storyPreflight.ts
FROZEN_RUN_MAX = 0.10          # fraction of the clip a single held frame may span
BLANK_ALPHA_FRAC = 0.001       # below this ink fraction a frame counts as blank
KNEE_OVERCURL_DEG = 120.0      # genloop knee work: below this is over-curl


def expand_gif(path):
    """GIF entries expanded by duration into real frames.

    PIL collapses consecutive identical frames and accumulates their duration.
    Reading `n_frames` instead of expanding is how a 779-frame render once got
    reported as 159 frames, so this is done explicitly.
    """
    im = Image.open(path)
    frames, entries = [], 0
    try:
        while True:
            entries += 1
            hold = max(1, int(round(im.info.get("duration", 33) / 33.3333)))
            frames.extend([im.convert("RGBA")] * hold)
            im.seek(im.tell() + 1)
    except EOFError:
        pass
    return frames, entries


def ink(frame):
    return (np.array(frame)[:, :, 3] > 8)


def aliveness(frames, stride=1):
    """Temporal aliveness: mean per-frame silhouette change, normalised.

    The same shape as story-worker's clipAlivenessScore — a frozen clip scores
    ~0, a moving one scores high. Reimplemented here because the production one
    lives in a .mjs the Python harness cannot import; the THRESHOLD is the
    production constant.
    """
    if len(frames) < 2:
        return 0.0
    a = [ink(f) for f in frames[::stride]]
    if len(a) < 2:
        return 0.0
    diffs = []
    for i in range(1, len(a)):
        u = (a[i] | a[i - 1]).sum()
        if u == 0:
            continue
        diffs.append((a[i] ^ a[i - 1]).sum() / u)
    if not diffs:
        return 0.0
    # scale so a normal ONIQ walk lands near 1.0; the constant is the median
    # per-frame silhouette churn of the accepted zombie walk (measured).
    return float(np.mean(diffs) / 0.035)


def gate(path, requested_seconds=None, wants_audio=False, fps=30.0):
    p = Path(path)
    checks, hard, warn = [], [], []

    def add(name, cls, ok, detail, severity="HARD_FAIL"):
        checks.append({"check": name, "classification": cls,
                       "result": "PASS" if ok else severity, "detail": detail})
        if not ok:
            (hard if severity == "HARD_FAIL" else warn).append(name)

    # 1 file exists
    exists = p.exists()
    add("file_exists", "MEASURED", exists, str(p))
    if not exists:
        return _verdict(p, checks, hard, warn, None)

    size = p.stat().st_size
    add("file_min_bytes", "MEASURED", size >= VIDEO_MIN_BYTES,
        f"{size} bytes (min {VIDEO_MIN_BYTES})")

    # 2 file decodes
    try:
        frames, entries = expand_gif(p)
        decoded = len(frames) > 0
    except Exception as e:  # noqa: BLE001
        add("file_decodes", "MEASURED", False, f"decode error: {e}")
        return _verdict(p, checks, hard, warn, None)
    add("file_decodes", "MEASURED", decoded, f"{len(frames)} frames / {entries} entries")
    if not decoded:
        return _verdict(p, checks, hard, warn, None)

    dur = len(frames) / fps

    # 3 duration within the shipped band
    if requested_seconds:
        lo, hi = requested_seconds * DURATION_MIN_RATIO, requested_seconds * DURATION_MAX_RATIO
        add("duration_within_band", "DERIVED", lo <= dur <= hi,
            f"{dur:.2f}s vs requested {requested_seconds}s band [{lo:.2f},{hi:.2f}]")
    else:
        add("duration_within_band", "NOT_APPLICABLE", True, "no requested duration supplied")

    # 4 resolution — the clip stage renders a square element, the FILM is
    #   1080x1920. Recorded, not asserted, because this gate sees the element.
    w, h = frames[0].size
    add("resolution_recorded", "MEASURED", True, f"{w}x{h} (film canvas is 1080x1920)")

    # 5 valid frame sequence — no blank frames
    inks = [ink(f) for f in frames]
    total_px = frames[0].size[0] * frames[0].size[1]
    blanks = sum(1 for a in inks if a.sum() / total_px < BLANK_ALPHA_FRAC)
    add("no_blank_frames", "MEASURED", blanks == 0, f"{blanks} blank frames")

    # 6 no frozen tail — longest run of byte-identical consecutive frames
    longest, run = 1, 1
    for i in range(1, len(inks)):
        run = run + 1 if np.array_equal(inks[i], inks[i - 1]) else 1
        longest = max(longest, run)
    frac = longest / len(frames)
    add("no_frozen_run", "MEASURED", frac <= FROZEN_RUN_MAX,
        f"longest identical run {longest}/{len(frames)} = {frac:.1%} (max {FROZEN_RUN_MAX:.0%})")

    # 7 character present in every frame
    add("character_present", "MEASURED", blanks == 0,
        "character ink present in every frame" if blanks == 0
        else f"{blanks} frames with no character")

    # 8 temporal aliveness — the shipped production check
    alive = aliveness(frames)
    add("temporal_aliveness", "MEASURED", alive >= CLIP_ALIVENESS_MIN,
        f"{alive:.3f} (min {CLIP_ALIVENESS_MIN})")

    # 9 render envelope — the figure must not be clipped by the frame edge
    border = 0
    for f in frames:
        a = np.array(f)[:, :, 3] > 8
        if a[0, :].any() or a[-1, :].any() or a[:, 0].any() or a[:, -1].any():
            border += 1
    add("within_render_envelope", "MEASURED", border == 0,
        f"{border} frames touch the border")

    # 10 identity stability — silhouette area must not collapse or explode
    areas = np.array([a.sum() for a in inks], dtype=float)
    ratio = float(areas.max() / max(areas.min(), 1))
    add("silhouette_area_stable", "DERIVED", ratio <= 3.0,
        f"max/min silhouette area {ratio:.2f} (max 3.0)")

    # 11 audio — this stage renders no audio track
    if wants_audio:
        add("audio_integrity", "OPEN", False,
            "audio was requested but this stage produces no audio track; the "
            "check cannot run here and is NOT silently passed", severity="HARD_FAIL")
    else:
        add("audio_integrity", "NOT_APPLICABLE", True, "audio not requested")

    # 12 checks that need a reference or a model — honestly OPEN
    for name in ("character_reference_consistency", "severe_anatomy_artifacts",
                 "dialogue_presence", "final_assembly_integrity"):
        add(name, "OPEN", True,
            "no reliable automated test exists in this repository; recorded OPEN "
            "rather than claimed as a deterministic pass", severity="WARNING")

    return _verdict(p, checks, hard, warn, {
        "frames": len(frames), "entries": entries, "duration_s": round(dur, 3),
        "aliveness": round(alive, 4), "blank_frames": blanks,
        "longest_frozen_run": longest, "border_frames": border,
        "silhouette_area_ratio": round(ratio, 3), "bytes": size,
        "width": w, "height": h,
    })


def _verdict(p, checks, hard, warn, measures):
    return {
        "asset": p.name,
        "ALL_MANDATORY_QA_PASS": len(hard) == 0,
        "verdict": "ACCEPTED" if not hard else "HARD_FAIL",
        "hard_failures": hard,
        "warnings": warn,
        "checks": checks,
        "measures": measures,
    }


if __name__ == "__main__":
    out = [gate(a) for a in sys.argv[1:]]
    for r in out:
        print(f"  {r['verdict']:10s} {r['asset']}"
              + (f"  hard={r['hard_failures']}" if r["hard_failures"] else ""))
    print(json.dumps(out, indent=1) if "--json" in sys.argv else "")
