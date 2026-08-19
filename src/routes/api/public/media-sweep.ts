// Track A4 — the janitor. Deletes R2 objects that Postgres has marked gone.
//
// Two jobs, both of which the database cannot do itself because Postgres
// cannot reach R2:
//
//   1. Drain media_deletions — rows queued by the messages trigger when a
//      message is deleted. Deleting a message must delete the BYTES, not just
//      the row, or "delete" is a lie the user cannot check.
//   2. Expire old media — files live 45 days and then go, so chat storage does
//      not quietly become an archive of everything anyone ever sent.
//
// A row is marked done only once R2 confirms, so a failed delete is retried on
// the next run rather than being lost.
//
// This lives under /api/public/* because a scheduler calls it, which means the
// platform does not authenticate it — so the handler does, with a shared
// secret compared in constant time. Nothing here is reachable by a user.
import { createFileRoute } from "@tanstack/react-router";
import { AwsClient } from "aws4fetch";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "oniq-chat-media";
/** Not the bucket location — R2 signs with the literal string "auto". */
const SIGNING_REGION = "auto";
const BATCH = 200;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/media-sweep")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["MEDIA_SWEEP_SECRET"] ?? "";
        const presented = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        // An unset secret must never mean "everyone is allowed".
        if (secret.length < 20 || !constantTimeEqual(secret, presented)) {
          return new Response("forbidden", { status: 403 });
        }

        const accessKeyId = process.env["R2_ACCESS_KEY_ID"] ?? "";
        const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"] ?? "";
        const accountId = process.env["R2_ACCOUNT_ID"] ?? "";
        const endpoint =
          process.env["R2_S3_ENDPOINT"] ??
          (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
        const missing = [
          !accessKeyId && "R2_ACCESS_KEY_ID",
          !secretAccessKey && "R2_SECRET_ACCESS_KEY",
          !endpoint && "R2_ACCOUNT_ID (or R2_S3_ENDPOINT)",
        ].filter(Boolean);
        if (missing.length) {
          return Response.json(
            { error: `missing secrets: ${missing.join(", ")}` },
            { status: 503 },
          );
        }

        const r2 = new AwsClient({
          accessKeyId,
          secretAccessKey,
          region: SIGNING_REGION,
          service: "s3",
        });
        const supa = createClient(
          process.env["SUPABASE_URL"] ?? "",
          process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "",
          { auth: { persistSession: false } },
        );

        // 1. Anything past its expiry joins the queue.
        const { data: expired } = await supa
          .from("chat_media")
          .select("id, r2_key")
          .lt("expires_at", new Date().toISOString())
          .eq("status", "ready")
          .limit(BATCH);

        for (const row of expired ?? []) {
          await supa.from("media_deletions").insert({ r2_key: row.r2_key, reason: "expired" });
          await supa.from("chat_media").update({ status: "deleted" }).eq("id", row.id);
        }

        // 2. Drain the queue.
        const { data: pending } = await supa
          .from("media_deletions")
          .select("id, r2_key, attempts")
          .is("deleted_at", null)
          .order("queued_at", { ascending: true })
          .limit(BATCH);

        let deleted = 0;
        let failed = 0;
        for (const row of pending ?? []) {
          const url = new URL(`${endpoint}/${BUCKET}/${row.r2_key}`);
          const res = await r2.fetch(new Request(url, { method: "DELETE" }));
          // R2 answers 204 for a delete and 404 for an object already gone.
          // Both mean the bytes are not there, which is the outcome wanted.
          if (res.ok || res.status === 404) {
            await supa
              .from("media_deletions")
              .update({ deleted_at: new Date().toISOString(), attempts: row.attempts + 1 })
              .eq("id", row.id);
            deleted += 1;
          } else {
            failed += 1;
            await supa
              .from("media_deletions")
              .update({
                attempts: row.attempts + 1,
                last_error: `${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`,
              })
              .eq("id", row.id);
          }
        }

        return Response.json({ expiredQueued: expired?.length ?? 0, deleted, failed });
      },
    },
  },
});
