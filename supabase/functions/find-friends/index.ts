// find-friends edge function.
// Given a list of emails (from device contacts), returns which ones are
// existing ONIQ accounts, mapped to public profiles. Emails are matched
// in-memory only — never logged, never stored.
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
  )).slice(0, 50);

  if (emails.length === 0) return json({ found: [], not_found: [] });

  // Look up each email via GoTrue admin (exact match). Runs in parallel; nothing is logged.
  const results = await Promise.all(emails.map(async (email) => {
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

  const foundIds = results.filter((r) => r.id).map((r) => r.id as string);
  let profMap = new Map<string, { id: string; username: string | null; display_name: string | null; avatar_url: string | null }>();
  if (foundIds.length) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", foundIds);
    for (const p of profs ?? []) profMap.set(p.id, p);
  }

  const me = userRes.user.id;
  const found: Array<{ email: string; profile: { id: string; username: string | null; display_name: string | null; avatar_url: string | null } }> = [];
  const not_found: string[] = [];
  for (const r of results) {
    if (r.id && r.id !== me && profMap.has(r.id)) {
      found.push({ email: r.email, profile: profMap.get(r.id)! });
    } else {
      not_found.push(r.email);
    }
  }

  return json({ found, not_found });
});
