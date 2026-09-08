/**
 * "DELETE MY ACCOUNT" REACHES THE HEALTH BUCKET. Rows cascade off profiles;
 * bytes do not cascade off anything, so the bucket must be in PURGE_BUCKETS —
 * the list delete-account walks. Source-read, comments stripped: the comment
 * beside the list names the bucket while explaining it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments, stripSqlComments } from "@/test/sourceText";

const ROOT = join(__dirname, "..", "..", "..");

describe("account deletion covers health documents", () => {
  it("PURGE_BUCKETS lists the bucket", () => {
    const src = stripComments(
      readFileSync(join(ROOT, "supabase/functions/_shared/purgeUserData.ts"), "utf8"),
    );
    const m = src.match(/export const PURGE_BUCKETS = \[([^\]]*)\]/);
    expect(m).toBeTruthy();
    const buckets = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(buckets).toContain("health-documents");
    expect(buckets).toContain("verification-docs");
  });

  it("the migration creates the same bucket id", () => {
    const sql = stripSqlComments(
      readFileSync(join(ROOT, "supabase/migrations/20260908120000_oniq_health_phase1.sql"), "utf8"),
    );
    expect(sql).toMatch(/values \('health-documents', 'health-documents', false\)/);
  });

  it("the privacy audit lists the health tables as user content", () => {
    const sql = readFileSync(join(ROOT, "scripts/privacy-audit.sql"), "utf8");
    for (const t of ["health_records", "health_documents", "health_consents", "health_audit"]) {
      expect(sql).toContain(`'${t}'`);
    }
  });
});
