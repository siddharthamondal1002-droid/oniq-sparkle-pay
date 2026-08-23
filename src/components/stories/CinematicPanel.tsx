/**
 * CINEMATIC CONTROLS — the Video Generator's engineering mode surface
 * (owner loop, 2026-08-23). Progressive disclosure in three tiers:
 *
 *   BASIC       = the studio exactly as it was: this panel collapsed, empty
 *                 intent, byte-for-byte the previous request. Nothing here
 *                 is required.
 *   ADVANCED    = the high-value cinematic picks (time, weather, season,
 *                 lighting, composition, mood).
 *   ENGINEERING = the full structured taxonomy from the frozen scene
 *                 reference library (environment, scale, depth, camera
 *                 angle, materials, story beat, reference provenance).
 *
 * Every control is a vocabulary pick from videoEngineering.ts — free text
 * never enters through this panel, so the fail-closed validator can hold.
 * Each tier shows its honest support level (loop §6): "enforced" only where
 * existing pipeline code deterministically honors the choice, "guides the
 * plan" / "advisory" everywhere else. Camera MOTION is deliberately absent:
 * the drawn still cannot move a camera, and pretending otherwise is exactly
 * what the loop forbids.
 *
 * VERBATIM MODE DISABLES THE PANEL: in verbatim the prompt IS the narration,
 * read word for word — appending intent prose would be spoken aloud.
 */
import { useMemo } from "react";
import {
  attachIntentToPrompt,
  CAMERA_ANGLES,
  COMPOSITIONS,
  DEPTH_EMPHASES,
  describeShotIntent,
  ENVIRONMENT_TYPES,
  LIGHTING_STYLES,
  MATERIALS,
  MOODS,
  SCENE_REFERENCE_REGISTRY,
  SCENE_SCALES,
  SEASONS,
  type ShotIntent,
  STORY_BEATS,
  TIMES_OF_DAY,
  validateShotIntent,
  WEATHERS,
} from "@/lib/videoEngineering";

type PickProps = {
  label: string;
  value: string | undefined;
  options: readonly string[];
  onPick: (v: string | undefined) => void;
  disabled: boolean;
};

function Pick({ label, value, options, onPick, disabled }: PickProps) {
  return (
    <label className="block text-[11px] text-muted-foreground">
      {label}
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onPick(e.target.value === "" ? undefined : e.target.value)}
        className="mt-0.5 block w-full rounded-xl border border-border bg-card/70 px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export type CinematicPanelProps = {
  intent: ShotIntent;
  onChange: (next: ShotIntent) => void;
  /** True in verbatim mode — the whole panel is off, with the reason shown. */
  disabled: boolean;
  /** The user's current story text, so the budget warning is live. */
  promptText: string;
};

export function CinematicPanel({ intent, onChange, disabled, promptText }: CinematicPanelProps) {
  const set = (patch: Partial<ShotIntent>) => onChange({ ...intent, ...patch });
  const validation = useMemo(() => validateShotIntent(intent), [intent]);
  const preview = useMemo(() => describeShotIntent(intent), [intent]);
  const attach = useMemo(
    () => attachIntentToPrompt(promptText.trim(), intent),
    [promptText, intent],
  );
  const picked = preview !== "";

  return (
    <details className="mt-3 rounded-2xl border border-border bg-card/50 px-3 py-2">
      <summary className="cursor-pointer select-none text-xs font-semibold text-foreground">
        Cinematic controls{picked ? " • on" : ""}
        <span className="ms-1 font-normal text-muted-foreground">(optional)</span>
      </summary>

      {disabled ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Verbatim narrates your text exactly as written, so cinematic intent is off for this film.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Picks are added to your story as a written intent line. Weather and lighting are honored
            by the film engine itself; the rest guides the planner and the image model.
          </p>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <Pick label="Time of day" value={intent.timeOfDay} options={TIMES_OF_DAY} onPick={(v) => set({ timeOfDay: v })} disabled={disabled} />
            <Pick label="Weather (enforced)" value={intent.weather} options={WEATHERS} onPick={(v) => set({ weather: v })} disabled={disabled} />
            <Pick label="Season" value={intent.season} options={SEASONS} onPick={(v) => set({ season: v })} disabled={disabled} />
            <Pick label="Lighting (enforced register)" value={intent.lighting} options={LIGHTING_STYLES} onPick={(v) => set({ lighting: v })} disabled={disabled} />
            <Pick label="Composition" value={intent.composition} options={COMPOSITIONS} onPick={(v) => set({ composition: v })} disabled={disabled} />
            <Pick label="Mood" value={intent.mood} options={MOODS} onPick={(v) => set({ mood: v })} disabled={disabled} />
          </div>

          <details className="mt-2">
            <summary className="cursor-pointer select-none text-[11px] font-semibold text-muted-foreground">
              Engineering mode — full scene taxonomy
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Pick label="Environment" value={intent.environmentType} options={ENVIRONMENT_TYPES} onPick={(v) => set({ environmentType: v })} disabled={disabled} />
              <Pick label="Scene scale" value={intent.sceneScale} options={SCENE_SCALES} onPick={(v) => set({ sceneScale: v })} disabled={disabled} />
              <Pick label="Depth" value={intent.depth} options={DEPTH_EMPHASES} onPick={(v) => set({ depth: v })} disabled={disabled} />
              <Pick label="Camera angle (advisory)" value={intent.cameraAngle} options={CAMERA_ANGLES} onPick={(v) => set({ cameraAngle: v })} disabled={disabled} />
              <Pick
                label="Key material"
                value={intent.materials?.[0]}
                options={MATERIALS}
                onPick={(v) => set({ materials: v ? [v] : undefined })}
                disabled={disabled}
              />
              <Pick label="Story beat" value={intent.storyBeat} options={STORY_BEATS} onPick={(v) => set({ storyBeat: v })} disabled={disabled} />
              <Pick
                label="Scene reference (provenance)"
                value={intent.referenceIds?.[0]}
                options={SCENE_REFERENCE_REGISTRY.map((r) => r.id)}
                onPick={(v) => set({ referenceIds: v ? [v] : undefined })}
                disabled={disabled}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Camera movement is not offered here: stills cannot move a camera, and only the
              movie-grade clip stage can — it stays provider-decided rather than falsely promised.
            </p>
          </details>

          {validation.warnings.map((w) => (
            <p key={w} className="mt-1 text-[11px] text-amber-300">
              {w}
            </p>
          ))}
          {picked && attach.reason === "prompt-budget" ? (
            <p className="mt-1 text-[11px] text-amber-300">
              Your story text is near the {"5000"}-character limit — these picks will be dropped
              rather than cutting your words.
            </p>
          ) : null}
          {picked && attach.applied ? (
            <p className="mt-1 text-[11px] text-muted-foreground">Will add: “{preview}”</p>
          ) : null}
        </>
      )}
    </details>
  );
}
