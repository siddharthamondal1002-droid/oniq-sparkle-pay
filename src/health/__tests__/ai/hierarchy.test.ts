/**
 * THE ENFORCEMENT HIERARCHY — Phase 4 (owner directive 2026-09-09, §8):
 *
 *   kill switch → AI flag → configuration validity → house cap →
 *   operation cap → provider
 *
 * Each rung is proven to WIN over everything below it by mutating one input
 * at a time against the real `flagsFromRow`, `checkGate` and `runHealthAi`:
 * a kill switch that is on refuses whatever the AI flag says; an AI flag that
 * is off refuses whatever the configuration says; an invalid configuration
 * refuses before any cap is read; the house cap refuses before the person's;
 * and the provider is never constructed, let alone run, on any refusal.
 * "Zero means unavailable, never unlimited" is the last rung of the
 * configuration check, on both caps, at the gate AND in the reservation.
 */
import { describe, expect, it } from "vitest";
import { flagsFromRow } from "../../../../supabase/functions/_shared/health/flags";
import { checkGate, type GateInput } from "../../../../supabase/functions/_shared/health/ai/policy";
import {
  runHealthAi,
  type AiConfig,
  type GatewayActor,
  type GatewayDeps,
  type Store,
} from "../../../../supabase/functions/_shared/health/ai/gateway";
import type { RecordRow } from "../../../../supabase/functions/_shared/health/ai/context";
import { FakeStore, reservations, type FakeUser } from "./fakeStore";

const NOW = "2026-09-09T12:00:00.000Z";
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALICE = u(1);

/** The production row as it stands, every switch the owner set (docs/health/07). */
function row(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: true,
    enabled: true,
    uploads_enabled: true,
    ai_enabled: true,
    ai_kill_switch: false,
    provider_sharing_enabled: true,
    ai_provider: "vertex",
    ai_model: "gemini-3.1-flash-lite",
    ai_daily_cap_house: 500,
    ai_daily_caps: {
      answer_question: 10,
      explain_record: 5,
      summarize_timeline: 3,
      classify_document: 10,
      extract_document: 10,
    },
    ai_admin_verification_enabled: true,
    environment: "production",
    ...patch,
  };
}

function gateInput(r: Record<string, unknown>, patch: Partial<GateInput> = {}): GateInput {
  return {
    flags: flagsFromRow(r),
    environment: "production",
    actor: { isAdmin: false, isAdult: true },
    adminVerificationEnabled: r.ai_admin_verification_enabled === true,
    regionBlocked: false,
    providerId: r.ai_provider,
    model: r.ai_model,
    task: "summarize_timeline",
    capPerUser: 3,
    capHouse: Number(r.ai_daily_cap_house),
    ...patch,
  };
}

describe("rung 1: the kill switch beats everything", () => {
  it("with every other switch on, the kill switch alone makes the gate answer ai_disabled", () => {
    expect(checkGate(gateInput(row())).allowed).toBe(true);
    const killed = gateInput(row({ ai_kill_switch: true }));
    expect(killed.flags["health.ai.enabled"]).toBe(false);
    expect(killed.flags["health.provider_sharing.enabled"]).toBe(false);
    expect(checkGate(killed)).toEqual({ allowed: false, reason: "ai_disabled" });
  });

  it("the kill switch wins over a valid configuration, open caps, an admin, and any task", () => {
    for (const task of [
      "summarize_timeline",
      "answer_question",
      "explain_record",
      "classify_document",
      "extract_document",
    ]) {
      const g = gateInput(row({ ai_kill_switch: true }), {
        task,
        actor: { isAdmin: true, isAdult: true },
        capPerUser: 1000,
        capHouse: 1000,
      });
      expect(checkGate(g), task).toEqual({ allowed: false, reason: "ai_disabled" });
    }
  });

  it("only the boolean true is a kill; 'true', 1 and 'on' leave the switch off (a string in the column is not a stop)", () => {
    for (const v of ["true", 1, "on", "yes"]) {
      expect(flagsFromRow(row({ ai_kill_switch: v }))["health.ai.enabled"], String(v)).toBe(true);
    }
  });
});

describe("rung 2: the AI flag beats the configuration", () => {
  it("ai_enabled false refuses ai_disabled even with a broken provider, model or cap — the configuration is never inspected", () => {
    const g = gateInput(
      row({ ai_enabled: false, ai_provider: "nonsense", ai_model: "", ai_daily_cap_house: 0 }),
      {
        capPerUser: 0,
        capHouse: 0,
      },
    );
    expect(checkGate(g)).toEqual({ allowed: false, reason: "ai_disabled" });
  });

  it("the master switch off is ai_disabled too, whatever ai_enabled says", () => {
    expect(checkGate(gateInput(row({ enabled: false })))).toEqual({
      allowed: false,
      reason: "ai_disabled",
    });
  });
});

describe("rung 3: configuration validity beats the caps", () => {
  it("an unknown provider, an unlisted model, a missing price and sharing off each refuse before a cap is looked at", () => {
    const cases: Array<[Partial<GateInput>, string]> = [
      [{ providerId: "anthropic" }, "provider_not_allowed"],
      [{ providerId: undefined }, "provider_not_allowed"],
      [{ model: "gemini-2.0-pro" }, "model_not_allowed"],
      [{ model: undefined }, "model_not_allowed"],
      [{ flags: flagsFromRow(row({ provider_sharing_enabled: false })) }, "provider_not_allowed"],
    ];
    for (const [patch, reason] of cases) {
      // Caps that would refuse on their own — the configuration must speak first.
      const g = gateInput(row(), { ...patch, capPerUser: 0, capHouse: 0 });
      expect(checkGate(g), JSON.stringify(patch)).toMatchObject({ allowed: false, reason });
    }
  });

  it("zero on either cap is caps_unset — the last configuration rung — before region, age or environment", () => {
    for (const patch of [
      { capHouse: 0 },
      { capPerUser: 0 },
      { capHouse: -1 },
      { capPerUser: Number.NaN },
    ]) {
      const g = gateInput(row(), {
        ...patch,
        regionBlocked: true,
        actor: { isAdmin: false, isAdult: null },
      });
      expect(checkGate(g), JSON.stringify(patch)).toEqual({ allowed: false, reason: "caps_unset" });
    }
  });
});

/* ---------------------------------------------------- rungs 4–6, live -- */

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

function alice(): Map<string, FakeUser> {
  return new Map([
    [
      ALICE,
      {
        id: ALICE,
        consents: [
          consent("s1", "store_records", ["labs"]),
          consent("a1", "ai_interpretation", ["labs"]),
        ],
        records: [record(10)],
        documents: [],
      },
    ],
  ]);
}

function config(r: Record<string, unknown>, patch: Partial<AiConfig> = {}): AiConfig {
  return {
    flags: flagsFromRow(r),
    environment: "development",
    provider: "synthetic",
    model: "synthetic-v1",
    capPerUser: 3,
    capHouse: 500,
    adminVerificationEnabled: false,
    ...patch,
  };
}

const actor: GatewayActor = { isAdmin: false, isAdult: true, regionBlocked: false };

function deps(store: Store, onProvider: () => void): GatewayDeps {
  return {
    store,
    now: NOW,
    requestId: "req-1",
    textSource: null,
    providerFor: (id) => {
      onProvider();
      // Only reached when every rung above passed; the real registry then.
      throw new Error(`provider constructed: ${String(id)}`);
    },
  };
}

describe("rungs 4–6 through the gateway: house cap, then the person's cap, then — and only then — the provider", () => {
  it("the house cap refuses first even when the person has room, and the provider is never constructed", async () => {
    const store = new FakeStore(alice(), ALICE);
    store.priorReceipts = Array.from({ length: 5 }, () => ({
      userId: u(9),
      createdAt: NOW,
      status: "ok",
    }));
    let constructed = 0;
    const r = await runHealthAi(
      deps(store, () => constructed++),
      config(row(), { capHouse: 5, capPerUser: 3 }),
      actor,
      { task: "summarize_timeline" },
    );
    expect(r).toMatchObject({ ok: false, reason: "quota_house" });
    expect(reservations(store)).toEqual(["reserveReceipt:quota_house"]);
    expect(constructed).toBe(0);
  });

  it("the person's cap refuses next, and the provider is still never constructed", async () => {
    const store = new FakeStore(alice(), ALICE);
    store.priorReceipts = Array.from({ length: 3 }, () => ({
      userId: ALICE,
      createdAt: NOW,
      status: "refused",
      task: "summarize_timeline",
    }));
    let constructed = 0;
    const r = await runHealthAi(
      deps(store, () => constructed++),
      config(row(), { capHouse: 500, capPerUser: 3 }),
      actor,
      { task: "summarize_timeline" },
    );
    expect(r).toMatchObject({ ok: false, reason: "quota_user" });
    expect(reservations(store)).toEqual(["reserveReceipt:quota_user"]);
    expect(constructed).toBe(0);
  });

  it("with every rung open the provider is constructed AFTER the receipt exists, and a throw there completes it as an error", async () => {
    const store = new FakeStore(alice(), ALICE);
    let constructed = 0;
    const r = await runHealthAi(
      deps(store, () => {
        constructed++;
        store.log.push("provider.construct");
      }),
      config(row()),
      actor,
      { task: "summarize_timeline" },
    );
    expect(constructed).toBe(1);
    expect(store.log.indexOf("reserveReceipt:ok")).toBeLessThan(
      store.log.indexOf("provider.construct"),
    );
    expect(r).toMatchObject({ ok: false, reason: "provider_error" });
    expect(store.receipts[0].patches.at(-1)?.status).toBe("error");
  });

  it("every refusal above the provider leaves exactly one ai.refused audit row and no receipt — the kill switch included", async () => {
    for (const [name, cfg] of [
      ["kill switch", config(row({ ai_kill_switch: true }))],
      ["ai flag", config(row({ ai_enabled: false }))],
      ["bad provider", config(row(), { provider: "anthropic" })],
      ["zero cap", config(row(), { capHouse: 0 })],
    ] as const) {
      const store = new FakeStore(alice(), ALICE);
      let constructed = 0;
      const r = await runHealthAi(
        deps(store, () => constructed++),
        cfg,
        actor,
        {
          task: "summarize_timeline",
        },
      );
      expect(r.ok, name).toBe(false);
      expect(store.receipts, name).toHaveLength(0);
      expect(
        store.audits.map((a) => a.action),
        name,
      ).toEqual(["ai.refused"]);
      expect(constructed, name).toBe(0);
    }
  });
});
