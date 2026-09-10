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
import {
  PROVIDER_REGISTRY,
  providerFor,
} from "../../../supabase/functions/_shared/health/ai/provider";
import { checkGate, type GateInput } from "../../../supabase/functions/_shared/health/ai/policy";
import { VertexHealthAIProvider } from "../../../supabase/functions/_shared/health/ai/vertex";
import { googleAuthStatus } from "../../../supabase/functions/_shared/googleAuth";
import { allHealthFlagsOff } from "../flagNames";
import { MODEL_ALLOWLIST, PROVIDER_IDS, RECIPIENT_FOR_PROVIDER } from "../ai/types";

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
    // THE FUNCTION NAME, NOT ANY IDENTIFIER THAT STARTS WITH IT. A bare
    // substring match flagged `data-testid="health-scan-view"` — the DICOM
    // viewer's marker, which invokes nothing and is on a screen that reads
    // no text at all. That is a real collision rather than a prose one, so
    // stripping comments cannot fix it: the guard has to mean what it says.
    // `(?![\w-])` ends the name, so `"health-scan"` in an invoke still
    // matches and `health-scan-view` no longer does. Mutation-checked below.
    const hits: string[] = [];
    for (const f of walk(join(ROOT, "src"))) {
      const text = stripComments(readFileSync(f, "utf8"));
      if (/health-scan(?![\w-])|ReportsSection/.test(text)) hits.push(relative(ROOT, f));
    }
    expect(hits).toEqual([]);
  });

  it("and that narrowing still catches the call it exists to catch", () => {
    // The mutation, inline: the guard is only worth its line if the shape it
    // was written for still trips it. Both spellings a caller would use.
    const guard = /health-scan(?![\w-])|ReportsSection/;
    expect(guard.test('supabase.functions.invoke("health-scan", { body })')).toBe(true);
    expect(guard.test("const fn = `health-scan`;")).toBe(true);
    expect(guard.test("<ReportsSection />")).toBe(true);
    expect(guard.test('data-testid="health-scan-view"')).toBe(false);
    expect(guard.test('data-testid="health-scan-not-read"')).toBe(false);
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

/* ------------------------------------------ Phase 4 §3: selection is explicit -- */

describe("provider selection is explicit, closed, and fails closed (Phase 4 §3)", () => {
  function gate(patch: Partial<GateInput>): ReturnType<typeof checkGate> {
    const flags = allHealthFlagsOff();
    flags["health.enabled"] = true;
    flags["health.ai.enabled"] = true;
    flags["health.provider_sharing.enabled"] = true;
    return checkGate({
      flags,
      environment: "production",
      actor: { isAdmin: false, isAdult: true },
      adminVerificationEnabled: false,
      regionBlocked: false,
      providerId: "vertex",
      model: MODEL_ALLOWLIST.vertex[0],
      task: "summarize_timeline",
      capPerUser: 3,
      capHouse: 500,
      ...patch,
    });
  }

  it("the registry has exactly two providers, neither of them Anthropic, and each names the recipient the table names", () => {
    expect(Object.keys(PROVIDER_REGISTRY).sort()).toEqual(["synthetic", "vertex"]);
    expect([...PROVIDER_IDS].sort()).toEqual(["synthetic", "vertex"]);
    expect(RECIPIENT_FOR_PROVIDER).toEqual({ synthetic: "oniq", vertex: "google_vertex" });
    for (const id of PROVIDER_IDS) {
      const p = providerFor(id);
      expect(p.id).toBe(id);
      expect(p.recipient).toBe(RECIPIENT_FOR_PROVIDER[id]);
      expect(JSON.stringify(p)).not.toMatch(ANTHROPIC);
    }
  });

  it("Health AI cannot route to Anthropic under any spelling: the registry throws and the gate refuses", () => {
    for (const id of [
      "anthropic",
      "claude",
      "claude-haiku",
      "Anthropic",
      " vertex",
      "vertex ",
      "",
      null,
      undefined,
      0,
      ["vertex"],
      { toString: () => "vertex" },
    ]) {
      expect(() => providerFor(id), String(id)).toThrow(/provider_not_allowed/);
      expect(gate({ providerId: id }), String(id)).toMatchObject({
        allowed: false,
        reason: "provider_not_allowed",
      });
    }
  });

  it("a provider that is not selected is not defaulted: an absent row value is a refusal, never synthetic and never vertex", () => {
    expect(gate({ providerId: undefined })).toMatchObject({
      allowed: false,
      reason: "provider_not_allowed",
    });
    expect(gate({ model: undefined })).toMatchObject({
      allowed: false,
      reason: "model_not_allowed",
    });
  });

  it("missing Vertex configuration fails closed: no service account means no token, a closed code, and no request", async () => {
    const status = googleAuthStatus(() => undefined);
    expect(status).toMatchObject({ mode: "none", ready: false, projectId: null });
    expect(status.reason).toMatch(/missing/);
    class NoNet extends VertexHealthAIProvider {
      sends = 0;
      protected override token() {
        return Promise.resolve({ ok: false as const, reason: status.reason ?? "none" });
      }
      protected override send(): never {
        this.sends++;
        throw new Error("must not be reached");
      }
    }
    const p = new NoNet();
    await expect(
      p.run({
        task: "summarize_timeline",
        model: MODEL_ALLOWLIST.vertex[0],
        context: {
          task: "summarize_timeline",
          language: "en",
          records: [],
          documents: [],
          question: null,
        },
        counts: { records: 0, documents: 0 },
      }),
    ).rejects.toMatchObject({ code: "vertex_no_token" });
    expect(p.sends).toBe(0);
  });

  it("no Health production path reads an Anthropic credential: the only secrets the health tree names are Supabase's and the Google service account's", () => {
    const secrets = new Set<string>();
    const healthTrees = [
      "src/health",
      "supabase/functions/health-api",
      "supabase/functions/health-ai",
      "supabase/functions/_shared/health",
    ];
    for (const t of healthTrees) {
      for (const f of walk(join(ROOT, t))) {
        const text = stripComments(readFileSync(f, "utf8"));
        for (const m of text.matchAll(/Deno\.env\.get\("([A-Z0-9_]+)"\)/g)) secrets.add(m[1]);
      }
    }
    const google = stripComments(read("supabase/functions/_shared/googleAuth.ts"));
    for (const m of google.matchAll(/env\("([A-Z0-9_]+)"\)/g)) secrets.add(m[1]);
    expect([...secrets].sort()).toEqual(
      [
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_ANON_KEY",
        "GOOGLE_SERVICE_ACCOUNT_JSON",
        "GOOGLE_VERTEX_USE_FIREBASE_SA",
        "FIREBASE_SERVICE_ACCOUNT",
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_PROJECT_ID",
        "GOOGLE_OAUTH_REFRESH_TOKEN",
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET",
      ].sort(),
    );
    expect([...secrets].some((s) => /ANTHROPIC|CLAUDE/.test(s))).toBe(false);
  });
});
