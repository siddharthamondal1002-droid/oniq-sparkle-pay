// The audit log is append-only BY TRIGGER, not only by grant — Phase 4
// (owner directive 2026-09-09, §9: "deletes … sequence collisions …
// tampering"; "do not rewrite historical hashes").
//
// The chain can PROVE a row was edited (its hash no longer recomputes) and
// that a row in the middle was removed (the next link breaks). It cannot
// prove the LAST row was removed: nothing links to it yet. So the table
// refuses UPDATE and DELETE outright, with one shaped exception — the FK on
// user_id is `on delete set null`, and an account's erasure performs exactly
// that update (migration 20260908190000 keeps the hash valid through it).
//
// Read from the migration with SQL comments stripped, and from the
// production check, which must expect the trigger to be armed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripSqlComments } from "../../test/sourceText";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const MIGRATION = stripSqlComments(
  read("supabase/migrations/20260909150000_oniq_health_phase4_hardening.sql"),
);
const PHASE1 = stripSqlComments(read("supabase/migrations/20260908120000_oniq_health_phase1.sql"));
const CHECK = read("scripts/health-production-check.sql");

function fn(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = sql.indexOf("end $$;", start);
  expect(end, `${name} end`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("the premise", () => {
  it("Phase 1 gave the service role select and insert only, and the FK on user_id is set-null", () => {
    expect(PHASE1).toContain("grant select, insert on public.health_audit to service_role;");
    expect(PHASE1).not.toMatch(/grant [^;]*(update|delete)[^;]* on public\.health_audit/);
    expect(PHASE1).toMatch(
      /create table if not exists public\.health_audit \([\s\S]*?user_id uuid references auth\.users\(id\) on delete set null/,
    );
  });
});

describe("the trigger", () => {
  const body = fn(MIGRATION, "health_audit_immutable");

  it("refuses every DELETE", () => {
    const del = body.indexOf("if tg_op = 'DELETE' then");
    expect(del).toBeGreaterThan(-1);
    expect(body.slice(del, body.indexOf("end if;", del))).toContain("raise exception");
  });

  it("allows exactly the erasure shape — user_id from non-null to null with every other column identical — and refuses any other UPDATE", () => {
    expect(body).toContain("if old.user_id is not null and new.user_id is null");
    expect(body).toContain("and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then");
    const allow = body.indexOf("(to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then");
    expect(body.slice(allow, allow + 80)).toContain("return new;");
    // What follows the one allowed shape is a raise, unconditionally.
    const tail = body.slice(body.indexOf("return new;") + "return new;".length);
    expect(tail).toContain("raise exception");
    expect(tail).not.toContain("return new");
  });

  it("is a BEFORE UPDATE OR DELETE row trigger on health_audit, and no client may execute the function", () => {
    expect(MIGRATION).toContain(
      "create trigger health_audit_immutable_before_change\n  before update or delete on public.health_audit\n  for each row execute function public.health_audit_immutable();",
    );
    expect(MIGRATION).toContain(
      "revoke all on function public.health_audit_immutable() from public, anon, authenticated;",
    );
    expect(body).toContain("security definer");
  });

  it("rewrites no hash and no historical row: the migration carries no UPDATE or DELETE of health_audit", () => {
    expect(MIGRATION).not.toMatch(/update public\.health_audit\b/i);
    expect(MIGRATION).not.toMatch(/delete from public\.health_audit\b/i);
  });
});

describe("the production check", () => {
  it("expects the immutability trigger armed on health_audit and the reserve function's version in history", () => {
    expect(CHECK).toContain("('health_audit_immutable_before_change', 'health_audit')");
    expect(CHECK).toContain("('20260909150000')");
    expect(CHECK).toContain("health_ai_reserve_request");
    expect(CHECK).toContain("health_ai_requests_request_id_key");
  });
});
