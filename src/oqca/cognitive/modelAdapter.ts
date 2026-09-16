/**
 * THE FRONTIER MODEL AS A SEAM — §6, §24.
 *
 * The kernel never imports a provider. It holds a `ModelAdapter` and the
 * implementations live at the edge, so "substitute another model without
 * changing memory, planning, or world-model code" is structural rather than
 * promised.
 *
 * THE DEFAULT REFUSES, and that is not caution — it is what makes an
 * unconfigured kernel honest. OQCA's equivalent default silently produced
 * "insufficient_allowance" and a reader concluded the budget was too low; a
 * refusal that NAMES ITSELF is the fix.
 *
 * MEASURED 2026-09-12, and it is why Mock and Replay are not optional:
 * api.openai.com answers HTTP 000 from this container (proxy CONNECT 403)
 * while api.anthropic.com answers 401 and Google 403 — both reached. So no
 * frontier model is callable here at all, no gpt-6-astra id can be verified
 * by POST, and every test in this tree runs on a recorded or scripted reply.
 */

export type ReasoningEffort = "low" | "medium" | "high";

/**
 * A tool the caller is willing to let the model ASK for.
 *
 * THE NAME ALONE IS NOT AN OFFER. The first version of this seam carried
 * `readonly string[]`, so the OpenAI adapter emitted `{type, name}` with no
 * description and no parameter schema. Three of the video benchmark's four
 * tools take no arguments and worked; `db_error_detail` needs one, the model
 * was never told the field existed, and both frontier arms called it six
 * times with `{}` — reading `no surface named ` each time and never seeing
 * the evidence that names the dead credential. The run scored zero and the
 * cause was this type. A tool offered without its arguments is a tool that
 * cannot be called.
 */
export type OfferedTool = {
  readonly name: string;
  readonly description: string;
  /** Argument names the tool reads. Empty means it takes none. */
  readonly schema: readonly string[];
  /** Version of the callable contract, not the provider implementation. */
  readonly version?: string;
  /** Immutable permission scopes required to offer the tool. */
  readonly scopes?: readonly string[];
};

export type ModelRequest = {
  readonly instructions: string;
  readonly input: string;
  readonly effort?: ReasoningEffort;
  /** Tools the caller is willing to let the model ASK for, with their arguments. */
  readonly toolsOffered?: readonly OfferedTool[];
};

export type ToolWish = {
  readonly name: string;
  readonly args: Readonly<Record<string, string>>;
};

export type ModelProposal = {
  /** Free text. NEVER promoted to truth by anything downstream. §11. */
  readonly text: string;
  /** A tool the model would like called. A REQUEST, not an instruction. */
  readonly wantsTool: ToolWish | null;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type ModelResult =
  | { readonly ok: true; readonly proposal: ModelProposal }
  | { readonly ok: false; readonly reason: string };

export type ModelAdapter = {
  readonly id: string;
  readonly reason: (req: ModelRequest) => Promise<ModelResult>;
};

/**
 * THE SHIPPED DEFAULT. Anything that forgets to pass an adapter gets a kernel
 * that cannot reason and says exactly that, rather than one that quietly
 * invents.
 */
export const REFUSING_MODEL: ModelAdapter = {
  id: "refusing",
  reason: async () => ({
    ok: false,
    reason: "no model adapter configured: this kernel was constructed without one",
  }),
};

/** Deterministic scripted replies. For unit tests; needs no credential. */
export function mockModelAdapter(replies: readonly ModelProposal[], id = "mock"): ModelAdapter {
  let i = 0;
  return {
    id,
    reason: async () => {
      if (i >= replies.length) {
        return { ok: false, reason: `mock exhausted after ${replies.length} reply(ies)` };
      }
      const proposal = replies[i];
      i += 1;
      return { ok: true, proposal };
    },
  };
}

/** Retained for callers importing the legacy constant. V2 keys are canonical JSON. */
export const REPLAY_KEY_SEP = "|~|";
export const REPLAY_KEY_VERSION = 2;

function canonicalTool(tool: OfferedTool) {
  return {
    name: tool.name,
    description: tool.description,
    schema: [...tool.schema].sort(),
    version: tool.version ?? "",
    scopes: [...(tool.scopes ?? [])].sort(),
  };
}

/**
 * Replay identity binds the complete offered permission surface. Catalog,
 * schema, and scope ordering are canonicalized because order does not change
 * authority. Versioning intentionally invalidates incomplete v1 transcripts.
 */
export function replayKey(req: ModelRequest): string {
  const tools = [...(req.toolsOffered ?? [])]
    .map(canonicalTool)
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return JSON.stringify({
    version: REPLAY_KEY_VERSION,
    instructions: req.instructions,
    input: req.input,
    effort: req.effort ?? "medium",
    tools,
  });
}

/**
 * REPLAY. Keyed by the request, so a recorded transcript reproduces a run
 * exactly — which is what makes "deterministic orchestration" checkable rather
 * than asserted. A key that was never recorded REFUSES rather than falling
 * back to a neighbouring reply: a replay that quietly substitutes is a replay
 * that proves nothing.
 */
export function replayModelAdapter(
  transcript: Readonly<Record<string, ModelProposal>>,
  id = "replay",
): ModelAdapter {
  return {
    id,
    reason: async (req) => {
      const key = replayKey(req);
      const hit = transcript[key];
      if (!hit) return { ok: false, reason: `no recorded reply for this request` };
      return { ok: true, proposal: hit };
    },
  };
}
