#!/usr/bin/env python3
"""Pre-render eligibility gate — READ-ONLY extraction of the accepted b4 gate.

Same dual-mask (u2netp + classical) silhouette and same thresholds as the
pipeline that validated M1-M3, lifted out so a render can be gated as its own
traceable step. Unlike the inline version this NEVER writes into the rig
directory: the accepted rig and its mask are evidence and stay untouched.

Thresholds (all MEASURED/ENFORCED in the engineering library):
  rig confidence  >= 0.70      mask fill <= 90%   (the 65% collapse rule is dead)
  no border contact            no core joint off the silhouette

usage: engineering_gate.py <rig_dir> <rig_result.json> <out_dir>
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import yaml
from PIL import Image
from rembg import new_session, remove

CORE = ("shoulder", "hip", "knee", "foot")


def classical(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    g = cv2.bitwise_not(cv2.adaptiveThreshold(
        g, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 115, 8))
    m = cv2.morphologyEx(g, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats((m > 0).astype(np.uint8))
    if n <= 1:
        return np.zeros_like(g)
    m = (lab == 1 + int(np.argmax(stats[1:, 4]))).astype(np.uint8)
    inv = 1 - m
    n2, lab2 = cv2.connectedComponents(inv)
    border = set(lab2[0, :]) | set(lab2[-1, :]) | set(lab2[:, 0]) | set(lab2[:, -1])
    hole = np.isin(lab2, [i for i in range(n2) if i not in border])
    return ((m > 0) | hole).astype(np.uint8)


def main():
    rig, rig_result, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    tex = cv2.imread(str(rig / "texture.png"), cv2.IMREAD_UNCHANGED)[:, :, :3]
    cfg = yaml.safe_load((rig / "char_cfg.yaml").read_text())

    a = np.array(remove(Image.fromarray(cv2.cvtColor(tex, cv2.COLOR_BGR2RGB)),
                        session=new_session("u2netp")))[:, :, 3]
    mu = (a > 127).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mu)
    if n > 1:
        mu = (lab == 1 + int(np.argmax(stats[1:, 4]))).astype(np.uint8)
    mc = classical(tex)

    def score(m):
        H, W = m.shape
        outj = [j["name"] for j in cfg["skeleton"]
                if not (0 <= int(round(j["loc"][1])) < H
                        and 0 <= int(round(j["loc"][0])) < W
                        and m[int(round(j["loc"][1])), int(round(j["loc"][0]))] > 0)]
        return outj, [j for j in outj if any(c in j for c in CORE)]

    ou, cu = score(mu)
    oc, cc = score(mc)
    m, which = (mc, "classical") if len(cc) < len(cu) else (mu, "u2netp")
    outj, core = (oc, cc) if which == "classical" else (ou, cu)
    cv2.imwrite(str(out / "gate_silhouette.png"), m * 255)  # workdir only

    fill = float((m > 0).mean() * 100)
    border = bool(m[0, :].any() or m[-1, :].any() or m[:, 0].any() or m[:, -1].any())
    conf = json.loads(rig_result.read_text()).get("kpt_conf_mean") or 0
    rec = {"mask": which, "fill_pct": round(fill, 1), "border": border,
           "coreOutside": core, "jointsOutside": outj, "kptConfMean": conf,
           "ELIGIBLE": (not border) and fill <= 90 and not core and conf >= 0.70,
           "thresholds": {"rig_confidence_min": 0.70, "mask_fill_max_pct": 90,
                          "border_contact_allowed": False,
                          "note": "the rejected 65% fill collapse rule is NOT applied"},
           "rig_untouched": True}
    (out / "gate.json").write_text(json.dumps(rec, indent=1))
    print(json.dumps(rec))
    return 0 if rec["ELIGIBLE"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
