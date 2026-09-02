#!/usr/bin/env python3
"""BUILD STEP + FIRST PROOF: load both .mar models on CPU, once, as root.

Two jobs, and the second is why this runs at build time rather than being a
runtime concern:

1.  PROVE the models load. A .mar that unzipped without error can still be
    the wrong archive, or miss the checkpoint the config names. Loading it is
    the only check that catches that, and a build is the cheap place to fail.

2.  GENERATE config_nopretrain.py. The drawn-humanoid detector's config
    initialises its backbone from `open-mmlab://detectron2/resnet50_caffe` —
    a network fetch that is pure waste when a full checkpoint is being loaded
    over the top of it, and impossible in a runtime with no egress.
    autorig_reference.py strips that by WRITING config_nopretrain.py next to
    the model on first use. In this image the model store is root-owned and
    read-only and the job runs as uid 10001, so that write would fail every
    time. Doing it here is what makes a read-only model store possible.

The stripping logic is NOT reimplemented here. This calls
autorig_reference.load_models(), so there is exactly one copy of it and this
proof cannot drift from the code it is proving.
"""
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, "/opt/oniq/scripts")
os.environ.setdefault("AD_MODEL_STORE", "/opt/oniq/model-store")

import autorig_reference as ar  # noqa: E402

store = Path(os.environ["AD_MODEL_STORE"])
nopre = store / "unpack_drawn_humanoid_detector" / "config_nopretrain.py"

t0 = time.time()
ar.load_models()
load_s = time.time() - t0

if not nopre.exists():
    print("FAIL: config_nopretrain.py was not generated at", nopre)
    raise SystemExit(1)
if "open-mmlab://" in nopre.read_text():
    print("FAIL: config_nopretrain.py still names open-mmlab://, so a runtime "
          "with no egress will try to fetch a backbone it cannot reach")
    raise SystemExit(1)

print(f"PROOF models load on CPU in {load_s:.1f}s")
print(f"PROOF config_nopretrain.py generated, no open-mmlab:// reference")
