/**
 * THE MIRRORED MODULES ARE IDENTICAL, BYTE FOR BYTE.
 *
 * Deno cannot import from src/ and the bundle guard forbids the reverse, so
 * the pure health modules exist twice. Two copies drift the first time one is
 * edited alone; this is the assertion that turns "should be the same" into a
 * red test. The fix when it fails is `cp`, never a hand-merge.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");
/** Path-aware, so a mirrored module under ai/ is checked too. */
const MIRRORED = ["flagNames", "domain", "consent", "redact", "retention", "ai/types"];
/** Client-only modules under src/health/ai — the ones a browser needs and Deno never will. */
const CLIENT_ONLY_AI = ["client"];

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

  it("every file under src/health/ai is either mirrored or declared client-only", () => {
    // A second client-side ai module cannot appear unmirrored and unlisted:
    // the directory's file set must equal the two lists' union.
    const files = readdirSync(join(ROOT, "src", "health", "ai"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/, ""))
      .sort();
    const expected = [
      ...MIRRORED.filter((m) => m.startsWith("ai/")).map((m) => m.slice(3)),
      ...CLIENT_ONLY_AI,
    ].sort();
    expect(files).toEqual(expected);
  });
});
