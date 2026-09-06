#!/usr/bin/env node
/**
 * WHAT STILL BLOCKS THE FIREBASE IDENTITY SWITCH — answered in one command,
 * for free, with no credential ONIQ has to protect.
 *
 *     node scripts/check-firebase-blockers.mjs
 *
 * Owner directive, 2026-09-06: Firebase Auth becomes ONIQ's identity and
 * Firestore holds payments/entitlements. Several console settings gate that,
 * every one of them invisible from the repo, and three sessions in a row have
 * spent a round trip rediscovering the same facts. This asks Google directly.
 *
 * IT NEEDS ONLY THE PUBLIC WEB API KEY, which ships in every browser bundle by
 * design, so there is nothing here worth guarding and nothing that can be
 * abused by running it. `identitytoolkit.googleapis.com` is reachable from the
 * dev container even though `*.supabase.co` is not — which is exactly why this
 * is the check to reach for first.
 *
 * IT CREATES NOTHING. The obvious way to test whether Email/Password signup is
 * open is to sign up, and that is how this file's first run left a real account
 * in the owner's project (deleted immediately, `accounts:lookup` then answering
 * USER_NOT_FOUND — but it should never have existed). Instead the probe sends a
 * deliberately too-short password: Google validates the password BEFORE it
 * creates anything, so the provider's state comes back in which error arrives.
 *
 *     WEAK_PASSWORD          -> provider is ENABLED  (open)
 *     OPERATION_NOT_ALLOWED  -> provider is DISABLED (closed)
 *
 * A diagnostic that mutates what it measures is not a diagnostic.
 *
 * WHAT IT CANNOT ANSWER, stated so a clean run is not over-read:
 *   - whether Firebase is registered as Supabase's third-party auth provider.
 *     That needs a real ID token presented to PostgREST, and PostgREST is not
 *     reachable from here. Ask the Lovable agent, with a three-way control.
 *   - whether Firestore is provisioned. The unauthenticated endpoint returns
 *     Google's generic HTML 404 for a project that certainly does not exist as
 *     readily as for this one, so that probe proves nothing. One tap on
 *     /app/admin/firebase asks with the service account and settles it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ENV_PATH = join(process.cwd(), ".env");
const IT = "https://identitytoolkit.googleapis.com/v1";

function webApiKey() {
  const fromEnv = process.env.VITE_FIREBASE_API_KEY;
  if (fromEnv) return fromEnv;
  let raw;
  try {
    raw = readFileSync(ENV_PATH, "utf8");
  } catch {
    throw new Error(`No VITE_FIREBASE_API_KEY in the environment and no ${ENV_PATH}`);
  }
  const line = raw.split("\n").find((l) => l.startsWith("VITE_FIREBASE_API_KEY="));
  if (!line) throw new Error("VITE_FIREBASE_API_KEY is not in .env");
  return line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

async function get(path, key) {
  const res = await fetch(`${IT}/${path}?key=${key}`);
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* Google answers a wrong path with an HTML 404 page, not JSON */
  }
  return { status: res.status, json, error: json?.error?.message ?? null };
}

async function post(path, body, key) {
  const res = await fetch(`${IT}/${path}?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* a non-JSON body is itself the answer */
  }
  return { status: res.status, json, error: json?.error?.message ?? null };
}

const PASS = "PASS";
const BLOCK = "BLOCK";
const UNKNOWN = "UNKNOWN";
const rows = [];
const record = (state, name, detail) => rows.push({ state, name, detail });

async function main() {
  const key = webApiKey();

  // 1. Is Firebase Authentication provisioned at all? A 200 here is only
  //    possible once the Auth config exists; before that every Identity
  //    Toolkit call answers CONFIGURATION_NOT_FOUND.
  {
    const r = await post(
      "accounts:createAuthUri",
      { identifier: "probe@example.invalid", continueUri: "http://localhost" },
      key,
    );
    record(
      r.status === 200 ? PASS : BLOCK,
      "Firebase Authentication provisioned",
      r.status === 200 ? "createAuthUri 200" : `${r.status} ${r.error ?? "unexpected"}`,
    );
  }

  // 2. Authorized domains. Web phone auth runs reCAPTCHA, which refuses any
  //    domain absent from this list — so a missing entry fails in production
  //    while working perfectly in local development.
  //    The endpoint is GET /v1/projects. `relyingparty/getProjectConfig` is
  //    what earlier notes named and it 404s on this project — measured both
  //    verbs. That wrong name survived because the command carrying it had a
  //    `|| curl <other endpoint>` fallback which fired silently when a parse
  //    failed, so the RIGHT data arrived from the WRONG URL and was written
  //    down under the wrong one. Never let a probe fall back to a second
  //    endpoint without printing which one answered.
  {
    const r = await get("projects", key);
    const domains = r.json?.authorizedDomains ?? [];
    const ok = domains.includes("oniqhub.com");
    record(
      ok ? PASS : BLOCK,
      "oniqhub.com is an authorized domain",
      domains.length ? domains.join(", ") : `${r.status} ${r.error ?? "no domains returned"}`,
    );
  }

  // 3. Email/Password self-signup. Harmless until the identity switch; a
  //    remote RLS outage vector after it, because a self-signed-up account
  //    carries a NATIVE 28-char uid and auth.uid() casts sub to uuid — see
  //    scripts/firebase-import-users.mjs. Creates nothing: see the header.
  {
    const r = await post(
      "accounts:signUp",
      { email: "probe@example.invalid", password: "x", returnSecureToken: true },
      key,
    );
    const err = r.error ?? "";
    const open = err.startsWith("WEAK_PASSWORD");
    const closed =
      err.startsWith("OPERATION_NOT_ALLOWED") || err.startsWith("ADMIN_ONLY_OPERATION");
    record(
      open ? BLOCK : closed ? PASS : UNKNOWN,
      "Email/Password self-signup is OFF",
      open
        ? "OPEN — anyone with the public web key can create an account"
        : closed
          ? err.split(" ")[0]
          : `unrecognised: ${err || r.status}`,
    );
    if (r.status === 200) {
      record(
        UNKNOWN,
        "probe unexpectedly created an account",
        `localId ${r.json?.localId} — DELETE IT, then fix this script`,
      );
    }
  }

  // 4. Anonymous sign-in, which should stay locked for the same reason.
  {
    const r = await post("accounts:signUp", { returnSecureToken: true }, key);
    const locked = (r.error ?? "").startsWith("ADMIN_ONLY_OPERATION");
    record(
      locked ? PASS : BLOCK,
      "Anonymous sign-in is OFF",
      locked ? "ADMIN_ONLY_OPERATION" : `${r.status} ${r.error ?? "created an anonymous account"}`,
    );
    if (r.status === 200) {
      record(
        UNKNOWN,
        "anonymous probe created an account",
        `localId ${r.json?.localId} — DELETE IT`,
      );
    }
  }

  const width = Math.max(...rows.map((r) => r.name.length));
  console.log("\nFirebase console state — project oniq-309bd, public web key only\n");
  for (const { state, name, detail } of rows) {
    const mark = state === PASS ? "ok   " : state === BLOCK ? "BLOCK" : "?    ";
    console.log(`  ${mark}  ${name.padEnd(width)}  ${detail}`);
  }

  console.log("\nNot answerable from here — both need someone else to ask:");
  console.log(
    "  ?      Firebase registered as Supabase third-party auth   Lovable agent, 3-way control",
  );
  console.log(
    "  ?      Firestore provisioned (Native mode, region)        one tap on /app/admin/firebase",
  );

  const blocked = rows.filter((r) => r.state === BLOCK);
  console.log(
    blocked.length
      ? `\n${blocked.length} blocker(s) open: ${blocked.map((b) => b.name).join("; ")}\n`
      : "\nEvery console setting this can see is clear.\n",
  );
  process.exit(blocked.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`\ncheck failed: ${err.message}\n`);
  process.exit(2);
});
