/**
 * THE MIRRORED MODULES ARE IDENTICAL, BYTE FOR BYTE.
 *
 * Deno cannot import from src/ and the bundle guard forbids the reverse, so
 * the pure health modules exist twice. Two copies drift the first time one is
 * edited alone; this is the assertion that turns "should be the same" into a
 * red test. The fix when it fails is `cp`, never a hand-merge.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");
const MIRRORED = ["flagNames", "domain", "consent", "redact", "retention"];

describe("src/health and _shared/health agree", () => {
  it.each(MIRRORED)("%s.ts is byte-identical on both sides", (name) => {
    const client = readFileSync(join(ROOT, "src", "health", `${name}.ts`), "utf8");
    const server = readFileSync(
      join(ROOT, "supabase", "functions", "_shared", "health", `${name}.ts`),
      "utf8",
    );
    expect(server).toBe(client);
  });

  it.each(MIRRORED)("%s.ts imports nothing, so copying it changes nothing", (name) => {
    const client = readFileSync(join(ROOT, "src", "health", `${name}.ts`), "utf8");
    expect(client).not.toMatch(/^\s*import\s/m);
  });
});
