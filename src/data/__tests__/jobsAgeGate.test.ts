/**
 * Phase 3a — durable guard for the Jobs/career 18+ data gate.
 *
 * WHY THIS WAS REWRITTEN
 *
 * The previous version shelled out to `psql` and read pg_class / pg_policy
 * from a live database. That was the right idea — a grep over source can miss
 * a table created by a future migration, which is exactly the failure this
 * exists to catch — but it was gated on `process.env.PGHOST`, and PGHOST is
 * never set here. The whole suite skipped, every run, silently. Three tests
 * that never execute are worse than no tests: they show up in the count and
 * nobody looks again.
 *
 * The live schema was verified by hand on 2026-08-05 through the database MCP:
 * cv_attestations and cv_documents both have RLS enabled and a RESTRICTIVE
 * is_adult_18 policy. So the gate itself is correct — it simply was not being
 * checked by anything automatic.
 *
 * WHAT IT CHECKS NOW
 *
 * The migrations directory: the source of truth for the schema, and — unlike a
 * live connection — present on every machine that can run the tests. Every
 * career/jobs-shaped table created by any migration must, in some migration,
 * get RLS enabled AND a RESTRICTIVE policy referencing is_adult_18.
 *
 * That is strictly better for the case that mattered. A new migration adding
 * an ungated table now fails at commit time, before it reaches a database,
 * rather than after deploy when somebody remembers to run a script.
 *
 * scripts/jobs-age-gate-check.sql still holds the live-schema assertion for
 * running against production directly, and remains the way to catch drift
 * applied outside the migration history.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

/**
 * Table-name shapes that carry career or jobs data. Deliberately broad: the
 * point is to catch a table nobody thought to gate, so a false positive here
 * (a matching table holding nothing sensitive) is cheap, and a false negative
 * is the bug.
 */
const CAREER_TABLE = /^(cv_|job_|career_|saved_job)|_jobs$|alert_subscription/;

const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
  .join("\n");

/** Strip SQL comments, so a commented-out policy cannot satisfy the check. */
const code = sql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

function createdTables(): string[] {
  const found = new Set<string>();
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;
  for (const m of code.matchAll(re)) found.add(m[1].toLowerCase());
  return [...found];
}

/**
 * Names that match CAREER_TABLE by accident and hold no career data.
 * public.video_jobs is the admin-only Runway render queue,
 * public.episode_jobs is the admin-only episode render queue,
 * public.story_jobs is the user-facing Story render queue, and
 * public.gpu_video_jobs is the admin-only in-house GPU render queue — "jobs"
 * as in background tasks. All four are gated by RLS (admin, admin, own-row,
 * and admin) and carry nothing about a person's employment, so an 18+
 * restriction is meaningless there. Nothing else may be added here without
 * the same argument.
 *
 * story_jobs is not an argument that Stories needs no age consideration. It is
 * an argument that THIS gate — the one protecting career data — is not where
 * that consideration belongs. If user-generated video turns out to need a
 * minimum age, it needs its own gate for its own reason.
 *
 * public.music_jobs (owner directive 2026-09-04) is the fifth, and it is added
 * with the same argument the four above had to make. It is the song-generation
 * ledger — "jobs" as in background tasks — and every column in it is about a
 * generation: the prompt, the model version that served, the stored path, the
 * bytes, the error. Nothing in it describes a person's employment, education
 * or earnings, so a career-data age gate would restrict it for a reason that
 * does not apply to it. It is gated by RLS on its own axis instead: select is
 * own-row, and authenticated holds no insert, update or delete at all, because
 * every write goes through the edge function on the service role.
 *
 * And the same caveat as story_jobs, for the same reason: this is not a claim
 * that generated music needs no age consideration. It is a claim that THIS
 * gate is not where such a consideration would live.
 *
 * public.image_jobs is the sixth, and it is music_jobs' argument verbatim with
 * the medium changed: the picture-generation ledger, "jobs" as in background
 * tasks, every column about one generation — prompt, model, stored path,
 * bytes, error. It holds no employer, no salary, no education, no CV. Same RLS
 * shape too: select is own-row and authenticated holds no write at all,
 * because every write goes through the edge function on the service role.
 */
const NOT_CAREER = new Set([
  "video_jobs",
  "episode_jobs",
  "story_jobs",
  "gpu_video_jobs",
  "music_jobs",
  "image_jobs",
]);

const careerTables = createdTables().filter((t) => CAREER_TABLE.test(t) && !NOT_CAREER.has(t));

function hasRls(table: string): boolean {
  return new RegExp(
    String.raw`alter\s+table\s+(?:public\.)?"?${table}"?\s+enable\s+row\s+level\s+security`,
    "i",
  ).test(code);
}

function hasAdultGate(table: string): boolean {
  // A RESTRICTIVE policy ON THIS TABLE whose body references is_adult_18.
  return new RegExp(
    String.raw`create\s+policy[^;]*?\son\s+(?:public\.)?"?${table}"?\s[^;]*?as\s+restrictive[^;]*?is_adult_18[^;]*?;`,
    "is",
  ).test(code);
}

describe("career/jobs tables are 18+ gated at the data layer", () => {
  it("matches at least one career/jobs table (a pattern matching nothing is a broken test)", () => {
    expect(
      careerTables.length,
      "no career/jobs table found in migrations — the pattern has gone stale",
    ).toBeGreaterThan(0);
  });

  it("today matches exactly the known CV tables", () => {
    expect([...careerTables].sort()).toEqual(["cv_attestations", "cv_documents"]);
  });

  it("has RLS enabled and a RESTRICTIVE is_adult_18 policy on every match", () => {
    const offenders = careerTables
      .filter((t) => !hasRls(t) || !hasAdultGate(t))
      .map(
        (t) =>
          `public.${t}: ${!hasRls(t) ? "RLS is never enabled" : "no RESTRICTIVE is_adult_18 policy"}. ` +
          `Add: ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY; ` +
          `CREATE POLICY "${t} adults only" ON public.${t} AS RESTRICTIVE FOR ALL ` +
          `TO authenticated USING (public.is_adult_18(auth.uid())) ` +
          `WITH CHECK (public.is_adult_18(auth.uid()));`,
      );
    expect(offenders).toEqual([]);
  });

  it("the gate function itself is not executable by anonymous callers", () => {
    // A RESTRICTIVE policy calling is_adult_18 is only as good as the function
    // it calls. Revoking anon is what stops an unauthenticated probe.
    expect(code).toMatch(/revoke\s+execute\s+on\s+function\s+public\.is_adult_18[^;]*anon/i);
  });

  it("bites when a gate is removed", () => {
    // Proof the matcher is real rather than vacuously true: the same check
    // against SQL with RESTRICTIVE downgraded must stop passing.
    const weakened = code.replace(/as\s+restrictive/gi, "as permissive");
    const stillGated = new RegExp(
      String.raw`create\s+policy[^;]*?\son\s+(?:public\.)?"?cv_documents"?\s[^;]*?as\s+restrictive[^;]*?is_adult_18[^;]*?;`,
      "is",
    ).test(weakened);
    expect(stillGated).toBe(false);
  });
});
