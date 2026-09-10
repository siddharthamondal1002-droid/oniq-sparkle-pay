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
import { AI_TASKS, MODEL_ALLOWLIST } from "../ai/types";
import {
  ENTRY_CHUNK,
  PRIVACY_CHUNK,
  OLD_PRIVACY_CLAIM,
  PRIVACY_SENTENCES,
  ROUTE_CHUNK,
  ROUTE_MARKERS,
  RECORDS_CHUNK,
  ADD_REPORT_CHUNK,
  RECORDS_MARKERS,
  ANALYSE_MARKERS,
  SCAN_MARKERS,
  DESCRIBE_MARKERS,
  check,
} from "../../../scripts/health-bundle-markers";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const CHECK = read("scripts/health-production-check.sql");
const CHECK_SQL = stripSqlComments(CHECK);
const PHASE1 = stripSqlComments(read("supabase/migrations/20260908120000_oniq_health_phase1.sql"));
const PHASE2 = stripSqlComments(read("supabase/migrations/20260908150000_oniq_health_phase2.sql"));
/**
 * The latest definition of health_verify_audit_chain(): erasure-proof since
 * 2026-09-08, adoption-aware since 2026-09-09 (the seq-outside-the-lock race).
 */
const VERIFIER = stripSqlComments(
  read("supabase/migrations/20260909130000_oniq_health_audit_seq_under_lock.sql"),
);

/** Owner directive 2026-09-08 (later the same day): the house cap is 500, a ceiling. */
const HOUSE_CAP_OWNER_VALUE = 500;

/**
 * The `ai_daily_caps` default the migrations leave in place, reading them in
 * filename (= application) order: the Phase 2 column default, then any later
 * `alter column … set default`. The LAST one wins, exactly as Postgres does.
 */
function latestCapsDefault(): string {
  const dir = join(ROOT, "supabase", "migrations");
  let latest: string | null = null;
  for (const f of readdirSync(dir).sort()) {
    if (!/oniq_health/.test(f)) continue;
    const sql = stripSqlComments(readFileSync(join(dir, f), "utf8"));
    for (const m of sql.matchAll(
      /ai_daily_caps (?:jsonb not null default|set default)\s+'([^']+)'::jsonb/g,
    )) {
      latest = m[1];
    }
  }
  expect(latest, "no ai_daily_caps default in any health migration").not.toBeNull();
  return latest!;
}

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

  it("expects the per-task caps the migrations CURRENTLY default to, one key per AI task", () => {
    // Phase 2 is APPLIED and may not be edited (appliedCopies.test.ts), so a
    // new task's cap arrives as a later `alter column … set default`. The
    // check must expect the LATEST default, not Phase 2's — and it must cover
    // every task, or a task nobody capped is a 503 nobody notices.
    const inCheck = CHECK_SQL.match(/\('ai_daily_caps',\s+'([^']+)'\)/);
    expect(inCheck).not.toBeNull();
    expect(JSON.parse(inCheck![1])).toEqual(JSON.parse(latestCapsDefault()));
    expect(Object.keys(JSON.parse(inCheck![1])).sort()).toEqual([...AI_TASKS].sort());
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

  it("expects exactly the versions production recorded: Lovable's two copies, the every-column trigger, the erasure-proof verifier, Phase 3, the seq-under-lock fix, the Phase 4 hardening", () => {
    const files = readdirSync(join(ROOT, "supabase", "migrations"));
    const versions = valuesList("expected_versions");
    expect(versions).toEqual([
      "20260908170834",
      "20260908171017",
      "20260908181500",
      "20260908190000",
      "20260909100000",
      "20260909130000",
      "20260909150000",
      // "Show it, don't store it" (owner directive 2026-09-10): the
      // describe_document cap and the two widened receipt CHECKs, applied from
      // here through the Lovable database connection and recorded in history.
      "20260910120000",
      // DICOM as a document mime (owner directive 2026-09-10, "B and C").
      "20260910160000",
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
    // The function links through `link` (the row's own prev_hash for an
    // adopted row, the running prev otherwise); the check recomputes every row
    // with its own stored prev_hash and checks the link separately.
    const fromFunction = expr(
      VERIFIER.slice(VERIFIER.indexOf("health_verify_audit_chain")),
    ).replace("coalesce(link,'')", "coalesce(r.prev_hash,'')");
    expect(fromFunction).toContain("coalesce(r.prev_hash,'')");
    expect(expr(CHECK_SQL)).toEqual(fromFunction);
  });

  it("links only the rows no chain.adopt row vouches for, and holds an adopt row to its claims", () => {
    // Adopted rows: content recomputed, left out of the lag() that links the rest.
    expect(CHECK_SQL).toContain("where a.action = 'chain.adopt'");
    expect(CHECK_SQL).toContain("(r.record_hash in (select h from adopted)) as adopted");
    expect(CHECK_SQL).toContain(
      "lag(h.record_hash) over (order by h.seq) as expected_prev\n  from hashed h\n  where not h.adopted",
    );
    expect(CHECK_SQL).toContain("select 'AUDIT_ADOPTED_ROW_ALTERED'");
    expect(CHECK_SQL).toContain("from hashed where adopted and calc <> record_hash");
    // An adopted hash must belong to an EARLIER row, or the adoption is the violation.
    expect(CHECK_SQL).toContain("select 'AUDIT_ADOPTION_INVALID'");
    expect(CHECK_SQL).toContain("where b.record_hash = x and b.seq < h.seq");
    // The schema half of the same fix: the unique seq, the trigger numbering
    // under the lock, the action and object type the adopt row needs.
    expect(CHECK_SQL).toContain(
      "indexname = 'health_audit_seq_key' and indexdef like 'CREATE UNIQUE INDEX%'",
    );
    expect(CHECK_SQL).toContain("def not like '%new.seq := coalesce(last_seq, 0) + 1%'");
    expect(CHECK_SQL).toContain("like '%''chain.adopt''%'");
    expect(CHECK_SQL).toContain("like '%''chain''%'");
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

  it("expects the Phase 4 hardening: the locked reservation function (service role only), one receipt per request, the append-only audit trigger", () => {
    const phase4 = stripSqlComments(
      read("supabase/migrations/20260909150000_oniq_health_phase4_hardening.sql"),
    );
    expect(phase4).toContain("perform pg_advisory_xact_lock(7700000000000030);");
    expect(CHECK_SQL).toContain("pg_advisory_xact_lock(7700000000000030)");
    expect(CHECK_SQL).toContain("select 'RESERVE_FN_CALLABLE_BY_CLIENT'");
    expect(CHECK_SQL).toContain("select 'RESERVE_FN_NOT_LOCKED'");
    expect(CHECK_SQL).toContain(
      "indexname = 'health_ai_requests_request_id_key' and indexdef like 'CREATE UNIQUE INDEX%'",
    );
    expect(CHECK_SQL).toContain("('health_audit_immutable_before_change', 'health_audit')");
    expect(CHECK_SQL).toContain("select 'AUDIT_IMMUTABLE_FN_CALLABLE_BY_CLIENT'");
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
    // The picker moved into src/health/AddReport.tsx, rendered by BOTH health
    // screens (owner report 2026-09-09, "nowhere to upload"). The markers are
    // its data-testids now; the screen keeps the document list's own.
    const records =
      read("src/routes/_authenticated/app.health.records.tsx") + read("src/health/AddReport.tsx");
    const ids = [...records.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
    for (const m of RECORDS_MARKERS) {
      expect(ids.includes(m) || records.includes(m), m).toBe(true);
    }
    expect(RECORDS_CHUNK.test("app.health.records-Dq8cIP7N.js")).toBe(true);
    expect(RECORDS_CHUNK.test("app.health.index-DiTriFPE.js")).toBe(false);
    // The picker's markers live in the SHARED component chunk now, measured
    // from a local build — both health routes import it, so Rolldown splits it
    // out and the records chunk no longer carries them.
    expect(ADD_REPORT_CHUNK.test("AddReport-BXFVkKxv.js")).toBe(true);
    expect(ADD_REPORT_CHUNK.test("app.health.records-Dq8cIP7N.js")).toBe(false);
  });

  it("every describe marker is a data-testid the shared component renders, and lives in ITS chunk", () => {
    // "What does this report say?" is its own component, imported by both
    // health screens, so Rolldown folds it into the SAME shared chunk as
    // AddReport — measured from a local build 2026-09-10, where every one of
    // these appears in AddReport-*.js and in no other. Greping the records
    // chunk for them would report ABSENT on a healthy deploy.
    const component = read("src/health/ReportDescription.tsx");
    // BOTH SPELLINGS. A bare element carries `data-testid`; an OniqCard takes
    // `testId` and renders the attribute itself, so a `data-testid`-only match
    // would miss the card that holds the answer — which is the one marker that
    // proves the description RENDERED rather than the button merely existing.
    const ids = [...component.matchAll(/(?:data-testid|testId)="([^"]+)"/g)].map((m) => m[1]);
    for (const m of DESCRIBE_MARKERS) expect(ids, m).toContain(m);
    const screen = read("src/routes/_authenticated/app.health.records.tsx");
    for (const m of DESCRIBE_MARKERS) expect(screen, m).not.toContain(m);
  });

  it("every analyse marker is a data-testid the Records screen itself renders", () => {
    // These stay in the records chunk while the picker's live in the shared
    // one, so they are pinned to the screen's own source. Owner report
    // 2026-09-09, "analysis is gone": the records chunk was previously checked
    // only for EXISTENCE, so its own control could vanish from a publish with
    // every marker green.
    const screen = read("src/routes/_authenticated/app.health.records.tsx");
    const ids = [...screen.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
    for (const m of ANALYSE_MARKERS) expect(ids, m).toContain(m);
    const shared = read("src/health/AddReport.tsx");
    for (const m of ANALYSE_MARKERS) expect(shared, m).not.toContain(m);
  });

  it("every scan marker is a testid the Records screen itself renders", () => {
    // Owner directive 2026-09-10, "B and C". The viewer is imported by this
    // ONE route, so Rolldown leaves it in the records chunk rather than the
    // shared AddReport one the describe markers went to — measured from a
    // local build before the list was written. Both attribute spellings,
    // because `health-scan-image` is an OniqCard's `testId` and a
    // data-testid-only match would miss the card that holds the image.
    const screen = read("src/routes/_authenticated/app.health.records.tsx");
    expect(screen).toContain("<HealthScanPreview");
    const viewer = read("src/health/ScanPreview.tsx");
    const ids = [...viewer.matchAll(/(?:data-testid|testId)="([^"]+)"/g)].map((m) => m[1]);
    for (const m of SCAN_MARKERS) expect(ids, m).toContain(m);
    const shared = read("src/health/AddReport.tsx");
    for (const m of SCAN_MARKERS) expect(shared, m).not.toContain(m);
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
    // The records chunk still ships; the PICKER's markers moved to the shared
    // component chunk both health routes import.
    "app.health.records-DDDD.js": `the document list ${ANALYSE_MARKERS.join(" ")} ${SCAN_MARKERS.join(" ")}`,
    "AddReport-EEEE.js": [...RECORDS_MARKERS, ...DESCRIBE_MARKERS].join(" "),
    "privacy-CCCC.js": `x ${PRIVACY_SENTENCES.join(" ")} y`,
  };
  const pass = (chunks: Record<string, string>) => check(chunks).every((r) => r.ok);

  it("passes a build that carries every marker in its own chunk", () => {
    expect(pass(good)).toBe(true);
  });

  it("fails an add-report chunk from before Phase 3b — the read-method note is the marker no earlier build had", () => {
    expect(pass({ ...good, "AddReport-EEEE.js": "health-doc-input health-doc-extract" })).toBe(
      false,
    );
    const { "AddReport-EEEE.js": _gone, ...rest } = good;
    expect(pass(rest)).toBe(false);
  });

  it("fails an add-report chunk with no way to read a scan report — the 2026-09-10 control", () => {
    expect(pass({ ...good, "AddReport-EEEE.js": RECORDS_MARKERS.join(" ") })).toBe(false);
  });

  it("fails a records chunk with no scan viewer — the 2026-09-10 B control", () => {
    // The exact shape the 2026-09-09 lesson warns about: every OTHER marker
    // green, the records chunk present, and the one control this feature adds
    // simply not in it.
    expect(
      pass({
        ...good,
        "app.health.records-DDDD.js": `the document list ${ANALYSE_MARKERS.join(" ")}`,
      }),
    ).toBe(false);
  });

  it("fails a records chunk that dropped only the not-read line", () => {
    // The viewer shipping WITHOUT the sentence saying nothing has checked the
    // image is worse than the viewer not shipping at all.
    const partial = SCAN_MARKERS.filter((m) => m !== "health-scan-not-read");
    expect(
      pass({
        ...good,
        "app.health.records-DDDD.js": `${ANALYSE_MARKERS.join(" ")} ${partial.join(" ")}`,
      }),
    ).toBe(false);
  });

  it("fails when the records chunk is absent — the documents screen left the build", () => {
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

  it("fails a records chunk that lost Analyse — the exact shape of the owner's report", () => {
    // The publish measured on production 2026-09-09 before this fix:
    // app.health.records-BYKX4X5r.js, health-doc-analyse = 0. This check
    // returned PASS on it, because the records chunk was only checked for
    // existence. It does not any more.
    expect(pass({ ...good, "app.health.records-DDDD.js": "the document list" })).toBe(false);
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
