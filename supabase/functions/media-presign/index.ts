// Track A4 — the server half. Presigns R2 multipart uploads and signed reads.
//
// THE BYTES NEVER PASS THROUGH HERE.
//
// An edge function that proxied a 200 MB upload would buffer it, time out, and
// cost egress twice. Instead this hands back short-lived presigned URLs and
// the phone talks to R2 directly. That is also why the client can stream a
// file.slice() straight into fetch: there is no intermediary to buffer it.
//
// WHAT THIS ENFORCES THAT THE CLIENT CANNOT
//
// The client-side 200 MB check is a courtesy so the user is told immediately.
// It is not a control — anything that can call this endpoint can lie about a
// size. So the cap is checked again here, and the presigned part URLs are only
// issued for a plan this function computed itself.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";
import { corsHeaders, json } from "../_shared/llm.ts";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;
/** Long enough to upload a part on poor mobile data, short enough to expire. */
const PART_URL_TTL_SECONDS = 3600;
const BUCKET = "oniq-chat-media";

/**
 * Signatures, never extensions — renaming payload.exe to holiday.pdf defeats
 * an extension check completely.
 *
 * This is a SUBSET of BLOCKED_MAGIC_BYTES in src/config/mediaStorage.ts: the
 * ZIP signature 504B0304 is deliberately absent HERE. Every .docx, .xlsx,
 * .pptx and .zip begins with those same four bytes, so blocking them at the
 * server would reject the office documents chat explicitly allows. The client
 * screen still refuses an .apk by that signature at pick time; the server
 * refuses the signatures that can only ever be an executable.
 */
const BLOCKED_MAGIC_BYTES = [
  { hex: "4D5A", label: "a Windows program" },
  { hex: "7F454C46", label: "a Linux program" },
  { hex: "CAFEBABE", label: "a Java program" },
  { hex: "FEEDFACE", label: "a macOS program" },
  { hex: "CEFAEDFE", label: "a macOS program" },
  { hex: "CFFAEDFE", label: "a macOS program" },
  { hex: "2321", label: "a script" },
];

/** Not the bucket location. See R2_SIGNING_REGION in config/mediaStorage.ts. */
const SIGNING_REGION = "auto";

type Env = { r2: AwsClient; endpoint: string };

function readEnv(): Env | { error: string } {
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
  const accountId = Deno.env.get("R2_ACCOUNT_ID") ?? "";
  const endpoint =
    Deno.env.get("R2_S3_ENDPOINT") ??
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

  const missing = [
    !accessKeyId && "R2_ACCESS_KEY_ID",
    !secretAccessKey && "R2_SECRET_ACCESS_KEY",
    !endpoint && "R2_ACCOUNT_ID (or R2_S3_ENDPOINT)",
  ].filter(Boolean);

  // Name what is missing. "Not configured" sends someone hunting; this does
  // not, and none of these names is itself a secret.
  if (missing.length) return { error: `missing secrets: ${missing.join(", ")}` };

  return {
    endpoint,
    r2: new AwsClient({ accessKeyId, secretAccessKey, region: SIGNING_REGION, service: "s3" }),
  };
}

/** Presign a URL by signing the query rather than a header. */
async function presign(env: Env, method: string, path: string, ttl: number): Promise<string> {
  const url = new URL(`${env.endpoint}/${BUCKET}${path}`);
  url.searchParams.set("X-Amz-Expires", String(ttl));
  const signed = await env.r2.sign(new Request(url, { method }), {
    aws: { signQuery: true, service: "s3", region: SIGNING_REGION },
  });
  return signed.url;
}

/** Object keys are namespaced per user so one account cannot touch another's. */
function objectKey(userId: string, uploadRef: string): string {
  return `u/${userId}/${uploadRef}`;
}

/** Same split as the client's planParts. Recomputed here, never trusted. */
function planParts(size: number): Array<{ partNumber: number; start: number; end: number }> {
  const parts = [];
  let start = 0;
  let n = 1;
  while (start < size) {
    const end = Math.min(start + UPLOAD_CHUNK_BYTES, size);
    parts.push({ partNumber: n, start, end });
    start = end;
    n += 1;
  }
  return parts;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { error: "unauthorized" });

  const supaUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supaUrl || !anon) return json(500, { error: "not configured" });

  const token = authHeader.slice(7);

  /**
   * The service role may run `check`, and nothing else.
   *
   * Verifying the R2 credentials should not require signing in as a real
   * person and uploading a real file — that turns "are the keys good?" into a
   * multi-step errand, which is how a broken key gets discovered by a user
   * instead of by us.
   *
   * This grants no new authority. Anyone holding the service role key already
   * has full database access; letting them list one object in a bucket adds
   * nothing to what they can do. Every other action still needs a real user,
   * because every other action writes objects under a specific user's prefix.
   */
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isOperator = serviceKey.length > 20 && token === serviceKey;

  let userId = "";
  if (!isOperator) {
    const asUser = createClient(supaUrl, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await asUser.auth.getUser(token);
    if (userErr || !userData?.user) return json(401, { error: "unauthorized" });
    userId = userData.user.id;
  }

  const env = readEnv();
  if ("error" in env) return json(503, { error: env.error, configured: false });

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");

  try {
    // ---- check ------------------------------------------------------------
    // Proves the credentials work, without uploading anything. This exists so
    // "did my keys land?" is one call rather than a failed 200 MB upload.
    if (action === "check") {
      const url = new URL(`${env.endpoint}/${BUCKET}?max-keys=1&list-type=2`);
      const res = await env.r2.fetch(new Request(url, { method: "GET" }));
      if (res.ok) return json(200, { ok: true, bucket: BUCKET, endpoint: env.endpoint });
      const text = await res.text().catch(() => "");
      // 403 here is nearly always the region: R2 signs with "auto", not the
      // bucket's location. Say so rather than letting it read as a bad key.
      const hint =
        res.status === 403
          ? "403 from R2. Check the token is scoped to this bucket with Object Read & Write, and that signing region is 'auto' (not the bucket location)."
          : res.status === 404
            ? `Bucket ${BUCKET} not found at ${env.endpoint} — check R2_ACCOUNT_ID.`
            : "";
      return json(200, { ok: false, status: res.status, hint, detail: text.slice(0, 400) });
    }

    // Everything past this point writes or reads objects under a specific
    // user's prefix, so it needs a real user. The operator shortcut above
    // stops here.
    if (!userId) return json(403, { error: "this action needs a signed-in user" });

    // The service client exists for the metadata ledger only: chat_media rows
    // are written here, never by the client, so a caller cannot mint a row
    // claiming a key it does not own or an expiry it prefers.
    const svc = serviceKey.length > 20 ? createClient(supaUrl, serviceKey) : null;

    // ---- create -----------------------------------------------------------
    if (action === "create") {
      const size = Number(body?.size);
      if (!Number.isFinite(size) || size <= 0) return json(400, { error: "bad size" });
      // The control, not the courtesy. The client already checked; this is the
      // one that counts, because a client can lie.
      if (size > MAX_UPLOAD_BYTES) return json(413, { error: "file too large" });

      // Per-user rate cap, decided in the database rather than in an isolate:
      // an in-memory counter resets on every cold start, which is no cap.
      if (svc) {
        const { data: gate } = await svc.rpc("media_upload_allowed", {
          _user: userId,
          _size: size,
        });
        if (gate && gate.allowed === false) {
          return json(429, { error: String(gate.reason ?? "slow down a moment") });
        }
      }

      const uploadRef = crypto.randomUUID();
      const key = objectKey(userId, uploadRef);

      const initUrl = new URL(`${env.endpoint}/${BUCKET}/${key}?uploads`);
      const init = await env.r2.fetch(new Request(initUrl, { method: "POST" }));
      if (!init.ok) {
        console.error("r2 create failed", init.status, await init.text().catch(() => ""));
        return json(502, { error: "couldn't start the upload" });
      }
      const xml = await init.text();
      const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1];
      if (!uploadId) return json(502, { error: "couldn't start the upload" });

      if (svc) {
        await svc.from("chat_media").insert({
          owner_id: userId,
          r2_key: key,
          upload_id: uploadId,
          size_bytes: size,
          mime: typeof body?.mime === "string" ? body.mime.slice(0, 120) : null,
          file_name: typeof body?.fileName === "string" ? body.fileName.slice(0, 200) : null,
          status: "pending",
        });
      }

      const parts = planParts(size);
      const urls = await Promise.all(
        parts.map(async (p) => ({
          partNumber: p.partNumber,
          start: p.start,
          end: p.end,
          url: await presign(
            env,
            "PUT",
            `/${key}?partNumber=${p.partNumber}&uploadId=${encodeURIComponent(uploadId)}`,
            PART_URL_TTL_SECONDS,
          ),
        })),
      );

      return json(200, { key, uploadId, parts: urls });
    }

    // ---- complete / abort -------------------------------------------------
    if (action === "complete" || action === "abort") {
      const key = String(body?.key ?? "");
      const uploadId = String(body?.uploadId ?? "");
      // A caller may only finish an upload under their OWN prefix. Without
      // this, one account could complete or abort another's upload.
      if (!key.startsWith(`u/${userId}/`)) return json(403, { error: "not your upload" });
      if (!uploadId) return json(400, { error: "missing uploadId" });

      const url = new URL(
        `${env.endpoint}/${BUCKET}/${key}?uploadId=${encodeURIComponent(uploadId)}`,
      );

      if (action === "abort") {
        const res = await env.r2.fetch(new Request(url, { method: "DELETE" }));
        if (svc) await svc.from("chat_media").delete().eq("r2_key", key);
        return json(res.ok ? 200 : 502, { ok: res.ok });
      }

      const parts = Array.isArray(body?.parts) ? body.parts : [];
      if (!parts.length) return json(400, { error: "no parts" });
      const xml =
        "<CompleteMultipartUpload>" +
        parts
          .slice()
          .sort(
            (a: { partNumber: number }, b: { partNumber: number }) => a.partNumber - b.partNumber,
          )
          .map(
            (p: { partNumber: number; etag: string }) =>
              `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`,
          )
          .join("") +
        "</CompleteMultipartUpload>";

      const res = await env.r2.fetch(
        new Request(url, {
          method: "POST",
          body: xml,
          headers: { "Content-Type": "application/xml" },
        }),
      );
      if (!res.ok) {
        console.error("r2 complete failed", res.status, await res.text().catch(() => ""));
        return json(502, { error: "couldn't finish the upload" });
      }

      // Signature check on the STORED bytes, by content and never by
      // extension. The client screens too, but the client is the thing being
      // defended against — renaming payload.exe to holiday.pdf defeats an
      // extension check completely. A ranged GET reads 8 bytes, not the file.
      const headUrl = await presign(env, "GET", `/${key}`, 60);
      const headRes = await fetch(headUrl, { headers: { Range: "bytes=0-7" } });
      if (headRes.ok) {
        const head = new Uint8Array(await headRes.arrayBuffer());
        const hex = Array.from(head)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase();
        const blocked = BLOCKED_MAGIC_BYTES.find((s) => hex.startsWith(s.hex));
        if (blocked) {
          await env.r2.fetch(
            new Request(new URL(`${env.endpoint}/${BUCKET}/${key}`), { method: "DELETE" }),
          );
          if (svc) await svc.from("chat_media").delete().eq("r2_key", key);
          return json(415, { error: `that looks like ${blocked.label}, not a photo or video` });
        }
      }

      if (svc) await svc.from("chat_media").update({ status: "ready" }).eq("r2_key", key);
      return json(200, { ok: true, key });
    }

    // ---- attach -------------------------------------------------------------
    // Ties a finished object to the message that carries it, so that deleting
    // the message deletes the bytes (the trigger reads this link).
    if (action === "attach") {
      const key = String(body?.key ?? "");
      const messageId = String(body?.messageId ?? "");
      if (!key.startsWith(`u/${userId}/`)) return json(403, { error: "not your upload" });
      if (!messageId) return json(400, { error: "missing messageId" });
      if (svc) {
        await svc
          .from("chat_media")
          .update({ message_id: messageId })
          .eq("r2_key", key)
          .eq("owner_id", userId);
      }
      return json(200, { ok: true });
    }

    // ---- signed read ------------------------------------------------------
    if (action === "get") {
      const key = String(body?.key ?? "");
      if (!key.startsWith("u/")) return json(400, { error: "bad key" });

      // A recipient is not the owner, so ownership alone cannot gate reads —
      // but neither can "anyone who knows a key". The link is the message: you
      // may read an object if you are in the conversation it was sent to.
      if (!key.startsWith(`u/${userId}/`)) {
        if (!svc) return json(403, { error: "not yours" });
        const { data: row } = await svc
          .from("chat_media")
          .select("message_id, status")
          .eq("r2_key", key)
          .maybeSingle();
        if (!row?.message_id || row.status === "deleted") return json(403, { error: "not yours" });
        const { data: msg } = await svc
          .from("messages")
          .select("conversation_id, is_deleted")
          .eq("id", row.message_id)
          .maybeSingle();
        if (!msg || msg.is_deleted) return json(403, { error: "not yours" });
        const { data: member } = await svc
          .from("conversation_members")
          .select("user_id")
          .eq("conversation_id", msg.conversation_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (!member) return json(403, { error: "not yours" });
      }

      // Short TTL — signed URLs are cheap to reissue, and a long-lived one
      // forwarded out of the app is an unrevocable public link.
      const url = await presign(env, "GET", `/${key}`, SIGNED_URL_TTL_SECONDS);
      return json(200, { url, expiresIn: SIGNED_URL_TTL_SECONDS });
    }

    return json(400, { error: "unknown action" });
  } catch (e) {
    console.error("media-presign error", e);
    return json(500, { error: "something went sideways" });
  }
});
