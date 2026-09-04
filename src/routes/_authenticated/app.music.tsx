import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Ear, Music4, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { edgeErrorMessage } from "@/lib/edgeError";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";
import {
  OniqCanvas,
  OniqCard,
  OniqChip,
  OniqEmpty,
  OniqHeader,
  OniqMadeLink,
  OniqSectionHeader,
  OniqSkeletonRows,
} from "@/components/oniq";
import { OniqAttachAudio, type AttachedAudio } from "@/components/oniq/OniqAttachAudio";
import { OniqAttachImage, type AttachedImage } from "@/components/oniq/OniqAttachImage";
import { MUSIC_MOODS, STYLE_LABEL, type MusicMood } from "@/data/createStyles";

export const Route = createFileRoute("/_authenticated/app/music")({
  component: MusicScreen,
});

/**
 * CREATE — MUSIC. Owner directive 2026-09-04.
 *
 * The whole track is generated, so this screen is an AI surface: it carries
 * AI_OUTPUT_LABEL and an <AiOutputReport /> and is declared in
 * src/config/playCompliance.ts. That declaration went in before this file
 * existed, which is the ordering Lores got wrong.
 *
 * WHAT THIS SCREEN DOES NOT DO. It shows no price and names no provider —
 * both are the backend's business and neither is the user's. It also does not
 * pretend: when music is switched off, or not yet open beyond admins, the
 * server says so and that sentence is what appears. A disabled feature that
 * looks alive is the thing this codebase keeps deciding not to ship.
 *
 * THE TWO ATTACHMENTS BEHAVE DIFFERENTLY, AND THE SCREEN SAYS SO.
 *
 *   A PICTURE goes straight to the music model. Measured 2026-09-04: a PNG
 *   before the text returned 200 with lyrics visibly drawn from the image.
 *
 *   A TRACK DOES NOT. It is LISTENED TO by a separate model, turned into a
 *   description — genre, tempo, instruments, mood — and that description is
 *   what the music model is given. The recording never reaches it. Owner
 *   directive 2026-09-04c, and the wording below is not decoration: a person
 *   attaching a song they like has to understand they are getting something
 *   NEW in that style, not a remix of their file, and ONIQ has to be visibly
 *   not in the business of copying somebody else's melody. What was heard is
 *   shown back for exactly that reason.
 */
const PROMPT_MAX = 300;

const IDEAS = [
  "calm piano for studying",
  "upbeat tabla and bass",
  "slow lo-fi rain loop",
  "bright morning acoustic",
];

type Song = {
  id: string;
  createdAt: string;
  prompt: string;
  url: string | null;
  /** "image" | "audio" | null — what was attached, if anything. */
  reference?: string | null;
  /** The one-line description heard in a reference track. */
  brief?: string | null;
};

function MusicScreen() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [picture, setPicture] = useState<AttachedImage | null>(null);
  const [track, setTrack] = useState<AttachedAudio | null>(null);
  const [mood, setMood] = useState<MusicMood | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await supabase.functions.invoke("music-generate", {
        body: { action: "list" },
      });
      if (!alive) return;
      if (error) {
        setLoadError(true);
        setSongs([]);
        return;
      }
      setSongs(Array.isArray(data?.songs) ? (data.songs as Song[]) : []);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const generate = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("music-generate", {
      body: {
        prompt: text,
        // A SHORT TOKEN, not a sentence. The clause it stands for is built
        // server-side from a closed list, so this can never become a second
        // prompt slot the client writes.
        mood,
        // previewUrl and label are for this screen, never for the wire — one
        // is a data: URL the size of the picture and the other is a filename.
        referenceImage: picture ? { mimeType: picture.mimeType, data: picture.data } : null,
        referenceAudio: track ? { mimeType: track.mimeType, data: track.data } : null,
      },
    });
    setBusy(false);
    // The server's own sentence is the one worth showing — it is the only
    // thing that knows whether this was a switch, a cap or a refusal.
    // `functions.invoke` throws every non-2xx into `error` (a FunctionsHttpError)
    // and leaves `data` null, so the real body only reaches `edgeErrorMessage`.
    const message = error
      ? await edgeErrorMessage(error)
      : typeof data?.error === "string"
        ? data.error
        : "";
    if (error || message || !data?.url) {
      toast.error(message || "Couldn't make that one. Try different words.");
      return;
    }
    setSongs((prev) => [data as Song, ...(prev ?? [])]);
    setPrompt("");
    // The attachments clear with the prompt. Leaving a reference behind means
    // the next song silently inherits it — and, for a track, silently spends a
    // second listening call nobody asked for.
    setPicture(null);
    setTrack(null);
    setMood(null);
  };

  return (
    <OniqCanvas world="lores" className="pb-28">
      <OniqHeader
        eyebrow="Create"
        title="Music 🎵"
        subtitle="Describe a track and ONIQ writes it."
        back="/app"
      />

      <div className="mt-4 px-5">
        <OniqCard variant="surface" className="p-4">
          <label htmlFor="music-prompt" className="sr-only">
            Describe the music you want
          </label>
          <textarea
            id="music-prompt"
            data-testid="music-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
            rows={3}
            placeholder="calm piano for studying"
            className="w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {/* The two attachments, under the words they modify. */}
          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
            <OniqAttachImage
              value={picture}
              onChange={setPicture}
              disabled={busy}
              label="Add picture"
            />
            <OniqAttachAudio
              value={track}
              onChange={setTrack}
              disabled={busy}
              label="Reference track"
            />
          </div>

          {/* MOOD, as the reference draws it. Prompt text, not an API
              parameter — Lyria has no verified `mood` field, and this repo
              does not write an unverified request field into code. Tapping the
              active chip again clears it: a mood nobody can turn off is a
              setting, and this is a suggestion. */}
          <p className="mt-4 text-[11px] font-semibold text-muted-foreground">Mood</p>
          <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Mood">
            {MUSIC_MOODS.map((m) => (
              <OniqChip
                key={m}
                role="radio"
                tone="soft"
                active={mood === m}
                onClick={() => setMood((cur) => (cur === m ? null : m))}
                testId={`music-mood-${m}`}
              >
                {STYLE_LABEL[m] ?? m}
              </OniqChip>
            ))}
          </div>

          {/* Shown only when a track is attached, because that is the only
              case where what happens is not what a person would assume. */}
          {track ? (
            <p
              data-testid="music-reference-note"
              className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground"
            >
              <Ear className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                ONIQ listens to your track and describes its style — genre, tempo, instruments —
                then writes something new from that description. Your recording is not copied,
                remixed or sent to the music engine.
              </span>
            </p>
          ) : null}

          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">
              {prompt.length}/{PROMPT_MAX}
            </span>
            <button
              type="button"
              data-testid="music-generate"
              onClick={() => void generate()}
              disabled={!prompt.trim() || busy}
              className="press inline-flex items-center gap-2 rounded-full bg-world px-4 py-2 text-[13px] font-semibold text-white world-glow disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {busy ? "Writing…" : "Make music"}
            </button>
          </div>
        </OniqCard>

        <div className="mt-3 flex flex-wrap gap-2">
          {IDEAS.map((idea) => (
            <OniqChip key={idea} onClick={() => setPrompt(idea)}>
              {idea}
            </OniqChip>
          ))}
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">🤖 {AI_OUTPUT_LABEL}</p>
        <AiOutputReport surface="music_ai_output" targetId="music-create" />
      </div>

      <div className="mt-6 px-5">
        <OniqSectionHeader eyebrow="Yours" title="Songs you made" />
        {songs === null ? (
          <OniqSkeletonRows rows={2} className="mt-3" />
        ) : songs.length === 0 ? (
          <div className="mt-3">
            <OniqEmpty
              emoji="🎵"
              title={loadError ? "Couldn't load your songs" : "No songs yet"}
              body={
                loadError
                  ? "A connection problem, not an empty shelf."
                  : "Describe a track above and it appears here."
              }
            />
          </div>
        ) : (
          <div className="mt-3 grid gap-2">
            {songs.map((s) => (
              <OniqCard key={s.id} variant="surface" className="p-3" testId="music-song">
                <div className="flex items-center gap-2">
                  <Music4 className="h-4 w-4 shrink-0 text-world" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {s.prompt}
                  </span>
                </div>
                {/* Provenance stays with the song, not just with the moment it
                    was made — the brief is the evidence that a reference
                    produced a DESCRIPTION and not a copy. */}
                {s.reference === "audio" && s.brief ? (
                  <p
                    data-testid="music-song-brief"
                    className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground"
                  >
                    <Ear className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">Heard in your track: {s.brief}</span>
                  </p>
                ) : s.reference === "image" ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">From a picture you added</p>
                ) : null}
                {s.url ? (
                  <audio controls preload="none" src={s.url} className="mt-2 w-full">
                    <track kind="captions" />
                  </audio>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    This one could not be loaded.
                  </p>
                )}
                <OniqMadeLink kind="music" id={s.id} testId="music-open" />
              </OniqCard>
            ))}
          </div>
        )}
      </div>
    </OniqCanvas>
  );
}
