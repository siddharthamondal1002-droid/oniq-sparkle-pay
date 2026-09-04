// watch-ask — "Ask about this video" and "What did I watch about …?", answered
// from the user's OWN notes, moments and saved metadata. Nothing else.
//
// Owner mission, 2026-09-03. ONIQ has no transcript for a saved video and
// does not fetch one: transcript acquisition is restricted by the providers,
// and the honest fallback is to answer from what the person wrote down and
// what the provider's metadata says, and to say so. The model is told it has
// not seen the video. Output is labelled AI-generated in the app.
//
// Reads go through the caller's own session (row-level security), so one
// person's library can never inform another's answer. Logs carry counts and
// status only — never a note, never a question.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callText, corsHeaders, json } from "../_shared/llm.ts";
import type { SearchBudget } from "../_shared/searchBudget.ts";
import {
  refusalMessage,
  requestIdFrom,
  serviceRoleRpc,
  withSearchSpendGuard,
} from "../_shared/searchGuard.ts";

const ASK_MODEL = "claude-sonnet-4-6";
const ASK_MAX_TOKENS = 600;

/**
 * THE SPEND GUARD. No web search — the answer comes from the person's notes —
 * so the reservation is tokens only: the notes context is bounded by the item
 * limits below, and the output by ASK_MAX_TOKENS. Same ledger, same refusal
 * path, as every other billable caller in the repository.
 */
const ASK_BUDGET: SearchBudget = {
  maxSearches: 0,
  maxProviderCalls: 1,
  maxLlmCalls: 1,
  maxInputTokens: 16_000,
  maxOutputTokens: ASK_MAX_TOKENS,
  maxWallClockMs: 30_000,
  maxEstimatedUsd: 0.1,
};

type ItemRow = {
  id: string;
  title: string;
  creator: string | null;
  provider: string;
  duration_seconds: number | null;
  notes: string | null;
  topics: string[];
  tags: string[];
  reason: string | null;
  last_watched_at: string | null;
  completed_at: string | null;
  position_seconds: number;
};

type MomentRow = { item_id: string; at_seconds: number; note: string | null };

function clock(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h ? `${h}:` : ""}${h ? String(m).padStart(2, "0") : m}:${String(sec).padStart(2, "0")}`;
}

function describe(item: ItemRow, moments: MomentRow[]): string {
  const lines = [
    `Title: ${item.title}`,
    item.creator ? `Creator: ${item.creator}` : "",
    `Provider: ${item.provider}`,
    item.duration_seconds ? `Length: ${clock(item.duration_seconds)}` : "",
    item.reason ? `Saved for: ${item.reason.replace("_", " ")}` : "",
    item.topics.length ? `Topics: ${item.topics.join(", ")}` : "",
    item.tags.length ? `Tags: ${item.tags.join(", ")}` : "",
    item.completed_at
      ? `Watched fully on ${item.completed_at.slice(0, 10)}`
      : item.last_watched_at
        ? `Last watched ${item.last_watched_at.slice(0, 10)}, at ${clock(item.position_seconds)}`
        : "Not watched yet",
    item.notes ? `Notes:\n${item.notes.slice(0, 3000)}` : "Notes: (none)",
  ];
  const ms = moments.filter((m) => m.item_id === item.id);
  if (ms.length) {
    lines.push("Saved moments:");
    for (const m of ms.slice(0, 40))
      lines.push(`- ${clock(m.at_seconds)}${m.note ? ` — ${m.note}` : ""}`);
  }
  return lines.filter(Boolean).join("\n");
}

function textOf(data: unknown): string {
  const content = (data as { content?: unknown[] })?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) =>
      c && typeof c === "object" && (c as { type?: string }).type === "text"
        ? String((c as { text?: string }).text ?? "")
        : "",
    )
    .join("")
    .trim();
}

const SYSTEM = [
  "You are ONIQ Watch, helping a person with their OWN saved videos.",
  "You have NOT seen any of these videos and have no transcript. Everything you know is in the notes, saved moments and metadata below, which the person wrote or saved themselves.",
  "Answer only from that material. If it does not cover the question, say so plainly in one sentence and suggest what note or moment would answer it next time.",
  "Never invent quotes, timestamps, facts or claims about what a video contains.",
  "Be brief: a few sentences, or a short list when asked for points. Plain language.",
].join(" ");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method" });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json(401, { error: "unauthorized" });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  let userId = "";
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return json(401, { error: "unauthorized" });
    userId = data.user.id;
  } catch {
    return json(401, { error: "unauthorized" });
  }

  let body: {
    mode?: string;
    itemId?: string;
    question?: string;
    task?: string;
    requestId?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    /* keep {} */
  }
  const mode = body.mode === "library" ? "library" : "item";
  const task = body.task === "summarize" ? "summarize" : "ask";
  const question = String(body.question ?? "")
    .trim()
    .slice(0, 500);
  if (task === "ask" && !question) return json(200, { ok: false, reason: "question required" });

  const FIELDS =
    "id,title,creator,provider,duration_seconds,notes,topics,tags,reason,last_watched_at,completed_at,position_seconds";
  let items: ItemRow[] = [];
  if (mode === "item") {
    const itemId = String(body.itemId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(itemId)) return json(200, { ok: false, reason: "item required" });
    const { data, error } = await supabase
      .from("watch_items")
      .select(FIELDS)
      .eq("id", itemId)
      .maybeSingle();
    if (error || !data) return json(200, { ok: false, reason: "item not found" });
    items = [data as ItemRow];
  } else {
    // The person's own library, narrowed by the question's words where possible.
    const words = question
      .replace(/[,()%\\"']/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .slice(0, 6);
    let q = supabase.from("watch_items").select(FIELDS).neq("state", "archived");
    if (words.length) {
      q = q.or(
        words
          .flatMap((w) => [`title.ilike.%${w}%`, `notes.ilike.%${w}%`, `topics.cs.{${w}}`])
          .join(","),
      );
    }
    const { data, error } = await q
      .order("last_watched_at", { ascending: false, nullsFirst: false })
      .limit(30);
    if (error) return json(200, { ok: false, reason: "library unavailable" });
    items = (data ?? []) as ItemRow[];
    if (items.length === 0) {
      const recent = await supabase
        .from("watch_items")
        .select(FIELDS)
        .neq("state", "archived")
        .order("saved_at", { ascending: false })
        .limit(15);
      items = (recent.data ?? []) as ItemRow[];
    }
  }
  if (items.length === 0) return json(200, { ok: false, reason: "nothing saved yet" });

  const ids = items.map((i) => i.id);
  const { data: momentRows } = await supabase
    .from("watch_moments")
    .select("item_id,at_seconds,note")
    .in("item_id", ids)
    .order("at_seconds", { ascending: true })
    .limit(300);
  const moments = (momentRows ?? []) as MomentRow[];

  const context = items.map((it) => describe(it, moments)).join("\n\n---\n\n");
  const ask =
    task === "summarize"
      ? "From the notes and moments above, give the main points as a short list, then the topics in one line. If there are no notes, say there is nothing to summarise beyond the title and suggest saving a moment or a note."
      : `Question: ${question}`;
  const user = `${mode === "library" ? "The person's saved videos" : "The saved video"}:\n\n${context}\n\n${ask}`;

  const guarded = await withSearchSpendGuard(
    serviceRoleRpc(),
    {
      requestId: requestIdFrom(body.requestId),
      provider: "anthropic",
      model: ASK_MODEL,
      searchType: "watch-ask",
      userId,
      budget: ASK_BUDGET,
    },
    async () => {
      const r = await callText({
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
        maxTokens: ASK_MAX_TOKENS,
        model: ASK_MODEL,
        timeoutMs: ASK_BUDGET.maxWallClockMs,
        allowFallback: false,
      });
      const data = r.ok ? (r.data as { usage?: unknown; stop_reason?: string } | null) : null;
      return {
        value: r,
        neverCalled: !r.ok && r.reason === "not configured",
        usage: data?.usage ? (data.usage as never) : null,
        stopReason: data?.stop_reason ?? null,
        terminationReason: r.ok ? undefined : ("PROVIDER_ERROR" as const),
      };
    },
  );
  if (!guarded.admitted) {
    console.warn(`watch-ask: spend guard refused (${guarded.reason})`);
    return json(200, { ok: false, reason: refusalMessage(guarded.reason) });
  }
  const res = guarded.value;
  if (!res.ok) {
    console.warn(
      `watch-ask: model unavailable (${mode}, ${items.length} items): ${String(res.reason ?? "").slice(0, 80)}`,
    );
    return json(200, { ok: false, reason: "unavailable right now" });
  }
  const answer = textOf(res.data);
  if (!answer) return json(200, { ok: false, reason: "no answer" });
  return json(200, {
    ok: true,
    answer,
    basis: { items: items.length, notes: items.some((i) => !!i.notes), moments: moments.length },
  });
});
