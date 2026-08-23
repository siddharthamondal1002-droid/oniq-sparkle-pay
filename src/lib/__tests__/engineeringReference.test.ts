/**
 * Engineering-reference layer pins. The contract under test is the
 * REFERENCE HIERARCHY itself: measured ONIQ evidence beats the posters,
 * REFERENCE_ONLY material can never become a hard gate, fallback stays
 * fail-closed with a MOTION_CONTRACT reason, and the recorded
 * poster-vs-evidence discrepancies cannot silently disappear.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ALIVENESS_MIN,
  CAMERA_LANES,
  DISCREPANCIES,
  ELIGIBILITY,
  ENGINEERING_CATEGORY_MAP,
  ENGINEERING_DETAIL_LIBRARY,
  ENGINEERING_REFERENCE_REGISTRY,
  engineeringProvenanceFor,
  FALLBACK,
  GATE_MAPPING,
  KNEE_DAMPING,
  LIMB_CLASSES,
  MESH_DENSITY,
  MOTION_PROMOTION,
  retrieveReferenceShelves,
  VISUAL_ATLAS_LIBRARY,
  WALK_PHASES,
} from "../engineeringReference.ts";

describe("measured constants stand over poster values", () => {
  it("aliveness gate is 0.75, and the ENG-002 0.70 conflict is on record", () => {
    expect(ALIVENESS_MIN).toBe(0.75);
    const d = DISCREPANCIES.find((x) => x.topic === "quality score threshold");
    expect(d?.poster).toContain("0.70");
    expect(d?.resolution).toContain("0.75");
  });

  it("knee damping is 0.50 at the BVH layer, both knees, six channels, with the untouchable list intact", () => {
    expect(KNEE_DAMPING.scale).toBe(0.5);
    expect(KNEE_DAMPING.layer).toBe("SOURCE_BVH");
    expect(KNEE_DAMPING.symmetric).toBe(true);
    expect(KNEE_DAMPING.channels).toBe(6);
    for (const item of ["hips", "ankles", "root translation", "timing", "stride timing", "ARAP mesh", "segmentation", "mapping"]) {
      expect(KNEE_DAMPING.mustNotAlter).toContain(item);
    }
  });

  it("eligibility mirrors the shipped gate exactly", () => {
    expect(ELIGIBILITY.fillPctMax).toBe(90);
    expect(ELIGIBILITY.kptConfMeanMin).toBe(0.7);
    expect(ELIGIBILITY.connectedComponentsMax).toBe(1);
    expect(ELIGIBILITY.borderContact).toBe("REJECT");
  });

  it("mesh density: GRID40 default; density rescues neither ink strokes nor bare-shin warp", () => {
    expect(MESH_DENSITY.default).toBe(40);
    expect(MESH_DENSITY.thinSolidLimbRecovery).toEqual([60, 80]);
    expect(MESH_DENSITY.rescuesThinInkStrokes).toBe(false);
    expect(MESH_DENSITY.rescuesBareThinShinWarp).toBe(false);
  });

  it("thin-limb and thin-stroke remain separate classes (plus the M3 bare-shin class)", () => {
    const names = LIMB_CLASSES.map((c) => c.cls);
    expect(names).toContain("THIN_SOLID_LIMB");
    expect(names).toContain("THIN_INK_STROKE");
    expect(names).toContain("BARE_THIN_SHIN");
    const d = DISCREPANCIES.find((x) => x.topic === "thin-limb classification");
    expect(d?.measured).toContain("NOT");
  });

  it("motion promotion: walking primary, idle secondary, wave excluded, turn/reach unpromoted", () => {
    expect(MOTION_PROMOTION.walking).toBe("PRIMARY");
    expect(MOTION_PROMOTION.idle).toBe("SECONDARY");
    expect(MOTION_PROMOTION.wave).toBe("EXCLUDED");
    expect(MOTION_PROMOTION.turn).toBe("UNPROMOTED");
    expect(MOTION_PROMOTION.reach).toBe("UNPROMOTED");
  });

  it("camera lanes: frontal/near-frontal only", () => {
    const supported = CAMERA_LANES.filter((l) => l.supported).map((l) => l.lane);
    expect(supported).toEqual(["frontal", "near_frontal"]);
  });
});

describe("gate mapping discipline", () => {
  it("every category maps to exactly one class, and poster-only material is never a gate", () => {
    const classes = ["PRE_RENDER_GATE", "POST_RENDER_GATE", "DIAGNOSTIC_ONLY", "REFERENCE_ONLY", "STRESS_TEST"];
    for (const [cat, cls] of Object.entries(GATE_MAPPING)) {
      expect(classes, cat).toContain(cls);
    }
    // The four discrepancy-bearing poster tables must all be REFERENCE_ONLY.
    for (const cat of ["proportion_table", "dof_rotation_limits", "foot_contact_cm_thresholds", "texture_deformation_budget"]) {
      expect(GATE_MAPPING[cat], cat).toBe("REFERENCE_ONLY");
    }
    // The measured hole finding stays diagnostic, never a reject rule.
    expect(GATE_MAPPING.interior_hole_metrics).toBe("DIAGNOSTIC_ONLY");
    // The real shipped gates stay gates.
    expect(GATE_MAPPING.temporal_aliveness).toBe("POST_RENDER_GATE");
    expect(GATE_MAPPING.border_contact).toBe("PRE_RENDER_GATE");
  });

  it("walk phases match the nine-phase cycle", () => {
    expect(WALK_PHASES.length).toBe(9);
    expect(WALK_PHASES[0]).toBe("contact");
    expect(WALK_PHASES[8]).toBe("recovery");
  });
});

describe("fallback stays fail-closed", () => {
  it("every rejection reason resolves to still/parallax with a MOTION_CONTRACT", () => {
    expect(FALLBACK.action).toBe("STILL_PARALLAX");
    expect(FALLBACK.contract).toBe("MOTION_CONTRACT");
    expect(FALLBACK.reasons.length).toBeGreaterThanOrEqual(10);
    expect(new Set(FALLBACK.reasons).size).toBe(FALLBACK.reasons.length);
  });
});

describe("frozen reference provenance", () => {
  it("registry hashes are well-formed, unique, and round-trip; unknown ids refuse", () => {
    const seen = new Set<string>();
    for (const r of ENGINEERING_REFERENCE_REGISTRY) {
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(seen.has(r.sha256)).toBe(false);
      seen.add(r.sha256);
    }
    const ok = engineeringProvenanceFor(["ENG-001", "ENG-002"]);
    expect(ok.ok).toBe(true);
    const bad = engineeringProvenanceFor(["ENG-404"]);
    expect(bad.ok).toBe(false);
  });
});

describe("the 1000-detail engineering library", () => {
  const raw = readFileSync(join(__dirname, "..", "engineeringDetails.json"), "utf8");
  const lib = JSON.parse(raw);

  it("holds exactly 1000 details, 100 per domain, continuous ids", () => {
    expect(lib.details.length).toBe(1000);
    const perDomain = new Map<string, number>();
    lib.details.forEach((d: { domain: string }, i: number) => {
      perDomain.set(d.domain, (perDomain.get(d.domain) ?? 0) + 1);
      expect(lib.details[i].id).toBe(`ENG-${String(i + 1).padStart(4, "0")}`);
    });
    expect(perDomain.size).toBe(10);
    for (const n of perDomain.values()) expect(n).toBe(100);
  });

  it("never promotes an assumption to a gate: ENFORCED requires MEASURED", () => {
    for (const d of lib.details) {
      expect(["MEASURED", "REFERENCE", "INFERRED", "OPEN"]).toContain(d.evidence_class);
      expect(["ENFORCED", "CANDIDATE", "REFERENCE_ONLY", "STRESS_TEST", "BLOCKED"]).toContain(d.implementation_status);
      if (d.implementation_status === "ENFORCED") expect(d.evidence_class, d.id).toBe("MEASURED");
    }
  });

  it("pins the owner's non-negotiables inside the data", () => {
    const by = (sub: string) => lib.details.find((d: { subdomain: string }) => d.subdomain === sub);
    expect(by("knee-damping/scale").implementation_status).toBe("ENFORCED");
    expect(by("gate/fill-65-retired").evidence_class).toBe("MEASURED");
    expect(by("grammar/wave").implementation_status).toBe("BLOCKED");
    expect(by("coverage/covered-shin").evidence_class).toBe("OPEN");
    expect(by("experiment/coverage-status").implementation_status).toBe("BLOCKED");
  });

  it("catalog metadata matches the shipped data file", () => {
    expect(ENGINEERING_DETAIL_LIBRARY.total).toBe(lib.details.length);
    const sha = createHash("sha256").update(raw).digest("hex");
    expect(sha).toBe(ENGINEERING_DETAIL_LIBRARY.sha256);
    for (const c of ENGINEERING_CATEGORY_MAP) {
      for (const g of c.gates) expect(Object.keys(GATE_MAPPING)).toContain(g);
    }
  });
});

describe("atlas retrieval layer (reference never generates)", () => {
  it("registry carries ENG-003/ENG-004 and the atlas metadata stays generation-locked", () => {
    expect(ENGINEERING_REFERENCE_REGISTRY.length).toBe(4);
    expect(VISUAL_ATLAS_LIBRARY.cameraDetails + VISUAL_ATLAS_LIBRARY.lightingDetails).toBe(10000);
    expect(VISUAL_ATLAS_LIBRARY.cameraLightingMatrix).toBe(10000);
    expect(VISUAL_ATLAS_LIBRARY.generationAllowed).toBe(false);
    expect(VISUAL_ATLAS_LIBRARY.productionEnabled).toBe(false);
  });

  it("retrieves the loop's four example intents onto the right shelves", () => {
    const s1 = retrieveReferenceShelves("Give me a low-angle cinematic shot.");
    expect(s1).toContain("CAMERA");
    expect(s1).toContain("LIGHTING");
    const s2 = retrieveReferenceShelves("Night rainy street.");
    expect(s2).toEqual(expect.arrayContaining(["LIGHTING", "SCENE", "MATERIAL"]));
    const s3 = retrieveReferenceShelves("Emotional close-up at sunset.");
    expect(s3).toEqual(expect.arrayContaining(["CAMERA", "LIGHTING", "CHARACTER ENGINEERING"]));
    const s4 = retrieveReferenceShelves("Character walking through a foggy forest.");
    expect(s4).toEqual(expect.arrayContaining(["MOTION ENGINEERING", "CHARACTER ENGINEERING", "LIGHTING", "SCENE"]));
    expect(retrieveReferenceShelves("zzz unrelated 123")).toEqual([]);
  });
});

describe("schema", () => {
  it("ENGINEERING_SCHEMA.json parses, pins generation_allowed=false, and stays identity-free", () => {
    const raw = readFileSync(join(__dirname, "..", "ENGINEERING_SCHEMA.json"), "utf8");
    const schema = JSON.parse(raw);
    expect(schema.properties.generation_allowed).toEqual({ const: false });
    expect(schema.required).toContain("generation_allowed");
    // Identity-free by construction: none of these may ever appear.
    for (const banned of ["ethnicity", "gender", "occupation", "nationality", "costume", "identity"]) {
      expect(Object.keys(schema.properties)).not.toContain(banned);
    }
    expect(schema.properties.limbs.properties.limb_class.enum).toContain("THIN_INK_STROKE");
    expect(schema.properties.mesh.properties.grid.enum).toEqual([30, 40, 60, 80]);
  });
});
