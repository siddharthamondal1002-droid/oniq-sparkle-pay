import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ImageIcon, Sparkles } from "lucide-react";
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
  OniqSectionHeader,
  OniqSkeletonRows,
} from "@/components/oniq";

export const Route = createFileRoute("/_authenticated/app/image")({
  component: ImageScreen,
});

/**
 * CREATE — IMAGE. Owner reference 2026-09-04, which drew Image as a live card.
 *
 * The picture is generated, so this is an AI surface: it carries
 * AI_OUTPUT_LABEL and an <AiOutputReport /> and is declared in
 * src/config/playCompliance.ts before this file existed.
 *
 * WHAT THIS SCREEN DOES NOT DO. It shows no price and names no provider —
 * both are the backend's business and neither is the user's. It also does not
 * pretend: when images are switched off, or not open beyond admins, the server
 * says so and that sentence is what appears.
 */
const PROMPT_MAX = 500;

const IDEAS = [
  "a red bicycle against a blue wall",
  "monsoon street at night, neon reflections",
  "a paper boat on still water",
  "terracotta pots on a sunlit balcony",
];

type Picture = { id: string; createdAt: string; prompt: string; url: string | null };

function ImageScreen() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [pictures, setPictures] = useState<Picture[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await supabase.functions.invoke("image-generate", {
        body: { action: "list" },
      });
      if (!alive) return;
      if (error) {
        setLoadError(true);
        setPictures([]);
        return;
      }
      setPictures(Array.isArray(data?.images) ? (data.images as Picture[]) : []);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const generate = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("image-generate", {
      body: { prompt: text },
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
      toast.error(message || "Couldn't draw that one. Try different words.");
      return;
    }
    setPictures((prev) => [data as Picture, ...(prev ?? [])]);
    setPrompt("");
  };

  return (
    <OniqCanvas world="create" className="pb-28">
      <OniqHeader
        eyebrow="Create"
        title="Image 🖼️"
        subtitle="Describe a picture and ONIQ draws it."
        back="/app"
      />

      <div className="mt-4 px-5">
        <OniqCard variant="surface" className="p-4">
          <label htmlFor="image-prompt" className="sr-only">
            Describe the picture you want
          </label>
          <textarea
            id="image-prompt"
            data-testid="image-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
            rows={3}
            placeholder="a red bicycle against a blue wall"
            className="w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">
              {prompt.length}/{PROMPT_MAX}
            </span>
            <button
              type="button"
              data-testid="image-generate"
              onClick={() => void generate()}
              disabled={!prompt.trim() || busy}
              className="press inline-flex items-center gap-2 rounded-full bg-world px-4 py-2 text-[13px] font-semibold text-white world-glow disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {busy ? "Drawing…" : "Make a picture"}
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
        <AiOutputReport surface="image_ai_output" targetId="image-create" />
      </div>

      <div className="mt-6 px-5">
        <OniqSectionHeader eyebrow="Yours" title="Pictures you made" />
        {pictures === null ? (
          <OniqSkeletonRows rows={2} className="mt-3" />
        ) : pictures.length === 0 ? (
          <div className="mt-3">
            <OniqEmpty
              emoji="🖼️"
              title={loadError ? "Couldn't load your pictures" : "No pictures yet"}
              body={
                loadError
                  ? "A connection problem, not an empty shelf."
                  : "Describe a picture above and it appears here."
              }
            />
          </div>
        ) : (
          <div className="mt-3 grid gap-2">
            {pictures.map((p) => (
              <OniqCard key={p.id} variant="surface" className="p-3" data-testid="image-picture">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 shrink-0 text-world" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {p.prompt}
                  </span>
                </div>
                {p.url ? (
                  <img
                    src={p.url}
                    alt={p.prompt}
                    loading="lazy"
                    className="mt-2 w-full rounded-xl bg-black"
                  />
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
