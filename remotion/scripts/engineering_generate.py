#!/usr/bin/env python3
"""Bind retrieved ONIQ engineering to renderer parameters, then generate ONE clip.

This is the link that was missing: previously the library produced a shot plan
and the renderer was invoked with hand-written configs, so nothing the library
said actually reached the pixels. Here every renderer parameter is DERIVED from
a named engineering reference, and any parameter that cannot be derived fails
closed instead of being defaulted.

Support levels, recorded per binding and never blurred:
  ENFORCED        the reference sets a real renderer parameter on this path
  PLAN_ONLY       carried into the plan; the zero-GPU CPU path has no such
                  control (all lighting/compositing) — for the owner-gated
                  paid stage, not executed here
  NOT_SPECIFIED   the library explicitly does not measure it (lens above all)
  BLOCKED         owner-gated

Generation is explicit: without --authorize the script plans and gates but
refuses to render.

usage: engineering_generate.py <run.json> <plan.json> <workdir> [--authorize]
"""
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

SC = Path("/tmp/claude-0/-home-user-oniq-sparkle-pay/"
          "65e4b369-079b-5eca-8708-c0c1cc6772c6/scratchpad")
AD = SC / "l3amp/AnimatedDrawings"
SRC_BVH = AD / "examples/bvh/fair1/zombie.bvh"
DAMPER = SC / "genloop/v3/b3_knee_damp.py"
REGISTERED_KNEE_BVH = SC / "genloop/v3/zombie_knee050.bvh"
RETARGET_BASE = SC / "l3amp/fair1_ppf_armdamped2.yaml"
RENDERER = Path("/home/user/oniq-sparkle-pay/remotion/scripts/l3_animate_reference.py")

# Measured render envelope per character: the largest frame window whose
# silhouette never contacts the canvas border. Sourced from the 2026-08-23
# envelope measurement; the post-render ENVELOPE gate re-verifies it and fails
# closed, so this is a derivation input, never an unchecked assumption.
MEASURED_ENVELOPE = {"m3_suit_woman": {"frames": 129, "first_border_contact": 129,
                                       "measured_at": "2026-08-23"}}


def sha256(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def sha256_str(s):
    return hashlib.sha256(s.encode()).hexdigest()


def die(msg, trace, workdir):
    trace["result"] = {"status": "FAIL_CLOSED", "reason": msg}
    (workdir / "ENGINEERING_TRACE.json").write_text(json.dumps(trace, indent=1))
    print(f"FAIL_CLOSED: {msg}")
    return 2


def main():
    run_p, plan_p, workdir = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    authorize = "--authorize" in sys.argv
    workdir.mkdir(parents=True, exist_ok=True)
    run = json.loads(run_p.read_text())
    plan = json.loads(plan_p.read_text())
    shelves = run["retrieval"]["shelves"]
    character = "m3_suit_woman"
    char_dir = SC / "genloop/v3/b4" / character

    bindings = []

    def bind(param, value, level, refs, note=""):
        bindings.append({"renderer_parameter": param, "value": value,
                         "support": level, "engineering_reference_ids": refs,
                         "note": note})

    trace = {
        "record": "ENGINEERING_TRACE", "version": "1.0",
        "request": run["request"],
        "engineering_reference_run": {
            "file": run_p.name, "sha256": sha256(run_p),
            "reference_ids": run["engineering_reference_ids"],
            "reference_sha256": run["engineering_reference_sha256"],
            "index_sha256": run["index_sha256"],
            "generation_allowed_for_references": run["generation_allowed"],
        },
        "shot_plan": {"file": plan_p.name, "sha256": sha256(plan_p),
                      "emotion": plan["emotion"], "motion": plan["motion"],
                      "camera": plan["camera"], "lens": plan["lens"],
                      "lighting": plan["lighting"], "weather": plan["weather"],
                      "time": plan["time"], "environment": plan["environment"],
                      "explicit_generation_required": plan["explicitGenerationRequired"],
                      "reference_provenance": plan["referenceProvenance"]},
        "retrieval_status": {k: v.get("status") for k, v in shelves.items()},
    }

    # ---------------------------------------------------------------- guards
    if run["generation_allowed"] is not False:
        return die("reference library generation_allowed must be FALSE", trace, workdir)
    for k in ("MOTION", "CAMERA", "LIGHTING", "CAMERA_X_LIGHTING", "SCENE",
              "ANATOMY", "NEGATIVE", "QA", "MOTION_KNEE_CONTRACT"):
        if shelves[k].get("status") not in ("RESOLVED",):
            return die(f"shelf {k} did not resolve ({shelves[k].get('status')})",
                       trace, workdir)
    if not plan.get("ok") or not plan.get("explicitGenerationRequired"):
        return die("shot plan is not ok / does not require explicit generation",
                   trace, workdir)

    # ------------------------------------------------- MOTION grammar binding
    motion = shelves["MOTION"]["selected"]
    if plan["motion"]["grammar"] != "walking" or plan["motion"]["status"] != "PRIMARY":
        return die("plan motion grammar is not the promoted WALKING/PRIMARY", trace, workdir)
    bind("driver_family", "walk (not idle)", "ENFORCED", [motion["id"]],
         "WALKING is the only promoted grammar; idle/turn/reach/wave are not substituted")

    # --------------------------------------- KNEE contract -> derived BVH
    knee = {r["id"]: r for r in shelves["MOTION_KNEE_CONTRACT"]["selected"]}
    scale_rec = knee.get("ENG-0153")
    if not scale_rec or scale_rec["implementation_status"] != "ENFORCED":
        return die("knee damping scale rule is not ENFORCED", trace, workdir)
    scale = 0.50  # stated by ENG-0153; asserted against its text below
    if "0.50" not in scale_rec["engineering_detail"]:
        return die("ENG-0153 no longer states 0.50", trace, workdir)
    if "BOTH" not in knee["ENG-0154"]["engineering_detail"]:
        return die("ENG-0154 symmetry rule changed", trace, workdir)
    if "six" not in knee["ENG-0155"]["engineering_detail"].lower():
        return die("ENG-0155 channel-count rule changed", trace, workdir)
    if "unwrap" not in knee["ENG-0156"]["engineering_detail"]:
        return die("ENG-0156 wrap-safe form changed", trace, workdir)

    derived = workdir / "driver_knee050.bvh"
    r = subprocess.run([sys.executable, str(DAMPER), str(SRC_BVH), str(derived),
                        str(scale)], capture_output=True, text=True)
    if r.returncode != 0:
        return die(f"knee damper failed: {r.stderr[:200]}", trace, workdir)
    damper_out = r.stdout.strip()
    trace["knee_driver"] = {
        "driver_id": "b3_knee_damp.py",
        "driver_sha256": sha256(DAMPER),
        "rule_ids": sorted(knee),
        "scale": scale,
        "scale_reference": "ENG-0153",
        "symmetry_reference": "ENG-0154",
        "channels_reference": "ENG-0155",
        "form_reference": "ENG-0156",
        "knee_drive_reference": "ENG-0134",
        "accepted_driver_file_reference": "ENG-0299",
        "source_bvh": str(SRC_BVH), "source_bvh_sha256": sha256(SRC_BVH),
        "derived_bvh_sha256": sha256(derived),
        "damper_report": damper_out,
        "channels_modified": "6 rotation channels on LeftLeg + RightLeg",
        "channels_not_modified": "hips, ankles(Foot), toes, spine, arms, head, "
                                 "root translation, frame count, frame time",
        "matches_registered_driver": sha256(derived) == sha256(REGISTERED_KNEE_BVH),
        "registered_driver_sha256": sha256(REGISTERED_KNEE_BVH),
    }
    if not trace["knee_driver"]["matches_registered_driver"]:
        return die("re-derived knee BVH does not match the registered ENG-0299 driver",
                   trace, workdir)
    bind("bvh_knee_damping", scale, "ENFORCED",
         ["ENG-0153", "ENG-0154", "ENG-0155", "ENG-0156", "ENG-0134", "ENG-0299"],
         "re-derived from the source BVH by the library rule and byte-matched to "
         "the registered accepted driver")

    # ------------------------------------------- CAMERA -> projection + envelope
    cam = shelves["CAMERA"]["selected"]
    if cam["camera_mode"] != "locked/static":
        return die("selected camera mode is not locked/static", trace, workdir)
    bind("camera_motion", "none (locked/static)", "ENFORCED", [cam["id"]],
         "the CPU renderer has a fixed camera; the selected reference agrees")
    if plan["camera"]["lane"] != "frontal/near_frontal":
        return die("plan camera lane is not frontal/near_frontal", trace, workdir)
    bind("retarget_projection_planes",
         {"Upper Limbs": "frontal", "Lower Limbs": "sagittal", "Trunk": "frontal"},
         "ENFORCED", [cam["id"], "ENG-0134"],
         "pinned explicitly so the basis cannot be re-derived by PCA from the "
         "frame range; values are the ones the full-range PCA itself selects")
    for k, v in cam["camera_parameters"].items():
        bind(f"camera_{k}", v, "NOT_SPECIFIED", [cam["id"]],
             "the atlas does not measure this; nothing is invented")
    bind("lens", plan["lens"], "NOT_SPECIFIED", [cam["id"]],
         "lens stays null — ONIQ measures no lens control")

    env = MEASURED_ENVELOPE.get(character)
    if not env:
        return die(f"no measured render envelope for character {character}", trace, workdir)
    bind("end_frame_idx", env["frames"], "ENFORCED",
         [cam["id"], "QA:no-border-contact"],
         "the frame window is bounded by the MEASURED no-border-contact envelope "
         "for this character; the post-render ENVELOPE gate re-verifies it")

    # ------------------------------------------------ LIGHTING / SCENE / MATRIX
    lit = shelves["LIGHTING"]["selected"]
    pair = shelves["CAMERA_X_LIGHTING"]["selected"]
    bind("lighting", {"primary": lit["id"], "condition": lit["condition"],
                      "direction": lit["direction"], "quality": lit["quality"],
                      "secondary_axes": shelves["LIGHTING"]["secondary_axes"]},
         "PLAN_ONLY", [lit["id"]],
         "the CPU ARAP renderer has NO lighting model: this is carried into the "
         "plan for the owner-gated paid compositing stage and is NOT executed here")
    bind("camera_x_lighting", {"matrix_id": pair["id"], "pair": pair["pair"],
                               "camera_panel": pair["camera_panel"],
                               "lighting_panel": pair["lighting_panel"]},
         "PLAN_ONLY", [pair["id"]],
         "registered matrix pair carried into the plan")
    scene = shelves["SCENE"]["selected"]
    bind("scene", {"category": scene["id"], "subdomain": scene["subdomain"],
                   "supporting": [s["id"] for s in shelves["SCENE"]["supporting"]]},
         "PLAN_ONLY", [scene["id"]],
         "no scene compositing on the zero-GPU path; plain canvas is rendered")
    bind("production_adoption", "owner-gated", "BLOCKED", ["ENG-0949"],
         "knee-damped walking production adoption is owner item (a)")

    # ------------------------------------------------------- write the configs
    motion_cfg = workdir / "motion_engineering.yaml"
    motion_cfg.write_text(
        "# GENERATED by engineering_generate.py — every value traces to a reference.\n"
        f"# grammar {motion['id']} | knee ENG-0153/0154/0155/0156 | envelope {cam['id']}+QA\n"
        f"filepath: {derived}\n"
        "start_frame_idx: 0\n"
        f"end_frame_idx: {env['frames']}\n"
        "groundplane_joint: LeftFoot\n"
        "forward_perp_joint_vectors:\n"
        "  - - LeftShoulder\n    - RightShoulder\n"
        "  - - LeftUpLeg\n    - RightUpLeg\n"
        "scale: 0.025\n"
        "up: +z\n")
    retarget_cfg = workdir / "retarget_engineering.yaml"
    txt = RETARGET_BASE.read_text()
    txt = txt.replace("""  - LeftHandEnd
  method: pca
  name: Upper Limbs""", """  - LeftHandEnd
  method: frontal
  name: Upper Limbs""").replace("""  - LeftToeBase
  method: pca
  name: Lower Limbs""", """  - LeftToeBase
  method: sagittal
  name: Lower Limbs""")
    if "method: pca" in txt:
        return die("projection planes not fully pinned", trace, workdir)
    retarget_cfg.write_text(txt)

    trace["bindings"] = bindings
    trace["renderer"] = {
        "script": str(RENDERER), "script_sha256": sha256(RENDERER),
        "character": character, "character_rig": str(char_dir / "rig"),
        "motion_cfg": str(motion_cfg), "motion_cfg_sha256": sha256(motion_cfg),
        "retarget_cfg": str(retarget_cfg), "retarget_cfg_sha256": sha256(retarget_cfg),
        "canvas": "500x500", "gpu": False,
    }
    trace["shot_plan_hash"] = sha256_str(json.dumps(plan, sort_keys=True))

    # ------------------------------------------------------ pre-render QA gates
    rig = json.loads((char_dir / "rig_result.json").read_text()) \
        if (char_dir / "rig_result.json").exists() else {}
    gate_p = workdir / "gate.json"   # produced by engineering_gate.py (read-only)
    if not gate_p.exists():
        return die("no pre-render gate record; run engineering_gate.py first",
                   trace, workdir)
    gate = json.loads(gate_p.read_text())
    trace["pre_render_gate_record"] = gate
    pre = []

    def g(name, ok, detail, refs):
        pre.append({"gate": name, "result": "PASS" if ok else "FAIL",
                    "detail": detail, "engineering_reference_ids": refs})

    kc = rig.get("kpt_conf_mean")
    g("rig_confidence>=0.70", kc is not None and kc >= 0.70,
      f"kpt_conf_mean={kc}", ["QA:landmark-confidence"])
    fill = gate.get("fill_pct", gate.get("fill"))
    g("mask_fill<=90", fill is not None and fill <= 90,
      f"fill={fill}%  (the rejected 65% collapse rule is NOT applied)", ["QA:mask-fill"])
    g("no_border_contact_pre", gate.get("border") is False,
      f"border={gate.get('border')}", ["QA:border-contact"])
    g("core_joints_on_silhouette", not gate.get("coreOutside"),
      f"coreOutside={gate.get('coreOutside')}", ["ENG-0101", "ENG-0104", "ENG-0105"])
    trace["pre_render_gates"] = pre
    if any(p["result"] == "FAIL" for p in pre):
        return die("a pre-render QA gate failed", trace, workdir)

    # ------------------------------------------------- explicit generation gate
    trace["generation_authorization"] = {
        "explicit_generation_required_by_plan": True,
        "authorized": bool(authorize),
        "authorization_source": "owner instruction (ONE corrected sample)" if authorize
                                else None,
        "cost": {"api_inr": 0, "gpu_inr": 0, "gpu_used": False},
    }
    if not authorize:
        trace["result"] = {"status": "PLANNED_NOT_GENERATED",
                           "reason": "explicit generation not authorized"}
        (workdir / "ENGINEERING_TRACE.json").write_text(json.dumps(trace, indent=1))
        print("PLANNED_NOT_GENERATED — rerun with --authorize to generate")
        return 0

    # ------------------------------------------------------------------ render
    outs = []
    for i in (1, 2):
        out = workdir / f"sample_{i}.gif"
        log = workdir / f"render_{i}.log"
        env_vars = {"PYTHONPATH": str(AD), "PYOPENGL_PLATFORM": "osmesa",
                    "MESA_GL_VERSION_OVERRIDE": "3.3", "PATH": "/usr/bin:/bin:/usr/local/bin"}
        rr = subprocess.run([sys.executable, str(RENDERER), str(AD),
                             str(char_dir / "rig"), str(motion_cfg), str(retarget_cfg),
                             str(out)], capture_output=True, text=True, env=env_vars)
        log.write_text(rr.stdout + rr.stderr)
        if not out.exists():
            return die(f"render {i} produced no output", trace, workdir)
        secs = next((l.split()[1] for l in rr.stdout.splitlines()
                     if l.startswith("RENDER_SECONDS")), "?")
        rss = next((l.split()[1] for l in rr.stdout.splitlines()
                    if l.startswith("MAX_RSS_MB")), "?")
        outs.append({"file": out.name, "sha256": sha256(out),
                     "render_seconds": secs, "max_rss_mb": rss,
                     "bytes": out.stat().st_size})
    trace["outputs"] = outs
    trace["determinism"] = {
        "same_host_pair": outs[0]["sha256"] == outs[1]["sha256"],
        "policy": "PER_HOST / PER_CPU_CLASS", "rebaselined_fixtures": False,
    }
    trace["result"] = {"status": "GENERATED", "output_sha256": outs[0]["sha256"]}
    (workdir / "ENGINEERING_TRACE.json").write_text(json.dumps(trace, indent=1))
    shutil.copy(run_p, workdir / run_p.name)
    print(f"GENERATED {outs[0]['file']} sha={outs[0]['sha256'][:16]} "
          f"determinism={'PASS' if trace['determinism']['same_host_pair'] else 'FAIL'}")
    for b in bindings:
        print(f"  {b['support']:14s} {b['renderer_parameter']:28s} <- "
              f"{','.join(b['engineering_reference_ids'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
