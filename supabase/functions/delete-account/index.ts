// Delete-account edge function.
// Verifies the caller's JWT, then uses the service role to remove the auth
// user. Cascades on public.profiles.id → auth.users(id) clean up owned rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userRes?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
  const uid = userRes.user.id;

  // Purge the user's storage objects (media, thumbnails, documents).
  // DB rows cascade off auth.users; storage objects do not — do it here.
  const purgeFolder = async (bucket: string, prefix: string, depth = 0): Promise<void> => {
    if (depth > 3) return;
    for (let page = 0; page < 50; page++) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100 });
      if (error || !data || data.length === 0) return;
      const files = data.filter((o) => o.id).map((o) => `${prefix}/${o.name}`);
      const folders = data.filter((o) => !o.id).map((o) => `${prefix}/${o.name}`);
      if (files.length > 0) await admin.storage.from(bucket).remove(files);
      for (const f of folders) await purgeFolder(bucket, f, depth + 1);
      if (files.length === 0 && folders.length === 0) return;
      if (data.length < 100 && folders.length === 0) return;
    }
  };
  for (const bucket of ["clips", "chat-media", "moments", "verification-docs"]) {
    try {
      await purgeFolder(bucket, uid);
    } catch {
      // Best-effort per bucket; auth-row deletion below still removes access.
    }
  }

  // Best-effort: remove profile row first (in case cascade FK isn't set).
  await admin.from("profiles").delete().eq("id", uid);

  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) {
    return new Response(JSON.stringify({ error: delErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
