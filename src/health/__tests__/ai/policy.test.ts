/**
 * ONE INPUT, ONE REASON. Mutating exactly one input of an allowed request
 * changes exactly one reason, in the documented order — so a refusal names
 * the first thing wrong and nothing can be skipped by fixing the second.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  ENVIRONMENTS,
  PRODUCTION_PROJECT_REF,
  checkConsent,
  checkGate,
  consentedCategories,
  evaluateAiPolicy,
  resolveEnvironment,
  type GateInput,
} from "../../../../supabase/functions/_shared/health/ai/policy";
// The SERVER copy: policy.ts reads these objects, and a test that mutates
// the client mirror would be mutating a different module instance.
import {
  MODEL_ALLOWLIST,
  RECIPIENT_FOR_PROVIDER,
} from "../../../../supabase/functions/_shared/health/ai/types";
import { allHealthFlagsOff } from "../../flagNames";
import { DATA_CATEGORIES } from "../../domain";

const NOW = "2026-09-08T12:00:00.000Z";

function flagsOn() {
  const f = allHealthFlagsOff();
  f["health.enabled"] = true;
  f["health.ai.enabled"] = true;
  return f;
}

const allowed: GateInput = {
  flags: flagsOn(),
  environment: "staging",
  actor: { isAdmin: false, isAdult: true },
  adminVerificationEnabled: false,
  regionBlocked: false,
  providerId: "synthetic",
  model: "synthetic-v1",
  task: "summarize_timeline",
  capPerUser: 10,
  capHouse: 100,
};

const aiConsent = {
  id: "c1",
  purpose: "ai_interpretation",
  dataCategories: ["vitals", "labs"],
  recipient: "oniq",
  status: "active",
  startTime: "2026-09-01T00:00:00.000Z",
  expiryTime: null,
  termsVersion: "health-ai-terms-v1",
};

describe("checkGate — one mutation, one reason, in order", () => {
  it("allows the base case", () => {
    const g = checkGate(allowed);
    expect(g.allowed).toBe(true);
    if (g.allowed) {
      expect(g.recipient).toBe("oniq");
      expect(g.adminVerification).toBe(false);
    }
  });

  it.each<[string, Partial<GateInput>, string]>([
    ["master flag off", { flags: { ...flagsOn(), "health.enabled": false } }, "ai_disabled"],
    ["ai flag off", { flags: { ...flagsOn(), "health.ai.enabled": false } }, "ai_disabled"],
    ["unknown task", { task: "diagnose" }, "task_not_allowed"],
    ["vertex provider", { providerId: "vertex" }, "provider_not_allowed"],
    ["gemini provider", { providerId: "gemini" }, "provider_not_allowed"],
    ["undefined provider", { providerId: undefined }, "provider_not_allowed"],
    ["unknown model", { model: "gemini-3.1-flash" }, "model_not_allowed"],
    ["cap per user 0", { capPerUser: 0 }, "caps_unset"],
    ["cap house 0", { capHouse: 0 }, "caps_unset"],
    ["cap NaN", { capHouse: Number.NaN }, "caps_unset"],
    ["region blocked", { regionBlocked: true }, "region_blocked"],
    ["no date of birth", { actor: { isAdmin: false, isAdult: null } }, "age_unverified"],
    ["under 18", { actor: { isAdmin: false, isAdult: false } }, "minor_blocked"],
    ["production, ordinary user", { environment: "production" }, "synthetic_in_production"],
    [
      "production, admin but verification switch off",
      { environment: "production", actor: { isAdmin: true, isAdult: true } },
      "synthetic_in_production",
    ],
  ])("%s → %s", (_label, patch, reason) => {
    const g = checkGate({ ...allowed, ...patch });
    expect(g.allowed).toBe(false);
    if (!g.allowed) expect(g.reason).toBe(reason);
  });

  it("lets an admin verify in production only with the row's switch, and says so", () => {
    const g = checkGate({
      ...allowed,
      environment: "production",
      actor: { isAdmin: true, isAdult: true },
      adminVerificationEnabled: true,
    });
    expect(g.allowed).toBe(true);
    if (g.allowed) expect(g.adminVerification).toBe(true);
  });

  it("an admin under 18 or without a date of birth is still refused", () => {
    const a = checkGate({ ...allowed, actor: { isAdmin: true, isAdult: null } });
    const b = checkGate({ ...allowed, actor: { isAdmin: true, isAdult: false } });
    expect(a.allowed && b.allowed).toBe(false);
    if (!a.allowed) expect(a.reason).toBe("age_unverified");
    if (!b.allowed) expect(b.reason).toBe("minor_blocked");
  });

  describe("a provider that would leave ONIQ needs the sharing switch", () => {
    const original = RECIPIENT_FOR_PROVIDER.synthetic;
    afterEach(() => {
      RECIPIENT_FOR_PROVIDER.synthetic = original;
    });

    it("refuses provider_not_allowed while health.provider_sharing.enabled is off", () => {
      RECIPIENT_FOR_PROVIDER.synthetic = "google_vertex";
      const g = checkGate(allowed);
      expect(g.allowed).toBe(false);
      if (!g.allowed) {
        expect(g.reason).toBe("provider_not_allowed");
        expect(g.detail).toEqual({ recipient: "google_vertex" });
      }
    });

    it("and with the switch on, the recipient travels to the consent check", () => {
      RECIPIENT_FOR_PROVIDER.synthetic = "google_vertex";
      const g = checkGate({
        ...allowed,
        flags: { ...flagsOn(), "health.provider_sharing.enabled": true },
      });
      expect(g.allowed).toBe(true);
      if (g.allowed) expect(g.recipient).toBe("google_vertex");
    });
  });

  describe("an allowed model with no price row is refused before anything is written", () => {
    it("unpriced_model", () => {
      (MODEL_ALLOWLIST.synthetic as string[]).push("synthetic-v2-unpriced");
      try {
        const g = checkGate({ ...allowed, model: "synthetic-v2-unpriced" });
        expect(g.allowed).toBe(false);
        if (!g.allowed) expect(g.reason).toBe("unpriced_model");
      } finally {
        (MODEL_ALLOWLIST.synthetic as string[]).pop();
      }
    });
  });
});

describe("resolveEnvironment — the project decides, the row may only tighten", () => {
  it("is production whenever the URL names the production project", () => {
    const url = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
    for (const env of ENVIRONMENTS) expect(resolveEnvironment(env, url)).toBe("production");
    expect(resolveEnvironment("development", url)).toBe("production");
  });

  it("reads the column elsewhere, and treats unknown or missing as production", () => {
    const url = "https://nzbthoecadcwdoqxhaok.supabase.co";
    expect(resolveEnvironment("staging", url)).toBe("staging");
    expect(resolveEnvironment("development", url)).toBe("development");
    expect(resolveEnvironment("prod-ish", url)).toBe("production");
    expect(resolveEnvironment(undefined, url)).toBe("production");
    expect(resolveEnvironment("staging", undefined)).toBe("staging");
  });
});

describe("checkConsent and consentedCategories", () => {
  it("requires every category, naming this provider's recipient", () => {
    const ok = checkConsent([aiConsent], ["vitals", "labs"], "oniq", NOW);
    expect(ok.allowed).toBe(true);
    if (ok.allowed) expect(ok.consentIds).toEqual(["c1"]);
    const missing = checkConsent([aiConsent], ["vitals", "notes"], "oniq", NOW);
    expect(missing.allowed).toBe(false);
    if (!missing.allowed) {
      expect(missing.reason).toBe("ai_consent_required");
      expect(missing.detail).toEqual({
        purpose: "ai_interpretation",
        category: "notes",
        recipient: "oniq",
      });
    }
    const other = checkConsent([aiConsent], ["vitals"], "google_vertex", NOW);
    expect(other.allowed).toBe(false);
  });

  it("a revoked consent covers nothing on the very next call — no cache", () => {
    const revoked = { ...aiConsent, status: "revoked" };
    expect(checkConsent([revoked], ["vitals"], "oniq", NOW).allowed).toBe(false);
    expect(consentedCategories([revoked], "oniq", NOW, DATA_CATEGORIES)).toEqual([]);
    expect(consentedCategories([aiConsent], "oniq", NOW, DATA_CATEGORIES)).toEqual([
      "vitals",
      "labs",
    ]);
  });

  it("evaluateAiPolicy runs the gate first, then consent", () => {
    const refused = evaluateAiPolicy({
      ...allowed,
      task: "nope",
      categoriesNeeded: ["vitals"],
      consents: [aiConsent],
      nowIso: NOW,
    });
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.reason).toBe("task_not_allowed");
    const ok = evaluateAiPolicy({
      ...allowed,
      categoriesNeeded: ["vitals"],
      consents: [aiConsent],
      nowIso: NOW,
    });
    expect(ok.allowed).toBe(true);
    if (ok.allowed) expect(ok.purpose).toBe("ai_interpretation");
  });
});
