// Client-callable RPCs for the admin-only episode assembler.
//
// Thin wrappers only. Every handler re-checks admin server-side inside
// episode.server — the unlinked screen is not a gate. Nothing here touches
// the Runway submit/poll/status path or its cost guard.
import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { EpisodeStatus, SubmitEpisodePayload } from './episode.server';

export const episodeSubmit = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SubmitEpisodePayload) => input)
  .handler(
    async ({ data, context }): Promise<{ id: string; totalSeconds: number; adjustments: string[] }> => {
      const { submitEpisode } = await import('./episode.server');
      return submitEpisode(context.supabase, context.userId, data);
    },
  );

export const episodeList = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EpisodeStatus> => {
    const { episodeStatus } = await import('./episode.server');
    return episodeStatus(context.supabase, context.userId);
  });

export const episodeSign = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { path: string }) => input)
  .handler(async ({ data, context }): Promise<string | null> => {
    const { signEpisode } = await import('./episode.server');
    return signEpisode(context.supabase, context.userId, data.path);
  });
