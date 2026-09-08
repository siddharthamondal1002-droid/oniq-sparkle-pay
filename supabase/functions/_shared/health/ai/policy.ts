/**
 * ONIQ HEALTH AI — the policy engine. Pure, fail-fast, one distinct reason
 * per clause, in the order below, so a refusal names the first thing that
 * was wrong and a test can mutate exactly one input and see exactly one
 * reason change.
 *
 *   ai_disabled             the server row says health or health.ai is off
 *   task_not_allowed        not one of AI_TASKS
 *   provider_not_allowed    not in PROVIDER_IDS, or a provider whose recipient
 *                           is not ONIQ while provider sharing is off
 *   model_not_allowed       not in MODEL_ALLOWLIST for that provider
 *   unpriced_model          allowed but with no PRICE_PER_1M row — refused
 *                           here so nothing can spend before it can price
 *   caps_unset              a daily cap of zero; the owner has not set one
 *   region_blocked          the request's region signal is a blocked one
 *   age_unverified          the account has no date of birth on file
 *   minor_blocked           the account is under 18
 *   synthetic_in_production a synthetic answer never reaches a real user in
 *                           production; an admin may verify there only when
 *                           the row's ai_admin_verification_enabled is true
 *   ai_consent_required     no active consent for (ai_interpretation,
 *                           category, provider.recipient) for EVERY category
 *
 * PRODUCTION IS DECIDED BY THE PROJECT, NOT THE ROW. `resolveEnvironment`
 * returns "production" whenever SUPABASE_URL names the production project
 * ref, whatever `health_config.environment` says — the column may only
 * tighten, never loosen, so an edit to one row cannot open synthetic answers
 * to 125 real accounts. Unknown values resolve to production too.
 *
 * The gate half (everything but consent) runs BEFORE any row about the
 * person is read, so a disabled gateway reads nothing about them. The
 * consent half runs after the context is built, because only then are the
 * categories known.
 */
import {
  AI_PURPOSE,
  AI_TASKS,
  PROVIDER_IDS,
  RECIPIENT_FOR_PROVIDER,
  type AiRecipient,
  type AiRefusalReason,
  type AiTask,
  type ProviderId,
} from "./types.ts";
import { modelAllowed } from "./provider.ts";
import { priceRowFor } from "./cost.ts";
import { findCovering, type ConsentLike } from "../consent.ts";
import type { HealthFlags } from "../flags.ts";

/** The one project whose URL means "real people". Pinned by supabaseProjectRef.test.ts. */
export const PRODUCTION_PROJECT_REF = "bqwttemnnoexadpwifcj";

export const ENVIRONMENTS = ["production", "staging", "development"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export function resolveEnvironment(
  rowValue: unknown,
  supabaseUrl: string | undefined,
): Environment {
  if (typeof supabaseUrl === "string" && supabaseUrl.includes(PRODUCTION_PROJECT_REF)) {
    return "production";
  }
  if (typeof rowValue === "string" && (ENVIRONMENTS as readonly string[]).includes(rowValue)) {
    return rowValue as Environment;
  }
  return "production";
}

export type Actor = {
  isAdmin: boolean;
  /** null = no date of birth on file; the account cannot prove its age either way. */
  isAdult: boolean | null;
};

export type GateInput = {
  flags: HealthFlags;
  environment: Environment;
  actor: Actor;
  adminVerificationEnabled: boolean;
  regionBlocked: boolean;
  providerId: unknown;
  model: unknown;
  task: unknown;
  capPerUser: number;
  capHouse: number;
};

export type GateAllowed = {
  allowed: true;
  task: AiTask;
  providerId: ProviderId;
  model: string;
  recipient: AiRecipient;
  /** True when the admin-verification clause is what let the call through. */
  adminVerification: boolean;
};

export type GateDecision =
  GateAllowed | { allowed: false; reason: AiRefusalReason; detail?: Record<string, string> };

export function checkGate(input: GateInput): GateDecision {
  if (!input.flags["health.enabled"] || !input.flags["health.ai.enabled"]) {
    return { allowed: false, reason: "ai_disabled" };
  }
  if (!(AI_TASKS as readonly string[]).includes(String(input.task))) {
    return { allowed: false, reason: "task_not_allowed" };
  }
  if (!(PROVIDER_IDS as readonly string[]).includes(String(input.providerId))) {
    return { allowed: false, reason: "provider_not_allowed" };
  }
  const providerId = input.providerId as ProviderId;
  const recipient = RECIPIENT_FOR_PROVIDER[providerId];
  // A provider that would carry bytes out of ONIQ needs the sharing switch
  // (§83C's health.provider_sharing.enabled). No Phase 2 provider does, and
  // aiIsolation.test.ts pins that; the clause exists so the day one is
  // registered, the switch is already the gate.
  if (recipient !== "oniq" && !input.flags["health.provider_sharing.enabled"]) {
    return { allowed: false, reason: "provider_not_allowed", detail: { recipient } };
  }
  if (!modelAllowed(providerId, input.model)) {
    return { allowed: false, reason: "model_not_allowed" };
  }
  if (!priceRowFor(input.model)) return { allowed: false, reason: "unpriced_model" };
  if (
    !Number.isFinite(input.capPerUser) ||
    !Number.isFinite(input.capHouse) ||
    input.capPerUser <= 0 ||
    input.capHouse <= 0
  ) {
    return { allowed: false, reason: "caps_unset" };
  }
  if (input.regionBlocked) return { allowed: false, reason: "region_blocked" };
  if (input.actor.isAdult === null) return { allowed: false, reason: "age_unverified" };
  if (input.actor.isAdult === false) return { allowed: false, reason: "minor_blocked" };
  let adminVerification = false;
  if (recipient === "oniq" && input.environment === "production") {
    if (!(input.actor.isAdmin && input.adminVerificationEnabled)) {
      return { allowed: false, reason: "synthetic_in_production" };
    }
    adminVerification = true;
  }
  return {
    allowed: true,
    task: input.task as AiTask,
    providerId,
    model: input.model,
    recipient,
    adminVerification,
  };
}

export type ConsentDecision =
  | { allowed: true; purpose: typeof AI_PURPOSE; consentIds: string[] }
  | {
      allowed: false;
      reason: "ai_consent_required";
      detail: { purpose: string; category: string; recipient: string };
    };

/**
 * Every category the context touched must be covered by an ACTIVE consent
 * for the AI purpose naming THIS provider's recipient. A consent for
 * `google_vertex` does not cover the synthetic provider and vice versa, so a
 * provider swap without a matching consent is a refusal.
 */
export function checkConsent(
  consents: readonly (ConsentLike & { id: string })[],
  categories: readonly string[],
  recipient: AiRecipient,
  nowIso: string,
): ConsentDecision {
  const ids = new Set<string>();
  for (const category of categories) {
    const hit = findCovering(consents, { purpose: AI_PURPOSE, category, recipient }, nowIso);
    if (!hit) {
      return {
        allowed: false,
        reason: "ai_consent_required",
        detail: { purpose: AI_PURPOSE, category, recipient },
      };
    }
    ids.add(hit.id);
  }
  return { allowed: true, purpose: AI_PURPOSE, consentIds: [...ids] };
}

/** The categories an active AI consent for this recipient covers right now. */
export function consentedCategories(
  consents: readonly (ConsentLike & { id: string })[],
  recipient: AiRecipient,
  nowIso: string,
  categories: readonly string[],
): string[] {
  return categories.filter(
    (category) =>
      findCovering(consents, { purpose: AI_PURPOSE, category, recipient }, nowIso) !== null,
  );
}

export type PolicyDecision =
  | (GateAllowed & { purpose: typeof AI_PURPOSE; consentIds: string[] })
  | { allowed: false; reason: AiRefusalReason; detail?: Record<string, string> };

/** Both halves at once, for tests and for callers that already hold the categories. */
export function evaluateAiPolicy(
  input: GateInput & {
    categoriesNeeded: readonly string[];
    consents: readonly (ConsentLike & { id: string })[];
    nowIso: string;
  },
): PolicyDecision {
  const gate = checkGate(input);
  if (!gate.allowed) return gate;
  const consent = checkConsent(
    input.consents,
    input.categoriesNeeded,
    gate.recipient,
    input.nowIso,
  );
  if (!consent.allowed) return consent;
  return { ...gate, purpose: consent.purpose, consentIds: consent.consentIds };
}
