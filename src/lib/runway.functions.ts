// Client-callable RPCs for the admin-only Runway tool.
//
// Thin wrappers only. Every handler re-checks admin server-side via
// requireAdmin() inside runwayOps.server — the unlinked route is not a gate.
import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { Scene, StatusResult, SubmitPayload } from './runwayOps.server';

export const runwaySubmitJob = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SubmitPayload) => input)
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { submitJob } = await import('./runwayOps.server');
    return submitJob(context.supabase, context.userId, data);
  });

export const runwayPollJobs = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { pollJobs } = await import('./runwayOps.server');
    return pollJobs(context.supabase, context.userId);
  });

export const runwayStatus = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StatusResult> => {
    const { listJobs } = await import('./runwayOps.server');
    return listJobs(context.supabase, context.userId);
  });

export const runwayScenes = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Scene[]> => {
    const { listScenes } = await import('./runwayOps.server');
    return listScenes(context.supabase, context.userId);
  });

export const runwaySignStored = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { path: string }) => input)
  .handler(async ({ data, context }): Promise<string | null> => {
    const { signStored } = await import('./runwayOps.server');
    return signStored(context.supabase, context.userId, data.path);
  });
