/**
 * Loop 1 — consented signal collection for anticipatory surfacing.
 *
 * What is collected: time of day, day of week, coarse city, which hub was
 * opened, and whether a suggested card was tapped or dismissed. Nothing else.
 *
 * Never collected: SMS or notification content, precise or background
 * location, contacts, other apps' usage, and anything from the health hub.
 *
 * Minors are excluded entirely. This module refuses to write, but it is the
 * second line of defence only — `usage_signals` has an RLS check and a
 * BEFORE INSERT trigger that refuse the row regardless of what the client
 * does, using each account's country threshold (18 in IN, 13 elsewhere).
 */
import { supabase } from "@/integrations/supabase/client";

export const PERSONALISATION_PURPOSE = "personalisation" as const;

/** Its own notice — deliberately not bundled into general app consent. */
export const PERSONALISATION_NOTICE =
  "We can learn which parts of ONIQ you use, and roughly when, to put the right " +
  "shortcut on your home screen. We store only: time of day, day of week, your " +
  "city, which hub you opened, and whether you tapped or dismissed a suggestion. " +
  "We never read your messages, SMS, notifications, contacts, background location " +
  "or anything from Vitals. Turn this off any time — switching it off erases " +
  "everything already collected. Not available for accounts under the age of " +
  "digital consent.";

export type SignalKind = "hub_open" | "card_tap" | "card_dismiss";

/** Latest recorded personalisation consent for the signed-in user. */
export async function getPersonalisationConsent(): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return false;
  const { data } = await supabase
    .from("user_consents")
    .select("granted")
    .eq("user_id", uid)
    .eq("purpose", PERSONALISATION_PURPOSE)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.granted === true;
}

/**
 * Grant or withdraw. Withdrawal wipes derived state server-side (a trigger on
 * user_consents deletes every usage_signals row for the user). The RPC also
 * refuses to record a grant for a minor account.
 */
export async function setPersonalisationConsent(granted: boolean): Promise<void> {
  const { error } = await supabase.rpc("record_consent", {
    _purpose: PERSONALISATION_PURPOSE,
    _granted: granted,
    _source: "privacy-settings",
  });
  if (error) throw error;
}

/**
 * Best-effort signal write. Silent on failure by design: a minor account or a
 * withdrawn consent makes the database reject the insert, and that rejection
 * must never surface as an error or change what the user sees.
 */
export async function recordSignal(
  kind: SignalKind,
  hub: string,
  city?: string | null,
): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;
    if (!(await getPersonalisationConsent())) return;
    const now = new Date();
    await supabase.from("usage_signals").insert({
      user_id: uid,
      kind,
      hub: hub.slice(0, 40),
      city: city ? city.slice(0, 60) : null,
      dow: now.getDay(),
      hour: now.getHours(),
    });
  } catch {
    /* collection is never allowed to break a user action */
  }
}

/** Everything held for the signed-in user — for the "see what's stored" view. */
export async function listMySignals(limit = 200) {
  const { data } = await supabase
    .from("usage_signals")
    .select("id, kind, hub, city, dow, hour, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/** Manual wipe, independent of withdrawing consent. */
export async function clearMySignals(): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;
  await supabase.from("usage_signals").delete().eq("user_id", uid);
}
