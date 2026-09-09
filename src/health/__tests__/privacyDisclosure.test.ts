// The privacy disclosure for health AI — owner directive 2026-09-09.
//
// "Health data is never sent to any AI feature" was the public notice's
// absolute claim, tied by tests to the Phase 2 gateway having no recipient but
// ONIQ. The owner replaced it with a consent-conditioned statement, verbatim in
// src/config/privacy.ts. This file pins three things: that the statement is
// what every copy says (notice, consent screen default, English i18n), that the
// retired claim cannot return to any user-facing source in any language, and
// that the controls the statement names — consent, a recipient that never
// leaves ONIQ — are still the controls the code enforces. The consent SENTENCE
// is not touched: it stays counsel's placeholder (docs/health/04 D3).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";
import { HEALTH_AI_PRIVACY_SENTENCES, HEALTH_AI_PRIVACY_STATEMENT } from "@/config/privacy";
import { DATA_COLLECTED } from "@/config/playCompliance";
import { HEALTH_STRINGS } from "../i18n";
import { RECIPIENT_FOR_PROVIDER } from "../ai/types";
import { CONSENT_TERMS_VERSIONS, GRANTABLE_CONSENTS } from "../domain";
import { DISCLOSED_RECIPIENTS_BY_TERMS, consentCovers } from "../consent";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** JSX to prose: `{" "}` spacers to a space, tags out, whitespace collapsed. */
const prose = (src: string) =>
  src
    .replace(/\{"\s*"\}/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

/** The retired claim, in every wording it was ever made in. */
const RETIRED_CLAIMS = [
  /never (be )?(sent|shared|passed|given) to any ai/i,
  /nothing from vitals reaches a model/i,
];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("the approved statement, verbatim", () => {
  it("is two sentences that join to the owner's statement", () => {
    expect(HEALTH_AI_PRIVACY_SENTENCES).toHaveLength(2);
    expect(HEALTH_AI_PRIVACY_STATEMENT).toBe(
      "Health data may be processed by ONIQ's AI-assisted health features when you choose to use them and provide the required consent. AI-assisted features are subject to ONIQ's privacy, security, consent, audit, and safety controls.",
    );
  });

  it("is what the public privacy notice renders", () => {
    expect(prose(read("src/routes/privacy.tsx"))).toContain(HEALTH_AI_PRIVACY_STATEMENT);
  });

  it("is the English text beside the AI consent, and the consent screen's own default", () => {
    expect(HEALTH_STRINGS.en["health.privacy.ai_processing"]).toBe(HEALTH_AI_PRIVACY_STATEMENT);
    const screen = read("src/routes/_authenticated/app.health.consent.tsx");
    expect(screen).toContain('data-testid="health-consent-ai-privacy"');
    expect(screen).toContain('"health.privacy.ai_processing"');
    expect(prose(screen)).toContain(HEALTH_AI_PRIVACY_STATEMENT);
  });

  it("Hindi and Bengali carry it in their own scripts, labelled as counsel-review placeholders", () => {
    const hi = HEALTH_STRINGS.hi["health.privacy.ai_processing"];
    const bn = HEALTH_STRINGS.bn["health.privacy.ai_processing"];
    expect(hi).toMatch(/[\u0900-\u097F]/);
    expect(bn).toMatch(/[\u0980-\u09FF]/);
    for (const s of [hi, bn]) {
      expect(s).not.toBe(HEALTH_AI_PRIVACY_STATEMENT);
      expect(s).toContain("ONIQ");
      expect(s).toContain("AI");
    }
    // The label is a comment beside each translation, so the raw source is read.
    const src = read("src/health/i18n.ts");
    expect(src.match(/Counsel-review placeholder/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("the retired absolute claim cannot return", () => {
  const roots = [
    "src/routes",
    "src/components",
    "src/health",
    "src/lib/consent",
    "src/lib/i18n",
    "src/config",
    "src/data",
    "public",
    "android/app/src/main/res",
  ];
  const files = roots
    .flatMap((r) => walk(join(ROOT, r)))
    .filter((f) => /\.(tsx?|json|txt|html|xml|webmanifest)$/.test(f) && !f.includes("__tests__"));

  it("walks a real set of user-facing sources", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith("privacy.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("i18n.ts"))).toBe(true);
  });

  it("in no user-facing source, in any language", () => {
    const hits: string[] = [];
    for (const f of files) {
      // Code files are read with comments stripped: the comments beside the
      // new constant and the Play declaration QUOTE the retired claim to
      // explain its retirement, and a grep that read them would fail on the
      // very files that document the change.
      const raw = readFileSync(f, "utf8");
      const text = /\.tsx?$/.test(f) ? stripComments(raw) : raw;
      if (RETIRED_CLAIMS.some((re) => re.test(text))) hits.push(relative(ROOT, f));
    }
    expect(hits).toEqual([]);
  });

  it("nor in the Play declaration, which mirrors the notice", () => {
    const ai = DATA_COLLECTED.find((d) => /ai processing/i.test(d.category));
    expect(ai).toBeDefined();
    expect(ai!.protection).not.toMatch(/never sent/i);
    expect(ai!.protection).toMatch(/required consent/);
    expect(ai!.protection).toMatch(/privacy notice/);
  });
});

describe("the statement's claims are the controls the code enforces", () => {
  const NOW = "2026-09-09T06:00:00Z";
  const need = { purpose: "ai_interpretation", category: "labs", recipient: "oniq" };
  const grant = {
    purpose: "ai_interpretation",
    dataCategories: ["labs"],
    recipient: "oniq",
    status: "active",
    startTime: "2026-09-01T00:00:00Z",
    expiryTime: null,
    termsVersion: CONSENT_TERMS_VERSIONS.ai_interpretation,
  };

  it("'the required consent': the AI purpose is grantable for ONIQ only, under terms that disclose ONIQ", () => {
    const pairs = GRANTABLE_CONSENTS.filter((p) => p.purpose === "ai_interpretation");
    expect(pairs.map((p) => p.recipient)).toEqual(["oniq"]);
    expect(DISCLOSED_RECIPIENTS_BY_TERMS[CONSENT_TERMS_VERSIONS.ai_interpretation]).toEqual([
      "oniq",
    ]);
  });

  it("'the required consent': an active grant covers; a revoked one, or one for a recipient the terms never named, does not", () => {
    expect(consentCovers(grant, need, NOW)).toBe(true);
    expect(consentCovers({ ...grant, status: "revoked" }, need, NOW)).toBe(false);
    expect(
      consentCovers(
        { ...grant, recipient: "google_vertex" },
        { ...need, recipient: "google_vertex" },
        NOW,
      ),
    ).toBe(false);
  });

  it("'ONIQ's AI-assisted health features': every registered provider's recipient is ONIQ, and the only provider is synthetic", () => {
    expect(Object.keys(RECIPIENT_FOR_PROVIDER)).toEqual(["synthetic"]);
    expect(Object.values(RECIPIENT_FOR_PROVIDER)).toEqual(["oniq"]);
  });

  it("the consent sentence itself is untouched by this change — it stays counsel's placeholder", () => {
    expect(HEALTH_STRINGS.en["health.consent.ai"]).toBe("Let ONIQ's AI read my records");
    expect(HEALTH_STRINGS.en["health.consent.ai.detail"]).toMatch(
      /nothing is sent to Google or any outside company/,
    );
  });
});
