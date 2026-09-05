/**
 * The Firebase WEB config for project `oniq-309bd`.
 *
 * Owner directive 2026-09-05: Firebase Auth becomes ONIQ's identity, with
 * phone OTP as the sign-in. The JS SDK cannot initialise without these six
 * values, and until 2026-09-05 they did not exist — the project had one
 * ANDROID client and no web app, measured against Google's own API
 * (`webApps` returned HTTP 200 with an empty body).
 *
 * THESE ARE NOT SECRETS, and treating them as such causes real harm: someone
 * moves them into the secret store, the browser bundle can no longer see
 * them, and the SDK fails to initialise for every user. Firebase publishes
 * the whole web config in every page that uses it. The API key names the
 * project; it authorises nothing by itself. What actually guards Firebase is
 * Auth rules plus App Check. The service account IS a secret and lives in
 * `FIREBASE_SERVICE_ACCOUNT` on the server, nowhere near this file.
 *
 * NO SDK IS IMPORTED HERE ON PURPOSE. Firebase Authentication is not yet
 * enabled on the project — Identity Toolkit answers `CONFIGURATION_NOT_FOUND`
 * to every call — so nothing client-side can be exercised end to end. This
 * module records and validates the config so that when Auth is switched on,
 * the values are already right and already guarded; adding the dependency and
 * the sign-in flow is the step after that, against a path that can be tested.
 */

/** The six values Firebase's `initializeApp` needs. */
export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

/** The project this app belongs to. Cross-checked against the Android config. */
export const FIREBASE_PROJECT_ID = "oniq-309bd";

const env = (k: string): string => {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return meta?.[k] ?? "";
};

/**
 * Read the config, or say precisely what is missing.
 *
 * IT RETURNS A REASON RATHER THAN THROWING, the same shape the rest of ONIQ
 * uses for unconfigured backends (`{ configured: false }`). A screen that
 * knows web push is not set up can say so; a screen that took an exception on
 * import cannot render at all, and the failure surfaces as a blank page
 * instead of a sentence.
 */
export function readFirebaseWebConfig():
  { configured: true; config: FirebaseWebConfig } | { configured: false; missing: string[] } {
  const pairs: [keyof FirebaseWebConfig, string][] = [
    ["apiKey", "VITE_FIREBASE_API_KEY"],
    ["authDomain", "VITE_FIREBASE_AUTH_DOMAIN"],
    ["projectId", "VITE_FIREBASE_PROJECT_ID"],
    ["storageBucket", "VITE_FIREBASE_STORAGE_BUCKET"],
    ["messagingSenderId", "VITE_FIREBASE_MESSAGING_SENDER_ID"],
    ["appId", "VITE_FIREBASE_APP_ID"],
  ];
  const missing = pairs.filter(([, k]) => !env(k)).map(([, k]) => k);
  if (missing.length > 0) return { configured: false, missing };
  const config = Object.fromEntries(
    pairs.map(([field, k]) => [field, env(k)]),
  ) as unknown as FirebaseWebConfig;
  return { configured: true, config };
}
