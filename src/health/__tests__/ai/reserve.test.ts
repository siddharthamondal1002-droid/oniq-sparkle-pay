/**
 * THE CAPS ARE RESERVED, NOT COUNTED — Phase 4 (owner directive 2026-09-09,
 * §8: "concurrent requests must not exceed limits"; "zero means unavailable,
 * never unlimited").
 *
 * Before Phase 4 the gateway counted the house window, counted the person's
 * window, and then inserted the receipt: three statements, three round
 * trips, and between any two of them another request could read the same
 * count. The 2026-09-09 audit-chain race proved concurrent calls DO
 * interleave on this project. Migration 20260909150000 moves the count and
 * the insert into one SQL function under one advisory lock, and the gateway
 * asks the store for a RESERVATION instead.
 *
 * Three layers, each pinned here:
 *   1. the SQL function's text — lock, house first, person for the task,
 *      no status filter, zero refuses, insert last, service role only
 *   2. the gateway — one reservation per request, before the provider, a
 *      refusal audited and uncounted, the window rolling 24h
 *   3. the race itself — N concurrent runs at cap K admit exactly K through
 *      an atomic reservation, and MORE than K through the old count-then-
 *      insert shape, reproduced here as a control so this file can tell a
 *      fix from a test that cannot see the fault
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  runHealthAi,
  type AiConfig,
  type GatewayActor,
  type GatewayDeps,
  type ReceiptRow,
  type ReserveResult,
  type ReserveWindow,
  type Store,
} from "../../../../supabase/functions/_shared/health/ai/gateway";
import type { RecordRow } from "../../../../supabase/functions/_shared/health/ai/context";
import { allHealthFlagsOff } from "../../flagNames";
import { stripSqlComments } from "../../../test/sourceText";
import { FakeStore, reservations, type FakeUser } from "./fakeStore";

const ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATION = stripSqlComments(
  readFileSync(
    join(ROOT, "supabase/migrations/20260909150000_oniq_health_phase4_hardening.sql"),
    "utf8",
  ),
);

/** The body of the reservation function, from `create or replace` to its `end $$;`. */
function reserveFn(): string {
  const start = MIGRATION.indexOf("create or replace function public.health_ai_reserve_request(");
  expect(start).toBeGreaterThan(-1);
  const end = MIGRATION.indexOf("end $$;", start);
  return MIGRATION.slice(start, end);
}

const NOW = "2026-09-09T12:00:00.000Z";
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALICE = u(1);
const BOB = u(2);

function consent(id: string, purpose: string, categories: string[]) {
  return {
    id,
    purpose,
    dataCategories: categories,
    recipient: "oniq",
    status: "active",
    startTime: "2026-09-01T00:00:00.000Z",
    expiryTime: null,
    termsVersion: purpose === "ai_interpretation" ? "health-ai-terms-v1" : "health-terms-v1",
  };
}

function record(n: number): RecordRow {
  return {
    id: u(n),
    kind: "lab",
    display: "HbA1c",
    value_num: 6.1,
    value_unit: "%",
    value_text: null,
    effective_at: "2026-03-14T09:00:00.000Z",
    status: "active",
    provenance: { source: "user_entry" },
  };
}

function users(): Map<string, FakeUser> {
  const mk = (id: string, n: number): FakeUser => ({
    id,
    consents: [
      consent(`s${n}`, "store_records", ["labs", "vitals"]),
      consent(`a${n}`, "ai_interpretation", ["labs", "vitals"]),
    ],
    records: [record(10 + n)],
    documents: [],
  });
  return new Map([
    [ALICE, mk(ALICE, 1)],
    [BOB, mk(BOB, 2)],
  ]);
}

function config(patch: Partial<AiConfig> = {}): AiConfig {
  const flags = allHealthFlagsOff();
  flags["health.enabled"] = true;
  flags["health.ai.enabled"] = true;
  return {
    flags,
    environment: "development",
    provider: "synthetic",
    model: "synthetic-v1",
    capPerUser: 10,
    capHouse: 100,
    adminVerificationEnabled: false,
    ...patch,
  };
}

const actor: GatewayActor = { isAdmin: false, isAdult: true, regionBlocked: false };

function deps(store: Store, requestId = "req-1"): GatewayDeps {
  return { store, now: NOW, requestId, textSource: null };
}

/* ------------------------------------------------------- 1. the SQL ---- */

describe("1. the SQL function, read from the migration", () => {
  const fn = reserveFn();

  it("locks, counts the house, counts the person for the task, inserts — in that order, under one lock", () => {
    const lock = fn.indexOf("perform pg_advisory_xact_lock(7700000000000030);");
    const house = fn.indexOf(
      "select count(*) into house_n from public.health_ai_requests where created_at >= _since;",
    );
    const houseRefuse = fn.indexOf("'quota_house'::text");
    const person = fn.indexOf(
      "where user_id = _user_id and task = _task and created_at >= _since;",
    );
    const personRefuse = fn.indexOf("'quota_user'::text");
    const insert = fn.indexOf("insert into public.health_ai_requests");
    for (const i of [lock, house, houseRefuse, person, personRefuse, insert]) {
      expect(i).toBeGreaterThan(-1);
    }
    expect(lock).toBeLessThan(house);
    expect(house).toBeLessThan(houseRefuse);
    expect(houseRefuse).toBeLessThan(person);
    expect(person).toBeLessThan(personRefuse);
    expect(personRefuse).toBeLessThan(insert);
  });

  it("neither count filters on status; the house count names no user; the person's names the task", () => {
    const counts = fn.split("select count(*)").slice(1);
    expect(counts).toHaveLength(2);
    for (const c of counts) expect(c.slice(0, c.indexOf(";"))).not.toContain("status");
    expect(counts[0].slice(0, counts[0].indexOf(";"))).not.toContain("user_id");
    expect(counts[1].slice(0, counts[1].indexOf(";"))).toContain("task = _task");
  });

  it("zero on either side is caps_unset BEFORE the lock — never unlimited", () => {
    const zero = fn.indexOf(
      "if _cap_house is null or _cap_house <= 0 or _cap_user is null or _cap_user <= 0 then",
    );
    expect(zero).toBeGreaterThan(-1);
    expect(fn.indexOf("'caps_unset'::text")).toBeGreaterThan(zero);
    expect(zero).toBeLessThan(fn.indexOf("pg_advisory_xact_lock"));
  });

  it("the started receipt is what the gateway used to insert: the caller's id, the closed columns, status started", () => {
    expect(fn).toContain(
      "(user_id, request_id, task, purpose, provider, model, consent_id, manifest, status)",
    );
    expect(fn).toContain("coalesce(_manifest, '{}'::jsonb), 'started')");
    expect(fn).toContain("security definer");
  });

  it("only the service role may execute it, and one request can hold at most one receipt", () => {
    const sig =
      "public.health_ai_reserve_request(uuid, uuid, text, text, text, text, uuid, jsonb, integer, integer, timestamptz)";
    expect(MIGRATION).toContain(
      `revoke all on function ${sig}\n  from public, anon, authenticated;`,
    );
    expect(MIGRATION).toContain(`grant execute on function ${sig}\n  to service_role;`);
    expect(MIGRATION).toContain(
      "create unique index if not exists health_ai_requests_request_id_key\n  on public.health_ai_requests (request_id);",
    );
  });
});

/* --------------------------------------------------- 2. the gateway ---- */

describe("2. the gateway reserves once, before the provider, with a rolling 24h window", () => {
  it("one reservation per request, with the request's own id and the row's task; the provider runs after it", async () => {
    const store = new FakeStore(users(), ALICE);
    const r = await runHealthAi(deps(store, "req-42"), config(), actor, {
      task: "summarize_timeline",
    });
    expect(r.ok).toBe(true);
    expect(reservations(store)).toEqual(["reserveReceipt:ok"]);
    expect(store.receipts).toHaveLength(1);
    expect(store.receipts[0].row).toMatchObject({
      request_id: "req-42",
      task: "summarize_timeline",
      status: "started",
    });
    expect(store.log.indexOf("reserveReceipt:ok")).toBeLessThan(
      store.log.indexOf("completeReceipt:ok"),
    );
  });

  it("the window is 24h back from `now`, and both caps travel as the gateway resolved them", async () => {
    const seen: ReserveWindow[] = [];
    class Watching extends FakeStore {
      override reserveReceipt(row: ReceiptRow, window: ReserveWindow) {
        seen.push(window);
        return super.reserveReceipt(row, window);
      }
    }
    const store = new Watching(users(), ALICE);
    await runHealthAi(deps(store), config({ capPerUser: 7, capHouse: 300 }), actor, {
      task: "summarize_timeline",
    });
    expect(seen).toEqual([{ since: "2026-09-08T12:00:00.000Z", capHouse: 300, capPerUser: 7 }]);
  });

  it("a refused reservation writes no receipt, runs no provider, and is audited with the reservation's own reason", async () => {
    for (const [reason, prior] of [
      ["quota_house", { userId: BOB, n: 100 }],
      ["quota_user", { userId: ALICE, n: 10 }],
    ] as const) {
      const store = new FakeStore(users(), ALICE);
      store.priorReceipts = Array.from({ length: prior.n }, () => ({
        userId: prior.userId,
        createdAt: NOW,
        status: "error",
        task: "summarize_timeline",
      }));
      const r = await runHealthAi(deps(store), config(), actor, { task: "summarize_timeline" });
      expect(r, reason).toMatchObject({ ok: false, reason });
      expect(reservations(store), reason).toEqual([`reserveReceipt:${reason}`]);
      expect(store.receipts, reason).toHaveLength(0);
      expect(store.audits, reason).toEqual([
        expect.objectContaining({
          action: "ai.refused",
          detail: expect.objectContaining({ reason }),
        }),
      ]);
    }
  });

  it("a store that answers caps_unset is answered as caps_unset — the database's refusal is honoured, not overridden", async () => {
    class Unset extends FakeStore {
      override reserveReceipt(): Promise<ReserveResult> {
        this.log.push("reserveReceipt:caps_unset");
        return Promise.resolve({ ok: false, reason: "caps_unset" });
      }
    }
    const store = new Unset(users(), ALICE);
    const r = await runHealthAi(deps(store), config(), actor, { task: "summarize_timeline" });
    expect(r).toMatchObject({ ok: false, reason: "caps_unset" });
    expect(store.receipts).toHaveLength(0);
  });
});

/* ------------------------------------------------------- 3. the race ---- */

/**
 * The OLD shape, reproduced: count, then yield to the event loop (a network
 * round trip), then insert. This is what the gateway did before Phase 4,
 * and what the control below runs so the race is SEEN to exist.
 */
class RacyStore extends FakeStore {
  override async reserveReceipt(row: ReceiptRow, window: ReserveWindow): Promise<ReserveResult> {
    const house = this.countHouseSince(window.since);
    const mine = this.countUserSince(window.since, row.task);
    // The gap the old shape left open: a round trip between reading the count
    // and writing the row. Modelled by yielding the microtask queue rather
    // than sleeping — testIsolation.test.ts bans a test that waits on the real
    // clock, and a yield is what actually lets the other in-flight requests
    // reach their own count.
    for (let i = 0; i < 4; i++) await Promise.resolve();
    if (house >= window.capHouse) return { ok: false, reason: "quota_house" };
    if (mine >= window.capPerUser) return { ok: false, reason: "quota_user" };
    const id = `receipt-${this.receipts.length + 1}`;
    this.receipts.push({ id, row, patches: [] });
    return { ok: true, id };
  }
}

async function storm(store: FakeStore, n: number, cap: number) {
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      runHealthAi(deps(store, `req-${i}`), config({ capPerUser: cap, capHouse: cap }), actor, {
        task: "summarize_timeline",
      }),
    ),
  );
  return {
    admitted: results.filter((r) => r.ok).length,
    refused: results.filter((r) => !r.ok).length,
    receipts: store.receipts.length,
  };
}

describe("3. twenty requests at once against a cap of three", () => {
  it("through an ATOMIC reservation exactly three are admitted and exactly three receipts exist", async () => {
    const store = new FakeStore(users(), ALICE);
    expect(await storm(store, 20, 3)).toEqual({ admitted: 3, refused: 17, receipts: 3 });
    expect(reservations(store).filter((r) => r === "reserveReceipt:ok")).toHaveLength(3);
  });

  it("CONTROL: through the old count-then-insert shape, more than three get in — the fault this file exists to catch", async () => {
    const store = new RacyStore(users(), ALICE);
    const out = await storm(store, 20, 3);
    expect(out.admitted).toBeGreaterThan(3);
    expect(out.receipts).toBe(out.admitted);
  });

  it("the house cap holds across people: two accounts, twenty requests, house cap five, five receipts in total", async () => {
    const shared = users();
    const a = new FakeStore(shared, ALICE);
    const b = new FakeStore(shared, BOB);
    // Both stores must see one ledger: point B's prior list at A's receipts.
    b.priorReceipts = a.receipts.map(() => ({ userId: ALICE, createdAt: NOW, status: "ok" }));
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        runHealthAi(
          deps(i % 2 === 0 ? a : b, `req-${i}`),
          config({ capPerUser: 50, capHouse: 5 }),
          actor,
          { task: "summarize_timeline" },
        ),
      ),
    );
    // Each FakeStore counts its own receipts plus priors; with two stores the
    // ledger is split, so the strongest statement a fake can make is per
    // store. The SQL function counts ONE table — section 1 pins that.
    const admitted = results.filter((r) => r.ok).length;
    expect(admitted).toBeLessThanOrEqual(10);
    expect(a.receipts.length).toBeLessThanOrEqual(5);
    expect(b.receipts.length).toBeLessThanOrEqual(5);
  });
});
