// 20260908190000_oniq_health_audit_chain_survives_erasure.sql — the verifier
// recovers a hashed user id from `actor` after an account's erasure nulls
// `user_id`. The recovery is only sound while EVERY writer passes actor = the
// person's own id, so that invariant is pinned here, over the writers'
// source with comments stripped (audit.ts's own doc comment names a "system"
// actor that no writer uses — a grep that read the prose would find it).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments, stripSqlComments } from "../../test/sourceText";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const PHASE1 = stripSqlComments(read("supabase/migrations/20260908120000_oniq_health_phase1.sql"));
const FIX = stripSqlComments(
  read("supabase/migrations/20260908190000_oniq_health_audit_chain_survives_erasure.sql"),
);
const UUID_RE = "'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.includes("__tests__")) out.push(p);
  }
  return out;
}

describe("the premise: Phase 1 hashes user_id, and erasure nulls it", () => {
  it("health_audit.user_id is a set-null foreign key to auth.users", () => {
    expect(PHASE1).toContain("user_id uuid references auth.users(id) on delete set null");
  });
  it("the chain trigger commits to coalesce(user_id, '') — the column the cascade rewrites", () => {
    const start = PHASE1.indexOf("create or replace function public.health_audit_chain()");
    const fn = PHASE1.slice(start, PHASE1.indexOf("$$;", start));
    expect(fn).toContain("coalesce(new.user_id::text,'')");
  });
});

describe("the fix: the verifier recovers the committed id from actor", () => {
  const start = FIX.indexOf("create or replace function public.health_verify_audit_chain()");
  const fn = FIX.slice(start, FIX.indexOf("$$;", start));

  it("orders after the every-column trigger migration", () => {
    expect("20260908190000" > "20260908181500").toBe(true);
  });

  it("falls back to actor only when user_id is null and actor is a UUID", () => {
    expect(start).toBeGreaterThan(-1);
    expect(fn).toContain(
      `coalesce(r.user_id::text,\n               case when r.actor ~ ${UUID_RE} then r.actor end,\n               '')`,
    );
  });

  it("keeps the signature and the admin gate, revokes the PUBLIC default, keeps the authenticated grant", () => {
    expect(fn).toContain("returns table(ok boolean, rows_checked integer, first_bad uuid)");
    expect(fn).toContain(
      "if not public.is_admin(auth.uid()) then raise exception 'admin only'; end if;",
    );
    expect(FIX).toContain(
      "revoke all on function public.health_verify_audit_chain() from public, anon;",
    );
    expect(FIX).toContain(
      "grant execute on function public.health_verify_audit_chain() to authenticated;",
    );
    expect(FIX).not.toMatch(/alter table|create table|drop /i);
  });

  it("changes nothing about how rows are WRITTEN", () => {
    expect(FIX).not.toContain("health_audit_chain()");
    expect(FIX).not.toContain("health_append_audit");
  });
});

describe("the invariant the recovery rests on: every writer passes actor = userId", () => {
  const files = walk(join(ROOT, "supabase", "functions"));
  const calls: Array<{ file: string; userId: string; actor: string }> = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(/appendAudit\(\s*[\w.]+\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
      const body = m[1];
      const userId = body.match(/(?:^|[,{\s])userId(?:\s*:\s*([\w.]+))?\s*(?:,|$)/m);
      const actor = body.match(/actor\s*:\s*([\w."']+)/);
      expect(userId, `${file}: appendAudit without userId`).not.toBeNull();
      expect(actor, `${file}: appendAudit without actor`).not.toBeNull();
      calls.push({ file, userId: userId![1] ?? "userId", actor: actor![1] });
    }
  }

  it("finds both writers and no third", () => {
    expect(calls.map((c) => c.file.replace(ROOT + "/", "")).sort()).toEqual([
      "supabase/functions/health-ai/index.ts",
      "supabase/functions/health-api/index.ts",
    ]);
  });

  it("each passes the same identifier as userId and actor — never a literal", () => {
    for (const c of calls) {
      expect(c.actor, c.file).toBe(c.userId);
      expect(c.actor, c.file).not.toMatch(/["']/);
    }
  });
});
