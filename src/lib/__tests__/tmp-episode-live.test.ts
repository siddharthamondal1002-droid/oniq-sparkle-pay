// TEMPORARY live-gate probe. Deleted immediately after the run — it talks to
// the real database and is not part of the suite.
import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { submitEpisode } from '../episode.server';
import type { Database } from '@/integrations/supabase/types';

const url = process.env['SUPABASE_URL']!;
const pub = process.env['SUPABASE_PUBLISHABLE_KEY'] ?? process.env['VITE_SUPABASE_PUBLISHABLE_KEY']!;
const token = JSON.parse(process.env['LOVABLE_BROWSER_SUPABASE_SESSION_JSON']!).access_token;
const uid = JSON.parse(process.env['LOVABLE_BROWSER_SUPABASE_SESSION_JSON']!).user.id;

const asAdmin = createClient<Database>(url, pub, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${token}` } },
}) as unknown as SupabaseClient<Database>;

const asAnon = createClient<Database>(url, pub, {
  auth: { persistSession: false },
}) as unknown as SupabaseClient<Database>;

const three = [
  { stillPath: 'ep1_s01.png', durationSeconds: 10, motion: 'zoomIn' as const },
  { stillPath: 'ep1_s02.png', durationSeconds: 10, motion: 'zoomOut' as const },
];

describe('live gates', () => {
  it('non-admin is refused', async () => {
    await expect(
      submitEpisode(asAnon, '00000000-0000-0000-0000-000000000000', { scenes: three }),
    ).rejects.toThrow('forbidden');
  });

  it('refuses a 25 minute timeline', async () => {
    const long = Array.from({ length: 25 }, () => ({
      stillPath: 'ep1_s01.png',
      durationSeconds: 60,
      motion: 'zoomIn' as const,
    }));
    await expect(submitEpisode(asAdmin, uid, { scenes: long })).rejects.toThrow(/cap is 20 minutes/);
  });

  it('refuses a second render while one is in progress', async () => {
    await expect(submitEpisode(asAdmin, uid, { scenes: three })).rejects.toThrow(
      /already in progress/,
    );
  });
});
