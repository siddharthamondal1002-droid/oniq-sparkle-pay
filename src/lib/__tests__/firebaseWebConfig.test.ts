/**
 * THE WEB CONFIG MUST NAME THE SAME FIREBASE PROJECT THE APP ALREADY USES.
 *
 * This repo has been bitten once by exactly this class of mistake, from the
 * other vendor: `.mcp.json` points at a Supabase project NAMED
 * "oniq-sparkle-pay" that is not the project ONIQ talks to, and
 * `supabaseProjectRef.test.ts` exists because a wrong answer there looked
 * exactly like a right one. Firebase now has the same shape of risk — an
 * Android client registered in one project and a web config pasted in from
 * another would both look plausible, and would fail only at runtime, for
 * users, with an opaque auth error.
 *
 * So the web config is checked against `android/app/google-services.json`,
 * which is the config Google generated for the client that has been shipping
 * for months. If those two ever name different projects, that is a mix-up and
 * not a migration.
 *
 * The values are read from `.env` rather than through `import.meta.env`,
 * because vitest does not inline VITE_ vars the way the Vite build does, and
 * `.env` is what the build reads. It is tracked in git — public client config
 * lives there in this repo, beside VITE_SUPABASE_PUBLISHABLE_KEY.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIREBASE_PROJECT_ID } from "../../integrations/firebase/config";

const ROOT = process.cwd();
const ENV = readFileSync(join(ROOT, ".env"), "utf8");
const GS = JSON.parse(readFileSync(join(ROOT, "android/app/google-services.json"), "utf8"));

/** One KEY="value" line out of .env. */
const envVal = (k: string): string => {
  const m = ENV.match(new RegExp(`^${k}="?([^"\\n]*)"?$`, "m"));
  return m?.[1] ?? "";
};

const REQUIRED = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

describe("the six values the SDK needs are all present", () => {
  it.each(REQUIRED)("%s is set", (k) => {
    expect(envVal(k)).not.toBe("");
  });
});

describe("it is the same project the Android app has been using", () => {
  it("agrees with google-services.json on the project id", () => {
    expect(envVal("VITE_FIREBASE_PROJECT_ID")).toBe(GS.project_info.project_id);
    expect(envVal("VITE_FIREBASE_PROJECT_ID")).toBe(FIREBASE_PROJECT_ID);
  });

  it("agrees on the project number, which is also the sender id", () => {
    // messagingSenderId IS the project number. Two projects can share a
    // display name; they cannot share this.
    expect(envVal("VITE_FIREBASE_MESSAGING_SENDER_ID")).toBe(GS.project_info.project_number);
  });

  it("agrees on the storage bucket", () => {
    // The bridge already writes to this bucket with the service account. A web
    // config naming a different one would split ONIQ's files across projects.
    expect(envVal("VITE_FIREBASE_STORAGE_BUCKET")).toBe(GS.project_info.storage_bucket);
  });

  it("carries a WEB appId, not the Android one", () => {
    // Firebase app ids encode their platform: 1:<number>:web:<hash> against
    // 1:<number>:android:<hash>. Pasting the Android id into the web config is
    // the easy version of this mistake, and it initialises far enough to look
    // fine before failing.
    const appId = envVal("VITE_FIREBASE_APP_ID");
    const androidId = GS.client[0].client_info.mobilesdk_app_id;
    expect(appId).toMatch(/^1:\d+:web:[a-z0-9]+$/);
    expect(appId).not.toBe(androidId);
    expect(appId.split(":")[1]).toBe(GS.project_info.project_number);
  });

  it("derives authDomain from the project, not from somewhere else", () => {
    expect(envVal("VITE_FIREBASE_AUTH_DOMAIN")).toBe(`${FIREBASE_PROJECT_ID}.firebaseapp.com`);
  });
});

describe("the config is treated as public, and the secret is not here", () => {
  it("keeps the service account out of client-visible env", () => {
    // FIREBASE_SERVICE_ACCOUNT is the one Firebase credential that IS a secret.
    // A VITE_ prefix on it would inline a private key into the browser bundle.
    expect(ENV).not.toMatch(/^VITE_FIREBASE_SERVICE_ACCOUNT/m);
    expect(ENV).not.toMatch(/BEGIN PRIVATE KEY/);
  });
});
