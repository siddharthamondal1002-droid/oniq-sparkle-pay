/**
 * Step 11C, step 11 — apply the EXISTING post-render gate to isolated WALKING
 * renders of real, eligible gateway characters.
 *
 *   npx tsx scripts/arap-walking-qc.ts <qc_dir> [verdicts.json]
 *
 * <qc_dir>/<stem>/stats.json is what runtime/arap-cpu/qc/walking_qc_stats.py
 * measured inside the image. This script hands each summary to l3RenderQc
 * (src/lib/motionCost.ts) unchanged, with its default thresholds, and writes
 * one verdict per character. A missing or unreadable stats file is a FAILED
 * render, never a pass. Nothing here routes a shot or enables anything: the
 * gate's `escalateTo` is recorded and not acted on.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { l3RenderQc, type L3RenderStats } from "../src/lib/motionCost";

const qcDir = process.argv[2];
if (!qcDir || !existsSync(qcDir)) {
  console.error("usage: arap-walking-qc.ts <qc_dir> [verdicts.json]");
  process.exit(2);
}
const outPath = process.argv[3] ?? join(qcDir, "verdicts.json");

type Summary = L3RenderStats & {
  clip: string;
  frames: number;
  fillMinPct: number;
  fillMaxPct: number;
  largestFillDropPct: number;
  vanishedFrames: number[];
  edgeContactFrames: number[];
  interframeMeanAbsDiff: number;
  staticPairs: number;
  comparedPairs: number;
};

const verdicts = readdirSync(qcDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()
  .map((stem) => {
    const statsPath = join(qcDir, stem, "stats.json");
    if (!existsSync(statsPath)) {
      return {
        stem,
        rendered: false,
        pass: false,
        reasons: ["no stats.json: the render or the measurement did not complete"],
        escalateTo: null,
        summary: null,
      };
    }
    const summary = (JSON.parse(readFileSync(statsPath, "utf8")) as { summary: Summary }).summary;
    const verdict = l3RenderQc({
      meanFillPct: summary.meanFillPct,
      inFrameAllFrames: summary.inFrameAllFrames,
      footLineRangePx: summary.footLineRangePx,
      frameSizePx: summary.frameSizePx,
    });
    return {
      stem,
      rendered: true,
      pass: verdict.pass,
      reasons: verdict.reasons,
      escalateTo: verdict.escalateTo,
      summary,
    };
  });

const report = {
  schema: "oniq.arap-walking-qc/1",
  gate: "src/lib/motionCost.ts l3RenderQc, default thresholds",
  motion:
    "WALKING (examples/bvh/fair1/zombie.bvh via examples/config/motion/zombie.yaml, arm-damped retarget)",
  characters: verdicts.length,
  passed: verdicts.filter((v) => v.pass).length,
  failed: verdicts.filter((v) => !v.pass).length,
  verdicts,
  note: "Isolated renders outside production routing. A pass here enables nothing; a fail is recorded as the existing gate's escalation and is not acted on.",
};
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

console.log("=".repeat(72));
console.log("  ARAP WALKING RENDER QC — isolated, the existing gate, real characters");
console.log("=".repeat(72));
for (const v of verdicts) {
  const s = v.summary;
  console.log(
    `  ${v.pass ? "PASS" : "FAIL"}  ${v.stem}` +
      (s
        ? `  fill mean ${s.meanFillPct}% (min ${s.fillMinPct}, max ${s.fillMaxPct}, largest drop ${s.largestFillDropPct})` +
          `  in-frame ${s.inFrameAllFrames}  foot range ${s.footLineRangePx}/${s.frameSizePx}px` +
          `  diff ${s.interframeMeanAbsDiff}  static ${s.staticPairs}/${s.comparedPairs}`
        : ""),
  );
  for (const r of v.reasons) console.log(`        ${r}`);
}
console.log(`  ${report.passed} passed, ${report.failed} failed, of ${report.characters}`);
console.log("=".repeat(72));
console.log(`WROTE ${outPath}`);
