/**
 * THE PHASE 2 MIGRATION SAYS WHAT THE TYPES SAY. Every closed list a receipt
 * can store is a CHECK here, every constraint is named, the receipts table
 * has RLS with a select-only policy and survives account deletion, the
 * config gains the AI columns with caps defaulting to zero, and the terms
 * pairs mirror DISCLOSED_RECIPIENTS_BY_TERMS. Comments stripped, since the
 * file's header quotes every rule.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripSqlComments } from "@/test/sourceText";
import { AI_REFUSAL_REASONS, AI_TASKS, CONTRACT_REFUSAL_CODES, PROVIDER_IDS } from "../../ai/types";
import { DISCLOSED_RECIPIENTS_BY_TERMS } from "../../consent";
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES, RECORD_STATUSES } from "../../domain";
import { HEALTH_FLAG_COLUMNS } from "../../flagNames";

const ROOT = join(__dirname, "..", "..", "..", "..");
const RAW = readFileSync(
  join(ROOT, "supabase/migrations/20260908150000_oniq_health_phase2.sql"),
  "utf8",
);
const SQL = stripSqlComments(RAW).toLowerCase();

function quoted(s: string): string[] {
  return [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function listIn(marker: string, from = SQL): string[] {
  const i = from.indexOf(marker);
  expect(i, marker).toBeGreaterThan(-1);
  const close = from.indexOf("))", i + marker.length);
  return quoted(from.slice(i + marker.length, close)).sort();
}

const RECEIPTS = SQL.slice(
  SQL.indexOf("create table if not exists public.health_ai_requests ("),
  SQL.indexOf("\n);", SQL.indexOf("create table if not exists public.health_ai_requests (")),
);

describe("the receipts table", () => {
  it("survives account deletion with user_id set null — it is the cap ledger", () => {
    expect(RECEIPTS).toContain("user_id uuid references auth.users(id) on delete set null");
  });

  it("stores only closed codes", () => {
    expect(listIn("task text not null check (task in (", RECEIPTS)).toEqual([...AI_TASKS].sort());
    // Phase 2 shipped one provider; Phase 3's migration widens this check to
    // PROVIDER_IDS (migration3.test.ts). The historical file keeps its text.
    expect(listIn("provider text not null check (provider in (", RECEIPTS)).toEqual(["synthetic"]);
    expect([...PROVIDER_IDS]).toContain("synthetic");
    expect(listIn("purpose text not null check (purpose in (", RECEIPTS)).toEqual([
      "ai_interpretation",
    ]);
    expect(listIn("refusal_reason is null or refusal_reason in (", RECEIPTS)).toEqual(
      [...AI_REFUSAL_REASONS].sort(),
    );
    expect(listIn("contract_code is null or contract_code in (", RECEIPTS)).toEqual(
      [...CONTRACT_REFUSAL_CODES].sort(),
    );
    expect(listIn("status text not null default 'started' check (status in (", RECEIPTS)).toEqual([
      "error",
      "ok",
      "refused",
      "started",
    ]);
  });

  it("has RLS, a select-only policy, both indexes, and a purged_at mark", () => {
    expect(SQL).toContain("alter table public.health_ai_requests enable row level security");
    expect(SQL).toMatch(
      /create policy "own health ai requests" on public\.health_ai_requests\s+for select to authenticated using \(auth\.uid\(\) = user_id\)/,
    );
    expect(SQL.match(/on public\.health_ai_requests\s+for (insert|update|delete)/g)).toBeNull();
    expect(SQL).toContain("create index if not exists health_ai_requests_created_idx");
    expect(SQL).toContain("create index if not exists health_ai_requests_user_created_idx");
    expect(RECEIPTS).toContain("purged_at timestamptz");
    expect(RECEIPTS).toContain("manifest jsonb not null default '{}'::jsonb");
  });
});

describe("the config row", () => {
  const alter = SQL.slice(
    SQL.indexOf("alter table public.health_config"),
    SQL.indexOf(";", SQL.indexOf("alter table public.health_config")),
  );

  it("adds the twelfth flag and the AI columns, caps defaulting to ZERO", () => {
    expect(alter).toContain(
      `add column if not exists ${HEALTH_FLAG_COLUMNS["health.provider_sharing.enabled"]} boolean not null default false`,
    );
    expect(alter).toContain(
      "add column if not exists ai_provider text not null default 'synthetic'",
    );
    expect(alter).toContain(
      "add column if not exists ai_model text not null default 'synthetic-v1'",
    );
    expect(alter).toContain("add column if not exists ai_daily_caps jsonb not null default");
    expect(alter).not.toContain("ai_daily_cap_per_user");
    expect(alter).toContain(
      "add column if not exists ai_daily_cap_house integer not null default 0",
    );
    expect(alter).toContain(
      "add column if not exists ai_kill_switch boolean not null default false",
    );
    expect(alter).toContain(
      "add column if not exists ai_admin_verification_enabled boolean not null default false",
    );
    expect(alter).not.toMatch(/ai_minors_allowed/);
  });

  it("the per-task caps default to the owner's B11 table, one key per Phase 2 task, changeable by UPDATE", () => {
    const m = alter.match(/ai_daily_caps jsonb not null default\s+'(\{[^']+\})'::jsonb/);
    expect(m).not.toBeNull();
    const caps = JSON.parse(m![1]) as Record<string, number>;
    expect(caps).toEqual({
      answer_question: 10,
      explain_record: 5,
      summarize_timeline: 3,
      classify_document: 10,
      extract_document: 10,
    });
    expect(Object.keys(caps).sort()).toEqual([...AI_TASKS].sort());
    // The house cap stays the owner's to set: still 0 = refuse.
    expect(alter).toContain("ai_daily_cap_house integer not null default 0");
  });

  it("the caps check keeps the house cap non-negative and the per-task caps an object", () => {
    expect(SQL).toContain(
      "check (ai_daily_cap_house >= 0 and jsonb_typeof(ai_daily_caps) = 'object')",
    );
    expect(SQL).toContain("comment on column public.health_config.ai_kill_switch is");
    expect(
      SQL.match(/comment on column public\.health_config\.ai_daily_cap_house is/g)?.length,
    ).toBe(1);
  });

  it("checks the provider by a named constraint — one provider in Phase 2, widened by Phase 3's file", () => {
    expect(
      listIn("add constraint health_config_ai_provider_check\n  check (ai_provider in ("),
    ).toEqual(["synthetic"]);
  });
});

describe("records, documents, consents, audit", () => {
  it("records: statuses, confidence, the numeric-extraction rule, the candidate index", () => {
    expect(listIn("add constraint health_records_status_check\n  check (status in (")).toEqual(
      [...RECORD_STATUSES].sort(),
    );
    expect(SQL).toContain("check (confidence is null or (confidence >= 0 and confidence <= 1))");
    expect(SQL).toContain(
      "check (provenance->>'source' <> 'document_extraction' or value_text is null)",
    );
    expect(SQL).toContain("create index if not exists health_records_user_candidate_idx");
    expect(SQL).toContain("where status = 'candidate'");
  });

  it("documents: classification, extraction state, text length", () => {
    expect(SQL).toContain("add column if not exists classification jsonb");
    expect(
      listIn(
        "add constraint health_documents_extraction_status_check\n  check (extraction_status in (",
      ),
    ).toEqual(["candidates", "empty", "failed", "none"]);
    expect(SQL).toContain("check (text_chars is null or text_chars >= 0)");
  });

  it("consents: the terms/recipient pairs equal the mirrored map, plus a jurisdiction", () => {
    const i = SQL.indexOf("add constraint health_consents_terms_recipient_check");
    const block = SQL.slice(i, SQL.indexOf(";", i));
    const pairs = [
      ...block.matchAll(/\(terms_version = '([^']+)' and recipient in \(([^)]+)\)\)/g),
    ].map((m) => [m[1], quoted(m[2]).sort()] as const);
    // Phase 2's file carries the v1 versions; Phase 3's file widens the check
    // to the whole map (migration3.test.ts). Each v1 pair must still agree.
    const expected = Object.entries(DISCLOSED_RECIPIENTS_BY_TERMS)
      .filter(([v]) => v.endsWith("-v1"))
      .map(([v, r]) => [v, [...r].sort()] as const);
    expect(expected.length).toBe(2);
    expect(pairs.sort()).toEqual(expected.sort());
    expect(SQL).toContain("add column if not exists jurisdiction text not null default 'in'");
  });

  it("audit: the widened action list equals the domain list", () => {
    expect(listIn("add constraint health_audit_action_check\n  check (action in (")).toEqual(
      [...AUDIT_ACTIONS].sort(),
    );
  });
});

describe("every change to the AI controls is audited, whatever the path (owner directive 2026-09-08)", () => {
  it("widens object_type to config by a named constraint equal to the domain list", () => {
    expect(
      listIn("add constraint health_audit_object_type_check\n  check (object_type in ("),
    ).toEqual([...AUDIT_OBJECT_TYPES].sort());
  });

  it("a row trigger appends config.changed on any change to the five AI-control columns, as a system row", () => {
    const start = SQL.indexOf(
      "create or replace function public.health_config_audit_ai_controls()",
    );
    expect(start).toBeGreaterThan(-1);
    const fn = SQL.slice(start, SQL.indexOf("$$;", start));
    expect(fn).toContain("security definer");
    for (const col of [
      "ai_daily_cap_house",
      "ai_daily_caps",
      "ai_kill_switch",
      "ai_enabled",
      "ai_admin_verification_enabled",
    ]) {
      expect(fn, col).toContain(`new.${col} is distinct from old.${col}`);
    }
    expect(fn).toContain("perform public.health_append_audit(");
    expect(fn).toContain("'config.changed', 'config'");
    expect(fn).toContain("null::uuid, current_user::text");
    expect(fn).toContain("gen_random_uuid(), 'ok'");
    expect(SQL).toContain(
      "create trigger health_config_audit_ai_controls\n  after update on public.health_config\n  for each row execute function public.health_config_audit_ai_controls()",
    );
    expect(SQL).toContain(
      "revoke all on function public.health_config_audit_ai_controls() from public, anon, authenticated",
    );
  });
});

describe("discipline", () => {
  it("every added constraint is NAMED, so the next phase can drop it without guessing", () => {
    const adds = [...SQL.matchAll(/add constraint (\w+)\s+check/g)].map((m) => m[1]);
    expect(adds.length).toBeGreaterThanOrEqual(10);
    expect(SQL).not.toMatch(/add constraint check/);
    expect(SQL).not.toMatch(/add check \(/);
    for (const m of SQL.matchAll(/drop constraint if exists (\w+)/g)) expect(adds).toContain(m[1]);
  });

  it("retention: receipts have a placeholder period and the sweep applies it", () => {
    expect(SQL).toMatch(/\('ai_requests', 365, 'placeholder/);
    expect(SQL).toContain("delete from public.health_ai_requests");
    expect(SQL).toContain("where category = 'ai_requests'");
    expect(SQL).toMatch(
      /revoke all on function public\.health_apply_retention\(\) from public, anon, authenticated/,
    );
  });

  it("applies after Phase 1 and touches no Vitals table", () => {
    expect("20260908150000" > "20260908120000").toBe(true);
    expect(SQL).not.toMatch(/health_checkins|cycle_logs|health_profiles/);
  });
});
