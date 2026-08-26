// Client-callable RPCs for the admin-only in-house GPU video tool.
//
// Thin wrappers only. Every handler re-checks admin server-side via
// requireAdmin() inside gpuVideo.server — the unlinked route is not a gate,
// and none of these accepts a GPU, provider, model, budget or bucket path.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { GpuStatusResult } from "./gpuVideo.server";
import type { JobStatus } from "./gpuVideoFlow";

export type GpuSubmitPayload = {
  prompt: string;
  referenceId: string;
  idempotencyKey: string;
};

export const gpuVideoSubmit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: GpuSubmitPayload) => input)
  .handler(
    async ({ data, context }): Promise<{ id: string; status: JobStatus; reused: boolean }> => {
      const { submitGeneration } = await import("./gpuVideo.server");
      // The whole object goes to the pure validator, which refuses unknown
      // fields — including infrastructure words — rather than ignoring them.
      return submitGeneration(context.supabase, context.userId, data as Record<string, unknown>);
    },
  );

export const gpuVideoPoll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ checked: number }> => {
    const { pollGenerations } = await import("./gpuVideo.server");
    return pollGenerations(context.supabase, context.userId);
  });

export const gpuVideoStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GpuStatusResult> => {
    const { listGenerations } = await import("./gpuVideo.server");
    return listGenerations(context.supabase, context.userId);
  });

export const gpuVideoSign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { path: string }) => input)
  .handler(async ({ data, context }): Promise<string | null> => {
    const { signGenerated } = await import("./gpuVideo.server");
    return signGenerated(context.supabase, context.userId, data.path);
  });
