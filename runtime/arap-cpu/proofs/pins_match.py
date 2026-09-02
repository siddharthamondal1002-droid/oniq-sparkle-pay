#!/usr/bin/env python3
"""PROOF: what is installed is what pins.json says is installed.

Every other proof checks that the stack works. This checks that the stack is
the PINNED one — a build that resolved a different version and still passed
its smoke tests is exactly the drift a digest-pinned image exists to prevent.
Run from outside both venvs.
"""
import json
import subprocess
import sys
from pathlib import Path

PINS = json.loads(Path("/opt/oniq/pins.json").read_text())
fail = []

def versions(venv):
    # --all is load-bearing: plain `pip freeze` OMITS setuptools, and the
    # setuptools pin is what makes the mmcv-full 1.6.2 source build work at
    # all. Without it this proof silently skips the pin it most needs to
    # check, and reports a mismatch on a perfectly good image.
    out = subprocess.run([f"{venv}/bin/pip", "freeze", "--all",
                          "--disable-pip-version-check"],
                         capture_output=True, text=True).stdout
    got = {}
    for line in out.splitlines():
        if "==" in line:
            name, _, ver = line.partition("==")
            got[name.strip().lower()] = ver.strip()
    return got

# ENV A: the versions the recipe names, plus torch's CPU local version.
a = versions("/opt/oniq/venv-autorig")
want_a = dict(PINS["envs"]["autorig"]["pip"])
want_a["numpy"] = PINS["envs"]["autorig"]["numpy"]
for name, ver in sorted(want_a.items()):
    got = a.get(name.lower())
    if got is None:
        fail.append(f"ENV A: {name} is not installed (pinned {ver})")
    elif got != ver:
        fail.append(f"ENV A: {name} is {got}, pinned {ver}")
    else:
        print(f"PROOF ENV A {name}=={ver}")

torch_ver = a.get("torch")
if torch_ver != "1.13.1+cpu":
    fail.append(f"ENV A: torch is {torch_ver}, pinned 1.13.1+cpu — a bare "
                f"'1.13.1' means the CUDA wheel from PyPI resolved instead")
else:
    print("PROOF ENV A torch==1.13.1+cpu")

# ENV B: the whole freeze, because it is short and it is the environment a
# real render was measured in.
b = versions("/opt/oniq/venv-arap")
for name, ver in sorted(PINS["envs"]["arap"]["freeze"].items()):
    got = b.get(name.lower())
    if got is None:
        fail.append(f"ENV B: {name} is not installed (pinned {ver})")
    elif got != ver:
        fail.append(f"ENV B: {name} is {got}, pinned {ver}")
print(f"PROOF ENV B: {len(PINS['envs']['arap']['freeze'])} pins checked")

ad = Path(PINS["source"]["animated_drawings"]["path_in_image"])
if not (ad / "examples/bvh/fair1/zombie.bvh").is_file():
    fail.append("the WALKING driver (zombie.bvh) is not in the AD checkout")
else:
    print("PROOF AD checkout carries the WALKING driver")

if fail:
    for f in fail:
        print("FAIL:", f)
    sys.exit(1)
print("PROOF pins: the image matches pins.json")
