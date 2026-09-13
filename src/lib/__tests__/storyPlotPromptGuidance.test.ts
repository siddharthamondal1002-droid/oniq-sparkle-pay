import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PLOT = readFileSync(join(ROOT, "supabase/functions/story-plot/index.ts"), "utf8");
const BATCH_BLOCK = PLOT.slice(
  PLOT.indexOf("const BATCH_SYSTEM = ["),
  PLOT.indexOf("].join", PLOT.indexOf("const BATCH_SYSTEM = [")),
);

describe("story-plot batch prompt guidance", () => {
  it("keeps cast locks consistent through reflections", () => {
    expect(BATCH_BLOCK).toContain("reflections must show ONLY the same cast already in frame");
    expect(BATCH_BLOCK).toContain("never extra");
  });

  it("asks narration to pace with beat duration", () => {
    expect(BATCH_BLOCK).toContain("Keep pacing duration-aware");
    expect(BATCH_BLOCK).toContain("quick beats get short narration");
  });
});

