/**
 * Step 11C, step 11 — the isolated WALKING QC stage: the workflow read as
 * data, the verdict script on synthetic statistics, and the statistics
 * script on a synthetic clip. The gate under test is the EXISTING
 * l3RenderQc; these tests prove the stage hands it honest numbers and
 * cannot do anything but judge.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { l3RenderQc } from "../motionCost";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("the WALKING QC workflow is read as data", () => {
  const wf = read(".github/workflows/arap-walking-qc.yml");
  const code = wf
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  it("pulls the validated digest read-only, mounts the statistics script, and can only judge", () => {
    expect(code).toContain("['validation']['image_build']['digest']");
    expect(code).toContain("packages: read");
    expect(code).not.toContain("packages: write");
    expect(code).not.toContain("contents: write");
    expect(code).not.toContain("docker push");
    expect(code).not.toContain("docker build");
    expect(code).not.toContain("allowPoseWarp");
    expect(code).toContain("/qc:ro");
    expect(code).toContain("fetch_corpus.py --selftest");
    expect(code).toContain("scripts/arap-walking-qc.ts");
    expect(code).not.toMatch(/story-worker|motionRuntime|planShotMotion|resolveShotMotion/);
  });
  it("renders only stems it is given, each validated as a plain id, with WALKING as the default motion", () => {
    expect(code).toContain(
      '[ -n "${STEMS}" ] || { echo "no stems given: nothing to QC"; exit 0; }',
    );
    expect(code).toContain('case "${stem}" in *[!A-Za-z0-9_-]*)');
    expect(code).toContain('default: "examples/config/motion/zombie.yaml"');
  });
});

describe("the verdict script applies l3RenderQc and nothing else", () => {
  const src = read("scripts/arap-walking-qc.ts");
  it("imports only the existing gate", () => {
    const imports = [...src.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)]
      .map((m) => m[1])
      .filter((i) => i.startsWith("../src"));
    expect(imports).toEqual(["../src/lib/motionCost"]);
    for (const s of [
      "allowPoseWarp",
      "planShotMotion",
      "makeArapL3Provider",
      "selectProviderOrder",
      "resolveShotMotion",
    ]) {
      expect(src).not.toContain(s);
    }
  });
  it("passes a clean walk, fails a collapse with the gate's own reasons, and fails a missing render", () => {
    const dir = mkdtempSync(join(tmpdir(), "arap-qc-"));
    const clean = {
      meanFillPct: 9.2,
      inFrameAllFrames: true,
      footLineRangePx: 12,
      frameSizePx: 512,
      clip: "walk.gif",
      frames: 211,
      fillMinPct: 8.1,
      fillMaxPct: 10.3,
      largestFillDropPct: 0.4,
      vanishedFrames: [],
      edgeContactFrames: [],
      interframeMeanAbsDiff: 1.5,
      staticPairs: 0,
      comparedPairs: 210,
    };
    const collapsed = {
      ...clean,
      meanFillPct: 2.3,
      inFrameAllFrames: false,
      footLineRangePx: 140,
      fillMinPct: 0.2,
      largestFillDropPct: 6.5,
      vanishedFrames: [88, 89],
      edgeContactFrames: [150],
    };
    for (const [stem, s] of [
      ["clean-s-shot000", clean],
      ["collapsed-s-shot001", collapsed],
    ] as const) {
      mkdirSync(join(dir, stem), { recursive: true });
      writeFileSync(join(dir, stem, "stats.json"), JSON.stringify({ summary: s, frames: [] }));
    }
    mkdirSync(join(dir, "missing-s-shot002"), { recursive: true });
    const out = execFileSync("npx", ["tsx", "scripts/arap-walking-qc.ts", dir], {
      cwd: root,
      encoding: "utf8",
      timeout: 180_000,
    });
    expect(out).toContain("PASS  clean-s-shot000");
    expect(out).toContain("FAIL  collapsed-s-shot001");
    expect(out).toContain("FAIL  missing-s-shot002");
    expect(out).toContain("1 passed, 2 failed, of 3");
    const report = JSON.parse(readFileSync(join(dir, "verdicts.json"), "utf8"));
    const by = Object.fromEntries(report.verdicts.map((v: { stem: string }) => [v.stem, v]));
    expect(by["clean-s-shot000"]).toMatchObject({ pass: true, reasons: [], escalateTo: null });
    expect(by["collapsed-s-shot001"].reasons).toEqual(
      l3RenderQc({
        meanFillPct: 2.3,
        inFrameAllFrames: false,
        footLineRangePx: 140,
        frameSizePx: 512,
      }).reasons,
    );
    expect(by["collapsed-s-shot001"].escalateTo).toBe(4);
    expect(by["missing-s-shot002"]).toMatchObject({ rendered: false, pass: false });
    expect(report.note).toMatch(/enables nothing/);
  }, 200_000);
});

describe("the statistics script measures a synthetic clip honestly", () => {
  const dir = mkdtempSync(join(tmpdir(), "arap-qc-stats-"));
  const script = join(root, "runtime/arap-cpu/qc/walking_qc_stats.py");
  const makeClip = (py: string) => {
    const gen = join(dir, "gen.py");
    writeFileSync(gen, py);
    execFileSync("python3", [gen], { cwd: dir, encoding: "utf8" });
  };
  it("a square that walks across the canvas and stays inside it: in frame, steady feet, real motion", () => {
    makeClip(`
from PIL import Image, ImageDraw
frames = []
for i in range(30):
    im = Image.new("RGB", (200, 100), (255, 255, 255))
    d = ImageDraw.Draw(im)
    x = 20 + i * 3
    d.rectangle([x, 30, x + 30, 80], fill=(30, 30, 30))
    frames.append(im)
frames.append(Image.new("RGB", (200, 100), (255, 255, 255)))
frames[0].save("walk.gif", save_all=True, append_images=frames[1:], duration=40, loop=0)
`);
    const out = execFileSync("python3", [script, join(dir, "walk.gif"), join(dir, "walk.json")], {
      encoding: "utf8",
    });
    expect(out).toContain("QC_STATS");
    const s = JSON.parse(readFileSync(join(dir, "walk.json"), "utf8")).summary;
    expect(s.bodyFrames).toBe(30);
    expect(s.meanFillPct).toBeCloseTo(((31 * 51) / (200 * 100)) * 100, 0);
    expect(s.inFrameAllFrames).toBe(true);
    expect(s.footLineRangePx).toBe(0);
    expect(s.frameSizePx).toBe(100);
    expect(s.staticPairs).toBe(0);
    expect(l3RenderQc(s).pass).toBe(true);
  });
  it("a square that shrinks to a speck and leaves the frame: vanished, edge contact, the gate fails it", () => {
    makeClip(`
from PIL import Image, ImageDraw
frames = []
for i in range(30):
    im = Image.new("RGB", (200, 100), (255, 255, 255))
    d = ImageDraw.Draw(im)
    size = max(1, 40 - i * 2)
    x = min(150 + i * 2, 198)
    d.rectangle([x, 30, min(199, x + size), 30 + size], fill=(30, 30, 30))
    frames.append(im)
frames.append(Image.new("RGB", (200, 100), (255, 255, 255)))
frames[0].save("collapse.gif", save_all=True, append_images=frames[1:], duration=40, loop=0)
`);
    execFileSync("python3", [script, join(dir, "collapse.gif"), join(dir, "collapse.json")], {
      encoding: "utf8",
    });
    const s = JSON.parse(readFileSync(join(dir, "collapse.json"), "utf8")).summary;
    expect(s.inFrameAllFrames).toBe(false);
    expect(s.edgeContactFrames.length).toBeGreaterThan(0);
    expect(s.vanishedFrames.length).toBeGreaterThan(0);
    expect(s.largestFillDropPct).toBeGreaterThan(0);
    expect(l3RenderQc(s).pass).toBe(false);
  });
  it("exists where the workflow mounts it", () => {
    expect(existsSync(script)).toBe(true);
  });
});
