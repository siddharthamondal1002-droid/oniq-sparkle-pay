import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { reportClientError } from "@/lib/errorReport";

/**
 * "Does this account have X?" — asked once per account, per key.
 *
 * THE SERVER IS THE AUTHORITY AND THIS IS NOT IT. `has_entitlement` resolves
 * against the plan the user is actually on, and the checks that matter run
 * there: claim_story_seconds reads it to decide the watermark, and nothing a
 * client says can change what a plan includes. This hook exists so the UI can
 * show a lock instead of offering something that would then be refused —
 * disappointment before the tap rather than after it.
 *
 * CACHED because the call overlay mounts on every call and a round trip per
 * mount, on a phone, during ringing, is a round trip nobody needs. A plan
 * change lands on the next app open, which is soon enough for a lens rack;
 * the things that cost money re-read on every claim.
 *
 * TWO WAYS THIS USED TO HAND OUT THE PAID RACK FOR FREE (both fixed here,
 * 2026-08-16, after the owner reported the free-tier gate not holding for
 * users). Both failed OPEN, which is why neither showed up in testing on an
 * admin account — an admin has every entitlement and never sees a lock.
 *
 *   1. THE CACHE WAS KEYED BY ENTITLEMENT, NOT BY ACCOUNT. Sign out and sign
 *      in as somebody else inside the same webview — which is exactly what
 *      happens when a phone gets handed over, and what the native shell does
 *      by never reloading the page — and the previous account's answer was
 *      still sitting there. One admin sign-in unlocked every lens for whoever
 *      used the phone next, for as long as the app stayed open. The key is
 *      now `uid:key`, so an answer cannot outlive the account it was about.
 *
 *   2. A READ THAT NEVER RETURNED LEFT EVERYTHING UNLOCKED, FOREVER. The old
 *      code called the network-backed `getUser` (a round trip in supabase-js
 *      v2) and then the RPC, neither with a timeout, and cached the PROMISE. A
 *      stalled request — on a phone, mid-call, while WebRTC has the radio —
 *      left the hook at `null`, and `null` is "still loading", which every
 *      caller renders as unlocked. The cached pending promise meant it never
 *      retried. Now the read is bounded and an unconfirmed read resolves
 *      false, matching the rule this file already claimed to follow.
 */

/**
 * The read is two round trips at worst. Six seconds is long enough that a
 * merely slow phone still gets the true answer, and short enough that the
 * lock rack settles before someone has finished scrolling to a locked chip.
 */
const READ_TIMEOUT_MS = 6000;

/** Answered reads only, keyed `uid:key`. An unconfirmed read is not stored. */
const cache = new Map<string, Promise<boolean>>();

/** Reported once per surface per session — this is a signal, not a firehose. */
let reportedUnconfirmed = false;

/**
 * `null` means COULD NOT DETERMINE — not signed in yet, RPC error, or the
 * read ran out of time. Kept distinct from `false` so the caller can decline
 * to cache it, which is what stops one bad moment from locking a paying
 * subscriber out of what they bought for the rest of the session.
 */
async function read(key: string, uid: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("has_entitlement", { _user: uid, _key: key });
  if (error) return null;
  return data === true;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    void p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export async function hasEntitlement(key: string): Promise<boolean> {
  // getSession reads the stored session; getUser would be a network call, and
  // the uid has to be resolved BEFORE the cache is consulted anyway, because
  // the uid is half the cache key.
  const sess = await withTimeout(supabase.auth.getSession(), READ_TIMEOUT_MS);
  const uid = sess?.data.session?.user?.id;
  // No session yet is not "no entitlement" forever — it is not cached, and
  // the hook re-asks on the auth change that brings the session in.
  if (!uid) return false;

  const cacheKey = `${uid}:${key}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const settled = withTimeout(read(key, uid), READ_TIMEOUT_MS).then((v) => {
    if (v === null) {
      // Do NOT keep an unconfirmed read. The next mount asks again.
      cache.delete(cacheKey);
      if (!reportedUnconfirmed) {
        reportedUnconfirmed = true;
        reportClientError("entitlement-unconfirmed", `could not confirm ${key}`, {
          key,
          timeoutMs: READ_TIMEOUT_MS,
        });
      }
      // A read we could not confirm is NOT an entitlement. Falling open would
      // hand out the paid rack to anybody with a flaky connection.
      return false;
    }
    return v;
  });
  cache.set(cacheKey, settled);
  return settled;
}

/**
 * Forget everything — call after a plan changes, and on any auth change, so
 * the UI catches up and no answer survives into another account's session.
 */
export function forgetEntitlements(): void {
  cache.clear();
  // And forget that we already complained. Clearing happens on an auth
  // change, and a second account failing to read its own entitlements is a
  // different fact from the first one failing — worth a second report, not a
  // silence inherited from the previous session.
  reportedUnconfirmed = false;
}

/**
 * `null` while unknown, so a caller can tell "not yet loaded" from "no".
 * Rendering a lock during the unknown moment would flash a lock at a
 * subscriber; rendering unlocked would flash the paid rack at everyone else.
 * Callers show neither until this settles.
 *
 * It ALWAYS settles now, within READ_TIMEOUT_MS. That is the whole point: a
 * `null` that never resolves is a permanently unlocked rack, and every
 * caller treats `null` as unlocked.
 */
export function useEntitlement(key: string): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const ask = () => {
      void hasEntitlement(key).then((v) => {
        if (alive) setOn(v);
      });
    };
    ask();
    // RE-ASK ON EVERY AUTH CHANGE, and throw the cache away first.
    //
    // Two reasons, and the second is the one that was letting free accounts
    // use the paid rack. (a) A component mounted before the session hydrated
    // read "no session" and would otherwise have sat on that answer. (b) A
    // sign-out followed by another account's sign-in, in a webview that never
    // reloads, must not inherit the first account's answers — the uid in the
    // cache key already stops that, and clearing here means the stale entry
    // does not even linger in memory.
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      forgetEntitlements();
      setOn(null);
      ask();
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [key]);
  return on;
}
