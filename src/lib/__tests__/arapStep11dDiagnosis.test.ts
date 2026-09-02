/**
 * Step 11D — the diagnosis stage: the workflow read as data, the per-frame
 * diagnosis on synthetic clips whose cause is known by construction, and the
 * report builder producing a PDF without Chrome.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const DIAG = join(root, "runtime/arap-cpu/qc/walking_diagnosis.py");
const REPORT = join(root, "runtime/arap-cpu/qc/diagnosis_report.py");

describe("the Step 11D workflow is read as data", () => {
  const wf = read(".github/workflows/arap-step-11d-diagnosis.yml");
  const code = wf
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  it("pulls the validated digest read-only, renders the reference beside the gateway characters, and writes the PDF at the workspace root", () => {
    expect(code).toContain("['validation']['image_build']['digest']");
    expect(code).toContain("packages: read");
    expect(code).not.toContain("packages: write");
    expect(code).not.toContain("contents: write");
    expect(code).not.toContain("docker push");
    expect(code).not.toContain("docker build");
    expect(code).not.toContain("allowPoseWarp");
    expect(code).toContain('"${DIGEST}" benchmark /work/reference-char1/walk.gif');
    expect(code).toContain("/qc/walking_diagnosis.py");
    expect(code).toContain('"${GITHUB_WORKSPACE}/ONIQ_Step_11D_Diagnosis_Report.pdf"');
    expect(code).toContain("ENTRYPOINT=cp run_in_image");
    expect(code).not.toMatch(/story-worker|motionRuntime|planShotMotion|resolveShotMotion/);
  });
});

describe("the diagnosis tells a translating figure from a collapsing one, by construction", () => {
  const dir = mkdtempSync(join(tmpdir(), "arap-11d-"));
  const clip = (name: string, py: string) => {
    mkdirSync(join(dir, name), { recursive: true });
    const gen = join(dir, `${name}.py`);
    writeFileSync(gen, py);
    execFileSync("python3", [gen], { cwd: join(dir, name), encoding: "utf8" });
    const out = execFileSync(
      "python3",
      [DIAG, join(dir, name, "walk.gif"), join(dir, name), "--label", name],
      { encoding: "utf8" },
    );
    expect(out).toContain("DIAGNOSIS");
    return JSON.parse(readFileSync(join(dir, name, "diagnosis.json"), "utf8")).diagnosis;
  };
  it("a rigid figure walking off the right edge reads TRANSLATION_DOMINANT", () => {
    const d = clip(
      "walker",
      `
from PIL import Image, ImageDraw
frames = []
for i in range(75):
    im = Image.new("RGB", (300, 200), (255, 255, 255)); ImageDraw.Draw(im).rectangle([20 + 4*i, 60, 60 + 4*i, 140], fill=(40, 40, 40)); frames.append(im)
frames.append(Image.new("RGB", (300, 200), (255, 255, 255)))
frames[0].save("walk.gif", save_all=True, append_images=frames[1:], duration=40, loop=0)
`,
    );
    expect(d.reading).toBe("TRANSLATION_DOMINANT");
    expect(d.exitSide).toBe("right");
    expect(d.preEdge.centroidDriftXPxPerFrame).toBeCloseTo(4, 0);
    expect(d.preEdge.heightRelStd).toBeLessThan(0.01);
    expect(d.preEdge.fillRelStd).toBeLessThan(0.01);
    expect(d.firstEdgeContact).not.toBeNull();
    expect(existsSync(join(dir, "walker", "sheet-overview.png"))).toBe(true);
    expect(existsSync(join(dir, "walker", "sheet-exit.png"))).toBe(true);
  });
  it("a figure that shrinks in place and vanishes reads DEFORM_DOMINANT", () => {
    const d = clip(
      "shrinker",
      `
from PIL import Image, ImageDraw
frames = []
for i in range(60):
    im = Image.new("RGB", (300, 200), (255, 255, 255)); d = ImageDraw.Draw(im)
    h = max(2, 80 - 2*i); w = max(2, 40 - i)
    if i < 55: d.rectangle([130, 100 - h//2, 130 + w, 100 + h//2], fill=(40, 40, 40))
    frames.append(im)
frames.append(Image.new("RGB", (300, 200), (255, 255, 255)))
frames[0].save("walk.gif", save_all=True, append_images=frames[1:], duration=40, loop=0)
`,
    );
    expect(d.reading).toBe("DEFORM_DOMINANT");
    expect(d.firstEdgeContact).toBeNull();
    expect(d.preEdge.heightChangeFirstToLastQuarter).toBeLessThan(-0.25);
  });
  it("names its cut points as analysis parameters, not gates", () => {
    const src = read("runtime/arap-cpu/qc/walking_diagnosis.py");
    expect(src).toContain("not gates");
    expect(src).not.toContain("l3RenderQc(");
  });
  it("the report builder writes a PDF from the diagnoses without Chrome", () => {
    const pdf = join(dir, "ONIQ_Step_11D_Diagnosis_Report.pdf");
    const out = execFileSync(
      "python3",
      [REPORT, dir, pdf, "--digest", "test-digest", "--extra", "note=test"],
      { encoding: "utf8" },
    );
    expect(out).toContain("WROTE");
    expect(out).toContain('"walker": "TRANSLATION_DOMINANT"');
    expect(out).toContain('"shrinker": "DEFORM_DOMINANT"');
    expect(statSync(pdf).size).toBeGreaterThan(1000);
    expect(readFileSync(pdf).subarray(0, 5).toString()).toBe("%PDF-");
    expect(existsSync(join(dir, "ONIQ_Step_11D_Diagnosis_Report.html"))).toBe(true);
  });
});
