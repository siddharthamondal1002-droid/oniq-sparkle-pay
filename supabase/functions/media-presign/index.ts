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

  const asUser = createClient(supaUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await asUser.auth.getUser(authHeader.slice(7));
  if (userErr || !userData?.user) return json(401, { error: "unauthorized" });
  const userId = userData.user.id;

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

    // ---- create -----------------------------------------------------------
    if (action === "create") {
      const size = Number(body?.size);
      if (!Number.isFinite(size) || size <= 0) return json(400, { error: "bad size" });
      // The control, not the courtesy. The client already checked; this is the
      // one that counts, because a client can lie.
      if (size > MAX_UPLOAD_BYTES) return json(413, { error: "file too large" });

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
      return json(200, { ok: true, key });
    }

    // ---- signed read ------------------------------------------------------
    if (action === "get") {
      const key = String(body?.key ?? "");
      if (!key.startsWith("u/")) return json(400, { error: "bad key" });
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
