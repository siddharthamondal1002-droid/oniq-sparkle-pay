// r2-probe — does the edge runtime's R2 credential actually write the bucket
// the still store needs? Asked of R2 directly, with the SAME environment and
// the SAME signing client story-still uses, and answered with R2's own error
// code. Built 2026-09-03 after three films answered `still-store-403` and a
// rotated token changed nothing: a status is not a diagnosis, and a film is
// not a probe.
//
// SERVICE ROLE ONLY. The gateway verifies a JWT (this function has no
// verify_jwt = false entry in config.toml, so the default holds), and on top
// of that the bearer must BE the service-role key: an anon key is a valid JWT
// and must not reach a function that writes to a bucket. No credential value
// is ever returned — only statuses, R2's error code and message, and the
// SHAPE of the endpoint (whether it is an R2 host, whether it carries a path).
//
// WHAT IT DOES, per bucket: HEAD the bucket, PUT a 12-byte probe object under
// `_probe/`, then DELETE it. The probe object is the PNG signature and four
// bytes, named so nothing can mistake it for a still. Both buckets are tried
// on purpose: a token that writes oniq-chat-media and not oniq-gpu is a scope
// problem; a token that writes neither with SignatureDoesNotMatch is a wrong
// secret; InvalidAccessKeyId on both is a key id this account does not know.
import { r2ErrorDetail, readStillStoreEnv, STILL_BUCKET } from "../_shared/stillStore.ts";
import { openStillStore } from "../_shared/stillStoreClient.ts";

const PROBE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const BUCKETS = [STILL_BUCKET, "oniq-chat-media"] as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Attempt = { status: number | null; detail: string; error?: string };

async function attempt(run: () => Promise<Response>): Promise<Attempt> {
  try {
    const res = await run();
    return { status: res.status, detail: res.ok ? "" : await r2ErrorDetail(res) };
  } catch (err) {
    return { status: null, detail: "", error: String(err).slice(0, 160) };
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!serviceKey || bearer !== serviceKey) return json({ error: "service role only" }, 401);

  const store = readStillStoreEnv((k) => Deno.env.get(k));
  if ("missing" in store) return json({ configured: false, missing: store.missing });

  let shape: Record<string, unknown>;
  try {
    const u = new URL(store.endpoint);
    shape = {
      protocol: u.protocol,
      hostIsR2: u.hostname.endsWith(".r2.cloudflarestorage.com"),
      hostLabelCount: u.hostname.split(".").length,
      path: u.pathname,
      trailingSlash: store.endpoint.endsWith("/"),
      hasQuery: u.search !== "",
    };
  } catch (err) {
    return json({ configured: true, endpointParse: String(err).slice(0, 120) });
  }

  const client = openStillStore(store);
  const stamp = Date.now();
  const results: Record<string, unknown> = {};
  for (const bucket of BUCKETS) {
    const base = `${store.endpoint}/${bucket}`;
    const key = `_probe/${stamp}.png`;
    const head = await attempt(() => client.r2.fetch(base, { method: "HEAD" }));
    const put = await attempt(() =>
      client.r2.fetch(`${base}/${key}`, {
        method: "PUT",
        body: PROBE_BYTES.buffer as ArrayBuffer,
        headers: { "content-type": "image/png" },
      }),
    );
    const del =
      put.status === 200
        ? await attempt(() => client.r2.fetch(`${base}/${key}`, { method: "DELETE" }))
        : { status: null, detail: "", error: "skipped: nothing was written" };
    results[bucket] = { headBucket: head, putProbe: put, deleteProbe: del };
  }
  return json({ configured: true, shape, results });
});
