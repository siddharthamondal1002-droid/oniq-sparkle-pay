/**
 * ANTHROPIC IS OFF THE HEALTH PATH — owner directive 2026-09-09: "Remove
 * Anthropic from the active Health AI path. Do not leave an accidental
 * fallback that sends health data to Anthropic."
 *
 * Three things, each a red test: the retired `health-scan` function is a
 * stub that reads no key, reads no body and opens no socket; nothing in the
 * shipped client invokes it; and no file on the health path — client or
 * server — names Anthropic, Claude or their host. Comments are stripped
 * first: the stub's own header explains what it retired by name (the tenth
 * prose match in this repo), and a guard that read the explanation as the
 * code would fail on the file that documents the change.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";
import { THIRD_PARTY_REQUESTS } from "@/config/playCompliance";
import { HEALTH_AI_RECIPIENT_NAME } from "@/config/privacy";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const ANTHROPIC = /anthropic|claude|api\.anthropic\.com/i;

describe("health-scan is a stub", () => {
  const src = stripComments(read("supabase/functions/health-scan/index.ts"));

  it("reads no key, no body, and opens no socket", () => {
    expect(src).not.toMatch(/\bfetch\b/);
    expect(src).not.toMatch(/Deno\.env/);
    expect(src).not.toMatch(ANTHROPIC);
    expect(src).not.toMatch(/req\.json|req\.text|req\.body|arrayBuffer/);
    expect(src).not.toMatch(/withSearchSpendGuard|web_search/);
  });

  it("answers 410 with a closed reason", () => {
    expect(src).toMatch(/status:\s*410/);
    expect(src).toContain('reason: "health_scan_retired"');
    expect(src).toMatch(/Deno\.serve\(/);
  });
});

describe("nothing in the shipped client reaches it", () => {
  it("no non-test source under src/ invokes health-scan or renders the report scan", () => {
    const hits: string[] = [];
    for (const f of walk(join(ROOT, "src"))) {
      const text = stripComments(readFileSync(f, "utf8"));
      if (/health-scan|ReportsSection/.test(text)) hits.push(relative(ROOT, f));
    }
    expect(hits).toEqual([]);
  });

  it("the Vitals screen no longer sends a report anywhere", () => {
    const vitals = stripComments(read("src/routes/_authenticated/app.vitals.tsx"));
    expect(vitals).not.toMatch(/functions\.invoke\(\s*"health-scan"/);
    // No whole-file read is left on the screen: the base64 encoder went with
    // the section. (Spelled as a pattern, not the method name, so the
    // whole-file-read guard in megaLoopGuardrails.test.ts does not count this
    // assertion as a call.)
    expect(vitals).not.toMatch(/FileReader|readAs[A-Z]\w+\(/);
  });
});

describe("the health path names no Anthropic anywhere", () => {
  const trees = [
    "src/health",
    "supabase/functions/health-api",
    "supabase/functions/health-ai",
    "supabase/functions/_shared/health",
  ];
  const routes = readdirSync(join(ROOT, "src/routes/_authenticated"))
    .filter((f) => /^app\.health.*\.tsx$|^app\.admin_\.health-ai\.tsx$/.test(f))
    .map((f) => join(ROOT, "src/routes/_authenticated", f));

  it("client and server, comments stripped", () => {
    const files = [...trees.flatMap((t) => walk(join(ROOT, t))), ...routes];
    expect(files.length).toBeGreaterThan(30);
    const hits: string[] = [];
    for (const f of files) {
      if (ANTHROPIC.test(stripComments(readFileSync(f, "utf8")))) hits.push(relative(ROOT, f));
    }
    expect(hits).toEqual([]);
  });

  it("the one recipient the notice names is the one the Play declaration declares", () => {
    expect(HEALTH_AI_RECIPIENT_NAME).toBe("Google Cloud Vertex AI (Gemini)");
    const vertex = THIRD_PARTY_REQUESTS.find((r) => r.host === "aiplatform.googleapis.com");
    expect(vertex).toBeDefined();
    expect(vertex!.sends).toMatch(/health records/i);
    expect(vertex!.triggeredBy).toMatch(/app\.health\.index\.tsx/);
    expect(THIRD_PARTY_REQUESTS.some((r) => /anthropic/i.test(r.host))).toBe(false);
  });
});
