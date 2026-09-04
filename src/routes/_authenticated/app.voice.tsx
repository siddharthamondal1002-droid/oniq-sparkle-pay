import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mic, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";
import {
  OniqCanvas,
  OniqCard,
  OniqChip,
  OniqEmpty,
  OniqHeader,
  OniqSectionHeader,
  OniqSkeletonRows,
} from "@/components/oniq";

export const Route = createFileRoute("/_authenticated/app/voice")({
  component: VoiceScreen,
});

/**
 * CREATE — VOICE. Owner reference 2026-09-04, which drew Voice as a live card.
 *
 * The speech is generated, so this is an AI surface: it carries
 * AI_OUTPUT_LABEL and an <AiOutputReport /> and is declared in
 * src/config/playCompliance.ts before this file existed.
 *
 * ONLY SPEAK SHIPS. The card's hint reads "Speak / Clone / Translate";
 * cloning a voice from a sample is a consent and likeness question before it
 * is an engineering one, and translation belongs to the text path. The screen
 * says what it does rather than implying the other two.
 *
 * WHAT THIS SCREEN DOES NOT DO. It shows no price and names no provider —
 * both are the backend's business and neither is the user's. It also does not
 * pretend: when voice is switched off, or not open beyond admins, the server
 * says so and that sentence is what appears.
 */
const TEXT_MAX = 600;

/**
 * The voices, mirroring supabase/functions/_shared/voiceCore.ts. Names only,
 * for the reason recorded there: the descriptors a provider publishes were
 * never measured here, and a person picks a voice by hearing it — which they
 * can, because every clip plays back the moment it exists.
 */
const VOICES = ["Charon", "Kore", "Puck", "Zephyr", "Aoede", "Fenrir", "Leda", "Orus"];

const IDEAS = [
  "Good morning. Here is what today looks like.",
  "Once upon a time, on a river with no name…",
  "Your table is ready. Please come through.",
];

type Clip = {
  id: string;
  createdAt: string;
  prompt: string;
  voice: string;
  url: string | null;
};

function VoiceScreen() {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(VOICES[0]);
  const [busy, setBusy] = useState(false);
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await supabase.functions.invoke("voice-generate", {
        body: { action: "list" },
      });
      if (!alive) return;
      if (error) {
        setLoadError(true);
        setClips([]);
        return;
      }
      setClips(Array.isArray(data?.clips) ? (data.clips as Clip[]) : []);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const generate = async () => {
    const line = text.trim();
    if (!line || busy) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("voice-generate", {
      body: { text: line, voice },
    });
    setBusy(false);
    // The server's own sentence is the one worth showing — it is the only
    // thing that knows whether this was a switch, a cap or a refusal.
    const message = typeof data?.error === "string" ? data.error : null;
    if (error || message || !data?.url) {
      toast.error(message ?? "Couldn't read that one. Try different words.");
      return;
    }
    setClips((prev) => [data as Clip, ...(prev ?? [])]);
    setText("");
  };

  return (
    <OniqCanvas world="create" className="pb-28">
      <OniqHeader
        eyebrow="Create"
        title="Voice 🎙️"
        subtitle="Type a line and hear it spoken."
        back="/app"
      />

      <div className="mt-4 px-5">
        <OniqCard variant="surface" className="p-4">
          <label htmlFor="voice-text" className="sr-only">
            What should it say?
          </label>
          <textarea
            id="voice-text"
            data-testid="voice-text"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, TEXT_MAX))}
            rows={3}
            placeholder="Good morning. Here is what today looks like."
            className="w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">
              {text.length}/{TEXT_MAX}
            </span>
            <button
              type="button"
              data-testid="voice-generate"
              onClick={() => void generate()}
              disabled={!text.trim() || busy}
              className="press inline-flex items-center gap-2 rounded-full bg-world px-4 py-2 text-[13px] font-semibold text-white world-glow disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {busy ? "Reading…" : "Say it"}
            </button>
          </div>
        </OniqCard>

        <div className="mt-3">
          <p className="text-[11px] text-muted-foreground" id="voice-picker-label">
            Voice
          </p>
          <div
            role="radiogroup"
            aria-labelledby="voice-picker-label"
            className="mt-2 flex flex-wrap gap-2"
          >
            {VOICES.map((v) => (
              <OniqChip
                key={v}
                role="radio"
                active={voice === v}
                onClick={() => setVoice(v)}
                testId={`voice-pick-${v}`}
              >
                {v}
              </OniqChip>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {IDEAS.map((idea) => (
            <OniqChip key={idea} onClick={() => setText(idea)}>
              {idea}
            </OniqChip>
          ))}
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">🤖 {AI_OUTPUT_LABEL}</p>
        <AiOutputReport surface="voice_ai_output" targetId="voice-create" />
      </div>

      <div className="mt-6 px-5">
        <OniqSectionHeader eyebrow="Yours" title="Clips you made" />
        {clips === null ? (
          <OniqSkeletonRows rows={2} className="mt-3" />
        ) : clips.length === 0 ? (
          <div className="mt-3">
            <OniqEmpty
              emoji="🎙️"
              title={loadError ? "Couldn't load your clips" : "No clips yet"}
              body={
                loadError
                  ? "A connection problem, not an empty shelf."
                  : "Type a line above and it appears here."
              }
            />
          </div>
        ) : (
          <div className="mt-3 grid gap-2">
            {clips.map((c) => (
              <OniqCard key={c.id} variant="surface" className="p-3" data-testid="voice-clip">
                <div className="flex items-center gap-2">
                  <Mic className="h-4 w-4 shrink-0 text-world" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {c.prompt}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{c.voice}</span>
                </div>
                {c.url ? (
                  <audio controls preload="none" src={c.url} className="mt-2 w-full">
                    <track kind="captions" />
                  </audio>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    This one could not be loaded.
                  </p>
                )}
              </OniqCard>
            ))}
          </div>
        )}
      </div>
    </OniqCanvas>
  );
}
