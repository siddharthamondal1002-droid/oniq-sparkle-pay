// story-deliver — the user gets their film, and then we stop holding it.
//
// This is the half of Stories that turns a finished mp4 into something the
// person who asked for it actually has. Without it a job reaches `ready` and
// sits there: bytes on our disk, nothing on their phone.
//
// IT IS ALSO THE PURGE. The product promise is specific — "your video goes to
// your device once, then it is deleted from our servers, there is no
// re-download" — and that sentence is printed above the Generate button before
// anyone spends a second of their allowance. A promise made before the action
// has to be kept by code, not by a sweeper that might run later. `done` deletes
// the object and then marks the row, in that order.
//
// THREE ACTIONS, following the lifecycle exactly:
//
//   start   ready -> delivering, and returns a short-lived signed URL. The same
//           URL serves the preview and the save, because they are the same
//           bytes and issuing two would mean two chances to leak one.
//   done    delivering -> delivered -> purged, with the object deleted first.
//   cancel  delivering -> ready, for a download that failed. The lifecycle
//           allows this specifically so a dropped connection does not cost
//           somebody their film.
//
// OWNERSHIP IS CHECKED AGAINST THE JWT, NOT THE BODY. The caller says which job
// it wants; this function reads that job with the service role and refuses
// unless `user_id` equals the `sub` the auth server just confirmed. A job id is
// a uuid, not a secret, and treating it as one would make every Story readable
// by anyone who could guess.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACTIONS: ReadonlySet<string> = new Set(["start", "done", "cancel"]);

/** Same bucket the episodes use. */
const BUCKET = "video-gen";

/**
 * How long a download link lives.
 *
 * Long enough to watch a five-minute preview and then save, short enough that a
 * URL copied out of a devtools panel is worthless by the time it is pasted.
 */
const SIGNED_URL_TTL_SECONDS = 900;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anon) return json({ configured: false }, 200);

    // Who is asking. Re-derived from the token by the auth server rather than
    // decoded here, because a JWT this function parses itself is a JWT this
    // function has not verified.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const who = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: anon },
    });
    if (!who.ok) return json({ error: "Unauthorized" }, 401);
    const userId = ((await who.json()) as { id?: string })?.id;
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const jobId = String(body?.jobId ?? "");
    if (!ACTIONS.has(action)) return json({ error: "unknown action" }, 400);
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json({ error: "bad job id" }, 400);

    const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    const got = await fetch(
      `${supabaseUrl}/rest/v1/story_jobs?id=eq.${jobId}&select=id,user_id,status,storage_path,has_bytes`,
      { headers: svc },
    );
    if (!got.ok) return json({ error: "could not read the job" }, 502);
    const rows = (await got.json()) as Record<string, unknown>[];
    if (!Array.isArray(rows) || rows.length === 0) return json({ error: "no such job" }, 404);
    const job = rows[0];

    // Not "forbidden" — 404. A different answer for "exists but not yours"
    // would confirm the id belongs to somebody.
    if (job.user_id !== userId) return json({ error: "no such job" }, 404);

    const patch = async (fields: Record<string, unknown>, expect?: string) => {
      const filter = expect ? `&status=eq.${expect}` : "";
      const res = await fetch(`${supabaseUrl}/rest/v1/story_jobs?id=eq.${jobId}${filter}`, {
        method: "PATCH",
        headers: { ...svc, "content-type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(fields),
      });
      const out = res.ok ? await res.json() : [];
      return Array.isArray(out) && out.length > 0;
    };

    if (action === "start") {
      const storagePath = typeof job.storage_path === "string" ? job.storage_path : "";
      if (!storagePath) return json({ error: "that Story has no file" }, 409);
      // `delivering` is allowed through as well as `ready`: a user who reloads
      // mid-preview would otherwise be locked out of their own film by a state
      // they never chose to enter.
      if (job.status !== "ready" && job.status !== "delivering") {
        return json({ error: `that Story is ${job.status}` }, 409);
      }
      if (job.status === "ready" && !(await patch({ status: "delivering" }, "ready"))) {
        return json({ error: "could not start the transfer" }, 409);
      }

      const signed = await fetch(
        `${supabaseUrl}/storage/v1/object/sign/${BUCKET}/${storagePath}`,
        {
          method: "POST",
          headers: { ...svc, "content-type": "application/json" },
          body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
        },
      );
      if (!signed.ok) {
        const detail = await signed.text().catch(() => "");
        console.error("story-deliver sign", signed.status, detail.slice(0, 300));
        // Put it back rather than stranding the job in `delivering` with no URL.
        await patch({ status: "ready" }, "delivering");
        return json({ error: "could not open that Story" }, 502);
      }
      const { signedURL, signedUrl } = (await signed.json()) as {
        signedURL?: string;
        signedUrl?: string;
      };
      const rel = signedUrl ?? signedURL;
      if (!rel) return json({ error: "no signed url returned" }, 502);
      return json({
        ok: true,
        url: `${supabaseUrl}/storage/v1${rel.startsWith("/") ? "" : "/"}${rel}`,
        expiresIn: SIGNED_URL_TTL_SECONDS,
      });
    }

    if (action === "cancel") {
      await patch({ status: "ready" }, "delivering");
      return json({ ok: true, status: "ready" });
    }

    // done: THE BYTES GO FIRST.
    //
    // Marking the row `delivered` before the delete would leave a window where
    // the database says the file is gone and the file is not, which is exactly
    // the state the sweeper exists to catch and exactly the state we should not
    // be manufacturing on the happy path. If the delete fails, the row keeps
    // has_bytes and stays claimable by the sweeper.
    const storagePath = typeof job.storage_path === "string" ? job.storage_path : "";
    if (storagePath) {
      const del = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath}`, {
        method: "DELETE",
        headers: svc,
      });
      if (!del.ok) {
        const detail = await del.text().catch(() => "");
        const gone =
          del.status === 404 || /"statusCode"\s*:\s*"404"|not[_ ]?found/i.test(detail);
        if (!gone) {
          console.error("story-deliver delete", del.status, detail.slice(0, 300));
          return json({ error: "saved, but the file could not be cleared yet" }, 502);
        }
      }
    }

    await patch({ status: "delivered", has_bytes: false }, "delivering");
    // And then purged, because the bytes are actually gone. Every path in
    // storyLifecycle ends here; leaving it at `delivered` would be waiting for
    // a sweeper to state something already true.
    await patch({ status: "purged" }, "delivered");
    return json({ ok: true, status: "purged" });
  } catch (e) {
    console.error("story-deliver fn error", e);
    return json({ error: "Something went sideways" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
