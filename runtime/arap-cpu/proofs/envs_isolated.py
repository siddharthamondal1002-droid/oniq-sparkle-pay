#!/usr/bin/env python3
"""PROOF: two venvs, two numpys, and no path from one into the other.

The whole design rests on this. ENV A needs numpy 1.23.5 (OpenMMLab 1.x
pins it hard); ENV B needs 1.26.4 (AD's retarget stack uses np.bool8, which
numpy 2 removed, and other parts of it postdate 1.23). If either venv could
see the other's site-packages the newer numpy would win on sys.path and one
half would break in a way that looks like a model bug.

Run from OUTSIDE both venvs — it drives each interpreter as a subprocess.
"""
import json
import subprocess
import sys
from pathlib import Path

PINS = json.loads(Path("/opt/oniq/pins.json").read_text())
EXPECT = {
    "/opt/oniq/venv-autorig": PINS["envs"]["autorig"]["numpy"],
    "/opt/oniq/venv-arap": PINS["envs"]["arap"]["freeze"]["numpy"],
}

fail = []
for venv, want in EXPECT.items():
    py = f"{venv}/bin/python"
    got = subprocess.run(
        [py, "-c", "import numpy;print(numpy.__version__)"],
        capture_output=True, text=True,
    )
    if got.returncode != 0:
        fail.append(f"{venv}: numpy did not import\n{got.stderr.strip()[:400]}")
        continue
    ver = got.stdout.strip()
    if ver != want:
        fail.append(f"{venv}: numpy {ver}, pins.json says {want}")
    else:
        print(f"PROOF {venv} numpy {ver}")

    # Nothing from the OTHER venv may be on this one's sys.path.
    other = [v for v in EXPECT if v != venv][0]
    paths = subprocess.run(
        [py, "-c", "import sys,json;print(json.dumps(sys.path))"],
        capture_output=True, text=True,
    ).stdout
    if other in paths:
        fail.append(f"{venv} has {other} on sys.path — the venvs are not isolated")

# ENV B must not carry torch at all: that is what lets the numpys differ.
has_torch = subprocess.run(
    ["/opt/oniq/venv-arap/bin/python", "-c", "import torch"],
    capture_output=True, text=True,
).returncode == 0
if has_torch:
    fail.append("ENV B (venv-arap) has torch installed; it is meant to be torch-free")
else:
    print("PROOF ENV B carries no torch")

# ENV A must not carry the render stack: a job that renders from ENV A would
# be running the ARAP deform against numpy 1.23.5, which is untested.
has_gl = subprocess.run(
    ["/opt/oniq/venv-autorig/bin/python", "-c", "import OpenGL"],
    capture_output=True, text=True,
).returncode == 0
if has_gl:
    fail.append("ENV A (venv-autorig) has PyOpenGL; rendering belongs to ENV B")
else:
    print("PROOF ENV A carries no PyOpenGL")

if fail:
    for f in fail:
        print("FAIL:", f)
    sys.exit(1)
print("PROOF envs: isolated, one numpy each, no crossover")
