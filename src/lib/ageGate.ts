/**
 * Age gate + verifiable parental consent — client API.
 *
 * The threshold is NEVER computed here. `minor_age_for_country()` in Postgres
 * is the only authority (18 unless the home country is an explicit 13 regime,
 * and 18 whenever the country is unknown — it fails closed). This module only
 * reads what the database decided.
 *
 * Restricted state = under threshold AND parental consent not yet verified.
 * It is a live predicate in SQL, not a stored flag, so completing verification
 * later lifts it instantly with no data loss. Writes by a restricted account
 * are refused by BEFORE INSERT triggers with SQLSTATE 42501 and a message that
 * says plainly that nothing was saved — a silent no-op is exactly the failure
 * mode this closes.
 */
import { supabase } from "@/integrations/supabase/client";

export type AgeGateStatus = {
  has_dob: boolean;
  threshold: number;
  is_minor: boolean;
  verified: boolean;
  restricted: boolean;
  pending: {
    id: string;
    method: "adult_account" | "digilocker";
    parent_email: string | null;
    code: string;
    expires_at: string;
    status: string;
    failure_reason: string | null;
  } | null;
};

export async function getAgeGateStatus(): Promise<AgeGateStatus | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.rpc("my_age_gate_status");
  if (error) throw error;
  return (data ?? null) as AgeGateStatus | null;
}

/** Child asks a parent to approve. Returns the one-time code to hand over. */
export async function requestParentalConsent(
  parentEmail: string,
  method: "adult_account" | "digilocker" = "adult_account",
): Promise<{ id: string; code: string; method: string }> {
  const { data, error } = await supabase.rpc("request_parental_consent", {
    _parent_email: parentEmail,
    _method: method,
  });
  if (error) throw error;
  return data as { id: string; code: string; method: string };
}

/** Path (a): the parent, signed in on their own adult ONIQ account, approves. */
export async function approveParentalConsent(code: string): Promise<void> {
  const { error } = await supabase.rpc("approve_parental_consent", { _code: code });
  if (error) throw error;
}

/**
 * Path (b): DigiLocker. Only the opaque token REFERENCE is ever sent — never an
 * Aadhaar number, never a raw government ID, never a document image. The
 * database refuses anything that looks like an identifier.
 */
export async function submitDigilockerToken(tokenRef: string): Promise<void> {
  const { error } = await supabase.rpc("submit_digilocker_parental_consent", {
    _token_ref: tokenRef,
  });
  if (error) throw error;
}

/**
 * One-time backfill of the caller's own date of birth, for grandfathered
 * accounts that never recorded one. Uses the existing `set_signup_profile`
 * RPC, which upserts the DOB and recomputes `is_minor`.
 *
 * Only ever offer this when `has_dob` is false: once a DOB exists,
 * `trg_prevent_is_minor_self_change` locks it permanently, which is what stops
 * a restricted minor from re-declaring themselves an adult.
 */
export async function setMyDateOfBirth(dob: string): Promise<void> {
  const { error } = await supabase.rpc("set_signup_profile", { _dob: dob });
  if (error) throw error;
}

/** True when an error came from the restricted-state guard. */
export function isRestrictedError(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? "";
  return msg.toLowerCase().includes("restricted:");
}
