/**
 * ONIQ HEALTH AI — the provider registry. This file is the boundary.
 *
 * A health byte can reach a model only through a provider resolved HERE, and
 * in Phase 2 the registry names one provider that never leaves the process.
 * `providerFor` throws for any other id — "vertex", "gemini", "medgemma",
 * anything — so a `health_config.ai_provider` value that names a real
 * provider is a refusal, not a call. Phase 3 adds an entry to the registry, a
 * model to the allowlist and a price row, under the owner's and counsel's
 * gate; nothing else in the gateway changes.
 *
 * THE FACTORIES TAKE NO ARGUMENTS. Nothing from a request or a config row can
 * reach a provider's constructor, so no provider can be put into a special
 * mode by a caller. The misbehaving provider the contract tests use is a
 * test-only class that is never registered here (`aiIsolation.test.ts`
 * reads this file and pins both facts).
 */
import {
  MODEL_ALLOWLIST,
  PROVIDER_IDS,
  RECIPIENT_FOR_PROVIDER,
  type AiRecipient,
  type ProviderId,
  type ProviderInput,
  type ProviderOutput,
} from "./types.ts";
import { SyntheticHealthAIProvider } from "./synthetic.ts";

export interface HealthAIProvider {
  readonly id: ProviderId;
  readonly recipient: AiRecipient;
  readonly synthetic: boolean;
  run(input: ProviderInput): Promise<ProviderOutput>;
}

export const PROVIDER_REGISTRY: Record<ProviderId, () => HealthAIProvider> = {
  synthetic: () => new SyntheticHealthAIProvider(),
};

export function isProviderId(id: unknown): id is ProviderId {
  return typeof id === "string" && (PROVIDER_IDS as readonly string[]).includes(id);
}

export function providerFor(id: unknown): HealthAIProvider {
  if (!isProviderId(id)) throw new Error("provider_not_allowed");
  const provider = PROVIDER_REGISTRY[id]();
  // The registry and the recipient table are two lists; a provider whose
  // object disagrees with the table is refused rather than trusted.
  if (provider.id !== id || provider.recipient !== RECIPIENT_FOR_PROVIDER[id]) {
    throw new Error("provider_not_allowed");
  }
  return provider;
}

export function modelAllowed(providerId: ProviderId, model: unknown): model is string {
  return typeof model === "string" && MODEL_ALLOWLIST[providerId].includes(model);
}
