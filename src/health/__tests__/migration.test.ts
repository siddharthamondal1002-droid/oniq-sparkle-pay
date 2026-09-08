/**
 * THE MIGRATION SAYS WHAT THE DOMAIN SAYS. Every closed list in domain.ts is
 * a CHECK constraint here; every user table has RLS, the cascade, the UAE
 * guard and no write policy; the audit chain is the audit_log chain with its
 * own lock; the bucket is private with no policy. Read with SQL comments
 * stripped, because the file's comments quote every rule.
 *
 * TWO FILES, ONE EFFECTIVE SCHEMA. Phase 2 replaces two CHECK lists and adds
 * columns by name rather than editing the unapplied Phase 1 file, so a list
 * is compared against its LAST definition across the ordered files — Phase 1
 * CREATE ∪ Phase 2 ALTER — never against Phase 1 alone.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripSqlComments } from "@/test/sourceText";
import {
  AUDIT_ACTIONS,
  CONSENT_PURPOSES,
  DATA_CATEGORIES,
  DOCUMENT_KINDS,
  DOCUMENT_MIMES,
  MAX_DOCUMENT_BYTES,
  PROVENANCE_SOURCES,
  RECIPIENTS,
  RECORD_KINDS,
  RECORD_STATUSES,
} from "@/health/domain";
import { HEALTH_FLAG_COLUMNS } from "@/health/flagNames";

const ROOT = join(__dirname, "..", "..", "..");
const SQL = stripSqlComments(
  readFileSync(join(ROOT, "supabase/migrations/20260908120000_oniq_health_phase1.sql"), "utf8"),
).toLowerCase();
const SQL2 = stripSqlComments(
  readFileSync(join(ROOT, "supabase/migrations/20260908150000_oniq_health_phase2.sql"), "utf8"),
).toLowerCase();

/** A named `add constraint … check (col in (…))` in the later file wins over the create. */
function effectiveCheck(table: string, column: string, createMarker: string, b: string): string[] {
  const named = `add constraint ${table}_${column}_check`;
  const i2 = SQL2.lastIndexOf(named);
  if (i2 > -1) {
    const open = SQL2.indexOf(`check (${column} in (`, i2);
    expect(open, `${named} has no IN list`).toBeGreaterThan(-1);
    const close = SQL2.indexOf("))", open);
    return quoted(SQL2.slice(open, close)).sort();
  }
  const i = b.indexOf(createMarker);
  expect(i, createMarker).toBeGreaterThan(-1);
  const close = b.indexOf("))", i + createMarker.length);
  return quoted(b.slice(i + createMarker.length, close)).sort();
}

const USER_TABLES = ["health_records", "health_documents", "health_consents"];
const ALL_TABLES = [...USER_TABLES, "health_audit", "health_config", "health_retention_policies"];

function block(table: string): string {
  const start = SQL.indexOf(`create table if not exists public.${table} (`);
  expect(start, table).toBeGreaterThan(-1);
  const end = SQL.indexOf("\n);", start);
  return SQL.slice(start, end);
}

function quoted(s: string): string[] {
  return [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("every table", () => {
  it.each(ALL_TABLES)("%s has row level security", (t) => {
    expect(SQL).toContain(`alter table public.${t} enable row level security`);
  });

  it.each(USER_TABLES)("%s cascades from profiles, carries the UAE guard and provenance", (t) => {
    const b = block(t);
    expect(b).toContain("user_id uuid not null references public.profiles(id) on delete cascade");
    expect(SQL).toMatch(
      new RegExp(
        `create trigger ${t}_ae_guard\\s+before insert or update on public\\.${t}\\s+for each row execute function public\\.health_write_guard\\(\\)`,
      ),
    );
    expect(SQL).toMatch(
      new RegExp(
        `create policy "no health writes for ae home" on public\\.${t}\\s+as restrictive for all to authenticated`,
      ),
    );
    if (t !== "health_consents") expect(b).toContain("provenance jsonb not null check (");
  });

  it("grants authenticated no write policy on any health table", () => {
    const re =
      /create policy "[^"]+" on public\.(health_\w+)\s+((?:as restrictive\s+)?)for (\w+) to authenticated/g;
    const seen: string[] = [];
    for (const m of SQL.matchAll(re)) {
      seen.push(`${m[1]}:${m[3]}`);
      if (m[3] !== "select") expect(m[2].trim(), `${m[1]} ${m[3]}`).toBe("as restrictive");
    }
    expect(seen.length).toBeGreaterThan(6);
    expect(SQL).not.toMatch(/on storage\.objects/);
  });
});

describe("the CHECK lists equal the domain lists", () => {
  const listAfter = (b: string, marker: string) => {
    const i = b.indexOf(marker);
    expect(i, marker).toBeGreaterThan(-1);
    const close = b.indexOf("))", i + marker.length);
    return quoted(b.slice(i + marker.length, close)).sort();
  };

  it("record kinds, code systems, statuses and provenance sources", () => {
    const b = block("health_records");
    expect(listAfter(b, "kind text not null check (kind in (")).toEqual([...RECORD_KINDS].sort());
    expect(listAfter(b, "provenance->>'source' in (")).toEqual([...PROVENANCE_SOURCES].sort());
    expect(
      effectiveCheck(
        "health_records",
        "status",
        "status text not null default 'active' check (status in (",
        b,
      ),
    ).toEqual([...RECORD_STATUSES].sort());
  });

  it("document kinds, mimes and the size cap", () => {
    const b = block("health_documents");
    expect(listAfter(b, "kind text not null check (kind in (")).toEqual([...DOCUMENT_KINDS].sort());
    expect(listAfter(b, "mime text not null check (mime in (")).toEqual([...DOCUMENT_MIMES].sort());
    expect(b).toContain(`size_bytes <= ${MAX_DOCUMENT_BYTES}`);
    expect(listAfter(b, "provenance->>'source' in (")).toEqual([...PROVENANCE_SOURCES].sort());
  });

  it("consent purposes, recipients and categories", () => {
    const b = block("health_consents");
    expect(listAfter(b, "purpose text not null check (purpose in (")).toEqual(
      [...CONSENT_PURPOSES].sort(),
    );
    expect(listAfter(b, "recipient text not null check (recipient in (")).toEqual(
      [...RECIPIENTS].sort(),
    );
    const cats = b.slice(b.indexOf("data_categories <@ array["), b.indexOf("]::text[]"));
    expect(quoted(cats).sort()).toEqual([...DATA_CATEGORIES].sort());
    expect(SQL).toContain("create unique index if not exists health_consents_one_active_idx");
  });

  it("audit actions", () => {
    const b = block("health_audit");
    expect(
      effectiveCheck("health_audit", "action", "action text not null check (action in (", b),
    ).toEqual([...AUDIT_ACTIONS].sort());
    // Phase 1's own list is a strict subset: the later file only widens.
    const phase1 = listAfter(b, "action text not null check (action in (");
    for (const a of phase1) expect(AUDIT_ACTIONS).toContain(a);
    expect(phase1.length).toBeLessThan(AUDIT_ACTIONS.length);
  });

  it("the config row carries every flag column, default false, across both files", () => {
    const b = block("health_config");
    const added = SQL2.slice(
      SQL2.indexOf("alter table public.health_config"),
      SQL2.indexOf(";", SQL2.indexOf("alter table public.health_config")),
    );
    for (const col of Object.values(HEALTH_FLAG_COLUMNS)) {
      const inCreate = b.includes(`${col} boolean not null default false`);
      const inAlter = added.includes(
        `add column if not exists ${col} boolean not null default false`,
      );
      expect(inCreate || inAlter, col).toBe(true);
    }
    expect(SQL).toContain(
      "insert into public.health_config (id) values (true) on conflict (id) do nothing",
    );
  });

  it("seeds a retention placeholder for every category", () => {
    const seed = SQL.slice(
      SQL.indexOf("insert into public.health_retention_policies"),
      SQL.indexOf("on conflict (category)"),
    );
    for (const c of DATA_CATEGORIES) expect(seed, c).toContain(`('${c}',`);
    expect(seed).toMatch(/placeholder/);
  });
});

describe("the audit chain and the bucket", () => {
  it("chains with sha256 under its own advisory lock, appended only by the service role", () => {
    expect(SQL).toContain("create or replace function public.health_audit_chain()");
    expect(SQL).toContain("pg_advisory_xact_lock(7700000000000020)");
    expect(SQL).toContain("'sha256'");
    expect(SQL).toMatch(
      /revoke all on function public\.health_append_audit\([^)]*\)\s+from public, anon, authenticated/,
    );
    expect(SQL).toMatch(
      /grant execute on function public\.health_append_audit\([^)]*\)\s+to service_role/,
    );
    expect(SQL).toContain("create or replace function public.health_verify_audit_chain()");
    expect(SQL).toMatch(/if not public\.is_admin\(auth\.uid\(\)\) then raise exception/);
  });

  it("creates the bucket private and leaves it with no client policy", () => {
    expect(SQL).toMatch(
      /insert into storage\.buckets \(id, name, public\)\s+values \('health-documents', 'health-documents', false\)/,
    );
  });

  it("keeps the retention sweep off the client", () => {
    expect(SQL).toMatch(
      /revoke all on function public\.health_apply_retention\(\) from public, anon, authenticated/,
    );
  });
});
