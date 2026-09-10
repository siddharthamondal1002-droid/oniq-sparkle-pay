/**
 * A QUEUE AND A CLOCK, IN MEMORY. Fixtures only — no test asserts against this
 * file, it is what the assertions are made WITH.
 *
 * The environment is a real implementation of `DispatchEnvironment`, not a set
 * of stubs returning constants: `stampDispatched` really writes the stamp,
 * `readJob` really reflects it, and `sendDispatch` really records the attempt.
 * A fixture that could not disagree with the loop would make every observation
 * test vacuous — which is exactly the trap `readJob` echoing `perform`'s own
 * claim would be.
 */
import type {
  DispatchEnvironment,
  QueuedJob,
} from "../../../supabase/functions/_shared/oqcaRuntime/dispatchJob.ts";

export const T0 = 1_700_000_000_000;

export function job(id: string, ageMinutes: number, dispatchedMinutesAgo?: number): QueuedJob {
  return {
    id,
    requestedSeconds: 60,
    grade: "classic",
    createdAtMs: T0 - ageMinutes * 60_000,
    dispatchedAtMs: dispatchedMinutesAgo === undefined ? null : T0 - dispatchedMinutesAgo * 60_000,
  };
}

export type FakeEnv = DispatchEnvironment & {
  readonly rows: Map<string, QueuedJob>;
  readonly sent: string[];
  readonly stamped: string[];
  /** Simulates a runner claiming the job: it leaves the queue. */
  claim: (id: string) => void;
  sendFails: string | null;
  /** Set to make the queue read throw, so the caller's catch can be exercised. */
  readFails: string | null;
  tick: (ms: number) => void;
};

export function fakeEnv(jobs: readonly QueuedJob[], opts: { now?: number } = {}): FakeEnv {
  const rows = new Map(jobs.map((j) => [j.id, j]));
  let now = opts.now ?? T0;
  const env: FakeEnv = {
    rows,
    sent: [],
    stamped: [],
    sendFails: null,
    readFails: null,
    tick: (ms) => {
      now += ms;
    },
    claim: (id) => {
      rows.delete(id);
    },
    nowMs: () => now,
    readQueue: async () => {
      if (env.readFails) throw new Error(env.readFails);
      return [...rows.values()];
    },
    readJob: async (id) => rows.get(id) ?? null,
    stampDispatched: async (id) => {
      env.stamped.push(id);
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, dispatchedAtMs: now });
    },
    sendDispatch: async (id) => {
      env.sent.push(id);
      return env.sendFails;
    },
  };
  return env;
}

/** An engine reply in `callText`'s shape, so the adapter is exercised for real. */
export function reply(text: string, inputTokens = 500, outputTokens = 200) {
  return {
    ok: true as const,
    provider: "gemini" as const,
    data: {
      model: "gemini-3.1-flash-lite",
      content: [{ type: "text", text }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    },
  };
}
