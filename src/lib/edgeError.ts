/**
 * The sentence an edge function actually sent, not the one supabase-js made up.
 *
 * WHY THIS IS SHARED RATHER THAN LOCAL. The same information loss has now
 * happened in two screens independently, and both times it cost a production
 * diagnosis:
 *
 *   Ting  — `functions.invoke` throws FunctionsHttpError on any non-2xx, and
 *           its `.message` is the fixed string "Edge Function returned a
 *           non-2xx status code". The real body hangs off `.context` as a
 *           Response and nothing read it, so 400/401/429/500/502 all rendered
 *           as "ting choked on that".
 *   Study — study-paper-generate answers 200 with `{source:"unavailable",
 *           reason}` and a precise reason ("mcq: http 400", "long: no items",
 *           "malformed paper", "bad mcq item", "storage failed"). The screen
 *           destructured `reason` and then never used it.
 *
 * On 2026-09-01 the Supabase log pipeline stopped returning rows, and these
 * discarded strings were the ONLY remaining evidence of why anything failed.
 * That is the argument for this file: the diagnostic has to survive to the one
 * place that is always available, which is the screen in front of the person.
 *
 * PURE-ISH AND TESTED. It touches no network and no clock; it only reads a
 * Response that an error is already carrying.
 */

/**
 * Pull the server's own message out of a thrown invoke error.
 *
 * Returns "" when there is genuinely nothing better to say, so callers keep
 * their friendly fallback instead of showing an empty toast.
 */
export async function edgeErrorMessage(e: unknown): Promise<string> {
  const ctx = (e as { context?: unknown } | null)?.context;
  // Cloned, in case anything else still needs to read the body.
  if (ctx instanceof Response) {
    try {
      const body = (await ctx.clone().json()) as { error?: unknown; reason?: unknown };
      // `error` is the convention on the razorpay/ting functions; `reason` is
      // the convention on the study functions, which answer 200 with a reason
      // rather than a non-2xx. Accept both rather than making every caller
      // remember which family it is talking to.
      for (const v of [body?.error, body?.reason]) {
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    } catch {
      /* not JSON — fall through to the message */
    }
  }
  const raw = e instanceof Error ? e.message : "";
  return raw && !/non-2xx/i.test(raw) ? raw : "";
}

/**
 * A friendly sentence with the machine reason kept alongside it.
 *
 * NOT just the raw reason. "mcq: http 400" is the right thing to put in a bug
 * report and the wrong thing to put in front of a student on its own, so the
 * human sentence leads and the reason trails in brackets. Losing it entirely is
 * what made today's outage undiagnosable; showing it alone would be a different
 * failure of care.
 */
export function withReason(friendly: string, reason?: string | null): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  return r ? `${friendly} (${r})` : friendly;
}
