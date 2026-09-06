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
// It has since taken a third question of the same shape: whether Vertex will
// let this credential read the voice catalogue. That one is a re-run rather
// than a discovery — see the comment on the probe itself for why the wording
// of the refusal, not its status code, is what carries the answer.
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
import {
  FIREBASE_BUCKET,
  STORAGE_PERMISSIONS,
  testPermissionsUrl,
} from "../_shared/firebaseServer.ts";

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
  const [webApps, databases, bucket, perms, classroom, drive, vertexVoices] = await Promise.all([
    get(`https://firebase.googleapis.com/v1beta1/projects/${p}/webApps`, auth.token),
    get(`https://firestore.googleapis.com/v1/projects/${p}/databases`, auth.token),
    get(`https://storage.googleapis.com/storage/v1/b/${FIREBASE_BUCKET}`, auth.token),
    // CAN THIS CREDENTIAL REACH THE STUDENT'S GOOGLE ACCOUNT? Asked, not
    // assumed. The ONIQ Study mapping puts Classroom behind four capabilities
    // (assignments, courses, coursework, grades) and Drive behind one, and the
    // whole plan turns on whether the service account already in hand opens
    // them. Two read-only GETs settle it in Google's own words, which is worth
    // more than a paragraph of mine — and the answer, whichever way it goes,
    // is the difference between a week of wiring and a console task nobody
    // has started.
    get("https://classroom.googleapis.com/v1/courses?pageSize=1", auth.token),
    get("https://www.googleapis.com/drive/v3/about?fields=user", auth.token),
    // "May this credential write?" asked WITHOUT writing. testIamPermissions
    // returns only the permissions actually held, so an empty list is a
    // definite no rather than an ambiguous error — which is exactly the
    // property the Firestore HTML 404 lacked.
    get(testPermissionsUrl(FIREBASE_BUCKET), auth.token),
    // THE VOICE-CLONE BLOCKER, ASKED THE ONLY WAY IT CAN BE ASKED. Measured
    // 2026-09-06 this exact URL refused with 403 PERMISSION_DENIED naming
    // "aiplatform.voices.list denied on projects/oniq-309bd/locations/global"
    // — itself an ADVANCE on the 401 CREDENTIALS_MISSING of 2026-09-04, which
    // is what established that the credential is accepted and the block is
    // authorization. The owner then granted the service account a Vertex role.
    // The hypothesis recorded beside that measurement is that an ALLOWLIST or
    // preview refusal can wear the same 403, so the grant landing and the
    // grant being enough are two different questions.
    //
    // RE-RUNNING THE IDENTICAL URL IS WHAT SEPARATES THEM, AND THE ANSWER IS
    // IN THE MESSAGE, NOT THE STATUS CODE. The same aiplatform.voices.list
    // wording means the grant did not reach THIS principal; different wording
    // at the same 403 means IAM is satisfied and something else refuses. That
    // is the same shape as the SMS region policy, where OPERATION_NOT_ALLOWED
    // became MISSING_CLIENT_IDENTIFIER and reading only the status code would
    // have reported no change at all.
    //
    // So this URL must stay byte-identical to the one that produced the 403.
    // Move it to a region, a different API version, or the v1 surface and the
    // comparison is worth nothing — pinned in firebaseServerPaths.test.ts.
    get(
      `https://aiplatform.googleapis.com/v1beta1/projects/${p}/locations/global/voices`,
      auth.token,
    ),
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
      // Storage is the one service whose SERVER-SIDE path needs nothing from
      // any console, so this is the answer that unblocks work rather than
      // merely reporting on it.
      storageWritable: perms.ok
        ? STORAGE_PERMISSIONS.every((x) =>
            ((perms.data as { permissions?: string[] })?.permissions ?? []).includes(x),
          )
        : "unknown — see storagePermissions.error",
      // NOT "is voice cloning built" — it is not. No deployed function imports
      // _shared/voiceReplication.ts, and voice-generate can only ask for a
      // prebuilt voiceName. This answers the narrower question that gates it:
      // whether Google lets this credential see the voice catalogue at all.
      vertexVoicesReadable: vertexVoices.ok ? true : "no — see vertexVoices.error",
    },
    webApps: webApps.ok
      ? { count: apps.length, apps: apps.map((a) => ({ name: a.name, appId: a.appId })) }
      : webApps,
    // Public client config, not a credential — see the header.
    webConfig: webConfig?.ok ? webConfig.data : webConfig,
    databases: databases.ok ? databases.data : databases,
    bucket: bucket.ok
      ? {
          name: (bucket.data as { name?: string })?.name,
          location: (bucket.data as { location?: string })?.location,
          created: (bucket.data as { timeCreated?: string })?.timeCreated,
        }
      : bucket,
    // Classroom and Drive belong to the STUDENT, not to the project, so a
    // service account cannot read them without domain-wide delegation granted
    // by the school's Workspace admin. That is the expected answer; it is
    // reported rather than assumed, and Google's refusal names which of the
    // two reasons applies (missing scope vs missing consent).
    googleWorkspace: {
      classroom: classroom.ok ? { reachable: true } : classroom,
      drive: drive.ok ? { reachable: true } : drive,
    },
    // Google's refusal verbatim, because here the WORDING is the whole signal
    // and a summarised one would erase it. See the probe's comment above.
    vertexVoices: vertexVoices.ok
      ? { voices: ((vertexVoices.data as { voices?: unknown[] })?.voices ?? []).length }
      : vertexVoices,
    // The permissions actually held, listed — so a partial grant is visible
    // as a partial grant rather than collapsing to a bare false.
    storagePermissions: perms.ok
      ? {
          asked: STORAGE_PERMISSIONS,
          held: (perms.data as { permissions?: string[] })?.permissions ?? [],
        }
      : perms,
  });
});
