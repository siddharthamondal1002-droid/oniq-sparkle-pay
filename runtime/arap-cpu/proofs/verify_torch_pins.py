#!/usr/bin/env python3
"""BUILD STEP: hash-pin the one asset that could not be hashed in advance.

Every other artifact in this image carries a sha256 measured by streaming it.
torch could not: the CPU-only wheels live on download.pytorch.org, which
answers 403 CONNECT under the network policy of the container that authored
this build, so there was no way to compute their hashes before the first
build ran. Leaving torch version-pinned while everything else is hash-pinned
is the actual reproducibility gap, and this closes it in two steps.

`pip install --report` (pip 22.2+, verified on the pinned pip 24.0) emits the
sha256 of every artifact it actually downloaded, without changing what gets
installed. So:

  RECORD  — pins.json carries `null` for a wheel's sha256. The build prints
            the measured hash loudly and stamps the image `hash_pinned:
            false`. This is the FIRST build only, and it is not a pass:
            nothing has been verified, the hash has merely been learned.
  ENFORCE — pins.json carries a sha256. A mismatch FAILS the build. From
            here torch is pinned exactly as the .mar models are.

The version specifier stays the outer gate either way: `torch==1.13.1+cpu`
cannot be satisfied by PyPI at all, so a substitution of the 887 MB CUDA
wheel is impossible before this script is ever reached.

usage: verify_torch_pins.py <pip-report.json> <pins.json> <out-manifest.json>
"""
import json
import sys
from pathlib import Path

report_p, pins_p, out_p = (Path(a) for a in sys.argv[1:4])
report = json.loads(report_p.read_text())
pins = json.loads(pins_p.read_text())
want = pins["envs"]["autorig"]["torch"].get("wheels", {})

got = {}
for item in report.get("install", []):
    md = item.get("metadata", {})
    dl = item.get("download_info", {})
    got[md.get("name", "").lower()] = {
        "version": md.get("version"),
        "url": dl.get("url"),
        "sha256": (dl.get("archive_info", {}).get("hashes", {}) or {}).get("sha256"),
    }

fail, recorded, enforced = [], [], []
for name, pin in want.items():
    # Per-wheel, so a wheel that fails ANY check is never also reported as
    # enforced. An earlier draft printed "PROOF ... ENFORCED torch==1.13.1"
    # for a wheel it had just rejected for not being a +cpu build — a proof
    # line and a failure line about the same artifact, in the same output.
    bad = []
    g = got.get(name.lower())
    if not g:
        bad.append(f"{name}: pip did not report installing it")
    elif not g["sha256"]:
        bad.append(f"{name}: pip reported no sha256 for {g['url']}")
    else:
        # The CPU local version, re-checked here rather than trusted from
        # the specifier: a resolver that satisfied it some other way is a
        # swap, and this is the last place to notice.
        if "+cpu" not in (g["version"] or ""):
            bad.append(f"{name} resolved to {g['version']}, which is not a +cpu build")
        if pin.get("sha256") not in (None, "", "null") and pin["sha256"] != g["sha256"]:
            bad.append(f"{name} sha256 {g['sha256']} does not match the pin {pin['sha256']}")
    if bad:
        fail.extend(bad)
        continue
    if pin.get("sha256") in (None, "", "null"):
        recorded.append((name, g["version"], g["sha256"]))
    else:
        enforced.append((name, g["version"], g["sha256"]))

# A failing build has proven nothing, so it must not stamp the manifest as
# pinned either — the manifest ships inside the image and is read back by
# pins_match.py.
hash_pinned = bool(enforced) and not recorded and not fail
out_p.parent.mkdir(parents=True, exist_ok=True)
out_p.write_text(json.dumps({
    "hash_pinned": hash_pinned,
    "wheels": {k: got[k] for k in sorted(got)},
}, indent=2) + "\n")

for name, ver, sha in enforced:
    print(f"PROOF torch pin ENFORCED {name}=={ver} sha256={sha}")
for name, ver, sha in recorded:
    # Deliberately shouty. This line is the deliverable of a first build:
    # it is what gets copied into pins.json to move torch to ENFORCE.
    print(f"RECORD-ONLY (NOT VERIFIED) {name}=={ver}")
    print(f"RECORD-ONLY sha256 {sha}")
if recorded:
    print("NOTE: torch is NOT hash-pinned yet. Copy the sha256 lines above into")
    print("      runtime/arap-cpu/pins.json envs.autorig.torch.wheels and rebuild;")
    print("      until then this image's torch is version-pinned only.")

if fail:
    for f in fail:
        print("FAIL:", f)
    sys.exit(1)
print(f"PROOF torch wheels: {len(enforced)} enforced, {len(recorded)} recorded")
