// match-contacts edge function.
// Auth-gated. Accepts { emails: string[] } (≤100), matches against auth.users,
// joins to public.profiles, and returns which emails are ONIQ users. Emails
// are matched in-memory only — never logged, never stored. Only the caller's
// own submitted emails are ever echoed back.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userRes?.user) return json({ error: "Unauthorized" }, 401);

  let body: { emails?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const raw = Array.isArray(body?.emails) ? body!.emails as unknown[] : [];
  const emails = Array.from(new Set(
    raw
      .filter((e): e is string => typeof e === "string")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
  )).slice(0, 100);

  if (emails.length === 0) return json({ on_oniq: [], not_on_oniq: [] });

  // Look up each submitted email via GoTrue admin (exact match). Runs in parallel; nothing is logged.
  const lookups = await Promise.all(emails.map(async (email) => {
    try {
      const url = `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`;
      const r = await fetch(url, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      if (!r.ok) return { email, id: null as string | null };
      const j = await r.json();
      const list = Array.isArray(j?.users) ? j.users : [];
      const match = list.find((u: { email?: string }) => (u?.email ?? "").toLowerCase() === email);
      return { email, id: (match?.id as string | undefined) ?? null };
    } catch {
      return { email, id: null as string | null };
    }
  }));

  const me = userRes.user.id;
  const foundIds = lookups.filter((r) => r.id && r.id !== me).map((r) => r.id as string);
  const profMap = new Map<string, { id: string; username: string | null; display_name: string | null; avatar_url: string | null }>();
  if (foundIds.length) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", foundIds);
    for (const p of profs ?? []) profMap.set(p.id, p);
  }

  const on_oniq: Array<{ user_id: string; username: string | null; display_name: string | null; avatar_url: string | null; email: string }> = [];
  const not_on_oniq: string[] = [];
  for (const r of lookups) {
    if (r.id && r.id !== me && profMap.has(r.id)) {
      const p = profMap.get(r.id)!;
      // email echoed here is exactly what the caller themselves submitted.
      on_oniq.push({ user_id: p.id, username: p.username, display_name: p.display_name, avatar_url: p.avatar_url, email: r.email });
    } else {
      not_on_oniq.push(r.email);
    }
  }

  return json({ on_oniq, not_on_oniq });
});
