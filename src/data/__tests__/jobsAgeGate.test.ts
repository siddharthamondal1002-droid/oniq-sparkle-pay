/**
 * Phase 3a — durable guard for the Jobs/career 18+ data gate.
 *
 * This does NOT read source files: a grep would miss a table created by a
 * future migration, which is exactly the failure this test exists to catch.
 * It queries the LIVE schema (pg_class / pg_policy) through psql and asserts
 * that every career/jobs-shaped table has RLS enabled and at least one
 * RESTRICTIVE policy referencing `is_adult_18`.
 *
 * The same assertion is committed as scripts/jobs-age-gate-check.sql so it can
 * be run by hand (or in a DB-connected CI job) where these tests run without
 * database credentials. When PGHOST is absent the suite skips rather than
 * pretending to have checked.
 */
import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";

const NAME_PATTERNS = [
  String.raw`c.relname LIKE 'cv\_%'`,
  String.raw`c.relname LIKE 'job\_%'`,
  String.raw`c.relname LIKE '%\_jobs'`,
  String.raw`c.relname LIKE 'career\_%'`,
  String.raw`c.relname LIKE '%alert\_subscription%'`,
  String.raw`c.relname LIKE 'saved\_job%'`,
].join(" OR ");

const QUERY = `
SELECT c.relname,
       c.relrowsecurity,
       EXISTS (
         SELECT 1 FROM pg_policy p
         WHERE p.polrelid = c.oid
           AND p.polpermissive = false
           AND (
             coalesce(pg_get_expr(p.polqual, p.polrelid), '') ILIKE '%is_adult_18%'
             OR coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ILIKE '%is_adult_18%'
           )
       ) AS has_adult_gate
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND (${NAME_PATTERNS})
ORDER BY c.relname;
`;

type Row = { table: string; rls: boolean; gated: boolean };

function readSchema(): Row[] {
  const out = execFileSync("psql", ["-At", "-F", "|", "-c", QUERY], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [table, rls, gated] = line.split("|");
      return { table: table!, rls: rls === "t", gated: gated === "t" };
    });
}

const hasDb = Boolean(process.env["PGHOST"]);

describe.skipIf(!hasDb)("career/jobs tables are 18+ gated at the data layer", () => {
  const rows = hasDb ? readSchema() : [];

  it("matches at least one career/jobs table (a pattern matching nothing is a broken test)", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it("today matches exactly the known CV tables", () => {
    expect(rows.map((r) => r.table)).toEqual(["cv_attestations", "cv_documents"]);
  });

  it("has RLS enabled and a RESTRICTIVE is_adult_18 policy on every match", () => {
    const offenders = rows.filter((r) => !r.rls || !r.gated);
    expect(
      offenders.map(
        (r) =>
          `public.${r.table}: ${!r.rls ? "RLS is DISABLED" : "no RESTRICTIVE is_adult_18 policy"}. ` +
          `Add: ALTER TABLE public.${r.table} ENABLE ROW LEVEL SECURITY; ` +
          `CREATE POLICY "${r.table} adults only" ON public.${r.table} AS RESTRICTIVE FOR ALL ` +
          `TO authenticated USING (public.is_adult_18(auth.uid())) ` +
          `WITH CHECK (public.is_adult_18(auth.uid()));`,
      ),
    ).toEqual([]);
  });
});
