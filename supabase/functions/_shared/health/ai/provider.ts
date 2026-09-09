/**
 * ONIQ HEALTH AI — the provider registry. This file is the boundary.
 *
 * A health byte can reach a model only through a provider resolved HERE.
 * Phase 2 named one provider that never leaves the process; Phase 3 (owner
 * directive 2026-09-09) added the one real provider, "vertex" — Google Cloud
 * Vertex AI through the Firebase service account (`./vertex.ts`). Its
 * recipient is `google_vertex`, so the gate refuses it until
 * `health.provider_sharing.enabled` is on and a consent names Google under a
 * terms version that disclosed Google. `providerFor` still throws for any
 * other id — "gemini", "medgemma", anything — so a `health_config.ai_provider`
 * value outside this file is a refusal, not a call.
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
import { VertexHealthAIProvider } from "./vertex.ts";

export interface HealthAIProvider {
  readonly id: ProviderId;
  readonly recipient: AiRecipient;
  readonly synthetic: boolean;
  run(input: ProviderInput): Promise<ProviderOutput>;
}

export const PROVIDER_REGISTRY: Record<ProviderId, () => HealthAIProvider> = {
  synthetic: () => new SyntheticHealthAIProvider(),
  vertex: () => new VertexHealthAIProvider(),
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
