import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * "Does this account have X?" — asked once per session, per key.
 *
 * THE SERVER IS THE AUTHORITY AND THIS IS NOT IT. `has_entitlement` resolves
 * against the plan the user is actually on, and the checks that matter run
 * there: claim_story_seconds reads it to decide the watermark, and nothing a
 * client says can change what a plan includes. This hook exists so the UI can
 * show a lock instead of offering something that would then be refused —
 * disappointment before the tap rather than after it.
 *
 * CACHED FOR THE SESSION because the call overlay mounts on every call and a
 * round trip per mount, on a phone, during ringing, is a round trip nobody
 * needs. A plan change lands on the next app open, which is soon enough for a
 * lens rack; the things that cost money re-read on every claim.
 */
const cache = new Map<string, Promise<boolean>>();

export function hasEntitlement(key: string): Promise<boolean> {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return false;
      const { data, error } = await supabase.rpc("has_entitlement", { _user: uid, _key: key });
      if (error) return false;
      return data === true;
    } catch {
      // A failed read is NOT an entitlement. Falling open would hand out the
      // paid rack to anybody with a flaky connection.
      return false;
    }
  })();
  cache.set(key, p);
  return p;
}

/** Forget everything — call after a plan changes so the UI catches up. */
export function forgetEntitlements(): void {
  cache.clear();
}

/**
 * null while unknown, so a caller can tell "not yet loaded" from "no".
 * Rendering a lock during the unknown moment would flash a lock at a
 * subscriber; rendering unlocked would flash the paid rack at everyone else.
 * Callers show neither until this settles.
 */
export function useEntitlement(key: string): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void hasEntitlement(key).then((v) => {
      if (alive) setOn(v);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return on;
}
