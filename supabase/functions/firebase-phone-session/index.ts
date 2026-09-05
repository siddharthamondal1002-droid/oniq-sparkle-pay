/**
 * Exchange a verified Firebase phone token for an ordinary Supabase session.
 *
 * OWNER DIRECTIVE 2026-09-05 (final): "I added firebase for mobile number
 * authentication only." Firebase sends the SMS and proves the person holds the
 * number. It does NOT become ONIQ's identity — Supabase stays that, Google
 * sign-in is untouched, and the 125 accounts and 242 RLS policies do not move.
 *
 * THE FIREBASE UID NEVER CROSSES. Only the verified `phone_number` does. The
 * session handed back is a normal Supabase session for a normal Supabase user,
 * so `auth.uid()` keeps returning the UUID every policy already compares
 * against. That is the whole reason this shape has no migration attached to it:
 * the uid problem that sank the identity-switch plan cannot arise here.
 *
 * UNAUTHENTICATED BY NECESSITY — nobody is signed in yet — so the SIGNATURE IS
 * THE SECURITY. `verifyFirebaseIdToken` checks the RS256 signature against
 * Google's published keys before a single claim is read, then that the token
 * was minted for THIS project, has not expired, and came from the PHONE
 * provider with a real number attached. That last check matters more than it
 * looks: Email/Password self-signup is open on this project to anyone holding
 * the public web key, so "a validly signed Firebase token" and "someone who
 * proved a phone number" are not the same thing.
 *
 * It spends no money. Firebase already sent the SMS, client-side, behind its
 * own reCAPTCHA — so unlike `send-otp` there is nothing here for a flood to
 * burn except CPU, and every request still has to carry a token Google signed.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { FIREBASE_JWKS_URL, verifyFirebaseIdToken } from "../_shared/firebaseIdToken.ts";
import { normalizeIndian, syntheticEmail } from "../_shared/phoneIdentity.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/**
 * Google's signing keys, cached per isolate.
 *
 * Caching a PUBLIC key is safe in a way that caching a rate-limit counter is
 * not: the worst a cold isolate costs is one extra fetch, and correctness
 * never depends on isolates agreeing. `force` refetches when a token names a
 * `kid` we have not seen, which is what a key rotation looks like from here.
 */
let jwksCache: { at: number; keys: unknown[] } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function fetchJwks(force: boolean): Promise<never[]> {
  if (!force && jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) {
    return jwksCache.keys as never[];
  }
  const r = await fetch(FIREBASE_JWKS_URL);
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  const body = await r.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  jwksCache = { at: Date.now(), keys };
  return keys as never[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const projectId = Deno.env.get("FIREBASE_PROJECT_ID") ?? "oniq-309bd";

  let body: { idToken?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const idToken = String(body.idToken ?? "").trim();
  if (!idToken) return json({ error: "missing idToken" }, 400);

  let result;
  try {
    result = await verifyFirebaseIdToken(idToken, projectId, fetchJwks);
  } catch (e) {
    // A JWKS fetch failure is NOT permission to skip verification.
    console.error("firebase token verification threw", e);
    return json({ error: "could not verify right now — try again" }, 503);
  }
  if (!result.ok) {
    // The specific reason goes to the log, never to the caller: telling an
    // unauthenticated caller which check they failed tells them how to pass it.
    console.warn("firebase token rejected:", result.reason);
    return json({ error: "that sign-in could not be verified" }, 401);
  }

  const phone = normalizeIndian(result.claims.phone_number ?? "");
  if (!phone) {
    console.warn("verified token carried a non-Indian number");
    return json({ error: "that number is not supported yet" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Same derivation as verify-otp and msg91-verify-session, from the shared
  // module — a fourth private copy is how one person becomes two accounts.
  const email = syntheticEmail(phone);
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { phone, phone_verified: true, auth_via: "firebase_phone" },
  });
  // "Already registered" is the RETURNING user, which is the common case, not
  // an error. Anything else is.
  if (created.error && !/(already|exists|registered)/i.test(created.error.message)) {
    console.error("createUser failed", created.error);
    return json({ error: "sign-in failed — try again" }, 500);
  }

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const token_hash = link.data?.properties?.hashed_token;
  if (link.error || !token_hash) {
    console.error("generateLink failed", link.error);
    return json({ error: "sign-in failed — try again" }, 500);
  }

  return json({ verified: true, email, token_hash });
});
