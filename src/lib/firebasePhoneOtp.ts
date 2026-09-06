/**
 * Phone OTP through Firebase, ending in an ordinary Supabase session.
 *
 * Owner directive 2026-09-05 (final): "I added firebase for mobile number
 * authentication only." Firebase sends the SMS and proves possession of the
 * number; Supabase stays ONIQ's identity and Google sign-in is untouched.
 *
 * IT SATISFIES THE EXISTING `OtpProviders` CONTRACT ON PURPOSE. `otpFlow.ts`
 * already owns the send/verify state machine and its error mapping, and it is
 * already tested, so this is a provider swap rather than a second flow. The
 * MSG91 provider it replaced has since been deleted (owner, 2026-09-06: "that
 * path was never proven successful") — it never delivered a code in
 * production, so there is nothing to fall back TO. That makes the contract
 * more valuable, not less: the flow's handling of a bad code, an expired code
 * and a dropped network is unit-tested independently of any provider, and
 * survived the provider being removed underneath it.
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

/** E.164, with the leading `+`, which is the only shape Firebase accepts. */
export function isE164(s: string): boolean {
  return /^\+[1-9]\d{6,17}$/.test(s);
}

/**
 * Pull the real reason out of a Firebase error.
 *
 * MEASURED 2026-09-06, on a real handset: tapping "get otp" produced
 * `Firebase: Error (auth/internal-error).` and nothing else. `auth/internal-error`
 * is the SDK's catch-all — it is what you get when Identity Toolkit returns a
 * shape the SDK did not expect, so the actual server message is the only thing
 * that identifies the fault, and the SDK hides it on `customData.serverResponse`.
 *
 * A toast reading "internal error" is indistinguishable between a blocked API
 * key, App Check enforcement, a reCAPTCHA that never solved, and a genuine
 * Google outage. Those have four different fixes and three different owners, so
 * surfacing the raw text is the difference between a diagnosis and a guess.
 *
 * Pure and total: it never throws, and falls back to the message it was given.
 */
export function firebaseErrorDetail(err: unknown): string {
  const e = err as {
    code?: unknown;
    message?: unknown;
    customData?: { serverResponse?: unknown; _serverResponse?: unknown };
  };
  const code = typeof e?.code === "string" ? e.code : "";
  const base = typeof e?.message === "string" ? e.message : String(err ?? "unknown error");

  const raw = e?.customData?.serverResponse ?? e?.customData?._serverResponse;
  let server = "";
  if (typeof raw === "string") server = raw;
  else if (raw && typeof raw === "object") {
    // Identity Toolkit shape: { error: { message, status } }.
    const m = (raw as { error?: { message?: unknown } }).error?.message;
    server = typeof m === "string" ? m : JSON.stringify(raw);
  }

  if (server && !base.includes(server)) return `${base} [${server}]`;

  // NO SERVER RESPONSE IS ITSELF THE ANSWER, and the first version of this
  // function threw that away. It appended the code only when the message did
  // not already contain it — but Firebase formats every message as
  // "Firebase: Error (auth/internal-error).", so the code is ALWAYS in the
  // message and the fallback never fired. Measured on a handset 2026-09-06:
  // the toast came back byte-identical to the un-unwrapped one, and a
  // diagnostic that silently changes nothing is worse than none, because it
  // reads as "we looked and there was nothing wrong".
  //
  // So when there is no serverResponse, say so and dump what the error DOES
  // carry. An error with no server response never reached Google — it failed
  // in the browser, which is a different fault with a different owner.
  const own: string[] = [];
  try {
    for (const k of Object.keys(Object(err))) {
      if (k === "message" || k === "stack") continue;
      const v = (err as Record<string, unknown>)[k];
      own.push(`${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    }
  } catch {
    /* an exotic error object is not worth failing the report over */
  }
  const bits = [code && `code=${code}`, "no-server-response", ...own].filter(Boolean);
  return `${base} [${bits.join(" ")}]`;
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
 * in `miniapps.ts`. `firebase` IS a dependency now — the Lovable agent added
 * it pinned at 12.18.0, since `package.json` is its to own — so the import is
 * dynamic for weight rather than for availability: see the note at the call.
 *
 * `containerId` must name a DOM element that exists; Firebase renders its
 * invisible reCAPTCHA into it, and that reCAPTCHA is the only thing standing
 * between this endpoint and someone else's SMS bill.
 */
export async function firebasePhoneSurface(
  config: Record<string, string>,
  containerId: string,
): Promise<PhoneAuthSurface> {
  // DYNAMIC WITH LITERAL SPECIFIERS. Both halves of that matter.
  //
  // LITERAL, because the first draft used `import(VARIABLE)` with
  // `@vite-ignore` to keep the file compiling before `firebase` was a
  // dependency — and that would have SHIPPED BROKEN. `@vite-ignore` tells Vite
  // not to analyse the import, so the SDK would never have entered the build
  // and the browser would have been handed a bare "firebase/app" to resolve at
  // runtime. A workaround for a typecheck had quietly become a production
  // defect, invisible until someone tried to sign in.
  //
  // DYNAMIC, because the Firebase SDK is large and most sessions never reach
  // phone sign-in. A literal dynamic import is exactly what lets Vite split it
  // into its own chunk and fetch it only when this function is called.
  //
  // The narrow cast is an ENVIRONMENT limitation, not a preference: the
  // lockfile resolves firebase from Lovable's Artifact Registry mirror, which
  // the dev container's proxy denies, so `@firebase/app` installs empty here
  // and the SDK's own types cannot be read. CI and the Lovable sandbox both
  // reach that mirror. Anyone working with a complete install should replace
  // this with the SDK's real types and delete the cast.
  const [appMod, authMod] = (await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ])) as unknown as [
    {
      initializeApp: (c: unknown) => unknown;
      getApps: () => unknown[];
      getApp: () => unknown;
    },
    {
      getAuth: (app: unknown) => unknown;
      RecaptchaVerifier: new (
        auth: unknown,
        id: string,
        opts: unknown,
      ) => { clear: () => void; verify: () => Promise<string> };
      signInWithPhoneNumber: (
        auth: unknown,
        phone: string,
        verifier: unknown,
      ) => Promise<{
        confirm: (code: string) => Promise<{ user: { getIdToken: () => Promise<string> } }>;
      }>;
    },
  ];

  // getApps() first: initializing twice throws, and this can be reached again
  // on a retry or a remount.
  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(config);
  const auth = authMod.getAuth(app);
  let verifier: { clear: () => void; verify: () => Promise<string> } | null = null;

  /**
   * Run one step and label any failure with WHICH step it was.
   *
   * `signInWithPhoneNumber` solves the reCAPTCHA and sends the code inside one
   * call, so a single catch around it cannot distinguish "the browser could
   * not produce an attestation" from "Google refused the send" — and those
   * have different causes and different fixes. Splitting them is the whole
   * diagnostic.
   */
  const step = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      throw new Error(`${name}: ${firebaseErrorDetail(err)}`);
    }
  };

  return {
    send: async (e164: string) => {
      // A FRESH VERIFIER PER SEND, AND THE OLD ONE CLEARED FIRST. Both halves.
      //
      // An invisible reCAPTCHA token is SPENT by the send it authorises, so one
      // verifier held across sends breaks the SECOND send — which is the resend
      // button, i.e. exactly the path a user reaches when the first SMS is slow.
      // Firebase reports that as a captcha error, and `otpFlow` would surface it
      // as "couldn't send the code", blaming the network for a bug here.
      //
      // And constructing the replacement WITHOUT clearing the old one throws
      // instead, because Firebase refuses a container that already holds a
      // widget. Fixing only the first half swaps one broken resend for another.
      //
      // Neither half is reachable from a unit test — it needs a browser, a real
      // reCAPTCHA and Google's SMS — so the reasoning is written down rather
      // than left for the next reader to rediscover from a bug report.
      verifier?.clear();
      try {
        // THREE NAMED STEPS, because "auth/internal-error" alone is compatible
        // with all three and they are three different faults:
        //
        //   recaptcha-init    the container is missing, or the SDK cannot build
        //                     a verifier at all
        //   recaptcha-verify  the browser could not produce an attestation.
        //                     This is the one an embedded WebView breaks, and
        //                     it never reaches Google — so the error carries no
        //                     server response, which is why the unwrapper says
        //                     "no-server-response" rather than staying silent
        //   send-code         Google itself refused, and the server's message
        //                     comes back attached
        //
        // Verifying explicitly before the send is deliberate: an invisible
        // reCAPTCHA caches its token until it is spent, so `signInWithPhoneNumber`
        // reuses this one rather than solving a second challenge.
        verifier = await step(
          "recaptcha-init",
          () => new authMod.RecaptchaVerifier(auth, containerId, { size: "invisible" }),
        );
        const token = await step("recaptcha-verify", () => verifier!.verify());
        if (!token) throw new Error("recaptcha-verify: resolved with an empty token");
        const confirmation = await step("send-code", () =>
          authMod.signInWithPhoneNumber(auth, e164, verifier),
        );
        return {
          confirm: async (code: string) => {
            const cred = await confirmation.confirm(code);
            return await cred.user.getIdToken();
          },
        };
      } catch (err) {
        // Whichever step failed, the verifier is spent or half-built. Drop it
        // so the next attempt constructs a clean one instead of hitting
        // "container already contains an element".
        verifier?.clear();
        verifier = null;
        throw err;
      }
    },
  };
}
