// Consent ledger client — append-only writes to public.consent_records.
//
// Withdrawal is an INSERT with consent_state='withdrawn', never an UPDATE:
// there is no UPDATE or DELETE policy on the table, for anyone, including us.
// prev_hash / record_hash are computed by a BEFORE INSERT trigger; anything
// the client sends for those columns is discarded server-side.
import { supabase } from "@/integrations/supabase/client";
import { getCountryConfig, type Country } from "@/data/countryRegistry";
import {
  CONSENT_PURPOSES,
  NOTICE_VERSION,
  type NoticeLocale,
} from "@/lib/consent/notice";

export type ConsentRow = {
  id: string;
  purpose_id: string;
  purpose_desc: string;
  data_categories: unknown;
  notice_version: string;
  notice_locale: string;
  consent_state: "granted" | "withdrawn";
  jurisdiction: string;
  created_at: string;
  prev_hash: string | null;
  record_hash: string;
};

/** The legal regime that governs this account, resolved from home country. */
export function resolveJurisdiction(home: Country | null | undefined): string {
  return getCountryConfig(home).legalRegime;
}

export async function writeConsent(opts: {
  purposeId: string;
  state: "granted" | "withdrawn";
  locale: NoticeLocale;
  home: Country | null | undefined;
}): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("not signed in");
  const purpose = CONSENT_PURPOSES.find((p) => p.id === opts.purposeId);
  if (!purpose) throw new Error(`unknown purpose ${opts.purposeId}`);

  const { error } = await supabase.from("consent_records").insert({
    user_id: uid,
    purpose_id: purpose.id,
    purpose_desc: purpose.purpose[opts.locale] ?? purpose.purpose.en,
    data_categories: purpose.categories.map((c) => ({
      id: c.id,
      label: c.label[opts.locale] ?? c.label.en,
    })),
    notice_version: NOTICE_VERSION,
    notice_locale: opts.locale,
    consent_state: opts.state,
    jurisdiction: resolveJurisdiction(opts.home),
  });
  if (error) throw error;
}

export async function listMyConsents(limit = 200): Promise<ConsentRow[]> {
  const { data, error } = await supabase
    .from("consent_records")
    .select(
      "id, purpose_id, purpose_desc, data_categories, notice_version, notice_locale, consent_state, jurisdiction, created_at, prev_hash, record_hash",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ConsentRow[];
}

/** Latest state per purpose. Absent purpose = never decided. */
export function latestStates(rows: ConsentRow[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  // rows arrive newest-first; first hit per purpose wins.
  for (const r of rows) {
    if (!(r.purpose_id in out)) out[r.purpose_id] = r.consent_state === "granted";
  }
  return out;
}

export async function verifyMyChain(): Promise<{
  ok: boolean;
  rows_checked: number;
  first_bad: string | null;
}> {
  const { data, error } = await supabase.rpc("verify_consent_chain", {});
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? { ok: true, rows_checked: 0, first_bad: null }) as {
    ok: boolean;
    rows_checked: number;
    first_bad: string | null;
  };
}
