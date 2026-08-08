// Runway orchestration — server-only. Cost guard lives here.
//
// ORDER MATTERS: admin gate -> kill switch -> daily cap -> validation ->
// Runway call. The cap is checked BEFORE any billable request is made.
//
// There is deliberately no batch input and no retry anywhere in this file.
// One submit, one clip. A loop over an array is how a month of credits
// disappears in an hour, and a failing prompt fails identically every time.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import {
  CREDITS_PER_SECOND,
  RUNWAY_BUCKET,
  requireAdmin,
  runwaySubmit,
  runwayTask,
  storeOutput,
  validateSubmit,
} from './runway.server';

export type SubmitPayload = {
  promptImage: string;
  promptText: string;
  model?: string;
  ratio?: string;
  duration?: number;
  seed?: number | null;
  sceneRef?: string | null;
};

export type JobRow = Database['public']['Tables']['video_jobs']['Row'];

function startOfUtcDay(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function submitJob(
  userSupabase: SupabaseClient<Database>,
  userId: string,
  payload: SubmitPayload,
): Promise<{ id: string }> {
  const { supabaseAdmin } = await requireAdmin(userSupabase, userId);

  // --- kill switch (a config row; no deploy needed to flip) ----------------
  const { data: cfg } = await supabaseAdmin
    .from('video_gen_config')
    .select('enabled, daily_cap')
    .eq('id', true)
    .maybeSingle();
  if (!cfg || cfg.enabled === false) throw new Error('video generation is disabled');

  // --- daily cap, BEFORE the billable call ---------------------------------
  const { count, error: countErr } = await supabaseAdmin
    .from('video_jobs')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', startOfUtcDay());
  if (countErr) throw new Error('cap check failed');
  if ((count ?? 0) >= cfg.daily_cap) {
    throw new Error(`daily cap reached (${count}/${cfg.daily_cap})`);
  }

  const normalised = {
    promptImage: String(payload.promptImage ?? ''),
    promptText: String(payload.promptText ?? '').trim(),
    model: payload.model ?? 'gen4_turbo',
    ratio: payload.ratio ?? '720:1280',
    duration: Number(payload.duration ?? 5),
    seed:
      payload.seed === null || payload.seed === undefined ? null : Number(payload.seed),
  };
  const invalid = validateSubmit(normalised);
  if (invalid) throw new Error(invalid);

  const taskId = await runwaySubmit(normalised);

  const { data: row, error } = await supabaseAdmin
    .from('video_jobs')
    .insert({
      created_by: userId,
      runway_task_id: taskId,
      status: 'running',
      scene_ref: payload.sceneRef ?? null,
      prompt_image_url: normalised.promptImage,
      prompt_text: normalised.promptText,
      model: normalised.model,
      ratio: normalised.ratio,
      duration: normalised.duration,
      seed: normalised.seed,
      credits_estimate: normalised.duration * CREDITS_PER_SECOND,
    })
    .select('id')
    .single();

  if (error || !row) {
    console.error('[runway-submit] insert failed', error?.message);
    throw new Error('job submitted but could not be recorded');
  }
  // Only the job id. Never the raw Runway response.
  return { id: row.id };
}

export async function pollJobs(
  userSupabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ checked: number; succeeded: number; failed: number }> {
  const { supabaseAdmin } = await requireAdmin(userSupabase, userId);

  const { data: jobs } = await supabaseAdmin
    .from('video_jobs')
    .select('id, runway_task_id, stored_path, status')
    .eq('status', 'running')
    .limit(25);

  let succeeded = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    if (!job.runway_task_id) continue;
    let state;
    try {
      state = await runwayTask(job.runway_task_id);
    } catch (e) {
      // Transient read failure. Leave the job running; no retry of the
      // generation itself ever happens here.
      console.warn('[runway-poll] task read failed', (e as Error).message);
      continue;
    }

    if (state.status === 'SUCCEEDED') {
      // Idempotent: if the bytes are already stored, only settle the status.
      let storedPath = job.stored_path;
      const url = state.output[0] ?? null;
      if (!storedPath && url) {
        try {
          storedPath = await storeOutput(supabaseAdmin, job.id, url);
        } catch (e) {
          console.error('[runway-poll] store failed', (e as Error).message);
          continue;
        }
      }
      // The status filter above makes this a no-op the second time round.
      const { data: updated } = await supabaseAdmin
        .from('video_jobs')
        .update({ status: 'succeeded', stored_path: storedPath, output_url: url, error: null })
        .eq('id', job.id)
        .eq('status', 'running')
        .select('id');
      if (updated?.length) succeeded += 1;
    } else if (state.status === 'FAILED') {
      // NO automatic retry. A failing prompt bills every attempt.
      const { data: updated } = await supabaseAdmin
        .from('video_jobs')
        .update({ status: 'failed', error: state.failure ?? 'runway reported failure' })
        .eq('id', job.id)
        .eq('status', 'running')
        .select('id');
      if (updated?.length) failed += 1;
    }
  }

  return { checked: jobs?.length ?? 0, succeeded, failed };
}

export type StatusResult = {
  jobs: JobRow[];
  usedToday: number;
  cap: number;
  enabled: boolean;
};

export async function listJobs(
  userSupabase: SupabaseClient<Database>,
  userId: string,
): Promise<StatusResult> {
  const { supabaseAdmin } = await requireAdmin(userSupabase, userId);

  const [{ data: jobs }, { data: cfg }, { count }] = await Promise.all([
    supabaseAdmin.from('video_jobs').select('*').order('created_at', { ascending: false }).limit(50),
    supabaseAdmin.from('video_gen_config').select('enabled, daily_cap').eq('id', true).maybeSingle(),
    supabaseAdmin
      .from('video_jobs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfUtcDay()),
  ]);

  return {
    jobs: (jobs ?? []) as JobRow[],
    usedToday: count ?? 0,
    cap: cfg?.daily_cap ?? 0,
    enabled: cfg?.enabled ?? false,
  };
}

export type Scene = { name: string; signedUrl: string };

/** Stills the admin can animate, plus a signed URL Runway is able to fetch. */
export async function listScenes(
  userSupabase: SupabaseClient<Database>,
  userId: string,
): Promise<Scene[]> {
  const { supabaseAdmin } = await requireAdmin(userSupabase, userId);
  const { data: files } = await supabaseAdmin.storage
    .from(RUNWAY_BUCKET)
    .list('stills', { limit: 100, sortBy: { column: 'name', order: 'asc' } });

  const names = (files ?? []).filter((f) => f.name && !f.name.startsWith('.')).map((f) => f.name);
  if (!names.length) return [];

  const { data: signed } = await supabaseAdmin.storage
    .from(RUNWAY_BUCKET)
    .createSignedUrls(
      names.map((n) => `stills/${n}`),
      60 * 60 * 6,
    );

  return (signed ?? [])
    .filter((s): s is typeof s & { signedUrl: string } => !!s.signedUrl && !s.error)
    .map((s) => ({ name: (s.path ?? '').replace(/^stills\//, ''), signedUrl: s.signedUrl }));
}

/** Signed playback URL for a stored clip. */
export async function signStored(
  userSupabase: SupabaseClient<Database>,
  userId: string,
  path: string,
): Promise<string | null> {
  const { supabaseAdmin } = await requireAdmin(userSupabase, userId);
  const { data } = await supabaseAdmin.storage
    .from(RUNWAY_BUCKET)
    .createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}
