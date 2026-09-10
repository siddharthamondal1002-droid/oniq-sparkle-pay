/**
 * THE ONE LINE THAT NAMES `callText` — brief section 4.
 *
 * "Connect the real model boundary via the existing `callText` model path."
 * This is the whole of that connection: no new provider, no new key, no new
 * model id, and no second way in.
 *
 * IT IS ITS OWN MODULE FOR A MEASURED REASON. `llm.ts` reads `Deno.env`, so
 * anything importing it cannot be loaded by the node test runner — and an
 * engine adapter that cannot be tested is an engine adapter nobody checks.
 * Keeping the binding here leaves `engine.ts` provider-free and testable, and
 * leaves exactly one greppable line for `runtimeWiring.test.ts` to pin.
 */
import { callText } from "../llm.ts";
import type { ProviderReply, ProviderRequest } from "./engine.ts";

export async function callTextProvider(req: ProviderRequest): Promise<ProviderReply> {
  return (await callText({
    system: req.system,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    maxTokens: req.maxTokens,
    noRetry: req.noRetry,
  })) as ProviderReply;
}
