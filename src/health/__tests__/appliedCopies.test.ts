// The repo carries each health migration TWICE, on purpose, and this test is
// what keeps the two from becoming competing sources of truth.
//
// Lovable's migration tool writes the SQL it applied as a new file named by
// apply time and a UUID, commits it to main, and records THAT version in
// supabase_migrations.schema_migrations. The hand-named originals are what the
// tests read and what carries the reasoning; they are not in the production
// history. Measured 2026-09-08: the history's newest versions are
// 20260908170834 (Phase 1's copy) and 20260908171017 (Phase 2's copy), and the
// older pair 20260904180000_weather_cache / 20260904191342_a64d5c1d… shows the
// same convention predates Health. So the copies stay — deleting them would
// make the repo disagree with production's history — and this file asserts
// they say the same thing as the originals, statement for statement.
//
// The ONE known difference is pinned rather than tolerated: Lovable's tool
// refuses writes to storage.buckets, so Phase 1's copy lacks exactly the bucket
// insert, and the bucket was created by the storage tool instead (private,
// 10 MB). Any other drift, in either direction, fails here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripSqlComments } from "../../test/sourceText";

const ROOT = join(__dirname, "..", "..", "..", "supabase", "migrations");

const PAIRS = [
  {
    ours: "20260908120000_oniq_health_phase1.sql",
    applied: "20260908170834_d2e6b48b-62fe-4914-96eb-b325e4fb0e97.sql",
    missingFromApplied: [
      "insert into storage.buckets (id, name, public) values ('health-documents', 'health-documents', false) on conflict (id) do nothing",
    ],
  },
  {
    ours: "20260908150000_oniq_health_phase2.sql",
    applied: "20260908171017_c14034b6-4e2e-4909-80b3-5c62bedaa37c.sql",
    missingFromApplied: [] as string[],
  },
];

/** Comment-free, whitespace-collapsed statements. Splitting on `;` also splits
 *  inside `$$` bodies, identically on both sides, so equality still holds. */
function statements(file: string): string[] {
  return stripSqlComments(readFileSync(join(ROOT, file), "utf8"))
    .replace(/\s+/g, " ")
    .split(/;\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("Lovable's applied copies agree with the authoritative migrations", () => {
  for (const pair of PAIRS) {
    it(`${pair.applied} == ${pair.ours}${pair.missingFromApplied.length ? " minus the bucket insert" : ""}`, () => {
      const ours = statements(pair.ours);
      const applied = statements(pair.applied);
      const extraInApplied = applied.filter((s) => !ours.includes(s));
      const missingFromApplied = ours.filter((s) => !applied.includes(s));
      expect(extraInApplied, "statements the applied copy has and the original lacks").toEqual([]);
      expect(missingFromApplied).toEqual(pair.missingFromApplied);
    });
  }
});
