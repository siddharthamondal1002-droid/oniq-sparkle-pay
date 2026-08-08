// TEMPORARY live verification harness — deleted after the run.
import { describe, expect, it } from 'vitest';
import { deleteStill, uploadStill } from '../runwayStills.server';

// The admin gate is proven separately (a real non-admin session gets
// "forbidden"). Here it is stubbed true so the POST-gate logic can be
// exercised against real storage.
const fakeUserSupabase = {
  rpc: async () => ({ data: true, error: null }),
} as never;
const UID = '00000000-0000-0000-0000-000000000000';

function png(size: number): Blob {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 0);
  return new Blob([b], { type: 'image/png' });
}

describe('live stills path', () => {
  it('runs every case', async () => {
    const results: Record<string, string> = {};
    const go = async (k: string, fn: () => Promise<unknown>) => {
      try {
        results[k] = `OK ${JSON.stringify(await fn())}`;
      } catch (e) {
        results[k] = `REJECTED ${(e as Error).message}`;
      }
    };

    await go('A 4MB real png', () =>
      uploadStill(fakeUserSupabase, UID, png(4 * 1024 * 1024), 'zz_probe_still.png', false),
    );
    await go('B txt renamed .png', () =>
      uploadStill(
        fakeUserSupabase,
        UID,
        new Blob([new TextEncoder().encode('plain text pretending to be an image')], {
          type: 'image/png',
        }),
        'zz_fake_text.png',
        false,
      ),
    );
    await go('C path separator', () =>
      uploadStill(fakeUserSupabase, UID, png(64), '../evil.png', false),
    );
    await go('D leading dot', () =>
      uploadStill(fakeUserSupabase, UID, png(64), '.hidden.png', false),
    );
    await go('E duplicate, no replace', () =>
      uploadStill(fakeUserSupabase, UID, png(64), 'zz_probe_still.png', false),
    );
    await go('F duplicate, replace=true', () =>
      uploadStill(fakeUserSupabase, UID, png(64), 'zz_probe_still.png', true),
    );
    await go('G over 15MB', () =>
      uploadStill(fakeUserSupabase, UID, png(16 * 1024 * 1024), 'zz_big.png', false),
    );
    await go('H delete', () => deleteStill(fakeUserSupabase, UID, 'zz_probe_still.png'));

    console.log('LIVE-RESULTS ' + JSON.stringify(results, null, 2));
    expect(true).toBe(true);
  }, 120_000);
});
