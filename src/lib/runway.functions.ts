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

// FormData on purpose: the File is streamed as the request body rather than
// being read into a string. A base64 data URL of a 15MB phone photo is ~20MB
// of JS string on a mid-range Android WebView, which kills the process.
export const runwayUploadStill = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FormData) => {
    if (!(input instanceof FormData)) throw new Error('expected form data');
    return input;
  })
  .handler(async ({ data, context }): Promise<{ name: string; replaced: boolean }> => {
    const file = data.get('file');
    if (!(file instanceof Blob)) throw new Error('no file');
    const filename = String(data.get('filename') ?? '');
    const replace = data.get('replace') === 'true';
    const { uploadStill } = await import('./runwayStills.server');
    return uploadStill(context.supabase, context.userId, file, filename, replace);
  });

export const runwayDeleteStill = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string }) => input)
  .handler(async ({ data, context }): Promise<{ deleted: string }> => {
    const { deleteStill } = await import('./runwayStills.server');
    return deleteStill(context.supabase, context.userId, data.name);
  });

