#!/usr/bin/env python3
"""Run every Story dry-run scenario end to end and check what each one proves.

    cd remotion
    python3 scripts/dry_run_all.py               # run all six, then check
    python3 scripts/dry_run_all.py happy-path    # run one
    python3 scripts/dry_run_all.py --check-only  # re-check the last run's logs

WHY A CHECKER AND NOT JUST THE RUNS. Every one of these scenarios finishes with
an exit code and, in five cases, a playable mp4. That is not the same claim as
"the ladder fired". A dry run whose still step-down never triggered, or whose
clip fixture threw and quietly fell back to a still, prints an almost identical
success. Twice now the clip stage has been broken in a way that produced a
finished film and a ledger of successful calls -- once answering with the wrong
key, once building its mp4 with a filter the compositor's ffmpeg does not have.
Reading six logs and saying "looks right" would have passed both times.

So each scenario declares an `_expect` block next to its `_why`, and this
script enforces it. Adding a scenario means writing what it proves, not editing
this file.

THE ABSENT LIST IS THE IMPORTANT HALF. Several properties worth having are
observable only as a call that did NOT happen -- `voice-quota-dies` scripts a
fifth voice answer that succeeds, and the worker must never ask for it, because
asking would mean the Piper switch stopped holding and the remaining shots went
back to the metered cloud. There is no log line for that. There is only the
absence of one.

Sequential on purpose: every scenario uses job id `dry-1`, so they all write
.tmp/dry-dry-1.mp4 and would clobber each other in parallel -- and Remotion
already saturates the cores, so concurrency would only distort the timings.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REMOTION = os.path.dirname(HERE)
REPO = os.path.dirname(REMOTION)
FIXTURES = os.path.join(REMOTION, "fixtures/story")
RUNS = os.path.join(REPO, ".tmp/dry-runs")
FILM = os.path.join(REPO, ".tmp/dry-dry-1.mp4")

# Slowest last, so a fast mistake surfaces in the first minute rather than the
# ninth. voice-quota-dies waits out a real 30/60/90s backoff; clip-refused
# polls on the real 10s interval.
ORDER = [
    "happy-path",
    "still-refused",
    "gateway-audio",
    "no-sample-rate",
    "clip-refused",
    "voice-quota-dies",
]


def scenarios():
    found = sorted(
        d for d in os.listdir(FIXTURES)
        if os.path.isfile(os.path.join(FIXTURES, d, "scenario.json"))
    )
    unknown = [d for d in found if d not in ORDER]
    return [d for d in ORDER if d in found] + unknown


def load(name):
    with open(os.path.join(FIXTURES, name, "scenario.json"), encoding="utf8") as fh:
        return json.load(fh)


def run(name):
    """One scenario, with every production credential stripped from the child."""
    spec = load(name)
    env = dict(os.environ)
    # Belt and braces. The worker refuses to start if either of these is set,
    # and that refusal is the safety property -- but a runner that leaves them
    # in the environment turns the whole suite into six identical refusals,
    # which reads as "nothing ran" rather than "nothing was allowed to".
    env.pop("SUPABASE_SERVICE_ROLE_KEY", None)
    env.pop("STORY_JOB_TOKEN", None)
    env["STORY_FIXTURES"] = f"fixtures/story/{name}"
    # The clip stage is gated on grade=movie AND STORY_MOVIE=on. Derived from
    # the scenario rather than a hard-coded special case that would drift.
    if spec.get("job", {}).get("grade") == "movie":
        env["STORY_MOVIE"] = "on"

    if os.path.exists(FILM):
        os.remove(FILM)
    os.makedirs(RUNS, exist_ok=True)

    started = time.time()
    with open(os.path.join(RUNS, f"{name}.log"), "wb") as log:
        code = subprocess.call(
            ["node", "scripts/story-worker.mjs"],
            cwd=REMOTION, env=env, stdout=log, stderr=subprocess.STDOUT,
        )
    secs = round(time.time() - started)

    film = None
    if os.path.exists(FILM):
        film = os.path.join(RUNS, f"{name}.mp4")
        shutil.move(FILM, film)
    with open(os.path.join(RUNS, f"{name}.meta.json"), "w", encoding="utf8") as fh:
        json.dump({"exit": code, "secs": secs, "film": bool(film)}, fh)
    print(f"  {name}: exit {code}, {secs}s, film={'yes' if film else 'none'}")
    return code


def probe(path):
    out = subprocess.check_output([
        "ffprobe", "-v", "error",
        "-show_entries", "stream=codec_type,codec_name,width,height,nb_frames",
        "-show_entries", "format=duration,size", "-of", "json", path,
    ]).decode()
    return json.loads(out)


def check(name):
    """Returns (summary_row, [problems])."""
    spec = load(name)
    exp = spec.get("_expect")
    problems = []
    if not exp:
        # A scenario that asserts nothing is a scenario that proves nothing.
        return (name, "-", "-", "no _expect block"), ["scenario.json has no _expect"]

    log_path = os.path.join(RUNS, f"{name}.log")
    meta_path = os.path.join(RUNS, f"{name}.meta.json")
    if not (os.path.exists(log_path) and os.path.exists(meta_path)):
        return (name, "-", "-", "not run"), ["no log — did the run reach it?"]

    with open(log_path, encoding="utf8", errors="replace") as fh:
        log = fh.read()
    with open(meta_path, encoding="utf8") as fh:
        meta = json.load(fh)

    if meta["exit"] != exp["exit"]:
        problems.append(f"exit {meta['exit']}, expected {exp['exit']}")

    found = re.search(r"\[dry\] calls: (\{.*\})", log)
    calls = json.loads(found.group(1)) if found else None
    if calls != exp["calls"]:
        problems.append(f"calls {calls}, expected {exp['calls']}")

    for needle in exp.get("log", []):
        if needle not in log:
            problems.append(f"missing {needle!r}")
    for needle in exp.get("absent", []):
        if needle in log:
            problems.append(f"UNEXPECTED {needle!r}")

    film_path = os.path.join(RUNS, f"{name}.mp4")
    have = os.path.exists(film_path)
    if have != exp["film"]:
        problems.append(f"film={have}, expected {exp['film']}")

    desc = "no film (expected)"
    if have:
        info = probe(film_path)
        video = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
        audio = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
        if not video:
            problems.append("no video stream")
            desc = "UNPLAYABLE"
        else:
            frames = int(video.get("nb_frames") or 0)
            desc = (f"{video['codec_name']} {video['width']}x{video['height']} "
                    f"{frames}f {float(info['format']['duration']):.2f}s "
                    f"{'+' + audio['codec_name'] if audio else 'NO AUDIO'} "
                    f"{int(info['format']['size']):,}B")
            if not audio:
                problems.append("no audio stream — the narration did not land")
            # A film far shorter than its narration means shots were dropped.
            if frames < 100:
                problems.append(f"only {frames} frames")

    # The sharpest assertion available, where two scenarios should differ only
    # in a code path and not in output. gateway-audio feeds the same speech
    # through the container branch instead of the headerless-PCM branch, so its
    # film must come out BYTE-IDENTICAL to happy-path's. If voiceBytesToFile
    # ever double-wraps, the extra 44-byte RIFF header decodes as samples, the
    # encode changes, and this fires -- where "the film rendered" would not,
    # because a double-wrapped file still plays. It is only an audible click.
    twin = exp.get("same_film_as")
    if twin and have:
        other = os.path.join(RUNS, f"{twin}.mp4")
        if not os.path.exists(other):
            problems.append(f"cannot compare to {twin}: not run")
        else:
            with open(film_path, "rb") as a, open(other, "rb") as b:
                if a.read() != b.read():
                    problems.append(f"film differs from {twin} — audio was re-encoded")
                else:
                    desc += f" (== {twin})"

    # A dry run reaches nothing. If a provider host appears in a log, the seam
    # has a hole regardless of what else passed.
    for host in re.findall(r"https?://[\w.-]+", log):
        if any(k in host for k in ("supabase", "googleapis", "lovable")):
            problems.append(f"NETWORK: log names {host}")

    return (name, f"{meta['secs']}s", json.dumps(calls), desc), problems


def main():
    args = [a for a in sys.argv[1:]]
    check_only = "--check-only" in args
    args = [a for a in args if not a.startswith("--")]
    names = args or scenarios()

    unknown = [n for n in names if not os.path.isdir(os.path.join(FIXTURES, n))]
    if unknown:
        sys.exit(f"no such scenario: {', '.join(unknown)}")

    if not check_only:
        print(f"running {len(names)} scenario(s) — nothing leaves this machine\n")
        for name in names:
            run(name)
        print()

    rows, failed = [], {}
    for name in names:
        row, problems = check(name)
        rows.append(row)
        if problems:
            failed[name] = problems

    width = max([len(r[0]) for r in rows] + [len("scenario")]) + 2
    calls_w = max([len(r[2]) for r in rows] + [len("calls")]) + 2
    print(f"{'scenario':<{width}}{'secs':>6}  {'calls':<{calls_w}}output")
    print("-" * (width + 8 + calls_w + 46))
    for name, secs, calls, desc in rows:
        print(f"{name:<{width}}{secs:>6}  {calls:<{calls_w}}{desc}")

    if failed:
        print()
        for name, problems in failed.items():
            for problem in problems:
                print(f"FAIL {name}: {problem}")
        print(f"\n{len(failed)} of {len(names)} scenario(s) did not prove what they claim")
        return 1

    print(f"\nall {len(names)} scenario(s) proved what they claim — no network, no spend")
    return 0


if __name__ == "__main__":
    sys.exit(main())
