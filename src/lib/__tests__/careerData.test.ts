// Phase 6 — data protection for CV and education data.
//
// These tests lock in guarantees that currently hold, so a later change
// cannot quietly break them: career consent is its own purpose, CV data is
// exported, CV data never reaches personalisation, and the career consent
// gate is 18+ rather than the (lower) age of digital consent.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONSENT_PURPOSES, NOTICE_VERSION } from "@/lib/consent/notice";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function allMigrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

/** The last CREATE OR REPLACE of export_my_data — the one that is live. */
function liveExportFunctionSql(): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let latest = "";
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const idx = sql.toLowerCase().lastIndexOf("function public.export_my_data");
    if (idx !== -1) latest = sql.slice(idx);
  }
  return latest;
}

describe("career consent purpose", () => {
  const career = CONSENT_PURPOSES.find((p) => p.id === "career");

  it("exists as its own purpose and is never essential", () => {
    expect(career).toBeTruthy();
    expect(career?.essential).toBeFalsy();
  });

  it("has English and Hindi for every string, genuinely translated", () => {
    expect(career!.title.en.length).toBeGreaterThan(0);
    expect(career!.title.hi.length).toBeGreaterThan(0);
    expect(career!.purpose.hi).not.toBe(career!.purpose.en);
    for (const c of career!.categories) {
      expect(c.label.en.length).toBeGreaterThan(0);
      expect(c.label.hi.length).toBeGreaterThan(0);
      expect(c.label.hi).not.toBe(c.label.en);
    }
  });

  it("itemises at least four named categories, covering the real holdings", () => {
    const ids = career!.categories.map((c) => c.id);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    for (const id of ["employment", "education", "skills", "cv_documents", "attestations"]) {
      expect(ids).toContain(id);
    }
  });

  it("states plainly that the data is CV-only, never personalised, never shared", () => {
    const en = career!.purpose.en.toLowerCase();
    expect(en).toContain("only the cvs you ask for");
    expect(en).toContain("never personalises");
    expect(en).toMatch(/never shared/);
  });

  it("bumped the notice version — the wording set changed", () => {
    expect(NOTICE_VERSION).not.toBe("2026-08-03.1");
    expect(NOTICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\./);
  });
});

describe("career consent is gated at 18, not the age of digital consent", () => {
  const sql = allMigrationSql();

  it("adds a separate career guard trigger on consent_records", () => {
    expect(sql).toContain("consent_records_career_adult_guard");
    expect(sql).toMatch(/BEFORE INSERT ON public\.consent_records/i);
  });

  it("checks is_adult_18 and not is_minor_account", () => {
    const idx = sql.indexOf("FUNCTION public.consent_records_career_adult_guard");
    const body = sql.slice(idx, idx + 1200);
    expect(body).toContain("public.is_adult_18(NEW.user_id)");
    expect(body).not.toContain("is_minor_account");
    expect(body).not.toContain("minor_age_for_country");
    expect(body).toContain("42501");
  });

  it("does not alter the existing chain or minor guards", () => {
    const idx = sql.lastIndexOf("consent_records_career_adult_guard");
    const phase6 = sql.slice(idx - 2000);
    expect(phase6).not.toMatch(/FUNCTION public\.consent_records_chain/);
    expect(phase6).not.toMatch(/FUNCTION public\.consent_records_minor_guard/);
    expect(phase6).not.toMatch(/FUNCTION public\.consent_records_audit/);
  });
});

describe("CV data is included in the DSR export", () => {
  const fn = liveExportFunctionSql();

  it("exports cv_documents and cv_attestations as aggregates, not scalar subqueries", () => {
    for (const key of ["cv_documents", "cv_attestations"] as const) {
      const at = fn.indexOf(`'${key}',`);
      expect(at).toBeGreaterThan(-1);
      const clause = fn.slice(at, at + 260);
      expect(clause).toContain("jsonb_agg");
      expect(clause).toContain("COALESCE");
      expect(clause).toContain("'[]'::jsonb");
      // A scalar subquery would be `to_jsonb(x) FROM ...` with no aggregate.
      expect(clause).not.toMatch(/\(SELECT to_jsonb\([a-z]+\) FROM/);
    }
  });

  it("keeps every pre-existing export key", () => {
    for (const key of [
      "exported_at",
      "profile",
      "private_profile",
      "consents",
      "consent_records",
      "dsr_requests",
      "learner_profiles",
      "grievances",
    ]) {
      expect(fn).toContain(`'${key}'`);
    }
  });
});

describe("no CV data ever feeds personalisation", () => {
  const files = ["personalisation.ts", "memory.ts", "adaptive.ts"].map((f) =>
    readFileSync(join(ROOT, "src", "lib", f), "utf8"),
  );

  it("has zero references to CV tables or CV fields in the personalisation paths", () => {
    for (const src of files) {
      for (const needle of [
        "cv_documents",
        "cv_attestations",
        "cvRules",
        "CvDeclared",
        "employer",
        "resume",
      ]) {
        expect(src).not.toContain(needle);
      }
    }
  });

  it("keeps the usage_signals write payload to the five declared fields", () => {
    const src = readFileSync(join(ROOT, "src", "lib", "personalisation.ts"), "utf8");
    const at = src.indexOf('from("usage_signals").insert(');
    const payload = src.slice(at, src.indexOf("});", at));
    for (const field of ["user_id", "kind", "hub", "city", "dow", "hour"]) {
      expect(payload).toContain(field);
    }
    expect(payload).not.toMatch(/cv|career|employer/i);
  });
});

describe("pasted job descriptions are never persisted", () => {
  const jobs = readFileSync(
    join(ROOT, "src", "routes", "_authenticated", "app.jobs.tsx"),
    "utf8",
  );

  it("passes the free-text instruction to cv-generate transiently only", () => {
    expect(jobs).toContain("instruction,");
    const at = jobs.indexOf('from("cv_documents")');
    const insert = jobs.slice(at, at + 500);
    expect(insert).toContain("content: { declared, generated }");
    expect(insert).not.toContain("instruction");
  });
});

describe("CV rows are removed with the account", () => {
  const sql = allMigrationSql();

  it("cascades both CV tables off auth.users, so no bespoke purge is needed", () => {
    for (const table of ["cv_documents", "cv_attestations"]) {
      const at = sql.indexOf(`CREATE TABLE public.${table}`);
      expect(at).toBeGreaterThan(-1);
      const body = sql.slice(at, sql.indexOf(");", at));
      expect(body).toMatch(/REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
    }
  });
});
