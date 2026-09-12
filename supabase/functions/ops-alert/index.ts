/**
 * ops-alert — the delivery half of the ONIQ watchdog.
 *
 * `ops_watch_tick()` detects and records; this says it out loud. The split is
 * deliberate: detection must keep working when delivery cannot. A row is
 * committed with `notified_at` NULL before this is ever called, so a missing
 * credential, a dead token or a Google outage costs an announcement and never
 * an observation — the next tick simply finds it still pending and tries again.
 *
 * WHY NOT `send-push`. That function is conversation-scoped: it demands a
 * sender's JWT, a `conversation_id` and membership of that conversation, and it
 * delivers to the OTHER members. An operational alert has no conversation and
 * no sender. Routing one through it would mean inventing both, and an invented
 * conversation becomes load-bearing the first time someone tidies it up.
 *
 * WHAT IT DOES NOT DO, stated rather than discovered: web push. `device_tokens`
 * holds two different things — FCM registration tokens for native installs and
 * VAPID subscriptions (`keys.p256dh`/`keys.auth`) for browsers — and only the
 * first is handled here. An operational alert exists to reach a phone. Adding
 * the web arm means reusing `_shared/webpush.ts` the way send-push does.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { googleAccessToken } from "../_shared/googleAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** One push per RUN, never one per alert: a burst of notifications is the spam failure this design exists to avoid. */
const MAX_LINES = 4;
const FCM_PROJECT = "oniq-309bd";

type AlertRow = {
  id: number;
  signal: string;
  severity: number;
  summary: string;
  resolved_at: string | null;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

/** The role claim, read without verifying — the value is only ever used to ADMIT the service role, and PostgREST verifies the same token below for every other caller. */
function roleOf(jwt: string): string {
  const parts = jwt.split(".");
  if (parts.length !== 3) return "";
  try {
    return String(JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))).role ?? "");
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!bearer) return json({ error: "Unauthorized" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "not configured" }, 503);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // TWO CALLERS, ONE GATE. The cron presents the service role from the vault;
  // an admin may tap the same endpoint to prove delivery works. Nobody else.
  let caller = "";
  if (roleOf(bearer) === "service_role") {
    caller = "cron";
  } else {
    const { data: userRes } = await admin.auth.getUser(bearer);
    const uid = userRes?.user?.id;
    if (!uid) return json({ error: "Unauthorized" }, 401);
    const { data: isAdmin } = await admin.rpc("is_admin", { _uid: uid });
    if (isAdmin !== true) return json({ error: "forbidden" }, 403);
    caller = "admin";
  }

  // WHAT STILL NEEDS SAYING. The same three cases the tick counts: never
  // announced, a severity-1 outage still open a day later, and a recovery of
  // something the owner WAS told about.
  const { data: rows, error: readErr } = await admin
    .from("ops_alerts")
    .select("id, signal, severity, summary, resolved_at, notified_at, resolved_notified_at")
    .order("severity", { ascending: true })
    .order("last_seen_at", { ascending: false })
    .limit(50);
  if (readErr) return json({ error: "read failed", detail: readErr.message }, 500);

  const dayAgo = Date.now() - 24 * 3_600_000;
  const all = (rows ?? []) as (AlertRow & {
    notified_at: string | null;
    resolved_notified_at: string | null;
  })[];
  const toAnnounce = all.filter(
    (a) =>
      a.resolved_at === null &&
      (a.notified_at === null || (a.severity === 1 && Date.parse(a.notified_at) < dayAgo)),
  );
  const toClear = all.filter(
    (a) => a.resolved_at !== null && a.notified_at !== null && a.resolved_notified_at === null,
  );
  if (toAnnounce.length === 0 && toClear.length === 0) {
    return json({ caller, sent: 0, reason: "nothing pending" }, 200);
  }

  const lines: string[] = [
    ...toAnnounce.map((a) => `${a.severity === 1 ? "!" : "-"} ${a.summary}`),
    ...toClear.map((a) => `ok ${a.signal} has recovered.`),
  ];
  const shown = lines.slice(0, MAX_LINES);
  const extra = lines.length - shown.length;
  const body = shown.join("\n") + (extra > 0 ? `\n(+${extra} more)` : "");
  const worst = toAnnounce.some((a) => a.severity === 1);
  const title =
    toAnnounce.length === 0 ? "ONIQ recovered" : worst ? "ONIQ needs you" : "ONIQ notice";

  // ADMINS ONLY, AND NATIVE ONLY. `platform = 'web'` rows are VAPID
  // subscriptions, not FCM tokens; posting one to FCM fails the whole send.
  const { data: adminIds } = await admin.from("profiles").select("id").eq("is_admin", true);
  const ids = ((adminIds ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return json({ caller, sent: 0, reason: "no admin" }, 200);

  const { data: tokenRows } = await admin
    .from("device_tokens")
    .select("token, platform")
    .in("user_id", ids)
    .neq("platform", "web");
  const tokens = ((tokenRows ?? []) as { token: string }[]).map((r) => r.token);
  if (tokens.length === 0) return json({ caller, sent: 0, reason: "no native admin token" }, 200);

  const tok = await googleAccessToken();
  if (!tok.ok) return json({ caller, sent: 0, reason: `google auth: ${tok.reason}` }, 503);

  const url = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT}/messages:send`;
  let sent = 0;
  const failures: string[] = [];
  for (const token of tokens) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tok.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body },
            android: { priority: "high" },
            data: { kind: "ops_alert", open: String(toAnnounce.length) },
          },
        }),
      });
      if (res.ok) sent += 1;
      // NEVER THE TOKEN. It is the address a push is delivered to; the status
      // is what a fix needs. Same rule push.ts records for its own reports.
      else failures.push(`http ${res.status}`);
    } catch {
      failures.push("network");
    }
  }

  // MARK ONLY ON A REAL DELIVERY. If every token failed the rows stay pending
  // and the next tick retries — a row marked notified after a failed send is
  // an outage nobody ever hears about twice.
  if (sent > 0) {
    const now = new Date().toISOString();
    if (toAnnounce.length > 0) {
      await admin
        .from("ops_alerts")
        .update({ notified_at: now })
        .in(
          "id",
          toAnnounce.map((a) => a.id),
        );
    }
    if (toClear.length > 0) {
      await admin
        .from("ops_alerts")
        .update({ resolved_notified_at: now })
        .in(
          "id",
          toClear.map((a) => a.id),
        );
    }
  }

  return json(
    {
      caller,
      sent,
      tokens: tokens.length,
      announced: toAnnounce.length,
      cleared: toClear.length,
      failures,
    },
    200,
  );
});
