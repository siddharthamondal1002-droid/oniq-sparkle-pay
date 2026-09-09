// The audit chain numbers its rows under the chain lock, and a row the old
// race orphaned is adopted rather than rewritten — migration 20260909130000.
//
// FOUND 2026-09-09 by scripts/health-production-check.sql after the Phase 3b
// smoke test: AUDIT_CHAIN_BROKEN at seq 44 and 45, two documents.register rows
// written concurrently. Their content hashes verified; their links were
// crossed, because `seq` came from the column default (nextval) BEFORE the
// trigger took pg_advisory_xact_lock and read the latest row for prev_hash.
// Row 44 ended up referenced by nothing: under the old trigger it could have
// been deleted without breaking the chain. See the migration's header.
//
// Read from source, comments stripped: the shapes a typecheck cannot see.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES } from "../domain";
import { stripSqlComments } from "../../test/sourceText";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => stripSqlComments(readFileSync(join(ROOT, rel), "utf8"));
const PHASE1 = read("supabase/migrations/20260908120000_oniq_health_phase1.sql");
const ERASURE = read(
  "supabase/migrations/20260908190000_oniq_health_audit_chain_survives_erasure.sql",
);
const FIX = read("supabase/migrations/20260909130000_oniq_health_audit_seq_under_lock.sql");

/** The body of one `create or replace function public.<name>(` in a migration. */
function fn(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = sql.indexOf("end $$;", start);
  expect(end, `${name} end`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/** The digest expression between encode(extensions.digest( and 'sha256'), whitespace-normalised. */
function digest(body: string): string {
  const start = body.indexOf("encode(extensions.digest(");
  expect(start).toBeGreaterThan(-1);
  return body.slice(start, body.indexOf("'sha256'), 'hex')", start)).replace(/\s+/g, " ");
}

describe("the premise: Phase 1 numbered rows outside the lock", () => {
  it("seq came from a sequence default, evaluated before the trigger runs", () => {
    expect(PHASE1).toMatch(
      /seq\s+bigserial|seq\s+bigint\s+generated|nextval\('health_audit_seq_seq'/,
    );
    const trigger = fn(PHASE1, "health_audit_chain");
    expect(trigger).toContain("pg_advisory_xact_lock(7700000000000020)");
    expect(trigger).not.toContain("new.seq :=");
  });
});

describe("the fix: the trigger assigns seq from the same locked read that supplies prev_hash", () => {
  const trigger = fn(FIX, "health_audit_chain");

  it("takes the lock, reads the latest row, then numbers and links from that one read", () => {
    const lock = trigger.indexOf("pg_advisory_xact_lock(7700000000000020)");
    const readLatest = trigger.indexOf(
      "select seq, record_hash into last_seq, p from public.health_audit order by seq desc limit 1;",
    );
    const number = trigger.indexOf("new.seq := coalesce(last_seq, 0) + 1;");
    const link = trigger.indexOf("new.prev_hash := p;");
    const hash = trigger.indexOf("new.record_hash := encode(");
    expect(lock).toBeGreaterThan(-1);
    expect(readLatest).toBeGreaterThan(lock);
    expect(number).toBeGreaterThan(readLatest);
    expect(link).toBeGreaterThan(number);
    expect(hash).toBeGreaterThan(link);
  });

  it("hashes exactly what Phase 1 hashed, so every existing row keeps verifying", () => {
    expect(digest(trigger)).toEqual(digest(fn(PHASE1, "health_audit_chain")));
  });

  it("makes two rows sharing a number an error, not a silent fork", () => {
    expect(FIX).toContain(
      "create unique index if not exists health_audit_seq_key on public.health_audit (seq);",
    );
  });
});

describe("the repair: adoption, never a rewritten hash", () => {
  const verifier = fn(FIX, "health_verify_audit_chain");

  it("adds chain.adopt and the chain object type, keeping every action and type the app writes", () => {
    for (const a of AUDIT_ACTIONS) expect(FIX).toContain(`'${a}'`);
    for (const t of AUDIT_OBJECT_TYPES) expect(FIX).toContain(`'${t}'`);
    expect(FIX).toContain("'chain.adopt'");
    expect(FIX).toContain("'chain'");
    // Written by an operator from SQL only: the app's closed lists do not carry it.
    expect(AUDIT_ACTIONS as readonly string[]).not.toContain("chain.adopt");
    expect(AUDIT_OBJECT_TYPES as readonly string[]).not.toContain("chain");
  });

  it("reads the adopted hashes from chain.adopt rows and recomputes an adopted row against its own prev", () => {
    expect(verifier).toContain(
      "from public.health_audit a, jsonb_array_elements_text(a.detail->'adopts') x",
    );
    expect(verifier).toContain("where a.action = 'chain.adopt'");
    expect(verifier).toContain(
      "link := case when r.record_hash = any(adopted) then r.prev_hash else prev end;",
    );
    expect(digest(verifier)).toContain("coalesce(link,'')");
  });

  it("checks an adopted row's content, then leaves it out of the linking", () => {
    const content = verifier.indexOf("if calc <> r.record_hash then");
    const skip = verifier.indexOf("if r.record_hash = any(adopted) then\n      continue;");
    const linkCheck = verifier.indexOf("if r.prev_hash is distinct from prev then");
    const advance = verifier.indexOf("prev := r.record_hash;");
    expect(content).toBeGreaterThan(-1);
    expect(skip).toBeGreaterThan(content);
    expect(linkCheck).toBeGreaterThan(skip);
    expect(advance).toBeGreaterThan(linkCheck);
  });

  it("holds an adopt row to its claims: chained itself, and only ever adopting an EARLIER row", () => {
    expect(verifier).toContain("if r.action = 'chain.adopt' and exists (");
    expect(verifier).toContain(
      "where not exists (select 1 from public.health_audit b where b.record_hash = x and b.seq < r.seq)",
    );
  });

  it("keeps the 2026-09-08 erasure fallback, the admin gate, the signature and the grants", () => {
    const slot =
      "coalesce(r.user_id::text,\n               case when r.actor ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then r.actor end,\n               '')";
    expect(verifier).toContain(slot);
    expect(fn(ERASURE, "health_verify_audit_chain")).toContain(slot);
    expect(verifier).toContain(
      "if not public.is_admin(auth.uid()) then raise exception 'admin only'; end if;",
    );
    expect(verifier).toContain("returns table(ok boolean, rows_checked integer, first_bad uuid)");
    expect(FIX).toContain(
      "revoke all on function public.health_verify_audit_chain() from public, anon;",
    );
    expect(FIX).toContain(
      "grant execute on function public.health_verify_audit_chain() to authenticated;",
    );
  });
});
