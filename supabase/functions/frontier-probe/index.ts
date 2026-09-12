/**
 * FRONTIER PROBE — does this key exist, and what may it actually CALL?
 *
 * WHY THIS FUNCTION EXISTS. `OPENAI_API_KEY` was added 2026-09-12 and lives in
 * the Supabase secret store, which is the one place that has BOTH the key and
 * outbound network: the dev container has neither (api.openai.com answers
 * HTTP 000 there against a proxy CONNECT 403, while api.anthropic.com answers
 * 401 and Google 403 on the same runner). So nothing about this provider can
 * be established anywhere else.
 *
 * A CATALOGUE IS NOT A POST, and this repo has the receipt: `llm.ts` carries a
 * measured table where a listed model advertising the right method returned
 * 404 on every real call for months, leaving the fallback it served dead the
 * whole time. So `catalogue` and `calls` are reported as two different facts
 * and the verdict reads the POST, never the list.
 *
 * THE KEY IS NEVER RETURNED, LOGGED, OR ECHOED. `configured` is a boolean, so
 * "no key" is distinguishable from "the call failed" without the value ever
 * leaving the process.
 *
 * A DIAGNOSTIC MAY NEVER FALL BACK TO THE THING IT WAS BUILT TO EXPLAIN — the
 * 2026-09-07 lesson, where a probe reported `http 404` and dropped Google's
 * actual sentence. `detail` falls back to the RAW BODY, never to the status.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/llm.ts";
import { serviceRoleRpc, withProviderSpendGuard } from "../_shared/financialLedger.ts";

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

/** At most three ids per tap. A probe that can loop is a probe that can bill. */
const MAX_MODELS_PER_CALL = 3;
/**
 * THE FLAT RESERVATION PER PROBE CALL, AND WHY A FLAT ONE IS RIGHT HERE.
 *
 * `searchSpendCoverage` caught this function as a billable caller with no
 * reservation and said, correctly, "guard it, do not list it". The obvious
 * objection is circular: the ledger refuses an unpriced model, and the whole
 * point of a probe is to reach a model whose price nobody knows yet.
 *
 * The repo already answers that. `music-generate`, `image-generate` and
 * `voice-generate` reserve a FLAT owner-given figure per generation rather
 * than a per-token rate, and settle against it. A probe is the same shape and
 * a far easier case, because its worst case is knowable from the request
 * itself: PROBE_MAX_OUTPUT_TOKENS output tokens on a ~20-token prompt. A cent
 * is orders of magnitude above any plausible cost for that on any model in the
 * catalogue, so it is a true ceiling rather than a guess dressed as one.
 *
 * So the probe is ACCOUNTED without needing a rate table, and it is refusable
 * by the same daily ceiling as everything else. What it is NOT is a licence to
 * price the general engine this way: a real cognitive run makes twenty calls
 * of unbounded length, and that still needs measured rates.
 */
const PROBE_RESERVATION_USD = 0.01;
/** The POST asks for almost nothing: this is an existence check, not a task. */
const PROBE_MAX_OUTPUT_TOKENS = 16;
const PROBE_INPUT = "Reply with the single word: ok";
const TIMEOUT_MS = 30_000;

type CallOutcome = {
  readonly model: string;
  readonly status: number;
  readonly ok: boolean;
  /** OpenAI's own words. Never a restatement of the status. */
  readonly detail: string;
  readonly outputText: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
};

/**
 * Read an error the way the provider actually sends it, and fall through to
 * the raw body when the shape is unfamiliar. An unreadable sentence can still
 * be read by a person; a status code restated cannot be read by anyone.
 */
function detailFrom(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    const root = (parsed ?? {}) as { error?: unknown };
    const err = root.error;
    if (typeof err === "string" && err.trim()) return err;
    if (err && typeof err === "object") {
      const e = err as { message?: unknown; code?: unknown; type?: unknown };
      const parts = [e.code, e.type, e.message].filter((x) => typeof x === "string" && x);
      if (parts.length > 0) return parts.join(": ");
    }
  } catch {
    // fall through to the raw body
  }
  const raw = body.trim();
  return raw.length > 0 ? raw.slice(0, 600) : `empty body with status ${status}`;
}

async function callModel(key: string, model: string): Promise<CallOutcome> {
  /**
   * THE LEDGER IS THE GATE, AND A NULL RPC REFUSES RATHER THAN SKIPS — the
   * same rule `engine.ts` follows. A caller that cannot reach the ledger gets
   * a probe that cannot spend, never one that spends uncounted.
   */
  const rpc = serviceRoleRpc();
  const guarded = await withProviderSpendGuard(
    rpc,
    {
      requestId: `frontier-probe:${model}:${Date.now()}`,
      capability: "TEXT",
      provider: "openai",
      model,
      unit: "tokens",
      units: PROBE_MAX_OUTPUT_TOKENS,
      estimatedUsd: PROBE_RESERVATION_USD,
      detail: { purpose: "model-id verification by POST" },
    },
    async () => ({ value: await callModelUnguarded(key, model) }),
  );
  if (!guarded.admitted) {
    return {
      model,
      status: 0,
      ok: false,
      detail: `the spend ledger refused this probe: ${guarded.reason}`,
      outputText: null,
      inputTokens: null,
      outputTokens: null,
    };
  }
  return guarded.value;
}

async function callModelUnguarded(key: string, model: string): Promise<CallOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        input: PROBE_INPUT,
        max_output_tokens: PROBE_MAX_OUTPUT_TOKENS,
      }),
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      return {
        model,
        status: res.status,
        ok: false,
        detail: detailFrom(res.status, body),
        outputText: null,
        inputTokens: null,
        outputTokens: null,
      };
    }
    const parsed = JSON.parse(body) as {
      output_text?: unknown;
      output?: unknown;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };
    let text: string | null = typeof parsed.output_text === "string" ? parsed.output_text : null;
    if (text === null && Array.isArray(parsed.output)) {
      for (const item of parsed.output as readonly unknown[]) {
        const o = (item ?? {}) as { content?: unknown };
        if (Array.isArray(o.content)) {
          for (const c of o.content as readonly unknown[]) {
            const cc = (c ?? {}) as { text?: unknown };
            if (typeof cc.text === "string") text = cc.text;
          }
        }
      }
    }
    const usage = parsed.usage ?? {};
    return {
      model,
      status: res.status,
      ok: true,
      detail: "accepted",
      outputText: text,
      inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
      outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
    };
  } catch (err) {
    return {
      model,
      status: 0,
      ok: false,
      detail: `call failed: ${String(err)}`,
      outputText: null,
      inputTokens: null,
      outputTokens: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function catalogue(key: string): Promise<{ status: number; ids: string[]; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(OPENAI_MODELS_URL, {
      headers: { authorization: `Bearer ${key}` },
    });
    const body = await res.text();
    if (!res.ok) return { status: res.status, ids: [], detail: detailFrom(res.status, body) };
    const parsed = JSON.parse(body) as { data?: unknown };
    const ids = Array.isArray(parsed.data)
      ? (parsed.data as readonly unknown[])
          .map((d) => (d as { id?: unknown }).id)
          .filter((id): id is string => typeof id === "string")
          .sort()
      : [];
    return { status: res.status, ids, detail: `${ids.length} id(s) listed` };
  } catch (err) {
    return { status: 0, ids: [], detail: `list failed: ${String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  /**
   * TWO CALLERS, ONE GATE. A person reaches this through an admin JWT, exactly
   * as `oqca-observe` and `firebase-provisioning` do — the screen is not the
   * gate. The service role is admitted too, and only because it is the key
   * this function already holds: admitting it opens no door that caller did
   * not already own, and it is what lets one deploy message also verify.
   */
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isServiceRole = serviceRole.length > 0 && token === serviceRole;

  if (!isServiceRole) {
    if (!token) return json(401, { error: "Unauthorized" });
    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userRes, error: userErr } = await db.auth.getUser(token);
    if (userErr || !userRes?.user) return json(401, { error: "Unauthorized" });
    const { data: isAdmin } = await db.rpc("is_admin", { _uid: userRes.user.id });
    if (isAdmin !== true) return json(403, { error: "Admins only" });
  }

  const key = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!key) {
    return json(200, {
      configured: false,
      note: "OPENAI_API_KEY is not set on this project; nothing was called and nothing was spent",
    });
  }

  let requested: string[] = [];
  try {
    const body = (await req.json()) as { models?: unknown };
    if (Array.isArray(body.models)) {
      requested = (body.models as readonly unknown[])
        .filter((m): m is string => typeof m === "string")
        .slice(0, MAX_MODELS_PER_CALL);
    }
  } catch {
    requested = [];
  }

  const list = await catalogue(key);
  const calls: CallOutcome[] = [];
  for (const m of requested) calls.push(await callModel(key, m));

  const accepted = calls.filter((c) => c.ok).map((c) => c.model);
  return json(200, {
    configured: true,
    catalogue: {
      status: list.status,
      detail: list.detail,
      total: list.ids.length,
      /** Only the reasoning families are echoed; the full list is noise here. */
      matching: list.ids.filter((id) => /^(gpt|o\d|chatgpt)/i.test(id)),
    },
    calls,
    /** THE VERDICT READS THE POST, NEVER THE LIST. */
    verdict:
      requested.length === 0
        ? "catalogue only — no id was POSTed, so nothing is verified as callable"
        : accepted.length > 0
          ? `CALLABLE: ${accepted.join(", ")}`
          : "every id POSTed was refused — read calls[].detail for the provider's own words",
  });
});
