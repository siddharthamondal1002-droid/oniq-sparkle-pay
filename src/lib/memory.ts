/**
 * Loop 3 — durable personalisation memory.
 *
 * A tiny, allow-listed key/value store of preferences ONIQ has either been
 * told ("stated") or worked out from the user's own signals ("derived").
 * It exists so a suggestion survives a reload without re-deriving it, and so
 * the user can see, correct, or forget each remembered item individually.
 *
 * Same gate as Loop 1: the database refuses every write for a minor account
 * or a withdrawn consent, and withdrawing personalisation deletes every row
 * here as well as the raw signals. This module is only the second line of
 * defence.
 *
 * Never stored here: messages, contacts, health data, money, precise
 * location, or anything from another user's account.
 */
import { supabase } from "@/integrations/supabase/client";
import { getPersonalisationConsent } from "@/lib/personalisation";

/** The complete set of things ONIQ is allowed to remember. */
export const MEMORY_KEYS = {
  favourite_hub: "The part of ONIQ you open most",
  usual_time_band: "When you usually use ONIQ",
  preferred_study_subject: "Subject you study most",
  preferred_ride_pickup: "Usual pickup area",
  preferred_news_topic: "News topic you read most",
  tutor_tone: "How you like the tutor to explain",
} as const;

export type MemoryKey = keyof typeof MEMORY_KEYS;

export type MemoryRow = {
  id: string;
  key: MemoryKey;
  value: string;
  source: "derived" | "stated";
  confirmed: boolean;
  updated_at: string;
};

export const isMemoryKey = (k: string): k is MemoryKey => k in MEMORY_KEYS;

/** Everything remembered for the signed-in user, newest first. */
export async function listMyMemory(): Promise<MemoryRow[]> {
  const { data } = await supabase
    .from("user_memory")
    .select("id, key, value, source, confirmed, updated_at")
    .order("updated_at", { ascending: false });
  return (data ?? []) as MemoryRow[];
}

/**
 * Write or refresh one remembered item. Best-effort and silent: a rejected
 * write (minor account, consent withdrawn) must never surface to the user or
 * change what they see.
 *
 * A `derived` write never overwrites something the user stated or confirmed.
 */
export async function rememberValue(
  key: MemoryKey,
  value: string,
  source: "derived" | "stated" = "derived",
): Promise<void> {
  try {
    const trimmed = value.trim().slice(0, 120);
    if (!trimmed || !isMemoryKey(key)) return;
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;
    if (!(await getPersonalisationConsent())) return;

    const { data: existing } = await supabase
      .from("user_memory")
      .select("id, source, confirmed")
      .eq("user_id", uid)
      .eq("key", key)
      .maybeSingle();

    if (existing) {
      const userOwned = existing.source === "stated" || existing.confirmed;
      if (source === "derived" && userOwned) return;
      await supabase
        .from("user_memory")
        .update({ value: trimmed, source, confirmed: source === "stated" })
        .eq("id", existing.id);
      return;
    }

    await supabase.from("user_memory").insert({
      user_id: uid,
      key,
      value: trimmed,
      source,
      confirmed: source === "stated",
    });
  } catch {
    /* remembering is never allowed to break a user action */
  }
}

/** The user says "yes, that's right" — pins the value against re-derivation. */
export async function confirmMemory(id: string): Promise<void> {
  await supabase.from("user_memory").update({ confirmed: true }).eq("id", id);
}

/** Forget one item. */
export async function forgetMemory(id: string): Promise<void> {
  await supabase.from("user_memory").delete().eq("id", id);
}

/** Forget everything, without withdrawing consent. */
export async function forgetAllMemory(): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;
  await supabase.from("user_memory").delete().eq("user_id", uid);
}
