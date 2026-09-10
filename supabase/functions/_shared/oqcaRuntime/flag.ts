/**
 * THE FEATURE FLAG — brief section 7. Default OFF, and off is the old path.
 *
 * THREE VALUES AND NOT A BOOLEAN, because there are three states worth having
 * and a boolean would force the third to be inferred from somewhere else:
 *
 *   off       story-dispatch behaves exactly as it did before this existed.
 *             No loop is constructed, nothing is read, nothing is recorded.
 *   shadow    section 8. The production path runs FIRST and unchanged; the loop
 *             then runs beside it and performs nothing. A failure in the loop
 *             cannot reach the response.
 *   assisted  section 9. The loop runs first and may dispatch — and its choice
 *             is honoured ONLY where the existing rule independently agrees, so
 *             it can narrow what gets dispatched and never widen it. If it
 *             declines, refuses or throws, the production path runs as it
 *             always did.
 *
 * ANYTHING ELSE IS `off`, INCLUDING A TYPO. A flag that fails open is a flag
 * that turns a misspelling into a production behaviour change, and the whole
 * point of the default is that it is the state nobody has to think about.
 */
export type OqcaMode = "off" | "shadow" | "assisted";

export const OQCA_FLAG_ENV = "OQCA_STORY_DISPATCH";

export function parseMode(raw: string | undefined | null): OqcaMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "shadow") return "shadow";
  if (v === "assisted") return "assisted";
  return "off";
}

/**
 * WHAT THE LOOP MAY SPEND ON ONE TICK, read from the environment and DEFAULTING
 * TO ZERO.
 *
 * How much a scheduled job may spend on a model is a spend decision, so it is
 * the owner's under CLAUDE.md's first rule and not a number an agent picks.
 * `health_config.ai_daily_cap_house` shipped as 0 for exactly this reason and
 * the owner set it afterwards. Until one is set here, the loop runs every
 * station, refuses every model call at the cost gate, and says so — which is
 * the correct behaviour for an unconfigured system that can spend.
 */
export const OQCA_COST_ENV = "OQCA_MAX_COST_USD";
export const OQCA_TOKENS_ENV = "OQCA_MAX_TOKENS";
export const OQCA_TOOLS_ENV = "OQCA_MAX_TOOL_CALLS";

export function readNonNegative(raw: string | undefined | null): number {
  const n = Number((raw ?? "").trim());
  // NaN, negative, Infinity and "" all mean the same thing: nobody set it.
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * READING AN ENVIRONMENT VARIABLE WITHOUT ASSUMING A RUNTIME.
 *
 * Found by a test, and it is the "a diagnostic may never fall back to the thing
 * it was built to explain" failure in a new place: a bare `Deno.env.get` throws
 * `ReferenceError: Deno is not defined` under the node test runner, that throw
 * happened BEFORE the code under test ran, and the hook's catch reported it in
 * place of the real error. The safety property still held — the production path
 * ran — but the message named the wrong fault entirely.
 *
 * `undefined` is what an unset variable already means, and every reader here
 * turns that into the refusing default.
 */
export function envReader(): (name: string) => string | undefined {
  const g = globalThis as { Deno?: { env?: { get?: (n: string) => string | undefined } } };
  const get = g.Deno?.env?.get;
  if (typeof get !== "function") return () => undefined;
  return (name) => {
    try {
      return get.call(g.Deno!.env, name);
    } catch {
      // A host that has Deno but denies --allow-env. Unset, not fatal.
      return undefined;
    }
  };
}
