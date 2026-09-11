/**
 * ONIQ'S EYE ON ITS OWN PRODUCTION STATE — the host half of v1.7 §2 and §3.
 *
 * §2 forbids the OBSERVER from hard-coding assumptions about ONIQ's
 * architecture, and `observe.ts` honours that: it turns whatever the host saw
 * into `Observation`s and judges nothing about which subsystems exist. THIS is
 * the host, and a host is allowed to know what it can read. What it is not
 * allowed to do is invent a reading, which is why every field of
 * `ProductionSnapshot` is nullable and a null produces NO item at all — the
 * kind then stays UNOBSERVED with the observer's own reason attached, rather
 * than becoming a fabricated healthy zero. That distinction is §3 in one line,
 * and it is the difference between "ONIQ looked and it is fine" and "ONIQ never
 * looked".
 *
 * THE READINGS ARE THE ONES THAT DIAGNOSED A REAL OUTAGE. On 2026-09-11
 * `story-dispatch` had been answering `401 Bad credentials` for six days, no
 * film had rendered since 05 Sep, and the four things that established it were
 * the dispatcher's own health row, the queued films, the client error reports
 * and the last successful run. Those are exactly the rows below. They were
 * chosen because they have already paid for themselves, not because they are a
 * complete picture — and the picture being incomplete is REPORTED rather than
 * hidden: nineteen kinds exist and this reads five of them.
 *
 * SEVERITY IS A JUDGEMENT AND IT IS MADE HERE, ONCE, WITH ITS THRESHOLDS
 * NAMED. Every constant below is stated as a threshold rather than defended as
 * principled; what is principled is the direction, which is that a reading the
 * host could not interpret is `null` (UNKNOWN — looked, cannot say) and never
 * `0` (OBSERVED and healthy). Reading a missing measurement as zero is the §3
 * failure written into the one file §3 depends on.
 *
 * AND THE SAME SNAPSHOT PRODUCES THE RESEARCH CORPUS, deliberately, so the two
 * cannot drift. A production reading IS a document: verbatim, located by the
 * query that produced it, and first-hand — which makes it the strongest
 * evidence class the substrate has, a MEASUREMENT of a system ONIQ can observe.
 * `makeLocalEvidenceResearch` then retrieves against the concept id, and the
 * concept id is `${kind}:${subject}` — so every corpus line opens with exactly
 * that string and the measured sentence follows it. Without that the retrieval
 * matches nothing, because `matches()` requires every term of the question.
 */
import type { EvidenceItem } from "./observe.ts";
import { OQCA_STATE_TABLE } from "./pgSink.ts";
import type { CorpusDocument } from "./research.ts";

/* ---------------------------------------------------------------- *
 * THE THRESHOLDS. Named, exported, and testable on their own.
 * ---------------------------------------------------------------- */

/** Consecutive dispatch failures at which the dispatcher is wholly down. */
export const DISPATCH_FAILURES_FOR_FULL_SEVERITY = 3;
/** `story-sweep`'s own stale window: past this, a queued film is late. */
export const QUEUE_STALE_MINUTES = 30;
/** `QUEUED_ABANDONED_TTL_MS` in minutes: past this the film is abandoned. */
export const QUEUE_ABANDONED_MINUTES = 360;
/** Client error reports in 24h at which a surface is wholly broken. */
export const ERRORS_FOR_FULL_SEVERITY = 50;
/**
 * Minutes without a rendered film at which the renderer is wholly down. One
 * day: the longest real wait between a film being asked for and being rendered
 * is 65 minutes, measured over the 117 films that reached `ready`.
 */
export const WORKER_SILENCE_FOR_FULL_SEVERITY = 24 * 60;

/** A reading the host took, or `null` where it could not take it. */
export type DispatchReading = {
  readonly consecutiveFailures: number;
  readonly lastOkAt: string | null;
  readonly lastError: string | null;
};

export type QueueReading = {
  readonly queued: number;
  /** Age of the OLDEST queued film, in minutes. Null when the queue is empty. */
  readonly oldestMinutes: number | null;
};

export type ErrorSurfaceReading = {
  readonly surface: string;
  readonly reports: number;
};

export type WorkerReading = {
  /** Minutes since the most recent film reached `ready`, or null if none ever has. */
  readonly sinceLastReadyMinutes: number | null;
  readonly readyInWindow: number;
};

export type DurableReading = {
  readonly records: number;
};

/**
 * WHAT THE HOST MANAGED TO READ. Every field nullable, and a null is "this read
 * did not happen or did not come back" — never "and it was fine".
 */
export type ProductionSnapshot = {
  readonly at: string;
  readonly dispatch: DispatchReading | null;
  readonly queue: QueueReading | null;
  readonly errorSurfaces: readonly ErrorSurfaceReading[] | null;
  readonly worker: WorkerReading | null;
  readonly durable: DurableReading | null;
};

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * ONE READING, IN BOTH SHAPES. The evidence item is what the observer judges;
 * the corpus line is what research may retrieve and promote. They are built
 * together from the same fields so a fix to one cannot leave the other stale.
 */
type Reading = {
  readonly item: EvidenceItem;
  readonly line: string;
};

function reading(item: Omit<EvidenceItem, "sourceVersion" | "contentHash">, at: string): Reading {
  return {
    item: {
      ...item,
      /**
       * THE VERSION OF A LIVE READING IS WHEN IT WAS TAKEN. There is no
       * revision to cite and inventing one would be worse than none.
       */
      sourceVersion: at,
      /**
       * NULL BECAUSE NOTHING HASHED ANY BYTES. `SourceEvidence` accepts null
       * and this repo's rule is that a handle is never invented; a digest
       * computed here would be a digest of a sentence this file just wrote,
       * which certifies nothing about the database it came from.
       */
      contentHash: null,
    },
    /**
     * THE CONCEPT ID OPENS THE LINE. `concernId` is `${kind}:${subject}` and
     * the retrieval requires EVERY term of the question to appear, so a line
     * that merely discusses the subject retrieves nothing.
     */
    line: `${item.kind}:${item.subject} — ${item.detail}`,
  };
}

function readings(snapshot: ProductionSnapshot): readonly Reading[] {
  const out: Reading[] = [];
  const at = snapshot.at;

  if (snapshot.dispatch !== null) {
    const d = snapshot.dispatch;
    /**
     * A FAILING DISPATCHER IS A TOTAL OUTAGE OF FILM, not a degradation: there
     * is no second route to a renderer. The scale reaches 1 quickly for that
     * reason, and zero failures reads as zero — OBSERVED and healthy.
     */
    const severity = clamp01(d.consecutiveFailures / DISPATCH_FAILURES_FOR_FULL_SEVERITY);
    out.push(
      reading(
        {
          kind: "provider_failure",
          subject: "github_repository_dispatch",
          locator: "story_dispatch_health row read by oqca-observe",
          detail:
            `the story dispatcher records ${d.consecutiveFailures} consecutive failure(s); ` +
            `last success ${d.lastOkAt ?? "never recorded"}` +
            (d.lastError ? `; last error ${d.lastError}` : ""),
          value: d.consecutiveFailures,
          severity,
          /**
           * REPLACING A DEAD CREDENTIAL IS A CONFIGURATION CHANGE, and
           * `UPDATE_CONFIGURATION` is registered and NOT authorized — so this
           * concern is escalation-blocked rather than actionable, which is
           * exactly what `needsAPerson` was built for on 2026-09-11. It ranks
           * as work ONIQ can report and cannot do.
           */
          requires: ["UPDATE_CONFIGURATION"],
        },
        at,
      ),
    );
  }

  if (snapshot.queue !== null) {
    const q = snapshot.queue;
    const oldest = q.oldestMinutes;
    /**
     * THREE STATES, AND THE MIDDLE ONE IS WHY THIS IS NOT A BOOLEAN. A film
     * past the sweep window is late; a film past the abandoned TTL was never
     * rendered, never failed and never refunded, which is the failure
     * `story-sweep`'s six-hour clock was added to end.
     */
    const severity =
      oldest === null
        ? 0
        : oldest >= QUEUE_ABANDONED_MINUTES
          ? 1
          : oldest >= QUEUE_STALE_MINUTES
            ? 0.5
            : 0;
    out.push(
      reading(
        {
          kind: "generation_failure",
          subject: "story_jobs_queue",
          locator: "story_jobs rows with status queued, read by oqca-observe",
          detail:
            `${q.queued} film(s) are queued and the oldest has waited ` +
            `${oldest === null ? "no time: the queue is empty" : `${Math.round(oldest)} minute(s)`}` +
            `, against a ${QUEUE_STALE_MINUTES} minute sweep window and a ` +
            `${QUEUE_ABANDONED_MINUTES} minute abandoned clock`,
          value: oldest,
          severity,
          requires: ["UPDATE_CONFIGURATION"],
        },
        at,
      ),
    );
  }

  if (snapshot.errorSurfaces !== null) {
    /**
     * ONE ROW FOR THE WORST SURFACE, NOT ONE PER SURFACE. Nineteen kinds exist
     * and `completeObservations` fills every kind exactly once, so a second
     * `error_rate` item would be dropped on the floor with no line saying so —
     * better to name the loudest surface and carry the total beside it.
     */
    const sorted = [...snapshot.errorSurfaces].sort((a, b) => b.reports - a.reports);
    const worst = sorted[0] ?? null;
    const total = sorted.reduce((n, s) => n + s.reports, 0);
    const severity = clamp01((worst?.reports ?? 0) / ERRORS_FOR_FULL_SEVERITY);
    out.push(
      reading(
        {
          kind: "error_rate",
          subject: "client_error_reports",
          locator: "client_error_reports over 24h, read by oqca-observe",
          detail:
            `${total} client error report(s) in the last 24 hours across ${sorted.length} ` +
            `surface(s); the loudest is ${worst ? `${worst.surface} with ${worst.reports}` : "none"}`,
          value: total,
          severity,
          requires: ["REBUILD_ARTIFACT"],
        },
        at,
      ),
    );
  }

  if (snapshot.worker !== null) {
    const w = snapshot.worker;
    /**
     * A SEPARATE FACT FROM THE DISPATCHER'S, AND THAT IS WHY IT IS ITS OWN
     * ROW. The dispatcher can be answering perfectly while no film renders —
     * the runner is a GitHub workflow ONIQ cannot see — and it can be failing
     * while a film already in flight completes. Two readings, two kinds, and
     * the pair is what said "no film since 05 Sep" when the dispatcher's own
     * health row still looked green because idle ticks were resetting it.
     *
     * NULL IS UNKNOWN AND NOT A CRISIS. A project that has never rendered a
     * film has nothing to be late about; the host looked and cannot say.
     */
    const severity =
      w.sinceLastReadyMinutes === null
        ? null
        : clamp01(w.sinceLastReadyMinutes / WORKER_SILENCE_FOR_FULL_SEVERITY);
    out.push(
      reading(
        {
          kind: "runtime_failure",
          subject: "story_worker",
          locator: "story_jobs rows with status ready, read by oqca-observe",
          detail:
            `the renderer last finished a film ` +
            `${
              w.sinceLastReadyMinutes === null
                ? "at no time this host could establish"
                : `${Math.round(w.sinceLastReadyMinutes)} minute(s) ago`
            }` +
            `, and ${w.readyInWindow} film(s) finished in the window read`,
          value: w.sinceLastReadyMinutes,
          severity,
          requires: ["UPDATE_CONFIGURATION"],
        },
        at,
      ),
    );
  }

  if (snapshot.durable !== null) {
    /**
     * READ AND HEALTHY IS WORTH A ROW. This is the one reading that says OQCA's
     * own memory exists: a count that came back at all proves the durable store
     * is reachable, which is the thing every report since v1.5 said was
     * missing. Severity 0 is the honest answer and the row is still evidence.
     */
    out.push(
      reading(
        {
          kind: "resource_availability",
          subject: "oqca_durable_state",
          locator: `${OQCA_STATE_TABLE} read by oqca-observe`,
          detail:
            `the durable knowledge store holds ${snapshot.durable.records} record(s) and ` +
            `answered this tick, so what this run learns will outlive it`,
          value: snapshot.durable.records,
          severity: 0,
          requires: ["UPDATE_KNOWLEDGE"],
        },
        at,
      ),
    );
  }

  return out;
}

/** What the observer judges. */
export function productionEvidence(snapshot: ProductionSnapshot): readonly EvidenceItem[] {
  return readings(snapshot).map((r) => r.item);
}

/**
 * WHAT RESEARCH MAY RETRIEVE — one document per reading, so a finding's
 * locator names the query that produced it rather than the file that formatted
 * it. Retrieval is verbatim, so what is promoted into durable knowledge is the
 * measured sentence itself.
 */
export function productionCorpus(snapshot: ProductionSnapshot): readonly CorpusDocument[] {
  return readings(snapshot).map((r) => ({
    locator: r.item.locator,
    sourceVersion: r.item.sourceVersion,
    contentHash: r.item.contentHash,
    text: r.line,
  }));
}

/** What this host cannot see, stated so a reader is not left to infer it. */
export const PRODUCTION_EVIDENCE_GAP =
  "oqca-observe reads five of the nineteen observation kinds: the dispatcher, " +
  "the film queue, the renderer, the client error reports and its own durable " +
  "store. Every other kind is UNOBSERVED and says so.";
