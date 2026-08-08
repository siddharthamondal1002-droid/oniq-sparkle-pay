// Episode assembler — server-only half. Never imported by the client.
//
// ORDER MATTERS, same as the Runway tool: admin gate -> kill switch ->
// daily cap -> concurrency -> validation -> enqueue. Every gate is checked
// BEFORE a job row exists, because the row is what the renderer picks up.
//
// This file NEVER renders. It only queues. The renderer is an out-of-band
// worker (remotion/scripts/render-episode.mjs) holding the service role;
// the Worker runtime this app is deployed to cannot run ffmpeg or Chromium
// and has a wall-clock limit far below a 20-minute render.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { RUNWAY_BUCKET, requireAdmin } from './runway.server';
import { planTimeline, type SceneInput } from './episodeTimeline';

export const EPISODE_PREFIX = 'episodes';
export const STILLS_PREFIX = 'stills';
export const AUDIO_PREFIX = 'audio';

export type EpisodeJobRow = Database['public']['Tables']['episode_jobs']['Row'];

export type SubmitEpisodePayload = {
  title?: string | null;
  scenes: SceneInput[];
};

function startOfUtcDay(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function listNames(
  supabaseAdmin: SupabaseClient<Database>,
  prefix: string,
): Promise<string[]> {
  const { data } = await supabaseAdmin.storage
    .from(RUNWAY_BUCKET)
    .list(prefix, { limit: 500, sortBy: { column: 'name', order: 'asc' } });
  return (data ?? []).filter((f) => f.name && !f.name.startsWith('.')).map((f) => f.name);
}

export async function submitEpisode(
  userSupabase: SupabaseClient<Database>,
  userId: string,
  payload: SubmitEpisodePayload,
): Promise<{ id: string; totalSeconds: number; adjustments: string[] }> {
  const { supabaseAdmin } = await requireAdmin(userSupabase, userId);

  // --- kill switch (a config row; flippable without a deploy) --------------
  const { data: cfg } = await supabaseAdmin
    .from('video_gen_config')
    .select('episodes_enabled, episode_daily_cap')
    .eq('id', true)
    .maybeSingle();
  if (!cfg || cfg.episodes_enabled === false) throw new Error('episode assembly is disabled');
  const cap = cfg.episode_daily_cap ?? 0;

  // --- daily cap, BEFORE any CPU is spent ----------------------------------
  const { count, error: countErr } = await supabaseAdmin
    .from('episode_jobs')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', startOfUtcDay());
  if (countErr) throw new Error('cap check failed');
  if ((count ?? 0) >= cap) throw new Error(`daily cap reached (${count}/${cap})`);

  // --- concurrency: one render at a time, refused not queued ---------------
  const { count: active } = await supabaseAdmin
    .from('episode_jobs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['queued', 'running']);
  if ((active ?? 0) > 0) throw new Error('a render is already in progress — wait for it to finish');

  // --- validation (the client plan is advisory; this one is the truth) -----
  const plan = planTimeline(payload.scenes);
  if (typeof plan === 'string') throw new Error(plan);

  // Every referenced file must already exist in our own bucket.
  const [stills, audio] = await Promise.all([
    listNames(supabaseAdmin, STILLS_PREFIX),
    listNames(supabaseAdmin, AUDIO_PREFIX),
  ]);
  for (const [i, s] of plan.scenes.entries()) {
    if (!stills.includes(s.stillPath)) throw new Error(`scene ${i + 1}: no still named ${s.stillPath}`);
    if (s.audioPath && !audio.includes(s.audioPath)) {
      throw new Error(`scene ${i + 1}: no narration named ${s.audioPath}`);
    }
  }

  const { data: row, error } = await supabaseAdmin
    .from('episode_jobs')
    .insert({
      created_by: userId,
      title: payload.title ? String(payload.title).slice(0, 120) : null,
      status: 'queued',
      timeline: plan.scenes as unknown as Database['public']['Tables']['episode_jobs']['Insert']['timeline'],
      total_seconds: plan.totalSeconds,
    })
    .select('id')
    .single();
  if (error || !row) {
    console.error('[episode-submit] insert failed', error?.message);
    throw new Error('could not queue the render');
  }

  return { id: row.id, totalSeconds: plan.totalSeconds, adjustments: plan.adjustments };
}

export type EpisodeStatus = {
  jobs: EpisodeJobRow[];
  usedToday: number;
  cap: number;
  enabled: boolean;
  stills: string[];
  audio: string[];
};

/** Read-only and idempotent: polling this never mutates a job. */
export async function episodeStatus(
  userSupabase: SupabaseClient<Database>,
  userId: string,
): Promise<EpisodeStatus> {
  const { supabaseAdmin } = await requireAdmin(userSupabase, userId);

  const [{ data: jobs }, { data: cfg }, { count }, stills, audio] = await Promise.all([
    supabaseAdmin
      .from('episode_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(25),
    supabaseAdmin
      .from('video_gen_config')
      .select('episodes_enabled, episode_daily_cap')
      .eq('id', true)
      .maybeSingle(),
    supabaseAdmin
      .from('episode_jobs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfUtcDay()),
    listNames(supabaseAdmin, STILLS_PREFIX),
    listNames(supabaseAdmin, AUDIO_PREFIX),
  ]);

  return {
    jobs: (jobs ?? []) as EpisodeJobRow[],
    usedToday: count ?? 0,
    cap: cfg?.episode_daily_cap ?? 0,
    enabled: cfg?.episodes_enabled ?? false,
    stills,
    audio,
  };
}

export async function signEpisode(
  userSupabase: SupabaseClient<Database>,
  userId: string,
  path: string,
): Promise<string | null> {
  const { supabaseAdmin } = await requireAdmin(userSupabase, userId);
  if (!path.startsWith(`${EPISODE_PREFIX}/`)) throw new Error('not an episode path');
  const { data } = await supabaseAdmin.storage.from(RUNWAY_BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}
