/**
 * A Store for the gateway tests. Two properties make it worth more than a
 * mock: it holds TWO users' rows and can only ever see one of them (the
 * gateway never passes a user id, so cross-user reads are impossible by
 * construction), and it keeps an ORDERED log of every call, so the tests can
 * assert that the receipt is written before the provider runs and that the
 * cap counts never asked about status.
 */
import type { ConsentLike } from "../../consent";
import type { DocRow, RecordRow } from "../../../../supabase/functions/_shared/health/ai/context";
import type {
  CandidateProvenance,
  GatewayAuditInput,
  ReceiptPatch,
  ReceiptRow,
  ReserveResult,
  ReserveWindow,
  Store,
} from "../../../../supabase/functions/_shared/health/ai/gateway";
import type { AiTask, CandidateRecord } from "../../ai/types";

export type FakeUser = {
  id: string;
  consents: (ConsentLike & { id: string })[];
  records: RecordRow[];
  documents: DocRow[];
};

export type Receipt = { id: string; row: ReceiptRow; patches: ReceiptPatch[] };

export class FakeStore implements Store {
  readonly log: string[] = [];
  readonly receipts: Receipt[] = [];
  readonly audits: GatewayAuditInput[] = [];
  readonly inserted: Array<{
    documentId: string;
    candidates: CandidateRecord[];
    provenance: CandidateProvenance;
  }> = [];
  readonly documentPatches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  /**
   * Extra receipts "already in the table" for the cap tests, with any status.
   * `task` is optional: absent means the receipt counts for EVERY task (the
   * pre-B11 fixtures keep their meaning); set it to prove the person's count
   * is per task while the house count is not.
   */
  priorReceipts: Array<{ userId: string; createdAt: string; status: string; task?: string }> = [];

  constructor(
    private readonly users: Map<string, FakeUser>,
    private readonly userId: string,
  ) {}

  private me(): FakeUser {
    const u = this.users.get(this.userId);
    if (!u) throw new Error("no such user in the fixture");
    return u;
  }

  loadConsents() {
    this.log.push("loadConsents");
    return Promise.resolve(this.me().consents.map((c) => ({ ...c })));
  }

  loadRecord(id: string) {
    this.log.push(`loadRecord:${id}`);
    return Promise.resolve(this.me().records.find((r) => r.id === id) ?? null);
  }

  loadActiveRecords(kinds: readonly string[], limit: number) {
    this.log.push(`loadActiveRecords:${[...kinds].join(",")}:${limit}`);
    return Promise.resolve(
      this.me()
        .records.filter((r) => (r.status ?? "active") === "active" && kinds.includes(r.kind))
        .sort((a, b) => b.effective_at.localeCompare(a.effective_at))
        .slice(0, limit),
    );
  }

  loadDocument(id: string) {
    this.log.push(`loadDocument:${id}`);
    return Promise.resolve(this.me().documents.find((d) => d.id === id) ?? null);
  }

  private allReceipts(): Array<{
    userId: string;
    createdAt: string;
    status: string;
    task?: string;
  }> {
    const own = this.receipts.map((r) => ({
      userId: this.userId,
      createdAt: "9999-01-01T00:00:00.000Z",
      status: r.patches.at(-1)?.status ?? "started",
      task: r.row.task,
    }));
    return [...this.priorReceipts, ...own];
  }

  /** The house window: every receipt, every person, every task, whatever its status. */
  countHouseSince(sinceIso: string): number {
    return this.allReceipts().filter((r) => r.createdAt >= sinceIso).length;
  }

  /** The person's window for ONE task, whatever the status. */
  countUserSince(sinceIso: string, task: AiTask): number {
    return this.allReceipts().filter(
      (r) =>
        r.userId === this.userId &&
        r.createdAt >= sinceIso &&
        (r.task === undefined || r.task === task),
    ).length;
  }

  /**
   * The same rules the SQL function health_ai_reserve_request() applies, in
   * the same order: a zero cap refuses, the house window first, then the
   * person's window for the row's task, and only then a started receipt.
   * One log entry, `reserveReceipt:<outcome>`, because the deployed step is
   * one locked transaction rather than three round trips.
   */
  reserveReceipt(row: ReceiptRow, window: ReserveWindow): Promise<ReserveResult> {
    const refuse = (reason: "quota_house" | "quota_user" | "caps_unset"): ReserveResult => {
      this.log.push(`reserveReceipt:${reason}`);
      return { ok: false, reason };
    };
    if (!(window.capHouse > 0) || !(window.capPerUser > 0))
      return Promise.resolve(refuse("caps_unset"));
    if (this.countHouseSince(window.since) >= window.capHouse) {
      return Promise.resolve(refuse("quota_house"));
    }
    if (this.countUserSince(window.since, row.task) >= window.capPerUser) {
      return Promise.resolve(refuse("quota_user"));
    }
    this.log.push("reserveReceipt:ok");
    const id = `receipt-${this.receipts.length + 1}`;
    this.receipts.push({ id, row, patches: [] });
    return Promise.resolve({ ok: true, id });
  }

  completeReceipt(id: string, patch: ReceiptPatch) {
    this.log.push(`completeReceipt:${patch.status}`);
    const r = this.receipts.find((x) => x.id === id);
    if (!r) throw new Error("unknown receipt");
    r.patches.push(patch);
    return Promise.resolve();
  }

  insertCandidates(
    documentId: string,
    candidates: CandidateRecord[],
    provenance: CandidateProvenance,
  ) {
    this.log.push(`insertCandidates:${candidates.length}`);
    this.inserted.push({ documentId, candidates, provenance });
    return Promise.resolve(candidates.length);
  }

  updateDocument(id: string, patch: Record<string, unknown>) {
    this.log.push("updateDocument");
    this.documentPatches.push({ id, patch });
    return Promise.resolve();
  }

  recordAudit(input: GatewayAuditInput) {
    this.log.push(`recordAudit:${input.action}:${input.outcome}`);
    this.audits.push(input);
    return Promise.resolve();
  }
}

/** The reservation calls a run made, in order — `reserveReceipt:ok`, `reserveReceipt:quota_house`, … */
export function reservations(store: FakeStore): string[] {
  return store.log.filter((l) => l.startsWith("reserveReceipt:"));
}
