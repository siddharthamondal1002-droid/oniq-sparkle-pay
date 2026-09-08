// 20260908181500_oniq_health_config_audit_every_column.sql — the row trigger
// that audits health_config stops naming columns and diffs the whole row.
//
// Why a test and not a comment: Phase 2's trigger listed five columns, and the
// first thing the owner's go sequence sets (`enabled = true`) was not one of
// them. A trigger that diffs `to_jsonb(new)` cannot miss a column added later,
// which is the property this file pins — a future edit that goes back to naming
// columns fails here. Comments are stripped first: the header of the migration
// quotes every column name it discusses, and a grep that read the prose would
// pass on a file whose executable half had lost the property.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripSqlComments } from "../../test/sourceText";

const ROOT = join(__dirname, "..", "..", "..");
const FILE = "20260908181500_oniq_health_config_audit_every_column.sql";
const RAW = readFileSync(join(ROOT, "supabase", "migrations", FILE), "utf8");
const SQL = stripSqlComments(RAW);

function fnBody(): string {
  const start = SQL.indexOf("create or replace function public.health_config_audit_ai_controls()");
  expect(start).toBeGreaterThan(-1);
  return SQL.slice(start, SQL.indexOf("$$;", start));
}

describe("the every-column audit trigger", () => {
  it("orders after Phase 2, which created the function it replaces", () => {
    expect(FILE.slice(0, 14) > "20260908150000").toBe(true);
  });

  it("replaces the SAME function under the SAME binding — no trigger is dropped or recreated", () => {
    expect(SQL).toContain("create or replace function public.health_config_audit_ai_controls()");
    expect(SQL).not.toMatch(/create trigger/i);
    expect(SQL).not.toMatch(/drop trigger/i);
    expect(SQL).not.toMatch(/alter table/i);
    expect(SQL).not.toMatch(/create table/i);
  });

  it("diffs the whole row minus updated_at, so a column added later is audited without an edit", () => {
    const fn = fnBody();
    expect(fn).toContain("jsonb_each(to_jsonb(new) - 'updated_at')");
    expect(fn).toContain("is distinct from (to_jsonb(old) -> n.key)");
    expect(fn).toContain("if changed <> '{}'::jsonb then");
    // The property: no column is named in the CONDITION. Naming one would be
    // the Phase 2 shape coming back, one forgotten column at a time.
    expect(fn).not.toMatch(/new\.\w+ is distinct from old\.\w+/);
  });

  it("keeps the five Phase 2 detail keys byte-for-byte and adds the two master switches and the changed set", () => {
    const fn = fnBody();
    for (const pair of [
      "'house', new.ai_daily_cap_house",
      "'caps', new.ai_daily_caps",
      "'switch', case when new.ai_kill_switch then 'on' else 'off' end",
      "'ai_enabled', new.ai_enabled",
      "'admin_verification', new.ai_admin_verification_enabled",
      "'enabled', new.enabled",
      "'uploads', new.uploads_enabled",
      "'changed', changed",
    ]) {
      expect(fn, pair).toContain(pair);
    }
  });

  it("appends through health_append_audit as a system row, exactly as Phase 2 did", () => {
    const fn = fnBody();
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = public");
    expect(fn).toContain("perform public.health_append_audit(");
    expect(fn).toContain("'config.changed', 'config'");
    expect(fn).toContain("null::uuid, current_user::text");
    expect(fn).toContain("gen_random_uuid(), 'ok'");
    expect(SQL).toContain(
      "revoke all on function public.health_config_audit_ai_controls() from public, anon, authenticated",
    );
  });
});
