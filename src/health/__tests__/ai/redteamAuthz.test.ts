/**
 * RED TEAM — AUTHORIZATION, OWNERSHIP AND CONSENT, through the REAL gateway.
 *
 * Every test here is an attack written to assert the SAFE outcome: a
 * refusal, an exclusion, `not_found`, a closed code. A passing test is a
 * defended attack; a failing test is a real finding and is reported beside
 * this file rather than deleted from it.
 *
 * Two users share one FakeStore; the store is bound to ALICE; BOB's rows are
 * the target of every cross-user attempt. The Deno entrypoints cannot run in
 * vitest, so their ownership properties are read from source with comments
 * stripped — prose in this repo quotes the code it explains, and a guard that
 * matches prose asserts nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";
import {
  parseAiRequest,
  runHealthAi,
  type AiConfig,
  type AiRequest,
  type GatewayActor,
  type GatewayDeps,
} from "../../../../supabase/functions/_shared/health/ai/gateway";
import {
  checkGate,
  resolveEnvironment,
  ENVIRONMENTS,
  type Environment,
} from "../../../../supabase/functions/_shared/health/ai/policy";
import type { DocRow, RecordRow } from "../../../../supabase/functions/_shared/health/ai/context";
import type { HealthAIProvider } from "../../../../supabase/functions/_shared/health/ai/provider";
import type { DocumentTextSource } from "../../../../supabase/functions/_shared/health/ai/textSource";
import { allHealthFlagsOff } from "../../flagNames";
import { AI_REFUSAL_REASONS, AI_TASKS, type AiTask } from "../../ai/types";
import { FakeStore, type FakeUser } from "./fakeStore";
import { InlineTextSource } from "./inlineTextSource";

const ROOT = join(__dirname, "..", "..", "..", "..");
const NOW = "2026-09-08T12:00:00.000Z";
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALICE = u(1);
const BOB = u(2);
const BOB_SECRET = "Bob's secret HbA1c";
const BOB_DOC_TITLE = "Bob confidential discharge";

function consent(
  id: string,
  purpose: string,
  categories: string[],
  patch: Partial<{
    status: string;
    recipient: string;
    startTime: string;
    expiryTime: string | null;
    termsVersion: string;
  }> = {},
) {
  return {
    id,
    purpose,
    dataCategories: categories,
    recipient: "oniq",
    status: "active",
    startTime: "2026-09-01T00:00:00.000Z",
    expiryTime: null as string | null,
    termsVersion: purpose === "ai_interpretation" ? "health-ai-terms-v1" : "health-terms-v1",
    ...patch,
  };
}

function record(n: number, patch: Partial<RecordRow> = {}): RecordRow {
  return {
    id: u(n),
    kind: "lab",
    display: "HbA1c",
    value_num: 6.1,
    value_unit: "%",
    value_text: null,
    effective_at: `2026-0${(n % 9) + 1}-14T09:00:00.000Z`,
    status: "active",
    provenance: { source: "user_entry" },
    ...patch,
  };
}

const ALICE_DOC: DocRow = {
  id: u(100),
  kind: "lab_report",
  title: "CBC March",
  mime: "application/pdf",
  size_bytes: 1000,
  captured_at: "2026-03-14T00:00:00.000Z",
  created_at: "2026-03-15T00:00:00.000Z",
};
const BOB_DOC: DocRow = { ...ALICE_DOC, id: u(200), title: BOB_DOC_TITLE };

const ALL = ["vitals", "labs", "documents"];

function users(): Map<string, FakeUser> {
  return new Map([
    [
      ALICE,
      {
        id: ALICE,
        consents: [consent("s1", "store_records", ALL), consent("a1", "ai_interpretation", ALL)],
        records: [
          record(10),
          record(11),
          record(12, {
            kind: "vital",
            display: "Blood pressure",
            value_num: 120,
            value_unit: "mmHg",
          }),
        ],
        documents: [ALICE_DOC],
      },
    ],
    [
      BOB,
      {
        id: BOB,
        consents: [consent("s2", "store_records", ALL), consent("a2", "ai_interpretation", ALL)],
        records: [
          record(20, { display: BOB_SECRET, value_num: 9.9 }),
          record(21, {
            kind: "vital",
            display: "Blood pressure",
            value_num: 190,
            value_unit: "mmHg",
          }),
        ],
        documents: [BOB_DOC],
      },
    ],
  ]);
}

function config(patch: Partial<AiConfig> = {}): AiConfig {
  const flags = allHealthFlagsOff();
  flags["health.enabled"] = true;
  flags["health.ai.enabled"] = true;
  return {
    flags,
    environment: "staging",
    provider: "synthetic",
    model: "synthetic-v1",
    capPerUser: 10,
    capHouse: 100,
    adminVerificationEnabled: false,
    ...patch,
  };
}

const actor: GatewayActor = { isAdmin: false, isAdult: true, regionBlocked: false };

function deps(store: FakeStore, extra: Partial<GatewayDeps> = {}): GatewayDeps {
  return { store, now: NOW, requestId: u(999), textSource: null, ...extra };
}

/**
 * Every byte the ROWS hold after a run — receipts, audits, candidates,
 * document patches — the leak surface. The store's call log is the fixture's
 * own bookkeeping (it echoes the id the caller asked for), so it is not a
 * row and is asserted separately where the read itself matters.
 */
function everything(store: FakeStore): string {
  return JSON.stringify({
    receipts: store.receipts,
    audits: store.audits,
    inserted: store.inserted,
    documentPatches: store.documentPatches,
  });
}

async function spyProvider(seen: string[]): Promise<(id: unknown) => HealthAIProvider> {
  const { providerFor } = await import("../../../../supabase/functions/_shared/health/ai/provider");
  return (id) => {
    const inner = providerFor(id);
    return {
      id: inner.id,
      recipient: inner.recipient,
      synthetic: inner.synthetic,
      run(input) {
        seen.push(JSON.stringify(input));
        return inner.run(input);
      },
    };
  };
}

/** A text source that records which document ids it was asked for. */
class SpyTextSource implements DocumentTextSource {
  readonly id = "null" as const;
  readonly asked: string[] = [];
  constructor(private readonly inner: InlineTextSource) {}
  read(documentId: string) {
    this.asked.push(documentId);
    return this.inner.read(documentId);
  }
}

/* =================================================================== A == */

describe("A. another person's ids, in every slot the body has", () => {
  it("explain_record on Bob's record: not_found, no receipt, no read of Bob's kind, no Bob id anywhere", async () => {
    const store = new FakeStore(users(), ALICE);
    const r = await runHealthAi(deps(store), config(), actor, {
      task: "explain_record",
      recordId: u(20),
    });
    expect(r).toMatchObject({ ok: false, reason: "not_found" });
    expect(store.receipts.length).toBe(0);
    expect(store.log.some((l) => l.startsWith("loadActiveRecords"))).toBe(false);
    expect(everything(store)).not.toContain(u(20));
    expect(everything(store)).not.toContain(BOB_SECRET);
  });

  it("classify_document and extract_document on Bob's document: not_found, the text source is never asked, nothing inserted", async () => {
    const store = new FakeStore(users(), ALICE);
    const texts = new SpyTextSource(
      new InlineTextSource({ [BOB_DOC.id]: "Haemoglobin 9.1 g/dL", [ALICE_DOC.id]: "HbA1c 6.1 %" }),
    );
    const c = await runHealthAi(deps(store, { textSource: texts }), config(), actor, {
      task: "classify_document",
      documentId: BOB_DOC.id,
    });
    const e = await runHealthAi(deps(store, { textSource: texts }), config(), actor, {
      task: "extract_document",
      documentId: BOB_DOC.id,
    });
    expect(c).toMatchObject({ ok: false, reason: "not_found" });
    expect(e).toMatchObject({ ok: false, reason: "not_found" });
    expect(texts.asked).toEqual([]);
    expect(store.inserted.length).toBe(0);
    expect(store.documentPatches.length).toBe(0);
    expect(store.receipts.length).toBe(0);
    expect(everything(store)).not.toContain(BOB_DOC.id);
    expect(everything(store)).not.toContain(BOB_DOC_TITLE);
  });

  it("answer_question naming Bob's words: the provider sees only Alice's rows and cites only Alice's ids", async () => {
    const store = new FakeStore(users(), ALICE);
    const seen: string[] = [];
    const r = await runHealthAi(
      deps(store, { providerFor: await spyProvider(seen) }),
      config(),
      actor,
      { task: "answer_question", question: "what was the secret hba1c and blood pressure" },
    );
    expect(r.ok).toBe(true);
    expect(seen.length).toBe(1);
    // The question itself travels (scrubbed); the RECORDS the provider saw
    // must be Alice's only — Bob's display, values and ids are absent.
    expect(seen[0]).not.toContain("Bob");
    expect(seen[0]).not.toContain("9.9");
    expect(seen[0]).not.toContain("190");
    const input = JSON.parse(seen[0]) as { context: { records: Array<{ display: string }> } };
    expect(input.context.records.length).toBeGreaterThan(0);
    expect(input.context.records.every((x) => x.display !== BOB_SECRET)).toBe(true);
    if (r.ok) {
      expect(r.manifest.recordIds.every((id) => [u(10), u(11), u(12)].includes(id))).toBe(true);
      if (r.result.kind === "response") {
        for (const s of r.result.response.segments) {
          expect(s.sourceRecordIds.every((id) => [u(10), u(11), u(12)].includes(id))).toBe(true);
          expect(s.text).not.toContain("9.9");
        }
      }
    }
    expect(everything(store)).not.toContain(u(20));
    expect(everything(store)).not.toContain(u(21));
  });

  it("a foreign documentId riding on explain_record is ignored: no read, no id in any row", async () => {
    const store = new FakeStore(users(), ALICE);
    const r = await runHealthAi(deps(store), config(), actor, {
      task: "explain_record",
      recordId: u(12),
      documentId: BOB_DOC.id,
    });
    expect(r.ok).toBe(true);
    expect(store.log.some((l) => l.startsWith("loadDocument"))).toBe(false);
    expect(everything(store)).not.toContain(BOB_DOC.id);
  });

  it("a foreign recordId riding on summarize_timeline / answer_question is never read and never reaches the audit row's objectId", async () => {
    for (const task of ["summarize_timeline", "answer_question"] as const) {
      const store = new FakeStore(users(), ALICE);
      const r = await runHealthAi(deps(store), config(), actor, {
        task,
        recordId: u(20),
        question: task === "answer_question" ? "what was my hba1c" : undefined,
      });
      expect(r.ok).toBe(true);
      expect(store.log.some((l) => l.startsWith("loadRecord"))).toBe(false);
      // The audit row of an ok request must name an object the request
      // actually touched — an id in the manifest — or the account. An
      // unverified id from the body must not become an audit fact.
      const okAudit = store.audits.find((a) => a.action === "ai.request");
      expect(okAudit).toBeDefined();
      const ids = r.ok ? r.manifest.recordIds : [];
      expect(
        okAudit!.objectId === null ||
          okAudit!.objectId === undefined ||
          ids.includes(okAudit!.objectId),
        `${task}: audit objectId ${okAudit!.objectId} is not in the manifest`,
      ).toBe(true);
      expect(everything(store)).not.toContain(u(20));
    }
  });

  it("Bob, asking about Alice, gets the same not_found — symmetry, so no id is a probe", async () => {
    const store = new FakeStore(users(), BOB);
    const r = await runHealthAi(deps(store), config(), actor, {
      task: "explain_record",
      recordId: u(12),
    });
    expect(r).toMatchObject({ ok: false, reason: "not_found" });
    const missing = await runHealthAi(deps(store), config(), actor, {
      task: "explain_record",
      recordId: u(777),
    });
    expect(missing).toMatchObject({ ok: false, reason: "not_found" });
    expect(JSON.stringify(r)).toBe(JSON.stringify(missing));
  });
});

/* =================================================================== B == */

describe("B. consent shapes that must not cover", () => {
  const aiOnly = (c: ReturnType<typeof consent>) => {
    const f = users();
    f.get(ALICE)!.consents = [consent("s1", "store_records", ALL), c];
    return f;
  };

  it("a consent naming a different recipient (google_vertex) does not cover the synthetic provider", async () => {
    const store = new FakeStore(
      aiOnly(consent("a1", "ai_interpretation", ALL, { recipient: "google_vertex" })),
      ALICE,
    );
    const r = await runHealthAi(deps(store), config(), actor, { task: "summarize_timeline" });
    expect(r).toMatchObject({ ok: false, reason: "ai_consent_required" });
    expect(store.receipts.length).toBe(0);
    expect(store.log.some((l) => l.startsWith("loadActiveRecords"))).toBe(false);
  });

  it("a consent whose termsVersion never disclosed the recipient does not cover, however the recipient column reads", async () => {
    // "health-ai-terms-v2" left this list on 2026-09-09: it is the Phase 3
    // version that DOES disclose both recipients. A version that does not
    // exist yet stands in for it.
    for (const termsVersion of ["health-ai-terms-v3", "", "__proto__", "constructor", "toString"]) {
      const store = new FakeStore(
        aiOnly(consent("a1", "ai_interpretation", ALL, { termsVersion })),
        ALICE,
      );
      const r = await runHealthAi(deps(store), config(), actor, { task: "summarize_timeline" });
      expect(r, termsVersion).toMatchObject({ ok: false, reason: "ai_consent_required" });
      expect(store.receipts.length).toBe(0);
    }
  });

  it("expired, not-yet-started, status=expired and status=revoked consents all refuse before any read", async () => {
    const shapes = [
      consent("a1", "ai_interpretation", ALL, { expiryTime: "2026-09-08T11:59:59.000Z" }),
      consent("a1", "ai_interpretation", ALL, { expiryTime: NOW }),
      consent("a1", "ai_interpretation", ALL, { startTime: "2026-09-08T12:00:01.000Z" }),
      consent("a1", "ai_interpretation", ALL, { status: "expired" }),
      consent("a1", "ai_interpretation", ALL, { status: "revoked" }),
      consent("a1", "ai_interpretation", ALL, { status: "ACTIVE" }),
      consent("a1", "ai_interpretation", ALL, { startTime: "not a date" }),
    ];
    for (const c of shapes) {
      const store = new FakeStore(aiOnly(c), ALICE);
      const r = await runHealthAi(deps(store), config(), actor, { task: "summarize_timeline" });
      expect(r, JSON.stringify(c)).toMatchObject({ ok: false, reason: "ai_consent_required" });
      expect(store.log).toEqual(["loadConsents", "recordAudit:ai.refused:refused"]);
    }
  });

  it("a storage consent alone (right recipient, right terms) is not an AI consent", async () => {
    const f = users();
    f.get(ALICE)!.consents = [consent("s1", "store_records", ALL)];
    const store = new FakeStore(f, ALICE);
    for (const req of [
      { task: "summarize_timeline" },
      { task: "explain_record", recordId: u(10) },
      { task: "classify_document", documentId: ALICE_DOC.id },
    ] as AiRequest[]) {
      const r = await runHealthAi(deps(store), config(), actor, req);
      expect(r, req.task).toMatchObject({ ok: false, reason: "ai_consent_required" });
    }
    expect(store.receipts.length).toBe(0);
  });

  it("a consent covering only labs: the vital target is refused, timeline and question never load vitals", async () => {
    const store = new FakeStore(aiOnly(consent("a1", "ai_interpretation", ["labs"])), ALICE);
    const explain = await runHealthAi(deps(store), config(), actor, {
      task: "explain_record",
      recordId: u(12),
    });
    expect(explain).toMatchObject({
      ok: false,
      reason: "ai_consent_required",
      detail: { category: "vitals", recipient: "oniq" },
    });
    const seen: string[] = [];
    const q = await runHealthAi(
      deps(store, { providerFor: await spyProvider(seen) }),
      config(),
      actor,
      { task: "answer_question", question: "what is my blood pressure" },
    );
    expect(q.ok).toBe(true);
    expect(store.log).toContain("loadActiveRecords:lab:120");
    expect(store.log.some((l) => l.startsWith("loadActiveRecords") && l.includes("vital"))).toBe(
      false,
    );
    expect(seen.join("")).not.toContain("Blood pressure");
    expect(seen.join("")).not.toContain("120");
    if (q.ok) expect(q.manifest.recordIds).not.toContain(u(12));
    expect(everything(store)).not.toContain(u(12));
  });

  it("extraction needs store_records for EACH extractable category — labs missing, then vitals missing", async () => {
    for (const [have, missing] of [
      [["vitals", "documents"], "labs"],
      [["labs", "documents"], "vitals"],
    ] as const) {
      const f = users();
      f.get(ALICE)!.consents[0] = consent("s1", "store_records", [...have]);
      const store = new FakeStore(f, ALICE);
      const r = await runHealthAi(
        deps(store, {
          textSource: new InlineTextSource({ [ALICE_DOC.id]: "Haemoglobin 13.2 g/dL\nBP 120/80" }),
        }),
        config(),
        actor,
        { task: "extract_document", documentId: ALICE_DOC.id },
      );
      expect(r, missing).toMatchObject({
        ok: false,
        reason: "consent_required",
        detail: { purpose: "store_records", category: missing },
      });
      expect(store.inserted.length).toBe(0);
      expect(store.receipts.length).toBe(0);
    }
  });

  it("a storage consent for google_vertex does not satisfy extraction's oniq storage need", async () => {
    const f = users();
    f.get(ALICE)!.consents[0] = consent("s1", "store_records", ALL, { recipient: "google_vertex" });
    const store = new FakeStore(f, ALICE);
    const r = await runHealthAi(
      deps(store, { textSource: new InlineTextSource({ [ALICE_DOC.id]: "HbA1c 6.1 %" }) }),
      config(),
      actor,
      { task: "extract_document", documentId: ALICE_DOC.id },
    );
    expect(r).toMatchObject({ ok: false, reason: "consent_required" });
    expect(store.inserted.length).toBe(0);
  });

  it("the TARGETED reads: a row is loaded to learn its category, and when that category is uncovered its content goes nowhere", async () => {
    // Design §4's "never loaded" holds for the LIST reads (the kinds are
    // derived from the consents before the query). A targeted read cannot
    // know a row's category without the row, so the row is loaded, the
    // refusal names the category — and the row's content reaches no
    // provider, no manifest, no receipt and no audit row. That is the
    // property that matters, and it is what is asserted.
    const labsOnly = new FakeStore(aiOnly(consent("a1", "ai_interpretation", ["labs"])), ALICE);
    const seen: string[] = [];
    const explain = await runHealthAi(
      deps(labsOnly, { providerFor: await spyProvider(seen) }),
      config(),
      actor,
      { task: "explain_record", recordId: u(12) },
    );
    expect(explain).toMatchObject({
      ok: false,
      reason: "ai_consent_required",
      detail: { category: "vitals" },
    });
    expect(explain.ok ? "" : JSON.stringify(explain.manifest ?? null)).not.toContain(u(12));
    expect(seen).toEqual([]);
    expect(labsOnly.receipts).toEqual([]);
    expect(labsOnly.log.some((l) => l.startsWith("loadActiveRecords"))).toBe(false);
    expect(everything(labsOnly)).not.toMatch(/Blood pressure|120|mmHg/);

    const noDocs = new FakeStore(
      aiOnly(consent("a1", "ai_interpretation", ["labs", "vitals"])),
      ALICE,
    );
    const classify = await runHealthAi(
      deps(noDocs, {
        providerFor: await spyProvider(seen),
        textSource: new InlineTextSource({ [ALICE_DOC.id]: "Haemoglobin 13.2 g/dL" }),
      }),
      config(),
      actor,
      { task: "classify_document", documentId: ALICE_DOC.id },
    );
    expect(classify).toMatchObject({
      ok: false,
      reason: "ai_consent_required",
      detail: { category: "documents" },
    });
    expect(seen).toEqual([]);
    expect(noDocs.receipts).toEqual([]);
    expect(noDocs.documentPatches).toEqual([]);
    expect(everything(noDocs)).not.toMatch(/CBC March|Haemoglobin/);
  });
});

/* =================================================================== C == */

describe("C. record and document status as a target", () => {
  it("a candidate, rejected, deleted or entered_in_error record is not an explain_record target", async () => {
    for (const status of ["candidate", "rejected", "deleted", "entered_in_error"]) {
      const f = users();
      f.get(ALICE)!.records.push(record(30, { status, display: "Not yet confirmed" }));
      const store = new FakeStore(f, ALICE);
      const r = await runHealthAi(deps(store), config(), actor, {
        task: "explain_record",
        recordId: u(30),
      });
      expect(r, status).toMatchObject({ ok: false, reason: "not_found" });
      expect(store.receipts.length).toBe(0);
      expect(everything(store)).not.toContain("Not yet confirmed");
    }
  });

  it("even when the store leaks non-active rows, the gateway drops them from every context", async () => {
    class LeakyStore extends FakeStore {
      constructor(
        private readonly all: Map<string, FakeUser>,
        id: string,
      ) {
        super(all, id);
      }
      override loadActiveRecords(kinds: readonly string[], limit: number) {
        this.log.push(`loadActiveRecords:${[...kinds].join(",")}:${limit}`);
        return Promise.resolve(
          this.all
            .get(ALICE)!
            .records.filter((r) => kinds.includes(r.kind))
            .slice(0, limit),
        );
      }
    }
    const f = users();
    f.get(ALICE)!.records.push(
      record(31, { status: "candidate", display: "Candidate HbA1c", value_num: 7.7 }),
      record(32, { status: "deleted", display: "Deleted HbA1c", value_num: 8.8 }),
      record(33, { status: "rejected", display: "Rejected HbA1c", value_num: 5.5 }),
    );
    const store = new LeakyStore(f, ALICE);
    const seen: string[] = [];
    for (const req of [
      { task: "summarize_timeline" },
      { task: "explain_record", recordId: u(10) },
      { task: "answer_question", question: "my hba1c" },
    ] as AiRequest[]) {
      const r = await runHealthAi(
        deps(store, { providerFor: await spyProvider(seen) }),
        config(),
        actor,
        req,
      );
      expect(r.ok, req.task).toBe(true);
      if (r.ok) {
        expect(r.manifest.recordIds).not.toContain(u(31));
        expect(r.manifest.recordIds).not.toContain(u(32));
        expect(r.manifest.recordIds).not.toContain(u(33));
      }
    }
    expect(seen.join("")).not.toMatch(/Candidate|Deleted|Rejected|7\.7|8\.8|5\.5/);
  });

  it("a document in pending_upload or deleted status is not a classify/extract target at the GATEWAY layer", async () => {
    for (const status of ["pending_upload", "deleted"]) {
      const f = users();
      const doc = { ...ALICE_DOC, id: u(101), title: `Doc ${status}`, status } as DocRow;
      f.get(ALICE)!.documents.push(doc);
      const store = new FakeStore(f, ALICE);
      const r = await runHealthAi(
        deps(store, { textSource: new InlineTextSource({ [u(101)]: "HbA1c 6.1 %" }) }),
        config(),
        actor,
        { task: "classify_document", documentId: u(101) },
      );
      expect(r, `document status=${status}`).toMatchObject({ ok: false, reason: "not_found" });
      expect(store.documentPatches.length, status).toBe(0);
    }
  });

  it("the real Store filters document status on read; the real loadRecord relies on the gateway for record status", () => {
    const src = stripComments(
      readFileSync(join(ROOT, "supabase/functions/health-ai/index.ts"), "utf8"),
    );
    const method = (name: string) => {
      const start = src.indexOf(`async ${name}(`);
      expect(start, name).toBeGreaterThan(-1);
      const end = src.indexOf("\n    async ", start + 1);
      return src.slice(start, end === -1 ? undefined : end);
    };
    expect(method("loadDocument")).toContain('.in("status", ["stored", "processing", "ready"])');
    expect(method("loadDocument")).toContain('.eq("user_id", userId)');
    expect(method("loadRecord")).toContain('.eq("user_id", userId)');
    // Documented asymmetry: the gateway checks record status itself, so the
    // store need not; the gateway cannot see document status (DocRow has no
    // status field), so the store MUST. Both layers hold today.
    const gateway = stripComments(
      readFileSync(join(ROOT, "supabase/functions/_shared/health/ai/gateway.ts"), "utf8"),
    );
    expect(gateway).toContain('target.status !== "active"');
  });
});

/* =================================================================== D == */

describe("D. the gate: every actor/environment/flag combination that must refuse", () => {
  const prod = (patch: Partial<AiConfig> = {}) =>
    config({ environment: "production", adminVerificationEnabled: true, ...patch });

  it("an admin under 18 is refused in production even with verification on; an admin with no DOB is age_unverified", async () => {
    const store = new FakeStore(users(), ALICE);
    const minor = await runHealthAi(
      deps(store),
      prod(),
      { ...actor, isAdmin: true, isAdult: false },
      {
        task: "summarize_timeline",
      },
    );
    expect(minor).toMatchObject({ ok: false, reason: "minor_blocked" });
    const noDob = await runHealthAi(
      deps(store),
      prod(),
      { ...actor, isAdmin: true, isAdult: null },
      {
        task: "summarize_timeline",
      },
    );
    expect(noDob).toMatchObject({ ok: false, reason: "age_unverified" });
    // and outside production too — admin does not waive age
    const stagingMinor = await runHealthAi(
      deps(store),
      config(),
      { ...actor, isAdmin: true, isAdult: false },
      { task: "summarize_timeline" },
    );
    expect(stagingMinor).toMatchObject({ ok: false, reason: "minor_blocked" });
    expect(store.receipts.length).toBe(0);
    expect(store.log.filter((l) => !l.startsWith("recordAudit"))).toEqual([]);
  });

  it("production with the row's admin-verification switch off refuses the admin; a non-admin is refused even with it on; a blocked region beats both", async () => {
    const store = new FakeStore(users(), ALICE);
    const adminOff = await runHealthAi(
      deps(store),
      prod({ adminVerificationEnabled: false }),
      { ...actor, isAdmin: true },
      { task: "summarize_timeline" },
    );
    expect(adminOff).toMatchObject({ ok: false, reason: "synthetic_in_production" });
    const userOn = await runHealthAi(deps(store), prod(), actor, { task: "summarize_timeline" });
    expect(userOn).toMatchObject({ ok: false, reason: "synthetic_in_production" });
    const adminBlocked = await runHealthAi(
      deps(store),
      prod(),
      { ...actor, isAdmin: true, regionBlocked: true },
      { task: "summarize_timeline" },
    );
    expect(adminBlocked).toMatchObject({ ok: false, reason: "region_blocked" });
    expect(store.receipts.length).toBe(0);
  });

  it("flags: either switch off is ai_disabled; an empty or foreign flags object is off; provider_sharing on changes nothing for synthetic", async () => {
    const store = new FakeStore(users(), ALICE);
    const onlyHealth = allHealthFlagsOff();
    onlyHealth["health.enabled"] = true;
    const onlyAi = allHealthFlagsOff();
    onlyAi["health.ai.enabled"] = true;
    for (const flags of [onlyHealth, onlyAi, allHealthFlagsOff(), {} as never, null as never]) {
      const r = await runHealthAi(deps(store), config({ flags }), actor, {
        task: "summarize_timeline",
      }).catch((e: unknown) => ({ ok: false, reason: "threw", e }));
      expect(r).toMatchObject({ ok: false });
      expect(["ai_disabled", "threw"]).toContain((r as { reason: string }).reason);
    }
    expect(store.receipts.length).toBe(0);
    const sharing = config();
    sharing.flags["health.provider_sharing.enabled"] = true;
    const r = await runHealthAi(deps(store), sharing, actor, { task: "summarize_timeline" });
    expect(r.ok).toBe(true);
  });

  it("provider and model outside the registry/allowlist are refused before any row is read", async () => {
    const store = new FakeStore(users(), ALICE);
    for (const provider of [
      "vertex",
      "gemini",
      "medgemma",
      "google_vertex",
      "",
      null,
      undefined,
      1,
    ]) {
      const r = await runHealthAi(deps(store), config({ provider }), actor, {
        task: "summarize_timeline",
      });
      expect(r, String(provider)).toMatchObject({ ok: false, reason: "provider_not_allowed" });
    }
    for (const model of ["synthetic-v2", "gemini-2.5-flash", "", null, ["synthetic-v1"]]) {
      const r = await runHealthAi(deps(store), config({ model }), actor, {
        task: "summarize_timeline",
      });
      expect(r, String(model)).toMatchObject({ ok: false, reason: "model_not_allowed" });
    }
    for (const caps of [
      { capPerUser: 0 },
      { capHouse: 0 },
      { capPerUser: -1 },
      { capHouse: Number.NaN },
      { capPerUser: Number.POSITIVE_INFINITY },
    ]) {
      const r = await runHealthAi(deps(store), config(caps), actor, { task: "summarize_timeline" });
      expect(r, JSON.stringify(caps)).toMatchObject({ ok: false, reason: "caps_unset" });
    }
    expect(store.receipts.length).toBe(0);
    expect(store.log.every((l) => l.startsWith("recordAudit:ai.refused"))).toBe(true);
  });

  it("a provider or task that is not a STRING is refused at the gate before any row is read, even when String() of it is an allowed name", async () => {
    // The gate validates with `AI_TASKS.includes(String(x))` /
    // `PROVIDER_IDS.includes(String(x))` and then keeps the RAW value, so
    // ["synthetic"] and { toString: () => "synthetic" } pass the name check.
    for (const provider of [["synthetic"], { toString: () => "synthetic" }]) {
      const store = new FakeStore(users(), ALICE);
      const r = await runHealthAi(deps(store), config({ provider }), actor, {
        task: "summarize_timeline",
      });
      expect(r, `provider=${JSON.stringify(provider)}`).toMatchObject({
        ok: false,
        reason: "provider_not_allowed",
      });
      expect(store.receipts.length, "a receipt was written for a non-string provider").toBe(0);
      expect(store.log.some((l) => l.startsWith("loadActiveRecords"))).toBe(false);
    }
    const g = checkGate({
      flags: config().flags,
      environment: "staging",
      actor: { isAdmin: false, isAdult: true },
      adminVerificationEnabled: false,
      regionBlocked: false,
      providerId: "synthetic",
      model: "synthetic-v1",
      task: ["explain_record"],
      capPerUser: 1,
      capHouse: 1,
    });
    expect(g.allowed, "checkGate allowed an ARRAY task").toBe(false);
  });

  it("a task outside AI_TASKS, including __proto__ and constructor, is task_not_allowed", async () => {
    const store = new FakeStore(users(), ALICE);
    for (const task of [
      "__proto__",
      "constructor",
      "toString",
      "diagnose",
      "",
      "SUMMARIZE_TIMELINE",
    ]) {
      const r = await runHealthAi(deps(store), config(), actor, { task: task as AiTask });
      expect(r, task).toMatchObject({ ok: false, reason: "task_not_allowed" });
    }
    expect(store.receipts.length).toBe(0);
  });

  it("an environment string outside ENVIRONMENTS fails CLOSED at the gate, as it does in resolveEnvironment", async () => {
    for (const bad of ["Production", "prod", "", "PRODUCTION", "production "]) {
      expect(resolveEnvironment(bad, undefined), bad).toBe("production");
      expect(resolveEnvironment("staging", `https://bqwttemnnoexadpwifcj.supabase.co`)).toBe(
        "production",
      );
    }
    for (const bad of ["Production", "prod", "", "PRODUCTION", "production "]) {
      const store = new FakeStore(users(), ALICE);
      const r = await runHealthAi(deps(store), config({ environment: bad as Environment }), actor, {
        task: "summarize_timeline",
      });
      expect(r, `environment=${JSON.stringify(bad)}`).toMatchObject({
        ok: false,
        reason: "synthetic_in_production",
      });
    }
    expect(ENVIRONMENTS).toEqual(["production", "staging", "development"]);
  });

  it("every refusal reason the gate can return is a closed code", () => {
    const gate = checkGate({
      flags: config().flags,
      environment: "staging",
      actor: { isAdmin: false, isAdult: true },
      adminVerificationEnabled: false,
      regionBlocked: false,
      providerId: "synthetic",
      model: "synthetic-v1",
      task: "summarize_timeline",
      capPerUser: 1,
      capHouse: 1,
    });
    expect(gate.allowed).toBe(true);
    for (const task of AI_TASKS) expect(AI_TASKS).toContain(task);
    expect(AI_REFUSAL_REASONS).toContain("synthetic_in_production");
  });
});

/* =================================================================== E == */

describe("E. parseAiRequest: prototype shapes, arrays, coercion, case", () => {
  it("__proto__ / constructor keys, arrays and extra keys are refused, and Object.prototype stays clean", () => {
    const before = Object.keys(Object.prototype).length;
    const bodies = [
      JSON.parse('{"__proto__":{"isAdmin":true},"task":"summarize_timeline"}'),
      JSON.parse('{"constructor":{"prototype":{"x":1}},"task":"summarize_timeline"}'),
      JSON.parse('{"task":"summarize_timeline","userId":"' + BOB + '"}'),
      JSON.parse('{"task":"summarize_timeline","user_id":"' + BOB + '"}'),
      JSON.parse('{"task":"explain_record","recordId":"' + u(20) + '","text":"x"}'),
      [],
      [{ task: "summarize_timeline" }],
      "summarize_timeline",
      42,
      true,
    ];
    for (const b of bodies) expect(parseAiRequest(b).ok, JSON.stringify(b)).toBe(false);
    expect(Object.keys(Object.prototype).length).toBe(before);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  it("task and language are accepted only as the exact strings — never an array or object that stringifies to one", async () => {
    expect(parseAiRequest({ task: "__proto__" }).ok).toBe(false);
    // A JSON body can carry an array. What happens if it is accepted is
    // measured here so the finding names the consequence, not a guess.
    const arr = parseAiRequest(JSON.parse('{"task":["summarize_timeline"],"language":["hi"]}'));
    if (arr.ok) {
      const store = new FakeStore(users(), ALICE);
      const r = await runHealthAi(deps(store), config(), actor, arr.request);
      // Whatever it did, no record content may have reached the output.
      expect(r.ok).toBe(false);
      expect(store.receipts.length).toBe(1);
      expect(Array.isArray(store.receipts[0].row.task)).toBe(true);
    }
    expect(arr.ok, 'parseAiRequest accepted task: ["summarize_timeline"]').toBe(false);
    expect(parseAiRequest({ task: { toString: () => "summarize_timeline" } }).ok).toBe(false);
    expect(parseAiRequest({ task: "summarize_timeline", language: ["en"] }).ok).toBe(false);
    expect(parseAiRequest({ task: "summarize_timeline", language: "EN" }).ok).toBe(false);
    expect(parseAiRequest({ task: "summarize_timeline", language: "en " }).ok).toBe(false);
    expect(parseAiRequest({ task: "summarize_timeline", language: null }).ok).toBe(false);
    expect(parseAiRequest({ task: "summarize_timeline", language: "en" }).ok).toBe(true);
  });

  it("ids: uppercase hex is not an escape — an uppercase own id answers not_found, a foreign one too; non-string ids are refused", async () => {
    // The default fixture ids carry no hex letters, so toUpperCase() would be
    // a no-op; these two do.
    const ALICE_HEX = "abcdefab-cdef-4abc-8abc-abcdefabcdef";
    const BOB_HEX = "bbbbbbbb-cdef-4abc-8abc-abcdefabcdef";
    const f = users();
    f.get(ALICE)!.records.push(record(40, { id: ALICE_HEX, display: "Alice hex" }));
    f.get(BOB)!.records.push(record(41, { id: BOB_HEX, display: "Bob hex secret" }));
    expect(ALICE_HEX.toUpperCase()).not.toBe(ALICE_HEX);
    for (const bad of [
      BOB_HEX.toUpperCase(),
      BOB_HEX,
      20,
      { id: BOB_HEX },
      [BOB_HEX],
      "not-a-uuid",
      BOB_HEX + "x",
    ]) {
      const parsed = parseAiRequest({ task: "explain_record", recordId: bad });
      if (parsed.ok) {
        const store = new FakeStore(f, ALICE);
        const r = await runHealthAi(deps(store), config(), actor, parsed.request);
        expect(r, String(bad)).toMatchObject({ ok: false, reason: "not_found" });
        expect(everything(store)).not.toContain("Bob hex secret");
      } else {
        expect(typeof bad === "string" && /^[0-9a-f-]{36}$/i.test(bad), String(bad)).toBe(false);
      }
    }
    const upperOwn = parseAiRequest({ task: "explain_record", recordId: ALICE_HEX.toUpperCase() });
    expect(upperOwn.ok).toBe(true);
    const store = new FakeStore(f, ALICE);
    const r = await runHealthAi(
      deps(store),
      config(),
      actor,
      (upperOwn as { request: AiRequest }).request,
    );
    // Measured: parse accepts (the UUID regex is /i) a case the pipeline's
    // exact-match lookups cannot serve, so an uppercase OWN id answers
    // not_found. Safe (nothing foreign is reachable); noted as a quirk.
    expect(r).toMatchObject({ ok: false, reason: "not_found" });
    const lowerOwn = await runHealthAi(deps(new FakeStore(f, ALICE)), config(), actor, {
      task: "explain_record",
      recordId: ALICE_HEX,
    });
    expect(lowerOwn.ok).toBe(true);
  });
});

/* =================================================================== F == */

describe("F. health-api and health-ai, read from source with comments stripped", () => {
  const API = stripComments(
    readFileSync(join(ROOT, "supabase/functions/health-api/index.ts"), "utf8"),
  );
  const AI = stripComments(
    readFileSync(join(ROOT, "supabase/functions/health-ai/index.ts"), "utf8"),
  );

  /** Each `.from("health_…")` chain up to its terminating `;`. */
  function chains(src: string): Array<{ table: string; text: string }> {
    const out: Array<{ table: string; text: string }> = [];
    const re = /\.from\("(health_\w+)"\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const end = src.indexOf(";", m.index);
      out.push({ table: m[1], text: src.slice(m.index, end === -1 ? undefined : end) });
    }
    return out;
  }

  it("every health-table query in health-api carries the caller's id — no exceptions but the shared policy table", () => {
    const qs = chains(API);
    expect(qs.length).toBeGreaterThanOrEqual(25);
    let configWrites = 0;
    for (const q of qs) {
      if (q.table === "health_retention_policies") continue;
      // The shared policy row has no owner. Its writes in this function are the
      // emergency stop and the caps (owner directive 2026-09-08), admitted here
      // only because both sit behind the server-side is_admin gate —
      // wiring.test.ts pins gate-before-update for each. Exactly these two; a
      // third health_config chain must earn its own line.
      if (q.table === "health_config") {
        expect(
          q.text.includes(".update({ ai_kill_switch: on })") || q.text.includes(".update(patch)"),
          q.text.slice(0, 120),
        ).toBe(true);
        expect(q.text).toContain('.eq("id", true)');
        configWrites++;
        continue;
      }
      expect(
        q.text.includes('.eq("user_id", ctx.userId)') || q.text.includes("user_id: ctx.userId"),
        `${q.table}: ${q.text.slice(0, 120)}`,
      ).toBe(true);
    }
    expect(configWrites).toBe(2);
    // The status counts go through a helper that applies the filter itself.
    expect(API).toContain('await q.eq("user_id", ctx.userId)');
  });

  it("no user id is ever read from the body in either function", () => {
    for (const src of [API, AI]) {
      expect(src).not.toMatch(/body\.(user_?[iI]d|uid|owner|actor|sub)\b/);
      expect(src).not.toMatch(/body\["user/);
    }
    // The id comes from the verified JWT and nowhere else.
    expect(API).toMatch(/userId: user\.id/);
    expect(AI).toMatch(/makeStore\(admin, user\.id,/);
    expect(API).not.toMatch(/\.eq\("user_id",\s*(body|String\(body)/);
    expect(AI).not.toMatch(/\.eq\("user_id",\s*(body|String\(body|parsed)/);
  });

  it("candidates, confirm and reject are scoped to the caller AND to status=candidate; confirm sits behind the AI flag and the storage consent", () => {
    const fn = (name: string) => {
      const start = API.indexOf(`async function ${name}(`);
      expect(start, name).toBeGreaterThan(-1);
      const end = API.indexOf("\nasync function ", start + 1);
      return API.slice(start, end === -1 ? undefined : end);
    };
    const cands = fn("actRecordsCandidates");
    expect(cands).toContain('.eq("user_id", ctx.userId)');
    expect(cands).toContain('.eq("status", "candidate")');
    const reject = fn("actRecordsReject");
    expect(reject).toContain('.eq("user_id", ctx.userId)');
    expect(reject).toContain('.eq("status", "candidate")');
    expect(reject).toContain('status: "rejected"');
    const confirm = fn("actRecordsConfirm");
    expect(confirm.match(/\.eq\("user_id", ctx\.userId\)/g)?.length).toBe(2);
    expect(confirm.match(/\.eq\("status", "candidate"\)/g)?.length).toBe(2);
    expect(confirm.indexOf('flags["health.ai.enabled"]')).toBeLessThan(confirm.indexOf(".from("));
    expect(confirm).toContain('requireConsent(ctx, "store_records", category)');
    expect(confirm.indexOf("requireConsent(")).toBeLessThan(confirm.indexOf('status: "active"'));
    expect(confirm).toContain('verifiedBy: "user"');
  });

  it("purge: the legal hold is checked BEFORE any write, receipts are marked (never deleted) and scoped, and the hold check does not fail open on an rpc error", () => {
    const start = API.indexOf("async function actPurge(");
    const purge = API.slice(
      start,
      API.indexOf("\nasync function ", start + 1) === -1
        ? undefined
        : API.indexOf("\ntype Handler"),
    );
    const hold = purge.indexOf('rpc("has_active_legal_hold"');
    expect(hold).toBeGreaterThan(-1);
    expect(hold).toBeLessThan(purge.indexOf(".update("));
    expect(purge).toContain('reason: "legal_hold"');
    // No HEALTH table is ever deleted from — rows are marked. (The person's
    // own health_ai_output rows in public.reports are the one delete, by
    // design: the domain's purge removes its single trace outside itself.)
    expect(purge).not.toMatch(/from\("health_[a-z_]+"\)\s*\.delete\(/);
    expect(purge).toMatch(
      /from\("reports"\)\s*\.delete\(\)\s*\.eq\("reporter_id", ctx\.userId\)\s*\.eq\("target_type", "health_ai_output"\)/,
    );
    const receipts = purge.slice(purge.indexOf('.from("health_ai_requests")'));
    expect(receipts).toContain("purged_at: ctx.now");
    expect(receipts).toContain('.eq("user_id", ctx.userId)');
    expect(receipts).toContain('.is("purged_at", null)');
    // A hold check whose rpc errored must refuse, not proceed: the `error`
    // half of the rpc result has to be read.
    const holdLine = purge.slice(hold - 80, hold + 80);
    expect(
      /error/.test(holdLine),
      "actPurge ignores the rpc error: `const { data: held } = await ctx.admin.rpc(...)` — an rpc failure reads as 'not held' and the purge proceeds",
    ).toBe(true);
  });

  it("status.aiAvailable agrees with the gate: it must weigh everything the gate weighs before saying 'available'", () => {
    const start = API.indexOf("async function aiAvailability(");
    const fn = API.slice(start, API.indexOf("\nasync function ", start + 1));
    // Things the gate refuses on that a truthful availability must consider.
    expect(fn).toContain('flags["health.ai.enabled"]');
    expect(fn).toContain("isProviderId(");
    expect(fn).toContain("resolveEnvironment(");
    expect(fn).toContain("ai_admin_verification_enabled");
    expect(
      /modelAllowed\(|ai_model/.test(fn),
      "aiAvailability never looks at ai_model: a row with an unlisted model reports aiAvailable=true while every call refuses model_not_allowed",
    ).toBe(true);
    expect(
      /is_adult_18|date_of_birth|isAdult/.test(fn),
      "aiAvailability never looks at age: an account with no DOB or under 18 reports aiAvailable=true while every call refuses age_unverified/minor_blocked",
    ).toBe(true);
  });

  it("health-ai reads the admin bit and the age from the server, never from the body, and fails closed on either rpc", () => {
    const serve = AI.slice(AI.indexOf("Deno.serve("));
    expect(serve).toContain('rpc("is_admin", { _uid: user.id })');
    expect(serve).toContain("isAdmin: isAdmin === true");
    expect(serve).toContain("isAdult = adult === true");
    expect(serve).toContain("let isAdult: boolean | null = null");
    expect(serve).not.toMatch(/isAdmin:\s*(body|parsed)/);
    expect(serve).not.toMatch(/isAdult\s*=\s*(body|parsed)/);
  });
});
