/**
 * WHAT THE KERNEL IS ALLOWED TO DO, AND THE DEFAULT IS THE SAFE ONE.
 *
 * OBSERVE      read-only inspection. Nothing outside the process changes.
 * DRY_RUN      a side-effecting tool is selected and its call is RECORDED,
 *              never made. This is how a plan is inspected before it runs.
 * AUTHORIZED   explicitly approved, bounded actions may execute.
 *
 * DEFAULT IS OBSERVE, and an unrecognised value is ALSO observe — the same
 * rule `parseMode` uses for OQCA's flag, for the same reason: a typo must not
 * be able to promote a read-only run into one that writes.
 */
export type ExecutionMode = "OBSERVE" | "DRY_RUN" | "AUTHORIZED";

export const DEFAULT_EXECUTION_MODE: ExecutionMode = "OBSERVE";

export function parseExecutionMode(raw: string | undefined | null): ExecutionMode {
  if (raw === "DRY_RUN") return "DRY_RUN";
  if (raw === "AUTHORIZED") return "AUTHORIZED";
  return DEFAULT_EXECUTION_MODE;
}

/** How much of the world a tool can disturb. §7. */
export type SideEffectLevel = "NONE" | "LOCAL" | "EXTERNAL" | "DESTRUCTIVE";

/**
 * May a tool with this side-effect level actually execute in this mode?
 *
 * NONE runs everywhere — a read cannot hurt anything and refusing reads is
 * what made OQCA unable to see. Everything else needs AUTHORIZED, and
 * DESTRUCTIVE is refused even then: this kernel has no authorized destructive
 * path at all, and adding one must be a deliberate separate change.
 */
export function mayExecute(mode: ExecutionMode, level: SideEffectLevel): boolean {
  if (level === "NONE") return true;
  if (level === "DESTRUCTIVE") return false;
  return mode === "AUTHORIZED";
}
