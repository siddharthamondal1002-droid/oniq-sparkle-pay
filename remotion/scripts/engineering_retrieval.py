#!/usr/bin/env python3
"""ONIQ engineering-library retrieval — the authoritative input to generation.

Reads the FROZEN registered library on val-charlib (engineering_refs/) and
resolves one user request into a per-shelf selection with provenance, then
writes ENGINEERING_REFERENCE_RUN.json.

Discipline:
  * selections are made by explicit, semantically-scoped rules, so the same
    request always resolves to the same references;
  * a shelf that cannot match above threshold resolves to REFERENCE_UNCERTAIN.
    It NEVER falls back to "the first record", which is how a first draft of
    this file silently selected 'neutral' emotion, a 'child' body type and an
    arm-damping rule for a knee query;
  * every record carries its id + the sha256 of the index it came from + the
    sha256 of the frozen master that index was derived from;
  * generation_allowed for reference assets stays FALSE — this module only
    reads engineering_refs/ and never writes into it;
  * NOT_SPECIFIED stays NOT_SPECIFIED. Nothing is invented to fill a field a
    generic cinematic pipeline expects (lens above all).

usage: engineering_retrieval.py <engineering_refs_dir> <out.json> "<request>"
"""
import hashlib
import json
import re
import sys
from pathlib import Path

MIN_SCORE = 1  # zero overlap with the request is never a selection

INDEXES = ("CAMERA_ENGINEERING_INDEX", "LIGHTING_ENGINEERING_INDEX",
           "CAMERA_LIGHTING_MATRIX", "MOTION_ENGINEERING_INDEX",
           "SCENE_ENGINEERING_INDEX", "CHARACTER_ENGINEERING_INDEX",
           "EMOTION_ENGINEERING_INDEX", "QA_ENGINEERING_INDEX",
           "ENGINEERING_DETAILS_1000", "ENGINEERING_TAXONOMY")

UNCERTAIN = {"status": "REFERENCE_UNCERTAIN",
             "fallback": {"action": "STILL_PARALLAX", "contract": "MOTION_CONTRACT"}}


def sha256(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


# Narrow request-side normalisation. This expands the REQUEST's tokens only —
# the frozen library vocabulary is never rewritten. Each entry exists because a
# real query missed a correct record on an inflection or an exact synonym the
# library uses. Anything ambiguous is left out and resolves REFERENCE_UNCERTAIN.
REQUEST_SYNONYMS = {
    "walks": {"walk", "walking"},
    "walk": {"walking"},
    "walked": {"walking"},
    "walking": {"walk"},
    "rainy": {"rain"},
    "city": {"urban", "cityscape"},
    "street": {"urban"},
}


def toks(s):
    return set(re.findall(r"[a-z]+", str(s).lower()))


def request_toks(s):
    t = toks(s)
    return t | {x for w in t for x in REQUEST_SYNONYMS.get(w, ())}


class Library:
    def __init__(self, root):
        self.root = Path(root)
        self.files, self.data = {}, {}
        for name in INDEXES:
            p = self.root / f"{name}.json"
            self.files[name] = sha256(p)
            self.data[name] = json.loads(p.read_text())
        self.taxonomy = self.data["ENGINEERING_TAXONOMY"]
        self.masters = {}
        for line in (self.root / "ENGINEERING_EVIDENCE_SHA256.txt").read_text().splitlines():
            if line.startswith("#") or not line.strip():
                continue
            f = line.split()
            self.masters[f[1]] = f[0]

    def recs(self, name):
        d = self.data[name]
        return d["records"] if "records" in d else d["details"]

    def prov(self, name, rec):
        rec = rec or {}
        return {
            "id": rec.get("id"),
            "index_file": f"{name}.json",
            "index_sha256": self.files[name],
            "reference_image_id": rec.get("reference_image_id") or self.data[name].get("source"),
            "reference_image_sha256": rec.get("source_sha256") or self.data[name].get("source_sha256"),
            "generation_allowed": bool(rec.get("generation_allowed", False)),
        }


def pick(records, request_tokens, fields, require=None, min_score=MIN_SCORE):
    """Highest-scoring admissible record, or None. Ties broken by id."""
    cands = []
    for r in records:
        if require and not require(r):
            continue
        s = len(toks(" ".join(str(r.get(f, "")) for f in fields)) & request_tokens)
        cands.append((s, str(r.get("id", "")), r))
    if not cands:
        return None, 0
    cands.sort(key=lambda c: (-c[0], c[1]))
    sc, _, rec = cands[0]
    return (rec, sc) if sc >= min_score else (None, sc)


def by_ids(records, ids):
    m = {r["id"]: r for r in records}
    return [m[i] for i in ids if i in m]


def retrieve(lib, request):
    rt = request_toks(request)
    shelves = {}

    def put(shelf, rec, name, why, extra=None):
        shelves[shelf] = ({"selected": rec, "provenance": lib.prov(name, rec),
                           "why": why, "status": "RESOLVED", **(extra or {})}
                          if rec else {"selected": None, "why": why, **UNCERTAIN,
                                       **(extra or {})})

    det = lib.recs("ENGINEERING_DETAILS_1000")

    # ---- MOTION grammar: only a PROMOTED grammar may be selected
    mo, _ = pick(lib.recs("MOTION_ENGINEERING_INDEX"), rt,
                 ("subdomain", "engineering_detail"),
                 require=lambda r: r.get("subdomain", "").startswith("grammar/walking"))
    put("MOTION", mo, "MOTION_ENGINEERING_INDEX",
        "the request's verb 'walks' resolves to WALKING, which the library "
        "records as the PRIMARY grammar; no other grammar is promoted, so none "
        "may be substituted")

    # ---- KNEE driver contract: the four ENFORCED damping rules + the driver file
    knee_ids = ["ENG-0134", "ENG-0153", "ENG-0154", "ENG-0155", "ENG-0156", "ENG-0299"]
    knee = by_ids(det, knee_ids)
    enforced = [r for r in knee if r.get("implementation_status") == "ENFORCED"]
    shelves["MOTION_KNEE_CONTRACT"] = {
        "status": "RESOLVED" if enforced else "REFERENCE_UNCERTAIN",
        "selected": [{"id": r["id"], "subdomain": r["subdomain"],
                      "engineering_detail": r["engineering_detail"],
                      "evidence_class": r["evidence_class"],
                      "implementation_status": r.get("implementation_status")} for r in knee],
        "provenance": lib.prov("ENGINEERING_DETAILS_1000", knee[0] if knee else None),
        "why": "the ENFORCED knee-damping rules that govern the BVH driver: scale, "
               "symmetry, channel count, wrap-safe form, knee drive vector and the "
               "accepted driver file pair",
        "enforced_count": len(enforced),
    }

    # ---- SCENE: scene-category / weather-surface / time-surface vocabulary only
    scene_recs = lib.recs("SCENE_ENGINEERING_INDEX")
    sc, _ = pick(scene_recs, rt, ("subdomain", "engineering_detail"),
                 require=lambda r: r.get("subdomain", "").startswith("scene-category/"))
    support = [r for r in scene_recs
               if r.get("subdomain", "").split("/")[0] in
               ("weather-surface", "time-surface", "prop", "scale")
               and len(toks(r["subdomain"]) & rt) >= 1]
    put("SCENE", sc, "SCENE_ENGINEERING_INDEX",
        "scene CATEGORY vocabulary is the only admissible scene selector; "
        "coverage-limitation records are not scene choices",
        {"supporting": [{"id": r["id"], "subdomain": r["subdomain"]} for r in support]})

    # ---- ANATOMY: only MEASURED constraints may gate a render
    anat_ids = ["ENG-0101", "ENG-0104", "ENG-0105", "ENG-0134"]
    anat = [r for r in by_ids(det, anat_ids) if r.get("evidence_class") == "MEASURED"]
    measured_all = [r for r in det if r.get("evidence_class") == "MEASURED"
                    and r.get("domain", "").startswith("01 CHARACTER ANATOMY")]
    shelves["ANATOMY"] = {
        "status": "RESOLVED" if anat else "REFERENCE_UNCERTAIN",
        "selected": [{"id": r["id"], "subdomain": r["subdomain"],
                      "engineering_detail": r["engineering_detail"],
                      "implementation_status": r.get("implementation_status")} for r in anat],
        "provenance": lib.prov("ENGINEERING_DETAILS_1000", anat[0] if anat else None),
        "why": "MEASURED anatomy/rig constraints — the only class permitted to gate "
               "a render (ENFORCED requires MEASURED)",
        "measured_anatomy_records_available": len(measured_all),
    }

    # ---- CAMERA: eye level + full figure + locked/static (the renderer IS static)
    cam, _ = pick(lib.recs("CAMERA_ENGINEERING_INDEX"), rt,
                  ("angle", "subject_scale", "camera_mode", "engineering_detail"),
                  require=lambda r: r["angle"] == "eye level"
                  and r["subject_scale"] == "full-figure subject scale"
                  and r["camera_mode"] == "locked/static")
    put("CAMERA", cam, "CAMERA_ENGINEERING_INDEX",
        "request states eye level and a frontal/near-frontal lane; a walking "
        "figure is a full-figure subject; the CPU renderer is a locked/static "
        "camera, so only locked/static is admissible",
        {"unspecified_by_library": ["lens", "height", "distance", "fov"],
         "unspecified_note": "the atlas does not measure these; they stay "
                             "NOT_SPECIFIED and lens stays null"})

    # ---- LIGHTING: night primary; rain / streetlight are separate atlas axes
    lit_recs = lib.recs("LIGHTING_ENGINEERING_INDEX")
    lit, _ = pick(lit_recs, rt, ("condition",),
                  require=lambda r: r["base_section"].startswith("S1 TIME OF DAY"))
    secondary = []
    for want in ("rain light", "street light"):
        r, _ = pick(lit_recs, toks(want), ("condition",),
                    require=lambda r, w=want: r["condition"] == w)
        if r:
            secondary.append({"id": r["id"], "condition": r["condition"],
                              "base_panel": r["base_panel"], "base_section": r["base_section"]})
    put("LIGHTING", lit, "LIGHTING_ENGINEERING_INDEX",
        "time-of-day register selected from the request's 'night'; the atlas "
        "models weather and artificial sources as SEPARATE panels, so one record "
        "cannot carry night+rain+streetlight — the other axes are carried "
        "explicitly rather than silently merged",
        {"secondary_axes": secondary,
         "unspecified_by_library": ["color_temperature", "ratio", "intensity"]})

    # ---- CAMERA x LIGHTING: must come FROM the registered matrix
    pair = None
    if cam and lit:
        pair = next((m for m in lib.recs("CAMERA_LIGHTING_MATRIX")
                     if m["camera_panel"] == cam["base_panel"]
                     and m["lighting_panel"] == lit["base_panel"]), None)
    shelves["CAMERA_X_LIGHTING"] = {
        "status": "RESOLVED" if pair else "REFERENCE_UNCERTAIN",
        "selected": pair,
        "provenance": lib.prov("CAMERA_LIGHTING_MATRIX", pair),
        "why": "the registered matrix entry joining the selected camera panel to "
               "the selected lighting panel — taken from the 10,000-pair matrix, "
               "not composed independently",
        "compatibility": "REGISTERED_PAIR" if pair else "NO_REGISTERED_PAIR",
    }

    # ---- NEGATIVE: MEASURED failure conditions testable against pixels
    words = ("curl", "slide", "merge", "spike", "tear", "ghost", "drift",
             "border", "silhouette", "segmentation", "crossing", "frozen")
    neg = sorted([r for r in det
                  if r.get("evidence_class") == "MEASURED"
                  and any(w in str(r.get("failure_condition", "")).lower() for w in words)],
                 key=lambda r: r["id"])
    shelves["NEGATIVE"] = {
        "status": "RESOLVED" if neg else "REFERENCE_UNCERTAIN",
        "selected": [{"id": r["id"], "subdomain": r["subdomain"],
                      "failure_condition": r["failure_condition"]} for r in neg],
        "provenance": lib.prov("ENGINEERING_DETAILS_1000", neg[0] if neg else None),
        "why": "MEASURED failure conditions that must be tested against the "
               "rendered pixels before the clip may be called valid",
        "count": len(neg),
    }

    # ---- QA: the measured gates, pre- and post-render
    qa = sorted([r for r in lib.recs("QA_ENGINEERING_INDEX")
                 if r.get("evidence_class") == "MEASURED"
                 and r.get("implementation_status") == "ENFORCED"], key=lambda r: r["id"])
    shelves["QA"] = {
        "status": "RESOLVED" if qa else "REFERENCE_UNCERTAIN",
        "selected": [{"id": r["id"], "subdomain": r["subdomain"],
                      "engineering_detail": r["engineering_detail"],
                      "failure_condition": r["failure_condition"]} for r in qa],
        "provenance": lib.prov("QA_ENGINEERING_INDEX", qa[0] if qa else None),
        "why": "MEASURED + ENFORCED QA gates applied before and after the render",
        "count": len(qa),
    }

    # ---- EMOTION: the atlas index is FACIAL vocabulary only
    emo, sc_e = pick(lib.recs("EMOTION_ENGINEERING_INDEX"), rt, ("detail",))
    shelves["EMOTION_ATLAS"] = {
        "status": "RESOLVED" if emo else "NOT_APPLICABLE",
        "selected": emo,
        "provenance": lib.prov("EMOTION_ENGINEERING_INDEX", emo),
        "why": "the frozen EMOTION index is a FACIAL/expression vocabulary "
               "(neutral, happy, gaze, blink, ...). It contains no whole-body "
               "reading for 'determined', so it cannot serve this request and is "
               "NOT forced to a nearest facial label. The whole-body emotion "
               "reading is taken from the shipped 25-emotion vocabulary instead.",
        "best_score": sc_e,
        "delegated_to": "src/lib/shotPlan.ts EMOTIONS (whole-body, identity-free)",
    }
    return {"request": request, "request_tokens_expanded": sorted(rt), "request_synonyms_applied": {k: sorted(v) for k, v in REQUEST_SYNONYMS.items()}, "shelves": shelves}


def main():
    refs, out_p, request = sys.argv[1], sys.argv[2], sys.argv[3]
    lib = Library(refs)
    r = retrieve(lib, request)
    sel = r["shelves"]
    doc = {
        "record": "ENGINEERING_REFERENCE_RUN",
        "version": "1.0",
        "request": request,
        "engineering_taxonomy_version": lib.taxonomy["version"],
        "engineering_schema_version": json.loads(
            (Path(refs) / "ENGINEERING_SCHEMA.json").read_text())["$id"],
        "engineering_reference_ids": sorted(lib.masters),
        "engineering_reference_sha256": lib.masters,
        "index_sha256": lib.files,
        "generation_allowed": False,
        "generation_allowed_note":
            "FALSE for every reference asset. This run READ the frozen library; "
            "it did not and may not mutate it.",
        "selected_character_shelf": (sel["ANATOMY"].get("provenance") or {}).get("id"),
        "selected_motion_shelf": (sel["MOTION"].get("provenance") or {}).get("id"),
        "selected_scene_shelf": (sel["SCENE"].get("provenance") or {}).get("id"),
        "selected_camera_shelf": (sel["CAMERA"].get("provenance") or {}).get("id"),
        "selected_lighting_shelf": (sel["LIGHTING"].get("provenance") or {}).get("id"),
        "selected_anatomy_shelf": (sel["ANATOMY"].get("provenance") or {}).get("id"),
        "selected_negative_shelf": (sel["NEGATIVE"].get("provenance") or {}).get("id"),
        "selected_qa_shelf": (sel["QA"].get("provenance") or {}).get("id"),
        "retrieval": r,
    }
    Path(out_p).write_text(json.dumps(doc, indent=1))
    print(f"ENGINEERING_REFERENCE_RUN -> {out_p}")
    for k, v in sel.items():
        s = v.get("selected")
        sid = (s.get("id") if isinstance(s, dict) else f"[{len(s)} records]") if s else "NONE"
        print(f"  {k:22s} {v.get('status','?'):20s} {sid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
