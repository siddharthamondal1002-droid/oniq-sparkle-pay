/**
 * Prove the Firebase phone sign-in path for zero money.  npx tsx scripts/prove-firebase-phone.ts
 *
 * `OTP_LOGIN_ENABLED` in `src/lib/flags.ts` says a delivered code is what flips
 * the flag, not a green build. This is the cheap half of that proof, and it
 * exists so the next session runs it instead of rebuilding it.
 *
 * WHAT IT PROVES, and it is more than it looks. Firebase TEST PHONE NUMBERS
 * (Authentication -> Sign-in method -> Phone -> numbers for testing) run the
 * entire REAL flow with a fixed code: no SMS is sent, nothing is billed, and —
 * the part that makes this possible at all — no reCAPTCHA/Play-Integrity
 * attestation is required, so it runs from a server with only the PUBLIC web
 * API key. Google still issues a genuine, signed ID token at the end of it.
 *
 * That token is then run through ONIQ's own `verifyFirebaseIdToken` against
 * GOOGLE'S LIVE JWKS. `firebaseIdToken.test.ts` has only ever seen tokens this
 * repo minted with self-generated RSA keys — which proves the checking logic
 * and proves nothing about whether it agrees with Google's actual key format,
 * kid rotation or claim shapes. This closes that gap, and the three negative
 * controls at the end are what make "ACCEPTED" mean something.
 *
 * WHAT IT DOES NOT PROVE, stated so nobody reads more into a green run:
 *
 *   - The BROWSER half. A real user's number needs a reCAPTCHA solved on an
 *     authorized domain, which no server can do. Test numbers skip exactly
 *     that step, so a pass here says nothing about whether reCAPTCHA works on
 *     oniqhub.com.
 *   - The EDGE FUNCTION. `*.supabase.co` is blocked from the dev container
 *     (403 CONNECT at the agent proxy), so POSTing the token to
 *     `firebase-phone-session` has to be done by the Lovable agent. See the
 *     `oniq-ship` skill: it is the only eye on production.
 *   - That an SMS ever ARRIVES. That is the whole point of the flag, and only
 *     a real handset can answer it.
 *
 * SETUP: a test number must be configured first, which needs the service
 * account (the Lovable agent holds it), and it should be REMOVED afterwards —
 * while it exists, anyone with the public web key can mint a Firebase token
 * for that number without any attestation.
 *
 *   PATCH https://identitytoolkit.googleapis.com/admin/v2/projects/oniq-309bd/config
 *         ?updateMask=signIn.phoneNumber.testPhoneNumbers
 *   body  {"signIn":{"phoneNumber":{"testPhoneNumbers":{"+919000000001":"654321"}}}}
 *
 * Do not paste that response body around: it also carries `hashConfig.signerKey`.
 */
import { readFileSync } from "node:fs";
import {
  verifyFirebaseIdToken,
  FIREBASE_JWKS_URL,
  splitJwt,
  type Jwk,
} from "../supabase/functions/_shared/firebaseIdToken.ts";
import { normalizeIndian, syntheticEmail } from "../supabase/functions/_shared/phoneIdentity.ts";

const PROJECT = "oniq-309bd";
const PHONE = process.env.FB_PHONE || "+919000000001";
const CODE = process.env.FB_CODE || "654321";
const IT = "https://identitytoolkit.googleapis.com/v1";

/** The web API key is PUBLIC by design — Firebase ships it in every bundle. */
function webKey(): string {
  if (process.env.VITE_FIREBASE_API_KEY) return process.env.VITE_FIREBASE_API_KEY;
  const line = readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .find((l) => l.startsWith("VITE_FIREBASE_API_KEY="));
  if (!line) throw new Error("VITE_FIREBASE_API_KEY not in env or .env");
  return line.slice("VITE_FIREBASE_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
}

const KEY = webKey();

async function post(path: string, body: unknown) {
  const r = await fetch(`${IT}/${path}?key=${KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

const errOf = (b: Record<string, unknown>) =>
  (b.error as { message?: string } | undefined)?.message ?? "";

const fetchJwks = async (): Promise<Jwk[]> => {
  const r = await fetch(FIREBASE_JWKS_URL);
  return ((await r.json()) as { keys: Jwk[] }).keys;
};

async function main() {
  console.log(`phone ${PHONE}   project ${PROJECT}\n`);

  const send = await post("accounts:sendVerificationCode", { phoneNumber: PHONE });
  console.log(`1  sendVerificationCode    ${send.status}  ${errOf(send.body) || "sessionInfo"}`);
  if (!send.body.sessionInfo) {
    // MISSING_CLIENT_IDENTIFIER here means the number is NOT configured as a
    // test number — Google is asking for the browser attestation. That is the
    // correct answer for a real number, and the reason this script needs one.
    console.log(
      errOf(send.body) === "MISSING_CLIENT_IDENTIFIER"
        ? "   not a configured test number — see SETUP in this file's header."
        : "   stopped.",
    );
    process.exit(1);
  }

  const signIn = await post("accounts:signInWithPhoneNumber", {
    sessionInfo: send.body.sessionInfo,
    code: CODE,
  });
  console.log(`2  signInWithPhoneNumber   ${signIn.status}  ${errOf(signIn.body) || "idToken"}`);
  const idToken = signIn.body.idToken as string | undefined;
  if (!idToken) process.exit(1);

  // Read the claims WITHOUT verifying, so the verdict below is judged against
  // what Google actually put in the token rather than against an assumption.
  const parts = splitJwt(idToken);
  const p = (parts?.payload ?? {}) as Record<string, unknown>;
  const h = (parts?.header ?? {}) as Record<string, unknown>;
  console.log(`   alg ${h.alg}  kid ${String(h.kid).slice(0, 12)}…`);
  console.log(`   iss ${p.iss}`);
  console.log(
    `   aud ${p.aud}  phone ${p.phone_number}  provider ${(p.firebase as { sign_in_provider?: string })?.sign_in_provider}`,
  );

  const verdict = await verifyFirebaseIdToken(idToken, PROJECT, fetchJwks);
  console.log(`\n3  verifyFirebaseIdToken   ${verdict.ok ? "ACCEPTED" : "REJECTED: " + verdict.reason}`);
  if (!verdict.ok) process.exit(1);
  const phone = normalizeIndian(verdict.claims.phone_number);
  console.log(`   normalizeIndian  -> ${phone ?? "(refused: not a +91 mobile)"}`);
  console.log(`   would sign in as -> ${phone ? syntheticEmail(phone) : "—"}`);

  // Controls on the SAME real token. Without these, "ACCEPTED" could equally
  // be a verifier that accepts everything.
  const wrongProject = await verifyFirebaseIdToken(idToken, "not-" + PROJECT, fetchJwks);
  const tampered = await verifyFirebaseIdToken(
    idToken.slice(0, -3) + (idToken.slice(-3) === "AAA" ? "BBB" : "AAA"),
    PROJECT,
    fetchJwks,
  );
  const expired = await verifyFirebaseIdToken(
    idToken,
    PROJECT,
    fetchJwks,
    Math.floor(Date.now() / 1000) + 7200,
  );
  const line = (label: string, r: { ok: boolean; reason?: string }) =>
    console.log(`   ${label.padEnd(20)} ${r.ok ? "ACCEPTED — THE VERIFIER IS BROKEN" : "rejected: " + r.reason}`);
  console.log(`\n4  controls, same token`);
  line("wrong project id", wrongProject);
  line("tampered signature", tampered);
  line("clock +2h", expired);

  const broken = wrongProject.ok || tampered.ok || expired.ok;
  console.log(
    broken
      ? "\nFAILED: a control passed. Do not ship."
      : "\nGoogle's half is proven. The edge function and the browser reCAPTCHA are not — see the header.",
  );
  process.exit(broken ? 1 : 0);
}

main();
