import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, Mic, Sparkles } from "lucide-react";
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
  OniqDeleteCreation,
  OniqMadeLink,
  OniqSectionHeader,
  OniqSkeletonRows,
} from "@/components/oniq";
import { OniqAttachAudio, type AttachedAudio } from "@/components/oniq/OniqAttachAudio";
import { unavailableMessage } from "@/data/capabilities";

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
 * THREE TABS, as the reference draws them, and each one is real.
 *
 * Speak types a line and hears it. VOICE INPUT and TRANSLATE attach a
 * recording and turn it into text — which very nearly did not get built: a
 * first probe attached audio to the TTS model, got 400 "Audio input modality
 * is not enabled", and concluded ONIQ could not do this. Wrong. The TTS model
 * speaks and does not listen; an ordinary Gemini text model transcribes fine,
 * measured on three models. The server routes the recording accordingly.
 *
 * CLONING STILL DOES NOT SHIP, and now for a measured reason rather than an
 * assumed one: `customVoiceConfig` is a real field this key is refused on
 * (see voiceCore.ts). It is also a consent and likeness question before it is
 * an engineering one, so both gates would have to open.
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

/** The reference's three tabs. `speak` is the default and the old behaviour. */
type Mode = "speak" | "listen" | "translate";

/**
 * Languages offered for Translate.
 *
 * A SHORT LIST ON PURPOSE. The instruction sent to the model is built
 * server-side from this name, so an open text box here would be an open
 * prompt surface on a paid model. These are ONIQ's own supported languages,
 * which is the set the rest of the app already speaks.
 */
const TRANSLATE_TO = [
  "English",
  "Hindi",
  "Bengali",
  "Tamil",
  "Telugu",
  "Marathi",
  "Spanish",
  "French",
];

function VoiceScreen() {
  const [mode, setMode] = useState<Mode>("speak");
  const [audio, setAudio] = useState<AttachedAudio | null>(null);
  const [target, setTarget] = useState(TRANSLATE_TO[0]);
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

  /**
   * Turn the attached recording into text, and put it in the box.
   *
   * The transcript lands in the SAME textarea the Speak tab uses, so the
   * obvious next step — hear it back, in a chosen voice — is one tap away
   * rather than a copy and paste. That is the whole reason the tabs share one
   * text field instead of each having their own.
   */
  const transcribe = async () => {
    if (!audio || busy) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("voice-generate", {
      body: {
        action: "transcribe",
        audio: { mimeType: audio.mimeType, data: audio.data },
        ...(mode === "translate" ? { translateTo: target } : {}),
      },
    });
    setBusy(false);
    const message = error
      ? await edgeErrorMessage(error)
      : typeof data?.error === "string"
        ? data.error
        : "";
    if (error || message || typeof data?.text !== "string" || !data.text) {
      toast.error(message || "Couldn't read that recording. Try another one.");
      return;
    }
    setText(String(data.text).slice(0, TEXT_MAX));
    setAudio(null);
    setMode("speak");
    toast.success(mode === "translate" ? "Translated" : "Transcribed");
  };

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
    // `functions.invoke` throws every non-2xx into `error` (a FunctionsHttpError)
    // and leaves `data` null, so the real body only reaches `edgeErrorMessage`.
    const message = error
      ? await edgeErrorMessage(error)
      : typeof data?.error === "string"
        ? data.error
        : "";
    if (error || message || !data?.url) {
      toast.error(message || "Couldn't read that one. Try different words.");
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

      {/* THE THREE TABS the reference draws. Each is real — see the header. */}
      <div className="mt-4 px-5">
        <div className="flex gap-1.5" role="tablist" aria-label="What to do with voice">
          {(
            [
              ["speak", "Text to Voice"],
              ["listen", "Voice Input"],
              ["translate", "Translate"],
            ] as [Mode, string][]
          ).map(([id, label]) => (
            <OniqChip
              key={id}
              role="tab"
              // `soft`, matching Create — Image and the owner's reference,
              // which draws the active tab as a pale wash with the world's own
              // ink rather than white on the gradient. It is also the legible
              // one: white on the `create` gradient measured 1.7:1 at the cyan
              // end in a browser, 2026-09-04.
              tone="soft"
              active={mode === id}
              onClick={() => setMode(id)}
              testId={`voice-tab-${id}`}
            >
              {label}
            </OniqChip>
          ))}
        </div>
      </div>

      <div className="mt-3 px-5">
        <OniqCard variant="surface" className="p-4">
          {mode !== "speak" ? (
            <div className="mb-3">
              <p className="text-[12px] text-muted-foreground">
                {mode === "translate"
                  ? "Attach or record something, and hear it back in another language."
                  : "Attach or record something, and ONIQ writes down what was said."}
              </p>
              <OniqAttachAudio value={audio} onChange={setAudio} disabled={busy} className="mt-2" />
              {mode === "translate" ? (
                <div className="mt-3">
                  <label htmlFor="voice-translate-to" className="text-[11px] text-muted-foreground">
                    Into
                  </label>
                  <select
                    id="voice-translate-to"
                    data-testid="voice-translate-to"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-border-strong bg-transparent px-3 py-2 text-sm text-foreground"
                  >
                    {TRANSLATE_TO.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <button
                type="button"
                data-testid="voice-transcribe"
                onClick={() => void transcribe()}
                disabled={!audio || busy}
                className="press mt-3 inline-flex items-center gap-2 rounded-full bg-world px-4 py-2 text-[13px] font-semibold text-on-world world-glow disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {busy ? "Listening…" : mode === "translate" ? "Translate" : "Write it down"}
              </button>
              <hr className="mt-4 border-border" />
            </div>
          ) : null}
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
              className="press inline-flex items-center gap-2 rounded-full bg-world px-4 py-2 text-[13px] font-semibold text-on-world world-glow disabled:opacity-50"
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

        {/* THE DOOR THAT IS SHUT, NAMED. Owner directive 2026-09-04c: voice
            replication is something GOOGLE HAS and this account is not admitted
            to — an allow-listed preview behind a form. Saying "unavailable"
            would be false and would make a person stop asking; the registry
            carries the exact sentence and the measured evidence behind it. It
            is a note, not a button: a control that cannot work is worse than
            no control. And it must not imply the form was filled: the owner
            confirmed 2026-09-07 that it NEVER was, after this copy had read
            "a preview ONIQ has asked to join" for three days. */}
        <div
          data-testid="voice-clone-gate"
          className="mt-3 flex items-start gap-2 rounded-2xl bg-tint-soft p-3"
          data-tint="amber"
        >
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-tint" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-tint">
              {unavailableMessage("voice.clone")}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              Speaking in your own voice is a Google preview that needs access ONIQ does not have
              yet. Until it is granted, every voice here is one of the built-in ones.
            </p>
          </div>
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
              <OniqCard key={c.id} variant="surface" className="p-3" testId="voice-clip">
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
                <div className="mt-2 flex items-center gap-2">
                  <OniqMadeLink kind="voice" id={c.id} testId="voice-open" className="mt-0" />
                  <OniqDeleteCreation
                    kind="clip"
                    id={c.id}
                    testId="voice-clip-delete"
                    onDeleted={() => setClips((prev) => (prev ?? []).filter((x) => x.id !== c.id))}
                  />
                </div>
              </OniqCard>
            ))}
          </div>
        )}
      </div>
    </OniqCanvas>
  );
}
