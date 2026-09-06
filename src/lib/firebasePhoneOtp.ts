/**
 * Phone OTP through Firebase, ending in an ordinary Supabase session.
 *
 * Owner directive 2026-09-05 (final): "I added firebase for mobile number
 * authentication only." Firebase sends the SMS and proves possession of the
 * number; Supabase stays ONIQ's identity and Google sign-in is untouched.
 *
 * IT SATISFIES THE EXISTING `OtpProviders` CONTRACT ON PURPOSE. `otpFlow.ts`
 * already owns the send/verify state machine and its error mapping, and it is
 * already tested. Swapping the provider rather than writing a second flow
 * means the two paths cannot drift in how they treat a bad code, an expired
 * code or a dropped network — and the MSG91 path keeps working untouched while
 * this one is proven.
 *
 * PURE PART SPLIT FROM NETWORKED PART, the same way the server module is.
 * `createFirebasePhoneProviders` is the whole orchestration and takes every
 * outside edge as an argument, so it is unit-tested with no SDK, no DOM, no
 * reCAPTCHA and no network. `firebasePhoneSurface` is the thin, untestable
 * shell that actually loads Firebase.
 *
 * THE CLIENT NEVER DECIDES VALIDITY. `confirm()` returning an ID token means
 * Google believed the code; it does not mean ONIQ should mint a session. The
 * token goes to `firebase-phone-session`, which checks its signature against
 * Google's published keys before reading a single claim. A client that skipped
 * that step would be trusting a string it was handed.
 */

import type { OtpProviders } from "./otpFlow";

/** What `confirm()` yields: the caller gets a token, never a user object. */
export type PhoneConfirmation = {
  /** Exchange the user-typed code for a Firebase ID token. Throws if wrong. */
  confirm: (code: string) => Promise<string>;
};

/** The only thing this module needs Firebase to do. */
export type PhoneAuthSurface = {
  /** Start a phone sign-in for an E.164 number. Throws if refused. */
  send: (e164: string) => Promise<PhoneConfirmation>;
};

/** E.164, which is what Firebase requires — not the MSG91 widget format. */
export function isE164(s: string): boolean {
  return /^\+[1-9]\d{6,17}$/.test(s);
}

export type FirebasePhoneDeps = {
  surface: PhoneAuthSurface;
  /** POST the ID token to firebase-phone-session; resolves with its token_hash. */
  exchange: (idToken: string) => Promise<string>;
  /** Turn that token_hash into a live Supabase session. */
  establish: (tokenHash: string) => Promise<void>;
};

/**
 * Wire Firebase phone auth into the flow `otpFlow.ts` already drives.
 *
 * The confirmation object is held between `send` and `verify` because that is
 * how Firebase's API is shaped — `confirm()` lives on the object `send`
 * returned. Verifying before sending is therefore a programming error, not a
 * user error, and it says so rather than throwing something the flow would
 * map to "invalid code — try again" and blame the user for.
 */
export function createFirebasePhoneProviders(deps: FirebasePhoneDeps): OtpProviders {
  let pending: PhoneConfirmation | null = null;

  return {
    send: async (phone: string) => {
      // Refuse rather than normalise. This adapter is handed a number that a
      // screen already validated; silently "fixing" an unexpected format is
      // how an SMS goes to the wrong person and the sender never finds out.
      if (!isE164(phone)) throw new Error("phone number must be E.164");
      pending = await deps.surface.send(phone);
    },

    verify: async (code: string) => {
      if (!pending) throw new Error("no code has been sent yet");
      return await pending.confirm(code);
    },

    createSession: async (idToken: string) => {
      const tokenHash = await deps.exchange(idToken);
      await deps.establish(tokenHash);
      // One code, one session. Dropping the confirmation stops a second
      // `verify` from re-minting from a token the server has already spent.
      pending = null;
    },
  };
}

/**
 * POST the ID token to the edge function and return its `token_hash`.
 *
 * The function answers 401 for a token it cannot verify and never says which
 * check failed, so there is nothing finer to map here — anything but a 200 is
 * "could not verify".
 */
export async function exchangeFirebaseIdToken(
  supabaseUrl: string,
  anonKey: string,
  idToken: string,
  doFetch: typeof fetch = fetch,
): Promise<string> {
  const r = await doFetch(`${supabaseUrl}/functions/v1/firebase-phone-session`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: anonKey },
    body: JSON.stringify({ idToken }),
  });
  const body = (await r.json().catch(() => ({}))) as { token_hash?: string; error?: string };
  if (!r.ok || !body.token_hash) {
    throw new Error(body.error || "that sign-in could not be verified");
  }
  return body.token_hash;
}

/**
 * Load Firebase and hand back the narrow surface above.
 *
 * The dynamic import matches how this repo already reaches `@capacitor/browser`
 * in `miniapps.ts`: the module is resolved at runtime, so the build does not
 * need it present to typecheck. That is load-bearing here — `firebase` is not
 * yet a dependency, and `package.json` belongs to the Lovable agent (see the
 * `oniq-ship` skill on what happens when both sides edit it).
 *
 * `containerId` must name a DOM element that exists; Firebase renders its
 * invisible reCAPTCHA into it, and that reCAPTCHA is the only thing standing
 * between this endpoint and someone else's SMS bill.
 */
export async function firebasePhoneSurface(
  config: Record<string, string>,
  containerId: string,
): Promise<PhoneAuthSurface> {
  // THE SPECIFIERS ARE VARIABLES, and that is deliberate rather than clever.
  // A literal `import("firebase/app")` is resolved by tsc at build time, so it
  // fails the typecheck until the dependency exists — and `package.json` is the
  // Lovable agent's to edit. Binding the specifier late keeps this file
  // compiling today and importing correctly the moment `firebase` is added.
  // Delete the indirection then; it earns nothing once the dep is real.
  const APP = "firebase/app";
  const AUTH = "firebase/auth";
  const appMod = (await import(/* @vite-ignore */ APP)) as {
    initializeApp: (c: unknown) => unknown;
    getApps: () => unknown[];
    getApp: () => unknown;
  };
  const authMod = (await import(/* @vite-ignore */ AUTH)) as {
    getAuth: (app: unknown) => unknown;
    RecaptchaVerifier: new (auth: unknown, id: string, opts: unknown) => unknown;
    signInWithPhoneNumber: (
      auth: unknown,
      phone: string,
      verifier: unknown,
    ) => Promise<{
      confirm: (code: string) => Promise<{ user: { getIdToken: () => Promise<string> } }>;
    }>;
  };

  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(config);
  const auth = authMod.getAuth(app);
  const verifier = new authMod.RecaptchaVerifier(auth, containerId, { size: "invisible" });

  return {
    send: async (e164: string) => {
      const confirmation = await authMod.signInWithPhoneNumber(auth, e164, verifier);
      return {
        confirm: async (code: string) => {
          const cred = await confirmation.confirm(code);
          return await cred.user.getIdToken();
        },
      };
    },
  };
}
