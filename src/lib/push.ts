// Push notification bootstrap.
//
// TWO TRANSPORTS SINCE 2026-08-14. Native Capacitor builds register with FCM;
// everything else subscribes through the browser's own Push API. Until then
// this file returned "unavailable" on the first line for anyone not on the
// native app — which was almost everyone. The call-log audit that day found
// 101 accounts, 14 with a push address ever, and six of the nine people
// called that day unreachable, while `send-push` reported success because
// nothing had failed: there was simply nowhere to send.
import { supabase } from "@/integrations/supabase/client";
import { subscribeWebPush, unsubscribeWebPush } from "@/lib/webPush";
import { reportClientError } from "@/lib/errorReport";

export type PushKind = "message" | "call" | "call_cancel";

export function sendPush(payload: {
  conversation_id: string;
  kind: PushKind;
  preview?: string;
  call_type?: string;
  call_id?: string;
}) {
  // Fire-and-forget — never block UI, never throw. But NOT silent any more.
  //
  // WHY THIS GREW A REPORTING ARM, 2026-08-18. "No notification coming" was
  // reported and took four rounds to even localise, because every layer that
  // could have said something was mute:
  //
  //   this function swallowed the invoke's error with `.catch(() => {})`, so
  //   a dead call looked exactly like a delivered one;
  //   the edge platform's request logging was capturing nothing project-wide,
  //   so "zero invocations in 24h" could not be trusted either way;
  //   send-push's own {sent:0,failed:0} is a 200, which the comment inside it
  //   already admits is indistinguishable from a delivery.
  //
  // Three mute layers is how 87 unreachable accounts went unnoticed until
  // someone read the call logs by hand. A direct FCM probe proved the whole
  // transport — credentials, project, token, channel, Android's display —
  // works, which means the fault is on this side of the wire and the only
  // thing missing was a witness.
  //
  // client_error_reports is that witness: admin-only to read, already wired,
  // and reachable from here. Failures only — a working send writes nothing.
  try {
    void supabase.functions
      .invoke("send-push", { body: payload })
      .then(({ data, error }) => {
        if (error) {
          reportClientError("send-push", `invoke failed: ${error.message}`, {
            kind: payload.kind,
          });
          return;
        }
        // invoke() resolves rather than rejects on a non-2xx, so the function's
        // own refusal arrives as data, not as error.
        // `unaddressed` IS READ, and its absence from this type was the bug in
        // the witness. send-push has two ways to answer sent:0 and they are
        // different faults — nobody had a push address (it returns
        // `unaddressed: N` and never reaches FCM), or it did reach FCM and
        // every send came back nothing. On 2026-09-07 that question was put to
        // the 44 recorded rows and could not be answered: the report below
        // built its detail from three named fields, so `unaddressed` was
        // dropped before it was ever written. An absent field then reads as
        // evidence of the OTHER branch, and it is not evidence of anything.
        // A witness that discards the one field separating two faults is not
        // a witness.
        const d = data as {
          sent?: number;
          failed?: number;
          error?: string;
          unaddressed?: number;
        } | null;
        if (d?.error) {
          reportClientError("send-push", `refused: ${d.error}`, { kind: payload.kind });
        } else if ((d?.sent ?? 0) === 0) {
          // The honest-but-useless 200. Nothing failed; nothing arrived either.
          reportClientError("send-push", "accepted but sent 0", {
            kind: payload.kind,
            sent: d?.sent ?? null,
            failed: d?.failed ?? null,
            // The discriminator. A NUMBER means that many recipients had no
            // push address at all, so nothing was ever dispatched and the
            // fault is registration. NULL means send-push did address
            // somebody and still delivered nothing, which is a transport
            // fault — a different problem with a different owner.
            unaddressed: d?.unaddressed ?? null,
          });
        }
      })
      .catch((e: unknown) => {
        reportClientError("send-push", "invoke threw", String(e));
      });
  } catch {
    // ignore
  }
}

export type PushInitResult = "granted" | "denied" | "unavailable";

let listenersAttached = false;
let registered = false;
// The FCM token this device most recently registered, kept so a later
// initPush() (after an account switch) can re-bind the row to the new user,
// and so sign-out can delete it.
let currentToken: string | null = null;
let boundUserId: string | null = null;

async function upsertToken(token: string) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("device_tokens").upsert(
      {
        user_id: user.id,
        token,
        platform: "android",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );
    if (error) {
      // The common cause: the row still belongs to the PREVIOUS account on
      // this device, and RLS blocks user B from updating user A's row. The
      // fix for that path is removePushToken() before sign-out.
      // eslint-disable-next-line no-console
      console.warn("device_tokens upsert failed:", error.message);
      /*
       * A CONSOLE LINE IS NOT VISIBILITY ON A PHONE, and this is the half
       * that was missing. `initPush()` runs on every authenticated mount, so
       * a device reaching here has permission AND a token and still ends up
       * with no push address — which is indistinguishable, from the outside,
       * from a person who declined notifications. Measured 2026-09-07: 40
       * "accepted but sent 0" reports, and the recipients on every one of
       * them had ZERO rows in device_tokens.
       *
       * `send-push` learned to say `unaddressed` in August so the SENDER's
       * report names registration as the fault. This is the other end of that
       * sentence: it says which device could not register, and why.
       *
       * THE TOKEN ITSELF IS NEVER REPORTED. It is the address a push is
       * delivered to; the error message and the platform are what a fix needs.
       */
      reportClientError("push-register", "device token upsert failed", {
        platform: "android",
        reason: error.message,
      });
      return;
    }
    boundUserId = user.id;
  } catch (e) {
    // Push is best-effort and must never break sign-in — but "best-effort"
    // was being read as "unobserved". A throw here leaves the account with no
    // push address for the life of the install and said so nowhere.
    reportClientError("push-register", "device token upsert threw", String(e));
  }
}

export async function initPush(): Promise<PushInitResult> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) {
      // The browser path. "unsupported" and "error" both collapse to
      // "unavailable" because the caller's only useful question is whether to
      // offer a retry, and neither is retryable by asking again.
      const web = await subscribeWebPush();
      return web === "granted" ? "granted" : web === "denied" ? "denied" : "unavailable";
    }

    const { PushNotifications } = await import("@capacitor/push-notifications" as string);

    const perm = await PushNotifications.checkPermissions();
    let granted = perm.receive === "granted";
    if (!granted) {
      const req = await PushNotifications.requestPermissions();
      granted = req.receive === "granted";
    }
    // No latch before the permission gate: one refusal must not poison the
    // session — the onboarding screen's retry calls initPush() again.
    if (!granted) return "denied";

    // Already registered in this session: re-bind the stored token to the
    // CURRENT user. On a shared device, sign-out → sign-in used to leave the
    // token row pointing at the previous account, ringing user A's calls on
    // user B's phone.
    if (registered) {
      if (currentToken) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user && user.id !== boundUserId) await upsertToken(currentToken);
      }
      return "granted";
    }

    // Listeners BEFORE register(): the registration event must have somewhere
    // to land. Today the plugin happens to retain the event until consumed,
    // but ordering correctness should not hang off an undocumented buffer.
    if (!listenersAttached) {
      listenersAttached = true;

      PushNotifications.addListener("registration", async (t: { value: string }) => {
        currentToken = t.value;
        await upsertToken(t.value);
      });

      PushNotifications.addListener("registrationError", () => {
        // Allow a later initPush() to retry the whole registration.
        registered = false;
      });

      PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action: { notification?: { data?: Record<string, unknown> } }) => {
          const url = (action.notification?.data as { url?: string } | undefined)?.url;
          if (url) {
            window.location.assign(url);
          }
        },
      );
    }

    await PushNotifications.register();
    // Latch only after register() resolves — a throw above leaves the latch
    // open so the next call retries instead of silently doing nothing.
    registered = true;
    return "granted";
  } catch {
    // native module not available — silently no-op
    return "unavailable";
  }
}

/**
 * Delete this device's token row. MUST run BEFORE supabase.auth.signOut():
 * RLS only lets the row's owner delete it, and after sign-out there is no
 * owner in the session. Without this, a signed-out (or re-used) device keeps
 * receiving the previous account's messages and calls.
 */
export async function removePushToken() {
  // The browser subscription first, and unconditionally: a web signee has no
  // `currentToken` at all, so an early return on that would have left every
  // shared browser ringing for the previous account — the exact bug this
  // function exists to prevent, reintroduced through the other transport.
  await unsubscribeWebPush();

  const token = currentToken;
  if (!token) return;
  try {
    await supabase.from("device_tokens").delete().eq("token", token);
    boundUserId = null;
  } catch {
    // best-effort
  }
}
