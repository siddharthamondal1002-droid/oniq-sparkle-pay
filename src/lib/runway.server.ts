// Runway video generation — server-only half. Never imported by the client.
//
// THE SERVER CHECK IS THE GATE. The admin screen being unlinked is cosmetic;
// everything below re-derives the caller's identity from their JWT and checks
// profiles.is_admin with the service role before doing anything at all.
//
// RUNWAY_API_KEY is read here and only here. It is never returned to the
// browser, never logged, and never embedded in an error message.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export const RUNWAY_BUCKET = 'video-gen';
export const RUNWAY_ENDPOINT = 'https://api.dev.runwayml.com/v1/image_to_video';
export const RUNWAY_TASKS_ENDPOINT = 'https://api.dev.runwayml.com/v1/tasks';
export const RUNWAY_VERSION = '2024-11-06';
/** gen4_turbo bills roughly 5 credits per second of output. */
export const CREDITS_PER_SECOND = 5;

export const ALLOWED_RATIOS = ['720:1280', '1280:720', '960:960', '1104:832', '832:1104'];
export const ALLOWED_DURATIONS = [5, 10];
export const ALLOWED_MODELS = ['gen4_turbo'];

export type Admin = { supabaseAdmin: SupabaseClient<Database>; userId: string };

/** Thrown as a plain Error so the client only ever sees "forbidden". */
export class Forbidden extends Error {
  constructor() {
    super('forbidden');
  }
}

export async function requireAdmin(
  userSupabase: SupabaseClient<Database>,
  userId: string,
): Promise<Admin> {
  const { data, error } = await userSupabase.rpc('is_admin', { _uid: userId });
  if (error || data !== true) {
    console.warn(`[runway] refused: non-admin caller ${userId}`);
    throw new Forbidden();
  }
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  return { supabaseAdmin: supabaseAdmin as unknown as SupabaseClient<Database>, userId };
}

function apiKey(): string {
  const key = process.env['RUNWAY_API_KEY'];
  if (!key) throw new Error('video generation is not configured');
  return key;
}

function runwayHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    'X-Runway-Version': RUNWAY_VERSION,
    'Content-Type': 'application/json',
  };
}

export type SubmitInput = {
  promptImage: string;
  promptText: string;
  model: string;
  ratio: string;
  duration: number;
  seed: number | null;
};

/** Returns the Runway task id, or throws with a message safe for the browser. */
export async function runwaySubmit(input: SubmitInput): Promise<string> {
  const payload: Record<string, unknown> = {
    model: input.model,
    promptImage: input.promptImage,
    promptText: input.promptText,
    ratio: input.ratio,
    duration: input.duration,
  };
  if (input.seed !== null) payload.seed = input.seed;

  const res = await fetch(RUNWAY_ENDPOINT, {
    method: 'POST',
    headers: runwayHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    // Status only. The upstream body can echo the request back, key included.
    console.error(`[runway-submit] upstream ${res.status}`);
    throw new Error(`runway rejected the request (${res.status})`);
  }
  const parsed = (await res.json()) as { id?: string };
  if (!parsed.id) throw new Error('runway returned no task id');
  return parsed.id;
}

export type TaskState = {
  status: string;
  output: string[];
  failure: string | null;
};

export async function runwayTask(taskId: string): Promise<TaskState> {
  const res = await fetch(`${RUNWAY_TASKS_ENDPOINT}/${encodeURIComponent(taskId)}`, {
    headers: runwayHeaders(),
  });
  if (!res.ok) {
    console.error(`[runway-poll] upstream ${res.status}`);
    throw new Error(`could not read task (${res.status})`);
  }
  const body = (await res.json()) as {
    status?: string;
    output?: string[];
    failure?: string;
    failureCode?: string;
  };
  return {
    status: String(body.status ?? 'UNKNOWN'),
    output: Array.isArray(body.output) ? body.output : [],
    failure: body.failure ?? body.failureCode ?? null,
  };
}

/**
 * Runway output URLs expire. Download and store the bytes immediately.
 * Returns the storage path.
 */
export async function storeOutput(
  supabaseAdmin: SupabaseClient<Database>,
  jobId: string,
  url: string,
): Promise<string> {
  const path = `out/${jobId}.mp4`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not download output (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const { error } = await supabaseAdmin.storage
    .from(RUNWAY_BUCKET)
    .upload(path, bytes, { contentType: 'video/mp4', upsert: true });
  if (error) throw new Error(`could not store output: ${error.message}`);
  return path;
}

export function validateSubmit(
  raw: {
    promptImage: string;
    promptText: string;
    model: string;
    ratio: string;
    duration: number;
    seed: number | null;
  },
): string | null {
  if (!raw.promptText.trim()) return 'promptText required';
  if (!ALLOWED_MODELS.includes(raw.model)) return 'unsupported model';
  if (!ALLOWED_RATIOS.includes(raw.ratio)) return 'unsupported ratio';
  if (!ALLOWED_DURATIONS.includes(raw.duration)) return 'duration must be 5 or 10';
  if (raw.seed !== null && (!Number.isFinite(raw.seed) || raw.seed < 0)) return 'invalid seed';

  // Runway fetches promptImage itself, so it must be https on a host we
  // control — a signed URL from our own storage, nothing else.
  let host = '';
  try {
    host = new URL(process.env['SUPABASE_URL'] ?? '').host;
  } catch {
    host = '';
  }
  let img: URL;
  try {
    img = new URL(raw.promptImage);
  } catch {
    return 'promptImage must be an absolute https URL';
  }
  if (img.protocol !== 'https:' || !host || img.host !== host) {
    return 'promptImage must be an https URL on our own storage';
  }
  return null;
}
