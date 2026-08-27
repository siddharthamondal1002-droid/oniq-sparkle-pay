/**
 * StoryWriter — "write the story first", and STOP there.
 *
 * Mega loop, 2026-08-27: story generation and film rendering are separate
 * products with separate gates. This panel calls `story-plot` (the existing
 * planner, user-authed, rate-limited server-side) and keeps the structured
 * story as a local draft. It deliberately CANNOT render: there is no
 * claim_story_seconds call, no story_jobs write, no still/voice/clip call
 * anywhere in this file — the "make this film" affordance only prefills the
 * studio's prompt, and the film still goes through the studio's own explicit,
 * paid Generate tap. A source-pinning test holds this file to that.
 *
 * Costs: one plot call per tap (the same call every film already makes,
 * behind the same server rate limit). No story seconds are consumed.
 */
import { useCallback, useState } from "react";
import { BookOpenText, ChevronDown, ChevronUp, Trash2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { saveCastMember } from "@/lib/castLibrary";
import {
  deleteDraft,
  listDrafts,
  parseStoryPlan,
  saveDraft,
  shotsFeaturing,
  type StoryDraft,
  type StoryDraftPlan,
} from "@/lib/storyDrafts";

type StoryWriterProps = {
  /** The studio's current prompt — the story to write. */
  prompt: string;
  /** The studio's chosen duration; decides the shot count via the studio. */
  seconds: number;
  /** Planned shot count for that duration (the studio's own planner value). */
  shots: number;
  /** The user's picked cast, riding along exactly as it does into a film. */
  reuse: { name: string; lock: string }[];
  /** Prefill the studio with a draft — the film still needs its own tap. */
  onUseDraft: (prompt: string, seconds: number) => void;
  /** A character from a story was saved into the library. */
  onCastSaved?: () => void;
};

export function StoryWriter({
  prompt,
  seconds,
  shots,
  reuse,
  onUseDraft,
  onCastSaved,
}: StoryWriterProps) {
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<StoryDraftPlan | null>(null);
  const [servedBy, setServedBy] = useState<string | undefined>(undefined);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<StoryDraft[]>(() => listDrafts());
  const [openDraft, setOpenDraft] = useState<string | null>(null);
  const [savedCastNames, setSavedCastNames] = useState<Set<string>>(new Set());

  const write = useCallback(async () => {
    setWriting(true);
    setError(null);
    setPlan(null);
    setSavedId(null);
    setSavedCastNames(new Set());
    try {
      const { data, error: fnError } = await supabase.functions.invoke("story-plot", {
        body: {
          prompt: prompt.trim(),
          shots,
          ...(reuse.length > 0 ? { reuse } : {}),
        },
      });
      const payload = (data ?? {}) as {
        configured?: boolean;
        plan?: unknown;
        servedBy?: string;
        error?: string;
      };
      if (fnError || payload.error) {
        setError(payload.error ?? fnError?.message ?? "Ting could not write that one.");
        return;
      }
      if (payload.configured === false) {
        setError("Story writing is not available right now.");
        return;
      }
      const parsed = parseStoryPlan(payload.plan);
      if (!parsed) {
        // A malformed story is rejected, never stored half-broken.
        setError("Ting's reply did not come back as a story — try again.");
        return;
      }
      setPlan(parsed);
      setServedBy(payload.servedBy);
    } catch {
      setError("Something went sideways — try again.");
    } finally {
      setWriting(false);
    }
  }, [prompt, shots, reuse]);

  const keep = useCallback(() => {
    if (!plan) return;
    const draft = saveDraft(prompt, seconds, plan, servedBy);
    if (draft) {
      setSavedId(draft.id);
      setDrafts(listDrafts());
    }
  }, [plan, prompt, seconds, servedBy]);

  const canWrite = !writing && prompt.trim().length >= 8;

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <BookOpenText className="h-3.5 w-3.5" /> story first
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Ting writes the story — title, characters, every shot — and stops. No film is made and no
        story seconds are used until you generate one yourself.
      </p>
      <button
        type="button"
        disabled={!canWrite}
        onClick={() => void write()}
        className="mt-2 rounded-xl border border-primary/50 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary disabled:opacity-40"
      >
        {writing ? "Writing…" : "Write the story"}
      </button>
      {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}

      {plan && (
        <div className="mt-3 rounded-xl border border-border bg-card/70 p-2.5">
          <div className="text-sm font-semibold text-foreground">{plan.title}</div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{plan.logline}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            <span className="font-semibold">Setting:</span> {plan.setting}
          </p>
          {plan.cast.length > 0 && (
            <div className="mt-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                characters
              </div>
              <ul className="mt-1 grid grid-cols-1 gap-1">
                {plan.cast.map((m) => {
                  const inShots = shotsFeaturing(plan, m);
                  const kept = savedCastNames.has(m.name);
                  return (
                    <li key={m.name} className="rounded-lg border border-border p-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-foreground">{m.name}</span>
                        <button
                          type="button"
                          disabled={kept}
                          onClick={() => {
                            if (saveCastMember(m.name, m.lock)) {
                              setSavedCastNames((cur) => new Set(cur).add(m.name));
                              onCastSaved?.();
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-primary/50 px-2 py-0.5 text-[11px] font-semibold text-primary disabled:opacity-40"
                        >
                          <UserPlus className="h-3 w-3" />
                          {kept ? "In your characters" : "Keep this character"}
                        </button>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{m.lock}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                        {inShots.length > 0
                          ? `Appears in shot${inShots.length === 1 ? "" : "s"} ${inShots.map((i) => i + 1).join(", ")}`
                          : "Present through the story's coverage rather than on camera"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="mt-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              shots
            </div>
            <ol className="mt-1 grid max-h-48 gap-1 overflow-y-auto pe-1">
              {plan.shots.map((sh, i) => (
                <li key={i} className="rounded-lg border border-border p-1.5">
                  <p className="text-[11px] text-foreground">
                    <span className="font-semibold">{i + 1}.</span> {sh.still}
                  </p>
                  <p className="mt-0.5 text-[11px] italic text-muted-foreground">
                    “{sh.narration}”
                  </p>
                  {sh.dialogue && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {sh.dialogue.speaker}: “{sh.dialogue.line}”
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>
          <button
            type="button"
            disabled={savedId !== null}
            onClick={keep}
            className="mt-2 rounded-xl border border-primary/50 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary disabled:opacity-40"
          >
            {savedId ? "Saved to your stories" : "Save this story"}
          </button>
        </div>
      )}

      {drafts.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            your stories
          </div>
          <ul className="mt-1 grid grid-cols-1 gap-1">
            {drafts.map((d) => {
              const open = openDraft === d.id;
              return (
                <li key={d.id} className="rounded-lg border border-border p-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setOpenDraft(open ? null : d.id)}
                      className="inline-flex min-w-0 items-center gap-1 text-start text-[11px] font-semibold text-foreground"
                    >
                      {open ? (
                        <ChevronUp className="h-3 w-3 shrink-0" />
                      ) : (
                        <ChevronDown className="h-3 w-3 shrink-0" />
                      )}
                      <span className="truncate">{d.plan.title}</span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onUseDraft(d.prompt, d.seconds)}
                        className="rounded-lg border border-primary/50 px-2 py-0.5 text-[11px] font-semibold text-primary"
                      >
                        Make this film
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${d.plan.title}`}
                        onClick={() => {
                          deleteDraft(d.id);
                          setDrafts(listDrafts());
                          if (openDraft === d.id) setOpenDraft(null);
                        }}
                        className="text-muted-foreground"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {open && (
                    <div className="mt-1">
                      <p className="text-[11px] text-muted-foreground">{d.plan.logline}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                        {d.plan.shots.length} shots · {d.plan.cast.length} character
                        {d.plan.cast.length === 1 ? "" : "s"} ·{" "}
                        {new Date(d.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
