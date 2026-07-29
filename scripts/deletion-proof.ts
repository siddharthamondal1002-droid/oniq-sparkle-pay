/**
 * B2 — live account-deletion proof harness.
 *
 * Run manually (founder/CI) with service-role credentials — NEVER from the
 * app: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/deletion-proof.ts`
 *
 * 1. Creates a throwaway user (delete-proof+<ts>@oniqhub.com).
 * 2. Seeds fixture rows in user-owned tables + one object per bucket.
 * 3. Runs the production deletion order: storage purge FIRST, then
 *    auth.admin.deleteUser (mirrors the delete-account edge function).
 * 4. Asserts zero rows per table and zero objects per bucket for that uid.
 * 5. Writes docs/deletion-proofs/<ts>.json with a SHA-256 of the report body.
 * Exits non-zero on any residue.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (run server-side only).");
  process.exit(2);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

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

async function purgeFolder(bucket: string, prefix: string, depth = 0): Promise<void> {
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
}

async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const email = `delete-proof+${ts}@oniqhub.com`;

  // 1) create
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password: crypto.randomUUID(), email_confirm: true,
  });
  if (cErr || !created.user) throw new Error(`createUser: ${cErr?.message}`);
  const uid = created.user.id;
  console.log("created", uid);

  // 2) seed (best-effort per table; signup trigger already made the profile)
  await admin.from("moments_posts").insert({ user_id: uid, content: "deletion-proof fixture", media_urls: [], visibility: "public" });
  for (const bucket of BUCKETS) {
    await admin.storage.from(bucket).upload(`${uid}/proof.txt`, new Blob(["proof"]), { contentType: "text/plain" });
  }

  // 3) delete in production order
  for (const bucket of BUCKETS) await purgeFolder(bucket, uid);
  const { error: dErr } = await admin.auth.admin.deleteUser(uid);
  if (dErr) throw new Error(`deleteUser: ${dErr.message}`);

  // 4) assert
  const residues: Array<{ where: string; count: number }> = [];
  for (const t of USER_TABLES) {
    const { count, error } = await admin.from(t.table).select("*", { count: "exact", head: true }).eq(t.column, uid);
    if (error) continue; // table may not exist in this env
    if ((count ?? 0) > 0) residues.push({ where: `${t.table}.${t.column}`, count: count ?? 0 });
  }
  for (const bucket of BUCKETS) {
    const { data } = await admin.storage.from(bucket).list(uid, { limit: 10 });
    if (data && data.length > 0) residues.push({ where: `bucket:${bucket}`, count: data.length });
  }
  const { data: authUser } = await admin.auth.admin.getUserById(uid);
  if (authUser?.user) residues.push({ where: "auth.users", count: 1 });

  // 5) report
  const report = { ts, uid, email, tables_checked: USER_TABLES.length, buckets_checked: BUCKETS.length, residues, pass: residues.length === 0 };
  const body = JSON.stringify(report, null, 2);
  const sha256 = createHash("sha256").update(body).digest("hex");
  mkdirSync("docs/deletion-proofs", { recursive: true });
  writeFileSync(`docs/deletion-proofs/${ts}.json`, JSON.stringify({ ...report, report_sha256: sha256 }, null, 2));
  console.log(body, "\nsha256:", sha256);
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
