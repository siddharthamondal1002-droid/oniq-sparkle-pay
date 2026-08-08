// Episode assembler — admin-only, lives on the internal video screen.
//
// The screen is not the gate: every call below is refused server-side for a
// non-admin (episode.server -> requireAdmin), and episode_jobs is admin-read /
// service-role-write only. Nothing here touches the Runway path.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { episodeList, episodeSign, episodeSubmit } from '@/lib/episode.functions';
import {
  DEFAULT_TRANSITION_SECONDS,
  MOTIONS,
  planTimeline,
  type Motion,
  type SceneInput,
} from '@/lib/episodeTimeline';

type Row = SceneInput & { transitionSeconds: number };

const blank = (): Row => ({
  stillPath: '',
  durationSeconds: 10,
  motion: 'zoomIn',
  audioPath: null,
  transitionSeconds: DEFAULT_TRANSITION_SECONDS,
});

export function EpisodeAssembler() {
  const qc = useQueryClient();
  const list = useServerFn(episodeList);
  const submit = useServerFn(episodeSubmit);
  const sign = useServerFn(episodeSign);

  const [title, setTitle] = useState('');
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, string>>({});

  const statusQuery = useQuery({
    queryKey: ['episode-status'],
    queryFn: () => list({ data: undefined }),
    retry: false,
    // Idempotent read; polling never mutates a job.
    refetchInterval: (q) =>
      (q.state.data?.jobs ?? []).some((j) => j.status === 'queued' || j.status === 'running')
        ? 10000
        : false,
  });

  const submitMutation = useMutation({
    mutationFn: () => submit({ data: { title: title || null, scenes: rows } }),
    onSuccess: (r) => {
      setMsg(
        `queued: ${r.id} — ${r.totalSeconds}s` +
          (r.adjustments.length ? ` | ${r.adjustments.join(' | ')}` : ''),
      );
      void qc.invalidateQueries({ queryKey: ['episode-status'] });
    },
    onError: (e: Error) => setMsg(`error: ${e.message}`),
  });

  if (statusQuery.isError) return null;

  const stills = statusQuery.data?.stills ?? [];
  const audio = statusQuery.data?.audio ?? [];
  const jobs = statusQuery.data?.jobs ?? [];
  const busy = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  const used = statusQuery.data?.usedToday ?? 0;
  const cap = statusQuery.data?.cap ?? 0;
  const enabled = statusQuery.data?.enabled ?? false;

  const local = planTimeline(rows);
  const localError = typeof local === 'string' ? local : null;

  function patch(i: number, next: Partial<Row>) {
    setRows((r) => r.map((row, k) => (k === i ? { ...row, ...next } : row)));
  }

  async function show(jobId: string, path: string) {
    const url = await sign({ data: { path } });
    if (url) setPreview((p) => ({ ...p, [jobId]: url }));
  }

  return (
    <fieldset style={{ marginTop: 12, padding: 8 }}>
      <legend>episode assembler (stills + narration &rarr; mp4)</legend>
      <p>
        today: {used}/{cap} &nbsp;|&nbsp; kill switch:{' '}
        {enabled ? 'ON (enabled)' : 'OFF (disabled)'} &nbsp;|&nbsp; 1080x1920, 30fps, 20 min cap
      </p>
      <p>
        rendering happens off-app: run{' '}
        <code>node scripts/render-episode.mjs --once</code> to pick up the queue.
      </p>

      <div>
        <label>
          title:{' '}
          <input value={title} onChange={(e) => setTitle(e.target.value)} size={30} />
        </label>
      </div>

      <table style={{ marginTop: 8, borderSpacing: 6 }}>
        <thead>
          <tr>
            <th align="left">#</th>
            <th align="left">still</th>
            <th align="left">dur (s)</th>
            <th align="left">motion</th>
            <th align="left">narration</th>
            <th align="left">dissolve (s)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            // eslint-disable-next-line react/no-array-index-key -- rows are positional
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <select
                  value={r.stillPath}
                  onChange={(e) => patch(i, { stillPath: e.target.value })}
                >
                  <option value="">-- pick --</option>
                  {stills.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  value={r.durationSeconds}
                  onChange={(e) => patch(i, { durationSeconds: Number(e.target.value) })}
                  size={4}
                  inputMode="numeric"
                />
              </td>
              <td>
                <select
                  value={r.motion}
                  onChange={(e) => patch(i, { motion: e.target.value as Motion })}
                >
                  {MOTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  value={r.audioPath ?? ''}
                  onChange={(e) => patch(i, { audioPath: e.target.value || null })}
                >
                  <option value="">-- none --</option>
                  {audio.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  value={r.transitionSeconds}
                  onChange={(e) => patch(i, { transitionSeconds: Number(e.target.value) })}
                  size={4}
                  inputMode="decimal"
                  disabled={i === 0}
                />
              </td>
              <td>
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}
                  disabled={rows.length === 1}
                >
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 6 }}>
        <button type="button" onClick={() => setRows((r) => [...r, blank()])}>
          add scene
        </button>{' '}
        <button
          type="button"
          onClick={() => submitMutation.mutate()}
          disabled={submitMutation.isPending || !enabled || busy || used >= cap || !!localError}
        >
          {submitMutation.isPending ? 'queueing...' : 'assemble'}
        </button>{' '}
        {typeof local !== 'string' ? (
          <span>
            {local.totalSeconds}s planned
            {local.adjustments.length ? ` · ${local.adjustments.join(' · ')}` : ''}
          </span>
        ) : (
          <span>{local}</span>
        )}
      </div>
      {busy ? <p>a render is in progress — a second submit is refused, not queued.</p> : null}
      {msg ? <p>{msg}</p> : null}

      <table style={{ marginTop: 10, borderSpacing: 8 }}>
        <thead>
          <tr>
            <th align="left">status</th>
            <th align="left">title</th>
            <th align="left">len</th>
            <th align="left">created</th>
            <th align="left">result</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>{j.status}</td>
              <td>{j.title ?? '-'}</td>
              <td>{j.total_seconds}s</td>
              <td>{j.created_at ? j.created_at.replace('T', ' ').slice(0, 19) : '-'}</td>
              <td>
                {j.status === 'failed' ? (
                  <span>{j.error ?? 'failed'}</span>
                ) : j.stored_path ? (
                  preview[j.id] ? (
                    <video src={preview[j.id]} controls width={140} />
                  ) : (
                    <button type="button" onClick={() => void show(j.id, j.stored_path!)}>
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
  );
}
