// firebase-provisioning — what actually exists in the Firebase project.
//
// READ-ONLY, DELIBERATELY. It lists; it creates nothing. Owner directive
// 2026-09-05 moves identity, chat and files onto Firebase, and two facts gate
// the whole plan: whether a WEB APP is registered (without one the JS SDK has
// no config and nothing client-side can ship) and whether FIRESTORE is
// provisioned. Neither can be read from a dev container:
//
//   - firestore.googleapis.com/v1/projects/<p>/databases/(default)/documents
//     returns Google's generic HTML 404 for a project that certainly does not
//     exist just as readily as for oniq-309bd, so that probe says NOTHING.
//   - an unauthenticated read of oniq-309bd.firebasestorage.app also 404s,
//     yet google-services.json names that bucket as the project's own — so
//     Storage IS provisioned and the probe alone concludes the opposite.
//
// Both were measured. A probe that answers the same way for "absent" and for
// "not allowed to look" is not evidence, and this function exists because the
// only credential that CAN answer lives as a Supabase secret and nowhere else.
//
// WHY IT IS AN EDGE FUNCTION AND NOT A SCRIPT. FIREBASE_SERVICE_ACCOUNT is
// readable here and in no other place ONIQ controls — not the dev container,
// not CI, not the Lovable sandbox. googleAuth.ts already mints a token from it
// with the cloud-platform scope, which is what the Firebase Management and
// Firestore Admin APIs want, so this reuses the exact credential path that
// FCM and weather already run on rather than introducing a second one.
//
// ADMINS ONLY. Project administration is not a user surface. The gate is the
// one deletion-proof uses: the caller's own JWT is re-derived server-side and
// checked against is_admin. A hidden endpoint is not a gate.
//
// NO CREDENTIAL IS EVER RETURNED. Not the service account, not the access
// token, not a refresh token. The web app CONFIG is returned, and that is
// deliberate and safe: a Firebase web apiKey is a public project identifier
// that ships inside every client bundle — the Android one is already
// committed at android/app/google-services.json — and is restricted by
// Security Rules and API-key restrictions, never by secrecy.
//
// GOOGLE'S OWN WORDS ARE PASSED THROUGH on failure. The weather build turned
// on this: a refusal that names the missing role ("Grant the caller the
// roles/serviceusage.serviceUsageConsumer role") is the difference between a
// fixable answer and a shrug. A summarised error would have cost a day.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/llm.ts";
import { googleAccessToken } from "../_shared/googleAuth.ts";

/** The project FCM, Vertex and weather already run on. One project, not two. */
const FIREBASE_PROJECT_ID = "oniq-309bd";

type Probe = {
  ok: boolean;
  status: number;
  /** Google's own status string and message, verbatim, when it refuses. */
  error?: { status?: string; message?: string };
  data?: unknown;
};

/** GET a Google API and keep whatever it says, refusal included. */
async function get(url: string, token: string): Promise<Probe> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    return { ok: false, status: 0, error: { message: `fetch failed: ${(e as Error).message}` } };
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Google answers some wrong-path requests with an HTML page. Say so
    // rather than pretending it was JSON — that HTML 404 is exactly the
    // shape that already misled one probe.
    return {
      ok: false,
      status: res.status,
      error: { status: "NON_JSON", message: text.slice(0, 200) },
    };
  }
  const err = (body as { error?: { status?: string; message?: string } })?.error;
  if (!res.ok || err) {
    return {
      ok: false,
      status: res.status,
      error: { status: err?.status, message: err?.message?.slice(0, 400) },
    };
  }
  return { ok: true, status: res.status, data: body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // ---- admins only, re-derived from the caller's own JWT ------------------
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  if (!token) return json(401, { error: "Unauthorized" });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: userRes, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userRes?.user) return json(401, { error: "Unauthorized" });
  const { data: isAdmin } = await admin.rpc("is_admin", { _uid: userRes.user.id });
  if (isAdmin !== true) return json(403, { error: "Admins only" });

  // ---- the credential -----------------------------------------------------
  const auth = await googleAccessToken();
  if (!auth.ok) {
    // Names the missing SECRET, never a value — googleAuth guarantees that.
    return json(200, { configured: false, reason: auth.reason });
  }

  const p = FIREBASE_PROJECT_ID;
  const [webApps, databases] = await Promise.all([
    get(`https://firebase.googleapis.com/v1beta1/projects/${p}/webApps`, auth.token),
    get(`https://firestore.googleapis.com/v1/projects/${p}/databases`, auth.token),
  ]);

  // A registered web app is useless without its config, so fetch it in the
  // same round rather than making the caller come back for it.
  let webConfig: Probe | null = null;
  const apps = (webApps.data as { apps?: { name?: string; appId?: string }[] })?.apps ?? [];
  if (webApps.ok && apps.length > 0 && apps[0].name) {
    webConfig = await get(
      `https://firebase.googleapis.com/v1beta1/${apps[0].name}/config`,
      auth.token,
    );
  }

  return json(200, {
    configured: true,
    project: p,
    // The two questions this exists to answer, stated plainly.
    answers: {
      webAppRegistered: webApps.ok ? apps.length > 0 : "unknown — see webApps.error",
      firestoreProvisioned: databases.ok
        ? ((databases.data as { databases?: unknown[] })?.databases ?? []).length > 0
        : "unknown — see databases.error",
    },
    webApps: webApps.ok
      ? { count: apps.length, apps: apps.map((a) => ({ name: a.name, appId: a.appId })) }
      : webApps,
    // Public client config, not a credential — see the header.
    webConfig: webConfig?.ok ? webConfig.data : webConfig,
    databases: databases.ok ? databases.data : databases,
  });
});
