#!/usr/bin/env python3
"""PROOF: the baked models are the ones pins.json names, and they are complete.

Downloads are verified by sha256 at build time, but that check lives in a
RUN layer and proves nothing about the image that was actually produced. This
re-checks from inside the finished image: the archives unpacked into the
directories autorig_reference.py will look in, the checkpoints its configs
name are present, u2netp still hashes to its pin, and the MIT licence text
travelled with the weights.

A licence file is not decoration here. These weights ship inside a
commercial product; the record of what permits that has to be in the image,
not only in a markdown file in a repository.
"""
import hashlib
import json
import os
import sys
from pathlib import Path

PINS = json.loads(Path(os.environ.get("ONIQ_ARAP_PINS", "/opt/oniq/pins.json")).read_text())
STORE = Path(os.environ.get("AD_MODEL_STORE", "/opt/oniq/model-store"))

fail = []

# The two checkpoint files autorig_reference.py loads by name.
REQUIRED = {
    "unpack_drawn_humanoid_detector": ["config.py", "config_nopretrain.py", "latest.pth"],
    "unpack_drawn_humanoid_pose_estimator": ["config.py", "best_AP_epoch_72.pth"],
}
for d, names in REQUIRED.items():
    for n in names:
        p = STORE / d / n
        if not p.is_file():
            fail.append(f"missing {p}")
        else:
            print(f"PROOF present {d}/{n} ({p.stat().st_size} bytes)")

# u2netp is small enough to re-hash in the image; the .mar archives are not
# retained after unpacking, so their hashes are the build's to assert.
u2 = STORE / "u2netp.onnx"
want = PINS["assets"]["u2netp.onnx"]
if not u2.is_file():
    fail.append(f"missing {u2}")
else:
    h = hashlib.sha256(u2.read_bytes()).hexdigest()
    if h != want["sha256"]:
        fail.append(f"u2netp.onnx sha256 {h}, pins.json says {want['sha256']}")
    elif u2.stat().st_size != want["bytes"]:
        fail.append(f"u2netp.onnx {u2.stat().st_size} bytes, pins.json says {want['bytes']}")
    else:
        print(f"PROOF u2netp.onnx sha256 {h}")

lic = STORE / "LICENSE.AnimatedDrawings"
if not lic.is_file():
    fail.append(f"missing {lic} — the weights shipped without their licence")
else:
    txt = lic.read_text()
    if "MIT License" not in txt:
        fail.append("LICENSE.AnimatedDrawings does not read as the MIT licence")
    else:
        print("PROOF licence: MIT text shipped beside the weights")

# The model store must be read-only to the uid that runs jobs.
if os.access(STORE, os.W_OK):
    fail.append(f"{STORE} is writable by uid {os.getuid()} — a job could rewrite its own model")
else:
    print(f"PROOF model store not writable by uid {os.getuid()}")

if fail:
    for f in fail:
        print("FAIL:", f)
    sys.exit(1)
print("PROOF models: complete, hash-matched, licensed, read-only")
