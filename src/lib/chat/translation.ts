// Track A2 — chat translation: consent gate, per-conversation preference, and
// the cache read that makes "translate on read" free.
//
// WHY MESSAGES ARE STORED SERVER-READABLE — A RECORDED DECISION
//
// ONIQ stores chat messages so the server can read them. That is a decision,
// not an oversight: translating one person's words for another reader
// requires the server to read those words. End-to-end encryption and
// server-side translation are mutually exclusive — you can have one.
//
// The path to having both is ON-DEVICE translation, at which point the server
// no longer needs to read anything. If and when E2EE is built here it uses
// libsignal or MLS (RFC 9420). Never a custom protocol; hand-rolled crypto is
// how messaging apps ship confidentiality that does not exist.
//
// Until then nothing in this app, its store listing or its marketing claims
// end-to-end encryption, because it would be false.
export const MESSAGE_STORAGE_NOTE =
  "Messages are stored server-readable by design so translation can work. " +
  "Not end-to-end encrypted.";

import { supabase } from "@/integrations/supabase/client";
import { listMyConsents, latestStates, writeConsent } from "@/lib/consent/ledger";
import { resolveNoticeLocale, TRANSLATION_PURPOSE_ID } from "@/lib/consent/notice";
import type { Country } from "@/data/countryRegistry";

/**
 * Has this reader consented to the translation purpose?
 *
 * Sending message text to a model provider is its own processing purpose, so
 * it has its own line in the notice and its own row in the ledger. This is
 * checked BEFORE the first translation call, never after.
 */
export async function hasTranslationConsent(): Promise<boolean> {
  const rows = await listMyConsents(200);
  return latestStates(rows)[TRANSLATION_PURPOSE_ID] === true;
}

/** Record the grant. Append-only; withdrawal is a later row, never an update. */
export async function grantTranslationConsent(lang: string | undefined): Promise<void> {
  // Home country decides which legal regime the row is stamped with; read it
  // here so no caller has to remember to pass it.
  const { data: prof } = await supabase.rpc("get_my_profile_meta").maybeSingle();
  const home = (prof?.country_code as Country | null) ?? null;
  await writeConsent({
    purposeId: TRANSLATION_PURPOSE_ID,
    state: "granted",
    locale: resolveNoticeLocale(lang),
    home,
  });
}

/**
 * Per-conversation preference. Off by default — absence of a row is off, so a
 * new conversation is never translated because an old one was.
 */
export async function getConversationTranslation(conversationId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("conversation_translation_prefs")
    .select("enabled")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) return false;
  return data?.enabled === true;
}

export async function setConversationTranslation(
  conversationId: string,
  enabled: boolean,
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("not signed in");
  const { error } = await supabase
    .from("conversation_translation_prefs")
    .upsert(
      { user_id: uid, conversation_id: conversationId, enabled, updated_at: new Date().toISOString() },
      { onConflict: "user_id,conversation_id" },
    );
  if (error) throw error;
}

/**
 * Cached translations for messages already on screen.
 *
 * This is the whole reason "translate on read" costs nothing: in a group, one
 * message translated once serves everyone reading in that language. Reading
 * the cache sends no text anywhere and calls no provider — RLS on
 * message_translations already restricts it to messages this reader may see.
 * A miss stays a miss: nothing is generated here.
 */
export async function fetchCachedTranslations(
  messageIds: string[],
  targetLang: string,
): Promise<Record<string, string>> {
  if (messageIds.length === 0) return {};
  const { data, error } = await supabase
    .from("message_translations")
    .select("message_id, translated_text")
    .eq("target_lang", targetLang)
    .in("message_id", messageIds.slice(0, 200));
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const r of data) {
    if (r.message_id && r.translated_text) out[r.message_id] = r.translated_text;
  }
  return out;
}
