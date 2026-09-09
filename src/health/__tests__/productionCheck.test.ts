// scripts/health-production-check.sql and scripts/health-bundle-markers.ts
// are the manual verification steps of 2026-09-08 turned into things anyone
// can run. Both encode expectations, and an expectation that lives in a script
// drifts from its source the first time the source moves — a renamed control,
// a changed cap, a reworded promise. This file pins every one of them to the
// place it comes from: the migrations, the route file, the privacy page.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripSqlComments } from "../../test/sourceText";
import { MODEL_ALLOWLIST } from "../ai/types";
import {
  ENTRY_CHUNK,
  PRIVACY_CHUNK,
  OLD_PRIVACY_CLAIM,
  PRIVACY_SENTENCES,
  ROUTE_CHUNK,
  ROUTE_MARKERS,
  RECORDS_CHUNK,
  RECORDS_MARKERS,
  check,
} from "../../../scripts/health-bundle-markers";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const CHECK = read("scripts/health-production-check.sql");
const CHECK_SQL = stripSqlComments(CHECK);
const PHASE1 = stripSqlComments(read("supabase/migrations/20260908120000_oniq_health_phase1.sql"));
const PHASE2 = stripSqlComments(read("supabase/migrations/20260908150000_oniq_health_phase2.sql"));
/** The latest definition of health_verify_audit_chain(): erasure-proof since 2026-09-08. */
const VERIFIER = stripSqlComments(
  read("supabase/migrations/20260908190000_oniq_health_audit_chain_survives_erasure.sql"),
);

/** Owner directive 2026-09-08 (later the same day): the house cap is 500, a ceiling. */
const HOUSE_CAP_OWNER_VALUE = 500;

function valuesList(cte: string): string[] {
  const start = CHECK_SQL.indexOf(`${cte}(`);
  expect(start, cte).toBeGreaterThan(-1);
  const body = CHECK_SQL.slice(start, CHECK_SQL.indexOf(")\n)", start) + 1);
  return [...body.matchAll(/\('([^']+)'\)/g)].map((m) => m[1]);
}

describe("health-production-check.sql", () => {
  it("expects every table the migrations create, and no other", () => {
    const created = new Set<string>();
    for (const sql of [PHASE1, PHASE2]) {
      for (const m of sql.matchAll(/create table if not exists public\.(health_\w+)/gi))
        created.add(m[1]);
    }
    expect(valuesList("expected_tables").sort()).toEqual([...created].sort());
  });

  it("expects the B11 per-task caps exactly as the migration defaults them", () => {
    const def = PHASE2.match(/ai_daily_caps jsonb not null default\s+'([^']+)'::jsonb/);
    expect(def).not.toBeNull();
    const inCheck = CHECK_SQL.match(/\('ai_daily_caps',\s+'([^']+)'\)/);
    expect(inCheck).not.toBeNull();
    expect(JSON.parse(inCheck![1])).toEqual(JSON.parse(def![1]));
  });

  it("expects the owner's house cap, AI ON with the vertex provider and its one model, sharing on, and production (Phase 3)", () => {
    expect(CHECK_SQL).toContain(`('ai_daily_cap_house',            '${HOUSE_CAP_OWNER_VALUE}')`);
    expect(CHECK_SQL).toContain("('ai_enabled',                    'true')");
    expect(CHECK_SQL).toContain("('ai_kill_switch',                'false')");
    expect(CHECK_SQL).toContain("('provider_sharing_enabled',      'true')");
    expect(CHECK_SQL).toContain("('ai_provider',                   'vertex')");
    expect(CHECK_SQL).toContain(
      `('ai_model',                      '${MODEL_ALLOWLIST.vertex[0]}')`,
    );
    expect(CHECK_SQL).toContain("('environment',                   'production')");
    expect(PHASE2).toContain("check (ai_provider in ('synthetic'))");
    // The lock the check expects is the WIDENED one, in Postgres's own rendering.
    expect(CHECK_SQL).toContain(
      "CHECK ((ai_provider = ANY (ARRAY[''synthetic''::text, ''vertex''::text])))",
    );
    expect(CHECK_SQL).toContain(
      "CHECK ((provider = ANY (ARRAY[''synthetic''::text, ''vertex''::text])))",
    );
    expect(CHECK_SQL).toContain("not like '%health-ai-terms-v2%google_vertex%'");
  });

  it("expects the bucket limit the documents table already enforces", () => {
    const bound = PHASE1.match(/size_bytes <= (\d+)/);
    expect(bound).not.toBeNull();
    expect(CHECK_SQL).toContain(`file_size_limit is distinct from ${bound![1]}`);
  });

  it("expects every retention category the migrations seed", () => {
    const seeded = new Set<string>();
    for (const sql of [PHASE1, PHASE2]) {
      const start = sql.indexOf("insert into public.health_retention_policies");
      for (const m of sql.slice(start).matchAll(/\('(\w+)',\s+\d+,/g)) seeded.add(m[1]);
    }
    expect(valuesList("expected_retention").sort()).toEqual([...seeded].sort());
  });

  it("expects exactly the versions production recorded: Lovable's two copies, the every-column trigger, the erasure-proof verifier", () => {
    const files = readdirSync(join(ROOT, "supabase", "migrations"));
    const versions = valuesList("expected_versions");
    expect(versions).toEqual([
      "20260908170834",
      "20260908171017",
      "20260908181500",
      "20260908190000",
      "20260909100000",
    ]);
    for (const v of versions) {
      expect(
        files.some((f) => f.startsWith(`${v}_`)),
        `a migration file for ${v}`,
      ).toBe(true);
    }
  });

  it("recomputes the chain with the digest expression health_verify_audit_chain uses", () => {
    const expr = (sql: string) => {
      const start = sql.indexOf("encode(extensions.digest(");
      expect(start).toBeGreaterThan(-1);
      return sql.slice(start, sql.indexOf("'sha256'), 'hex')", start)).replace(/\s+/g, " ");
    };
    const fromFunction = expr(
      VERIFIER.slice(VERIFIER.indexOf("health_verify_audit_chain")),
    ).replace("coalesce(prev,'')", "coalesce(r.prev_hash,'')");
    expect(expr(CHECK_SQL)).toEqual(fromFunction);
  });

  it("expects every audit action Phase 2 added, and the config object type", () => {
    for (const a of valuesList("expected_actions")) expect(PHASE2, a).toContain(`'${a}'`);
    expect(valuesList("expected_actions")).toEqual(
      expect.arrayContaining(["config.ai_kill", "config.ai_caps", "config.changed"]),
    );
    expect(CHECK_SQL).toContain("like '%''config''%'");
  });

  it("names the every-column property the trigger migration pins", () => {
    expect(CHECK_SQL).toContain("jsonb_each(to_jsonb(new) - ''updated_at'')");
  });
});

describe("health-bundle-markers.ts", () => {
  const ROUTE_FILE = "src/routes/_authenticated/app.admin_.health-ai.tsx";
  const route = read(ROUTE_FILE);

  it("every route marker is a data-testid the admin screen renders, verbatim", () => {
    const ids = [...route.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
    for (const m of ROUTE_MARKERS) expect(ids, m).toContain(m);
    expect(ROUTE_MARKERS).toEqual(
      expect.arrayContaining(["health-ai-admin-kill", "health-ai-admin-caps-save"]),
    );
  });

  it("every records marker is a data-testid the Records screen renders, or a literal it carries (Phase 3b)", () => {
    const records = read("src/routes/_authenticated/app.health.records.tsx");
    const ids = [...records.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
    for (const m of RECORDS_MARKERS) {
      expect(ids.includes(m) || records.includes(m), m).toBe(true);
    }
    expect(RECORDS_CHUNK.test("app.health.records-Dq8cIP7N.js")).toBe(true);
    expect(RECORDS_CHUNK.test("app.health.index-DiTriFPE.js")).toBe(false);
  });

  it("looks for them in the chunk named after the route file, never the entry", () => {
    expect(ROUTE_CHUNK.test("app.admin_.health-ai-C3CCfxGu.js")).toBe(true);
    expect(ROUTE_CHUNK.test("app.admin.health-ai-C3CCfxGu.js")).toBe(false); // the nested build that never rendered
    expect(ENTRY_CHUNK.test("index-CKbSFFCL.js")).toBe(true);
    expect(PRIVACY_CHUNK.test("privacy-CuFNK7FV.js")).toBe(true);
  });

  it("the privacy sentences are the ones the privacy page makes, and the retired claim is what it no longer makes", () => {
    const page = read("src/routes/privacy.tsx")
      .replace(/\{"\s*"\}/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    for (const sentence of PRIVACY_SENTENCES) expect(page).toContain(sentence);
    expect(page.toLowerCase()).not.toContain(OLD_PRIVACY_CLAIM.toLowerCase());
  });
});

describe("health-bundle-markers.ts check()", () => {
  const good = {
    "index-AAAA.js": "entry without the marker",
    "app.admin_.health-ai-BBBB.js": ROUTE_MARKERS.join(" "),
    "app.health.records-DDDD.js": RECORDS_MARKERS.join(" "),
    "privacy-CCCC.js": `x ${PRIVACY_SENTENCES.join(" ")} y`,
  };
  const pass = (chunks: Record<string, string>) => check(chunks).every((r) => r.ok);

  it("passes a build that carries every marker in its own chunk", () => {
    expect(pass(good)).toBe(true);
  });

  it("fails a records chunk from before Phase 3b — the read-method note is the marker no earlier build had", () => {
    expect(
      pass({ ...good, "app.health.records-DDDD.js": "health-doc-input health-doc-extract" }),
    ).toBe(false);
    const { "app.health.records-DDDD.js": _gone, ...rest } = good;
    expect(pass(rest)).toBe(false);
  });

  it("fails a stale route chunk — the shape of a publish that rebuilt the previous commit", () => {
    expect(pass({ ...good, "app.admin_.health-ai-BBBB.js": "health-ai-admin-kill only" })).toBe(
      false,
    );
  });

  it("fails when the route chunk is absent — a route that never made it into the build", () => {
    const { "app.admin_.health-ai-BBBB.js": _gone, ...rest } = good;
    expect(pass(rest)).toBe(false);
  });

  it("fails when the marker leaks into the entry — the chunk split changed and the recipe is stale", () => {
    expect(pass({ ...good, "index-AAAA.js": `entry ${ROUTE_MARKERS[0]}` })).toBe(false);
  });

  it("fails a reworded privacy disclosure, and one that carries only its first sentence", () => {
    expect(
      pass({ ...good, "privacy-CCCC.js": "Health data is sometimes sent to an AI feature" }),
    ).toBe(false);
    expect(pass({ ...good, "privacy-CCCC.js": PRIVACY_SENTENCES[0] })).toBe(false);
  });

  it("fails a build that still serves the retired absolute claim — the shape of a publish that never happened", () => {
    expect(
      pass({
        ...good,
        "privacy-CCCC.js": `${PRIVACY_SENTENCES.join(" ")} Health data is never sent to any AI feature.`,
      }),
    ).toBe(false);
    expect(
      pass({
        ...good,
        "index-AAAA.js": "entry saying health data is never sent to any AI feature",
      }),
    ).toBe(false);
  });
});
