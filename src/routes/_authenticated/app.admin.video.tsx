// ADMIN-ONLY internal tool. Deliberately unstyled — it should look like a
// tool, not a feature. Direct route only; nothing in the app links here.
//
// The screen is not the gate. Every call below is refused server-side for a
// non-admin, and video_jobs RLS is admin-only.
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useState } from 'react';
import {
  runwayPollJobs,
  runwayScenes,
  runwaySignStored,
  runwayStatus,
  runwaySubmitJob,
} from '@/lib/runway.functions';

export const Route = createFileRoute('/_authenticated/app/admin/video')({
  head: () => ({
    meta: [
      { title: 'Internal video tool' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: AdminVideoTool,
});

const RATIOS = ['720:1280', '1280:720', '960:960', '1104:832', '832:1104'];

function AdminVideoTool() {
  const qc = useQueryClient();
  const status = useServerFn(runwayStatus);
  const scenes = useServerFn(runwayScenes);
  const submit = useServerFn(runwaySubmitJob);
  const poll = useServerFn(runwayPollJobs);
  const sign = useServerFn(runwaySignStored);

  const [scene, setScene] = useState('');
  const [promptText, setPromptText] = useState('');
  const [duration, setDuration] = useState(5);
  const [ratio, setRatio] = useState('720:1280');
  const [seed, setSeed] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, string>>({});

  const statusQuery = useQuery({
    queryKey: ['runway-status'],
    queryFn: () => status({ data: undefined }),
    retry: false,
  });

  const scenesQuery = useQuery({
    queryKey: ['runway-scenes'],
    queryFn: () => scenes({ data: undefined }),
    retry: false,
  });

  const jobs = statusQuery.data?.jobs ?? [];
  const anyRunning = jobs.some((j) => j.status === 'running');

  // Poll only while something is running; stop entirely when nothing is.
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => {
      void poll({ data: undefined })
        .then(() => qc.invalidateQueries({ queryKey: ['runway-status'] }))
        .catch(() => undefined);
    }, 12000);
    return () => clearInterval(t);
  }, [anyRunning, poll, qc]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const chosen = (scenesQuery.data ?? []).find((s) => s.name === scene);
      if (!chosen) throw new Error('pick a scene still first');
      return submit({
        data: {
          promptImage: chosen.signedUrl,
          promptText,
          ratio,
          duration,
          seed: seed.trim() === '' ? null : Number(seed),
          sceneRef: chosen.name,
        },
      });
    },
    onSuccess: (r) => {
      setMessage(`submitted: ${r.id}`);
      void qc.invalidateQueries({ queryKey: ['runway-status'] });
    },
    onError: (e: Error) => setMessage(`error: ${e.message}`),
  });

  async function showClip(jobId: string, path: string) {
    const url = await sign({ data: { path } });
    if (url) setPreview((p) => ({ ...p, [jobId]: url }));
  }

  if (statusQuery.isError) {
    return <pre style={{ padding: 16 }}>forbidden</pre>;
  }

  const used = statusQuery.data?.usedToday ?? 0;
  const cap = statusQuery.data?.cap ?? 0;
  const enabled = statusQuery.data?.enabled ?? false;

  return (
    <div style={{ padding: 16, fontFamily: 'monospace', fontSize: 13 }}>
      <h1 style={{ fontSize: 15, fontWeight: 700 }}>runway video tool (internal)</h1>
      <p>
        today: {used}/{cap} &nbsp;|&nbsp; kill switch: {enabled ? 'ON (enabled)' : 'OFF (disabled)'}
      </p>

      <fieldset style={{ marginTop: 12, padding: 8 }}>
        <legend>submit one clip</legend>
        <div>
          <label>
            scene still:{' '}
            <select value={scene} onChange={(e) => setScene(e.target.value)}>
              <option value="">-- pick --</option>
              {(scenesQuery.data ?? []).map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ marginTop: 6 }}>
          <label>
            motion prompt:{' '}
            <textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={3}
              cols={60}
            />
          </label>
        </div>
        <div style={{ marginTop: 6 }}>
          <label>
            duration:{' '}
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              <option value={5}>5</option>
              <option value={10}>10</option>
            </select>
          </label>{' '}
          <label>
            ratio:{' '}
            <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
              {RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            seed:{' '}
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              size={10}
              inputMode="numeric"
            />
          </label>
        </div>
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending || !enabled || used >= cap}
          >
            {submitMutation.isPending ? 'submitting...' : 'submit'}
          </button>
        </div>
        {message ? <p>{message}</p> : null}
      </fieldset>

      <fieldset style={{ marginTop: 12, padding: 8 }}>
        <legend>jobs</legend>
        <button
          type="button"
          onClick={() =>
            void poll({ data: undefined })
              .then(() => qc.invalidateQueries({ queryKey: ['runway-status'] }))
              .catch(() => undefined)
          }
        >
          poll now
        </button>
        <table style={{ marginTop: 8, borderSpacing: 8 }}>
          <thead>
            <tr>
              <th align="left">status</th>
              <th align="left">scene</th>
              <th align="left">dur</th>
              <th align="left">est</th>
              <th align="left">created</th>
              <th align="left">result</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{j.status}</td>
                <td>{j.scene_ref ?? '-'}</td>
                <td>{j.duration}s</td>
                <td>{j.credits_estimate ?? '-'}</td>
                <td>{j.created_at ? j.created_at.replace('T', ' ').slice(0, 19) : '-'}</td>
                <td>
                  {j.status === 'failed' ? (
                    <span>{j.error ?? 'failed'}</span>
                  ) : j.stored_path ? (
                    preview[j.id] ? (
                      <video src={preview[j.id]} controls width={140} />
                    ) : (
                      <button type="button" onClick={() => void showClip(j.id, j.stored_path!)}>
                        load
                      </button>
                    )
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
    </div>
  );
}
