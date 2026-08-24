#!/usr/bin/env python3
"""Acceptance gate for EXTERNAL (Veo) clips.

Design note on why this is split from the measurement step: the raw numbers are
extracted on the machine that holds the clips, but the VERDICT is computed here,
once, from those numbers. One implementation, applied identically to both
models — which is what makes the Lite-vs-Fast comparison fair (Phase 12). The
gate cannot be weakened for one model and not the other because it never sees
which model produced a row until after it has judged it.

Thresholds are inherited from the in-house gate (acceptance_gate.py), which
lifted them from shipped ONIQ code rather than inventing them:
    CLIP_ALIVENESS_MIN  0.75   story-worker.mjs
    DURATION_MIN/MAX    0.5 / 1.6   storyPreflight.ts
    VIDEO_MIN_BYTES     1024   storyPreflight.ts

Checks that need a human eye (character likeness, anatomy, artefacts) are
reported OPEN and never silently counted as passes.
"""
CLIP_ALIVENESS_MIN = 0.75
DURATION_MIN_RATIO = 0.5
DURATION_MAX_RATIO = 1.6
VIDEO_MIN_BYTES = 1024
FROZEN_RUN_MAX = 0.10      # fraction of the clip that may be a held frame
BLANK_FRAC_MAX = 0.001     # a frame this uniform is blank

OPEN_CHECKS = [
    "character_reference_consistency",
    "severe_anatomy_artefacts",
    "temporal_flicker_subjective",
    "camera_move_intent_matched",
]


def gate(m, requested_seconds=4.0):
    """`m` is one measurement dict from mp4_measure.py. Returns a verdict dict."""
    checks = []

    def add(name, ok, cls, detail=""):
        checks.append({"check": name, "result": "PASS" if ok else "HARD_FAIL",
                       "classification": cls, "detail": detail})

    # --- file level -------------------------------------------------------
    add("file_min_bytes", m.get("size", 0) >= VIDEO_MIN_BYTES, "MEASURED",
        f"{m.get('size', 0)} bytes")
    add("file_decodes", bool(m.get("decodes")), "MEASURED")
    if not m.get("decodes"):
        return _finish(m, checks, "HARD_FAIL")

    add("video_stream_present", "video" in m.get("codec_types", []), "MEASURED",
        ",".join(m.get("codec_types", [])))

    # --- duration ---------------------------------------------------------
    d = float(m.get("duration", 0.0))
    ratio = d / requested_seconds if requested_seconds else 0.0
    add("duration_within_envelope",
        DURATION_MIN_RATIO <= ratio <= DURATION_MAX_RATIO, "MEASURED",
        f"{d:.3f}s vs {requested_seconds}s requested (ratio {ratio:.2f})")

    # --- motion -----------------------------------------------------------
    diffs = m.get("frame_diffs") or []
    n = m.get("frame_count", 0)
    alive = (sum(1 for x in diffs if x > 0.002) / len(diffs)) if diffs else 0.0
    add("temporal_aliveness", alive >= CLIP_ALIVENESS_MIN, "MEASURED",
        f"{alive:.3f} of frames move (min {CLIP_ALIVENESS_MIN})")

    run = m.get("longest_static_run", 0)
    add("no_frozen_run", n > 0 and run / n <= FROZEN_RUN_MAX, "MEASURED",
        f"longest held run {run}/{n}")

    blanks = m.get("blank_frames", 0)
    add("no_blank_frames", blanks == 0, "MEASURED", f"{blanks} blank frames")

    # --- what an automated gate genuinely cannot settle --------------------
    for name in OPEN_CHECKS:
        checks.append({"check": name, "result": "OPEN", "classification": "OPEN",
                       "detail": "needs human assessment; never counted as a pass"})

    hard = [c["check"] for c in checks if c["result"] == "HARD_FAIL"]
    return _finish(m, checks, "HARD_FAIL" if hard else "ACCEPTED")


def _finish(m, checks, verdict):
    hard = [c["check"] for c in checks if c["result"] == "HARD_FAIL"]
    return {
        "clip": m.get("clip"),
        "verdict": verdict,
        "ALL_MANDATORY_QA_PASS": verdict == "ACCEPTED",
        "hard_failures": hard,
        "checks": checks,
    }


def summarise(rows, label=""):
    acc = [r for r in rows if r["ALL_MANDATORY_QA_PASS"]]
    causes = {}
    for r in rows:
        for h in r["hard_failures"]:
            causes[h] = causes.get(h, 0) + 1
    return {
        "label": label,
        "attempts": len(rows),
        "accepted": len(acc),
        "failed": len(rows) - len(acc),
        "first_pass_acceptance": (len(acc) / len(rows)) if rows else 0.0,
        "failure_categories": causes,
    }
