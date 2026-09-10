/**
 * THE DENO ENTRYPOINT IS WIRED THE WAY THE GATEWAY ASSUMES. health-ai cannot
 * run in vitest (Deno.serve, esm.sh), so its properties are read from source
 * with comments stripped: flags before identity, identity before the body,
 * the CLOSED body before the actor, every health-table query scoped to the
 * caller, the caps and the receipt reserved through the ONE locked SQL
 * function (Phase 4 — reserve.test.ts reads that function), no delete on a
 * health table, one redacted log line, body-first json, a per-minute rate,
 * and no text source but the stored document.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";
import { AI_REFUSAL_REASONS } from "../../ai/types";

const ROOT = join(__dirname, "..", "..", "..", "..");
const RAW = readFileSync(join(ROOT, "supabase/functions/health-ai/index.ts"), "utf8");
const SRC = stripComments(RAW);

function fnBody(name: string): string {
  const start = SRC.search(new RegExp(`(async )?${name}\\(`));
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const rest = SRC.slice(start + 1);
  const next = rest.search(/\n    (async )?\w+\(|\n\/\* -+|\nfunction |\nDeno\.serve/);
  return SRC.slice(start, next === -1 ? undefined : start + 1 + next);
}

describe("gate order in Deno.serve", () => {
  const serve = SRC.slice(SRC.indexOf("Deno.serve("));

  it("flags, then both 503s, then the JWT, then the rate, then the CLOSED body, then the actor, then the gateway", () => {
    const flags = serve.indexOf("readHealthConfig(");
    const off = serve.indexOf('"health_disabled"');
    const aiOff = serve.indexOf('reason: "ai_disabled"');
    const jwt = serve.indexOf("auth.getUser()");
    const rate = serve.indexOf("rateLimited(user.id)");
    const body = serve.indexOf("req.json()");
    const parse = serve.indexOf("parseAiRequest(body)");
    const admin = serve.indexOf('rpc("is_admin"');
    const run = serve.indexOf("runHealthAi(");
    for (const [a, b] of [
      [flags, off],
      [off, aiOff],
      [aiOff, jwt],
      [jwt, rate],
      [rate, body],
      [body, parse],
      [parse, admin],
      [admin, run],
    ]) {
      expect(a).toBeGreaterThan(-1);
      expect(a).toBeLessThan(b);
    }
  });

  it("resolves production from the project URL and reads caps, provider and model from the row only", () => {
    expect(serve).toContain("resolveEnvironment(row?.environment, url)");
    expect(serve).toContain("provider: row?.ai_provider");
    expect(serve).toContain("model: row?.ai_model");
    // B11: the person's cap is THIS task's number from the row's JSON, never a total.
    expect(serve).toContain("capPerUser: capForTask(row?.ai_daily_caps, parsed.request.task)");
    expect(SRC).not.toContain("ai_daily_cap_per_user");
    expect(serve).toContain("capHouse: capFrom(row?.ai_daily_cap_house)");
    expect(serve).toContain(
      "adminVerificationEnabled: row?.ai_admin_verification_enabled === true",
    );
    expect(serve).not.toMatch(/provider:\s*"synthetic"|model:\s*"synthetic-v1"/);
  });

  it("registers no text source: the literal null, and no import of one", () => {
    // Phase 3b: the STORED document is the text source, built here with the
    // person-bound byte loader and the PDF reader; the test-only inline
    // sources stay under __tests__ and never reach this file.
    expect(serve).toContain("textSource: new StoredDocumentSource({");
    expect(serve).toContain(
      "loadBytes: (documentId: string) => loadDocumentBytes(admin, user.id, documentId),",
    );
    expect(SRC).not.toMatch(/InlineTextSource|InlineBytesSource|textSourceFor|__tests__/);
  });

  it("reads age from the private profile and the same rpc cv-generate uses; null means unverified", () => {
    expect(serve).toContain('from("profiles_private")');
    expect(serve).toContain('rpc("is_adult_18", { _uid: user.id })');
    expect(serve).toContain("let isAdult: boolean | null = null");
  });

  it("rate-limits at ten per minute", () => {
    expect(SRC).toMatch(/const RATE_PER_MINUTE = 10;/);
  });
});

describe("the Store is bound to the caller", () => {
  const store = SRC.slice(SRC.indexOf("function makeStore("), SRC.indexOf("function capFrom("));

  it("takes the user id once, at construction, and no method takes one", () => {
    expect(store).toMatch(/function makeStore\(\s*admin: Admin,\s*userId: string,/);
    const methods = [...store.matchAll(/^\s{4}(async )?(\w+)\(([^)]*)\)/gm)].map((m) => [
      m[2],
      m[3],
    ]);
    expect(methods.length).toBeGreaterThanOrEqual(9);
    for (const [name, params] of methods) expect(params, name).not.toMatch(/user/i);
  });

  it("every store method that touches a health table scopes it to the caller — no exceptions", () => {
    // Split the Store into its methods; each method that names a health
    // table must filter on the caller's id or write it, inside THAT method.
    // (The house cap, the one deliberately unscoped count, moved into the
    // SQL function in Phase 4; this file no longer counts anything.)
    const parts = store.split(/\n    (?=(?:async )?\w+\()/).slice(1);
    expect(parts.length).toBeGreaterThanOrEqual(9);
    let touching = 0;
    for (const body of parts) {
      const name = body.match(/^(?:async )?(\w+)\(/)?.[1] ?? "?";
      if (!/\.from\("health_\w+"\)/.test(body)) continue;
      touching++;
      const scoped = body.includes('.eq("user_id", userId)') || body.includes("user_id: userId");
      expect(scoped, `${name} touches a health table without the ownership filter`).toBe(true);
    }
    expect(touching).toBeGreaterThanOrEqual(7);
    expect(store).not.toMatch(/countHouseSince|countUserSince|beginReceipt/);
  });

  it("reserves the caps and the receipt through the one locked SQL function, as the caller, with the window the gateway computed", () => {
    const body = fnBody("reserveReceipt");
    expect(body).toContain('admin.rpc("health_ai_reserve_request"');
    expect(body).toContain("_user_id: userId");
    expect(body).toContain("_task: row.task");
    expect(body).toContain("_cap_house: window.capHouse");
    expect(body).toContain("_cap_user: window.capPerUser");
    expect(body).toContain("_since: window.since");
    // A refusal is one of three closed reasons; anything else is a failure, never an open door.
    expect(body).toContain(
      'refusal === "quota_house" || refusal === "quota_user" || refusal === "caps_unset"',
    );
    expect(body).toContain('throw new Error("receipt_failed")');
    // No count and no insert of its own: the function is the whole step.
    expect(body).not.toContain('.from("health_ai_requests")');
    expect(SRC).not.toMatch(/\.from\("health_ai_requests"\)\s*\.insert\(/);
  });

  it("reads only active records, and documents only in stored states", () => {
    expect(fnBody("loadActiveRecords")).toContain('.eq("status", "active")');
    expect(fnBody("loadDocument")).toContain('.in("status", ["stored", "processing", "ready"])');
  });

  it("inserts what a report states as an ACTIVE record (one action, 2026-09-09), numeric only, with the confidence on both the column and the provenance", () => {
    const body = fnBody("insertCandidates");
    // No confirm step stands between this row and the person's timeline, so
    // the label is what carries the honesty: provenance document_extraction
    // makes isAiDerived() true, which is what renders "AI-assisted".
    expect(body).toContain('status: "active"');
    expect(body).not.toContain('status: "candidate"');
    expect(body).toContain("provenance: { ...base, confidence: c.confidence }");
    expect(body).toContain("value_text: null");
    expect(body).toContain("confidence: c.confidence");
    expect(body).toContain("provenance: { ...base, confidence: c.confidence }");
  });

  it("never deletes a health row", () => {
    expect(SRC).not.toMatch(/\.from\("health_\w+"\)\s*\.delete\(/);
  });
});

describe("hygiene", () => {
  it("logs through one redacted line and nothing else", () => {
    expect(SRC.match(/console\./g)?.length ?? 0).toBe(1);
    expect(SRC).toMatch(/console\.log\(JSON\.stringify\(redactForLog\(/);
    expect(SRC).not.toMatch(/logSafe\(\s*body/);
  });

  it("uses the body-first json() convention", () => {
    expect(SRC).toMatch(/function json\(body: unknown, status = 200\)/);
    expect(SRC).not.toMatch(/json\(\s*\d{3}\s*,/);
  });

  it("names no provider host or model helper, even in prose (searchSpendCoverage reads raw source)", () => {
    expect(RAW).not.toMatch(/callGemini\(|callClaude\(|callText\(|callGatewayText\(/);
    expect(RAW).not.toMatch(
      /api\.anthropic\.com|generativelanguage|ai\.gateway\.lovable|runwayml|api\.openai|aiplatform/,
    );
  });

  it("maps every refusal reason to a status, so an unknown reason cannot 200", () => {
    const map = SRC.slice(
      SRC.indexOf("const STATUS_FOR_REASON"),
      SRC.indexOf("const CONSENT_COLUMNS"),
    );
    expect(map).toContain("Record<AiRefusalReason, number>");
    // EVERY reason, not a sample of three. `Record<AiRefusalReason, number>`
    // does enforce this — but only under `deno check`, which is a hand-run
    // command and not a CI step, and vitest never loads this file as a module.
    // Measured 2026-09-10: adding `document_rejected` left this test green
    // while the deployed function had no status for it, and only a manual
    // deno check said so. A type nothing runs is not a guard.
    const keys = [...map.matchAll(/^\s{2}(\w+): (\d{3}),$/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...AI_REFUSAL_REASONS].sort());
    expect(map).toMatch(/output_rejected: 502/);
    expect(map).toMatch(/quota_user: 429/);
    expect(map).toMatch(/synthetic_in_production: 403/);
  });
});
