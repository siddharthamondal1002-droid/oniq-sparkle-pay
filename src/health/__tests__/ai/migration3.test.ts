/**
 * THE PHASE 3 MIGRATION WIDENS THREE CHECKS TO EXACTLY WHAT THE CODE NAMES
 * — and does nothing else. Provider lists equal PROVIDER_IDS; the consents
 * check names each terms version with exactly the recipients
 * DISCLOSED_RECIPIENTS_BY_TERMS says that version disclosed; no table, no
 * column, no config value (a config change is an audited UPDATE, never a
 * migration). The Phase 2 file keeps its historical single-provider text and
 * is pinned as such by migration2.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDER_IDS } from "../../ai/types";
import { DISCLOSED_RECIPIENTS_BY_TERMS } from "../../consent";

const ROOT = join(__dirname, "..", "..", "..", "..");
const SQL = readFileSync(
  join(ROOT, "supabase/migrations/20260909100000_oniq_health_phase3_vertex.sql"),
  "utf8",
);
const quoted = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
function listIn(marker: string): string[] {
  const i = SQL.indexOf(marker);
  expect(i, marker).toBeGreaterThan(-1);
  const close = SQL.indexOf("))", i + marker.length);
  return quoted(SQL.slice(i + marker.length, close)).sort();
}

describe("the provider checks", () => {
  it("the row and the receipts may name exactly the registry's providers", () => {
    expect(
      listIn("add constraint health_config_ai_provider_check\n  check (ai_provider in ("),
    ).toEqual([...PROVIDER_IDS].sort());
    expect(
      listIn("add constraint health_ai_requests_provider_check\n  check (provider in ("),
    ).toEqual([...PROVIDER_IDS].sort());
    expect(PROVIDER_IDS).toContain("vertex");
    expect(PROVIDER_IDS).toContain("synthetic");
  });
});

describe("the consents check", () => {
  it("names every terms version with exactly the recipients that version disclosed", () => {
    const i = SQL.indexOf("add constraint health_consents_terms_recipient_check");
    expect(i).toBeGreaterThan(-1);
    const block = SQL.slice(i, SQL.indexOf(";", i));
    const clauses = [
      ...block.matchAll(/\(terms_version = '([^']+)' and recipient in \(([^)]+)\)\)/g),
    ];
    const fromSql = Object.fromEntries(clauses.map((m) => [m[1], quoted(m[2]).sort()]));
    const fromCode = Object.fromEntries(
      Object.entries(DISCLOSED_RECIPIENTS_BY_TERMS).map(([v, r]) => [v, [...r].sort()]),
    );
    expect(fromSql).toEqual(fromCode);
    expect(fromSql["health-ai-terms-v2"]).toEqual(["google_vertex", "oniq"]);
    expect(fromSql["health-ai-terms-v1"]).toEqual(["oniq"]);
  });
});

describe("and nothing else", () => {
  it("creates no table or column, seeds nothing, and sets no config value", () => {
    expect(SQL).not.toMatch(
      /create table|add column|insert into|\bupdate public\.health_config\b/i,
    );
    expect(SQL).not.toMatch(/ai_enabled\s*=|ai_kill_switch\s*=|ai_daily_cap/);
    expect(SQL).toMatch(/drop constraint if exists health_config_ai_provider_check/);
    expect(SQL).toMatch(/drop constraint if exists health_ai_requests_provider_check/);
    expect(SQL).toMatch(/drop constraint if exists health_consents_terms_recipient_check/);
  });
});
