// ADMIN-ONLY internal tool. Deliberately unstyled — it should look like a
// tool, not a feature. Direct route only; nothing in the app links here.
//
// The screen is not the gate. Every call below is refused server-side for a
// non-admin, and video_jobs RLS is admin-only.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  runwayDeleteStill,
  runwayPollJobs,
  runwayScenes,
  runwaySignStored,
  runwayStatus,
  runwaySubmitJob,
  runwayUploadStill,
} from "@/lib/runway.functions";
import { EpisodeAssembler } from "@/components/admin/EpisodeAssembler";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";
import { MAX_STILL_BYTES, validateStillName } from "@/lib/stillValidation";
import { ORIGINALS, SEASON_DURATION, SEASON_RATIO, findScene } from "@/data/originals";

export const Route = createFileRoute("/_authenticated/app/admin/video")({
  head: () => ({
    meta: [{ title: "Internal video tool" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AdminVideoTool,
});

const RATIOS = ["720:1280", "1280:720", "960:960", "1104:832", "832:1104"];

function AdminVideoTool() {
  const qc = useQueryClient();
  const status = useServerFn(runwayStatus);
  const scenes = useServerFn(runwayScenes);
  const submit = useServerFn(runwaySubmitJob);
  const poll = useServerFn(runwayPollJobs);
  const sign = useServerFn(runwaySignStored);
  const uploadStill = useServerFn(runwayUploadStill);
  const deleteStill = useServerFn(runwayDeleteStill);

  const [scene, setScene] = useState("");
  const [shotId, setShotId] = useState("");
  const [promptText, setPromptText] = useState("");
  const [duration, setDuration] = useState(SEASON_DURATION);
  const [ratio, setRatio] = useState(SEASON_RATIO);
  const [seed, setSeed] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, string>>({});

  const [replace, setReplace] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["runway-status"],
    queryFn: () => status({ data: undefined }),
    retry: false,
  });

  const scenesQuery = useQuery({
    queryKey: ["runway-scenes"],
    queryFn: () => scenes({ data: undefined }),
    retry: false,
  });

  const jobs = statusQuery.data?.jobs ?? [];
  const anyRunning = jobs.some((j) => j.status === "running");

  // Poll only while something is running; stop entirely when nothing is.
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => {
      void poll({ data: undefined })
        .then(() => qc.invalidateQueries({ queryKey: ["runway-status"] }))
        .catch(() => undefined);
    }, 12000);
    return () => clearInterval(t);
  }, [anyRunning, poll, qc]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const chosen = (scenesQuery.data ?? []).find((s) => s.name === scene);
      if (!chosen) throw new Error("pick a scene still first");
      return submit({
        data: {
          promptImage: chosen.signedUrl,
          promptText,
          ratio,
          duration,
          seed: seed.trim() === "" ? null : Number(seed),
          sceneRef: chosen.name,
        },
      });
    },
    onSuccess: (r) => {
      setMessage(`submitted: ${r.id}`);
      void qc.invalidateQueries({ queryKey: ["runway-status"] });
    },
    onError: (e: Error) => setMessage(`error: ${e.message}`),
  });

  // The File goes into FormData untouched — no FileReader, no data URL, no
  // arrayBuffer() on the whole thing. fetch streams the body, so a 15MB phone
  // photo never exists as a JS value in the WebView.
  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const done: string[] = [];
      for (const file of files) {
        const name = file.name;
        const bad = validateStillName(name);
        if (bad) throw new Error(`${name}: ${bad}`);
        if (file.size > MAX_STILL_BYTES) throw new Error(`${name}: over 15MB`);
        const fd = new FormData();
        fd.append("file", file);
        fd.append("filename", name);
        fd.append("replace", replace ? "true" : "false");
        await uploadStill({ data: fd });
        done.push(name);
      }
      return done;
    },
    onSuccess: (names) => {
      setUploadMsg(`uploaded: ${names.join(", ")}`);
      void qc.invalidateQueries({ queryKey: ["runway-scenes"] });
    },
    onError: (e: Error) => setUploadMsg(`error: ${e.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteStill({ data: { name } }),
    onSuccess: (r) => {
      setUploadMsg(`deleted: ${r.deleted}`);
      if (scene === r.deleted) setScene("");
      void qc.invalidateQueries({ queryKey: ["runway-scenes"] });
    },
    onError: (e: Error) => setUploadMsg(`error: ${e.message}`),
  });

  async function showClip(jobId: string, path: string) {
    const url = await sign({ data: { path } });
    if (url) setPreview((p) => ({ ...p, [jobId]: url }));
  }

  function confirmDelete(name: string) {
    // Deliberate confirm step: a still is the input to every clip made from it.
    if (window.confirm(`delete still "${name}"? this cannot be undone.`)) {
      deleteMutation.mutate(name);
    }
  }

  if (statusQuery.isError) {
    return <pre style={{ padding: 16 }}>forbidden</pre>;
  }

  const used = statusQuery.data?.usedToday ?? 0;
  const cap = statusQuery.data?.cap ?? 0;
  const enabled = statusQuery.data?.enabled ?? false;

  return (
    <div style={{ padding: 16, fontFamily: "monospace", fontSize: 13 }}>
      <h1 style={{ fontSize: 15, fontWeight: 700 }}>runway video tool (internal)</h1>
      {/* Admin-only, but still a generative surface inside the shipped app —
          it is where the AI video is produced. Play's AI-Generated Content
          policy asks for the label and an in-app report path; an internal
          screen a reviewer can reach is not an exception. */}
      <p style={{ fontSize: 11, fontWeight: 600, color: "#fbbf24", marginTop: 4 }}>
        AI-generated video 🤖 — {AI_OUTPUT_LABEL}
      </p>
      <AiOutputReport surface="runway_admin_output" targetId="runway-admin" />
      <p>
        today: {used}/{cap} &nbsp;|&nbsp; kill switch: {enabled ? "ON (enabled)" : "OFF (disabled)"}
      </p>

      <fieldset style={{ marginTop: 12, padding: 8 }}>
        <legend>scene stills</legend>
        <div>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            capture={undefined}
            disabled={uploadMutation.isPending}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) uploadMutation.mutate(files);
            }}
          />
        </div>
        <div style={{ marginTop: 6 }}>
          <label>
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />{" "}
            replace if a still with the same name exists
          </label>
        </div>
        <p>png / jpeg / webp only, max 15MB each. type is checked by content, not extension.</p>
        {uploadMutation.isPending ? <p>uploading...</p> : null}
        {uploadMsg ? <p>{uploadMsg}</p> : null}
        <ul style={{ marginTop: 6, paddingLeft: 18 }}>
          {(scenesQuery.data ?? []).map((s) => (
            <li key={s.name}>
              {s.name}{" "}
              <button
                type="button"
                onClick={() => confirmDelete(s.name)}
                disabled={deleteMutation.isPending}
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset style={{ marginTop: 12, padding: 8 }}>
        <legend>submit one clip</legend>
        <div>
          <label>
            ONIQ Originals shot:{" "}
            <select
              value={shotId}
              onChange={(e) => {
                const id = e.target.value;
                setShotId(id);
                const shot = findScene(id);
                if (!shot) return;
                // Pre-fill from the shot list, then let the operator edit.
                setPromptText(shot.motionPrompt);
                setRatio(SEASON_RATIO);
                setDuration(SEASON_DURATION);
                const still = `${id}.png`;
                setScene((scenesQuery.data ?? []).some((s) => s.name === still) ? still : "");
              }}
            >
              <option value="">-- free-form (no shot) --</option>
              {ORIGINALS.map((ep) => (
                <optgroup key={ep.id} label={`Ep${ep.number} — ${ep.title}`}>
                  {ep.scenes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} · {s.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {shotId && !scene ? <p>no still named {shotId}.png yet — upload one above.</p> : null}
        </div>
        <div style={{ marginTop: 6 }}>
          <label>
            scene still:{" "}
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
            motion prompt:{" "}
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
            duration:{" "}
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              <option value={5}>5</option>
              <option value={10}>10</option>
            </select>
          </label>{" "}
          <label>
            ratio:{" "}
            <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
              {RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>{" "}
          <label>
            seed:{" "}
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
            {submitMutation.isPending ? "submitting..." : "submit"}
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
              .then(() => qc.invalidateQueries({ queryKey: ["runway-status"] }))
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
                <td>{j.scene_ref ?? "-"}</td>
                <td>{j.duration}s</td>
                <td>{j.credits_estimate ?? "-"}</td>
                <td>{j.created_at ? j.created_at.replace("T", " ").slice(0, 19) : "-"}</td>
                <td>
                  {j.status === "failed" ? (
                    <span>{j.error ?? "failed"}</span>
                  ) : j.stored_path ? (
                    preview[j.id] ? (
                      <video src={preview[j.id]} controls width={140} />
                    ) : (
                      <button type="button" onClick={() => void showClip(j.id, j.stored_path!)}>
                        load
                      </button>
                    )
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>

      <EpisodeAssembler />
    </div>
  );
}
