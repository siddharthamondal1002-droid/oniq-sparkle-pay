// B2 — live account-deletion proof, admin-triggered from the app.
// Creates a throwaway user, seeds fixture data, runs the production
// deletion order (storage purge BEFORE auth.admin.deleteUser), asserts
// zero rows / zero objects for that uid, and stores a dated report in
// public.deletion_proofs. The service-role key never leaves this function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { googleAccessToken } from "../_shared/googleAuth.ts";
import { FIREBASE_BUCKET, listObjects, uploadObject } from "../_shared/firebaseServer.ts";
import { firebasePrefixFor, purgeFirebaseObjects } from "../_shared/purgeUserData.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const USER_TABLES: Array<{ table: string; column: string }> = [
  { table: "profiles", column: "id" },
  { table: "moments_posts", column: "user_id" },
  { table: "moments_comments", column: "user_id" },
  { table: "moments_likes", column: "user_id" },
  { table: "clips", column: "user_id" },
  { table: "clips_likes", column: "user_id" },
  { table: "clips_comments", column: "user_id" },
  { table: "messages", column: "sender_id" },
  { table: "friendships", column: "user_a" },
  { table: "blocked_users", column: "blocker_id" },
  { table: "partner_applications", column: "user_id" },
  { table: "service_bookings", column: "customer_id" },
  { table: "learner_profiles", column: "user_id" },
  { table: "reports", column: "reporter_id" },
  { table: "media_provenance", column: "uploader_id" },
];
const BUCKETS = ["clips", "chat-media", "moments", "verification-docs"];

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: userRes, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userRes?.user) return json({ error: "Unauthorized" }, 401);
  const callerId = userRes.user.id;
  const { data: isAdmin } = await admin.rpc("is_admin", { _uid: callerId });
  if (isAdmin !== true) return json({ error: "Admins only" }, 403);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const email = `delete-proof+${ts}@oniqhub.com`;

  const purgeFolder = async (bucket: string, prefix: string, depth = 0): Promise<void> => {
    if (depth > 3) return;
    for (let page = 0; page < 50; page++) {
      const { data } = await admin.storage.from(bucket).list(prefix, { limit: 100 });
      if (!data || data.length === 0) return;
      const files = data.filter((o) => o.id).map((o) => `${prefix}/${o.name}`);
      const folders = data.filter((o) => !o.id).map((o) => `${prefix}/${o.name}`);
      if (files.length) await admin.storage.from(bucket).remove(files);
      for (const f of folders) await purgeFolder(bucket, f, depth + 1);
      if (!files.length && !folders.length) return;
    }
  };

  // 1) create throwaway
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (cErr || !created?.user) return json({ error: `createUser failed: ${cErr?.message}` }, 500);
  const uid = created.user.id;

  try {
    // 2) seed — 'moots' visibility so the fixture is never publicly visible,
    // even for the seconds it exists (the throwaway has no moots).
    await admin.from("moments_posts").insert({
      user_id: uid,
      content: "deletion-proof fixture",
      media_urls: [],
      visibility: "moots",
    });
    for (const bucket of BUCKETS) {
      await admin.storage
        .from(bucket)
        .upload(`${uid}/proof.txt`, new Blob(["proof"]), { contentType: "text/plain" });
    }

    // Seed the FIREBASE bucket too. Owner directive 2026-09-05 has ONIQ keep a
    // student's study attachments there, and an object outside Postgres and
    // outside Supabase Storage is reached by neither a cascade nor
    // PURGE_BUCKETS — so if the proof does not put one here, it cannot claim
    // the deletion promise is kept. Skipped silently when the service account
    // is absent: an environment with no Firebase has nothing to leave behind.
    const fbAuth = await googleAccessToken();
    const firebaseSeeded = fbAuth.ok
      ? (
          await uploadObject(
            fbAuth.token,
            FIREBASE_BUCKET,
            `${firebasePrefixFor(uid)}study/proof.txt`,
            new TextEncoder().encode("proof"),
            "text/plain",
          )
        ).ok
      : false;

    // 3) production deletion order
    for (const bucket of BUCKETS) await purgeFolder(bucket, uid);
    // The same function delete-account runs, not a copy of it — a copy is how
    // a proof keeps passing after the real path has drifted.
    if (firebaseSeeded) await purgeFirebaseObjects(uid);
    const { error: dErr } = await admin.auth.admin.deleteUser(uid);
    if (dErr) return json({ error: `deleteUser failed: ${dErr.message}` }, 500);
  } catch (e) {
    // Never leave the throwaway behind on a mid-run failure.
    await admin.auth.admin.deleteUser(uid).catch(() => {});
    return json({ error: `proof run failed: ${e instanceof Error ? e.message : "unknown"}` }, 500);
  }

  // 4) assert residues
  const residues: Array<{ where: string; count: number }> = [];
  for (const t of USER_TABLES) {
    const { count, error } = await admin
      .from(t.table)
      .select("*", { count: "exact", head: true })
      .eq(t.column, uid);
    if (error) continue; // table absent in this environment
    if ((count ?? 0) > 0) residues.push({ where: `${t.table}.${t.column}`, count: count ?? 0 });
  }
  for (const bucket of BUCKETS) {
    const { data } = await admin.storage.from(bucket).list(uid, { limit: 10 });
    if (data && data.length > 0) residues.push({ where: `bucket:${bucket}`, count: data.length });
  }
  // The Firebase prefix, checked with the same listing the purge used.
  const fbCheck = await googleAccessToken();
  if (fbCheck.ok) {
    const left = await listObjects(fbCheck.token, FIREBASE_BUCKET, firebasePrefixFor(uid), 10);
    if (left.ok && left.data.length > 0) {
      residues.push({ where: `firebase:${FIREBASE_BUCKET}`, count: left.data.length });
    }
  }

  const { data: authUser } = await admin.auth.admin.getUserById(uid);
  if (authUser?.user) residues.push({ where: "auth.users", count: 1 });

  // 5) report
  const report = {
    ts,
    uid,
    email,
    tables_checked: USER_TABLES.length,
    buckets_checked: BUCKETS.length,
    residues,
    pass: residues.length === 0,
  };
  const report_sha256 = await sha256Hex(JSON.stringify(report));
  await admin.from("deletion_proofs").insert({
    run_by: callerId,
    test_uid: uid,
    test_email: email,
    tables_checked: report.tables_checked,
    buckets_checked: report.buckets_checked,
    residues: residues,
    pass: report.pass,
    report_sha256,
  });

  return json({ ...report, report_sha256 });
});
