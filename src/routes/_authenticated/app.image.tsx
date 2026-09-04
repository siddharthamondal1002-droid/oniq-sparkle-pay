import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  OniqMadeLink,
  OniqSectionHeader,
  OniqSkeletonRows,
} from "@/components/oniq";
import { OniqAttachImage, type AttachedImage } from "@/components/oniq/OniqAttachImage";
import {
  ASPECT_RATIOS,
  IMAGE_STYLES,
  STYLE_LABEL,
  type AspectRatio,
  type ImageStyle,
} from "@/data/createStyles";

type ImageMode = "edit" | "transform";
type ImageSearch = { mode?: ImageMode };

export const Route = createFileRoute("/_authenticated/app/image")({
  // ?mode=edit from Create's "Transform" chip (owner directive 2026-09-04g),
  // and ?mode=transform from this screen's own third tab. Anything else is
  // dropped, never thrown on — the same shape app.lores uses. Absent is the
  // Generate tab, so a bare /app/image is unchanged.
  validateSearch: (s: Record<string, unknown>): ImageSearch => ({
    mode: s.mode === "edit" || s.mode === "transform" ? s.mode : undefined,
  }),
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

/**
 * Starters, one set per tab, because the three tabs take three different
 * kinds of sentence: Generate takes a DESCRIPTION of a picture that does not
 * exist, Edit takes an INSTRUCTION about one that does, and Transform takes a
 * note about what to KEEP while the style chip changes everything else.
 * Offering "a red bicycle against a blue wall" beside somebody's attached
 * photograph would be suggesting they throw their own picture away.
 */
const IDEAS = {
  generate: [
    "a red bicycle against a blue wall",
    "monsoon street at night, neon reflections",
    "a paper boat on still water",
    "terracotta pots on a sunlit balcony",
  ],
  edit: [
    "make the wall green",
    "turn the sky to sunset",
    "remove the background",
    "add a warm evening light",
  ],
  transform: [
    "keep the scene and composition",
    "keep the faces as they are",
    "keep the colours, change the finish",
  ],
};

/**
 * What the Transform tab sends when the person has not written anything of
 * their own. IT IS PUT INTO THE BOX, not sent from behind it — the prompt
 * that reaches the model is always the text on the screen, editable and
 * clearable, because a hidden client-authored sentence on a paid model is a
 * second prompt slot nobody can see.
 */
const TRANSFORM_OPENER = "Keep the scene and composition.";

/**
 * THE THREE TABS THE REFERENCE DRAWS, and what makes each of them real.
 *
 * The owner's reference draws Generate / Edit / Transform on Create — Image,
 * and the Create screen's Image card names the same three. A picture cannot
 * say what they DO, so each is given the one job that no other tab has; three
 * tabs that post the same request under three names would be the fault that
 * kept "Save" off the result screen when it was the identical call to
 * Download.
 *
 *   GENERATE   a sentence, and nothing else. No attachment: a picture here
 *              would silently make it an edit, and Edit is the next tab.
 *   EDIT       your picture + what to change about it. The measured route —
 *              one inlineData part before the text, 200 with an edited
 *              picture back, 2026-09-04.
 *   TRANSFORM  your picture + a STYLE, applied to the whole of it. It is the
 *              only tab where a style is required, which is what separates it
 *              from Edit: Edit changes a THING in the picture, Transform
 *              changes how the picture is DRAWN.
 *
 * All three post to the same endpoint, because they are the same call with
 * different parts filled in. What differs is what the screen insists on
 * having before it will let the button fire.
 */
const TABS = [
  { id: "generate" as const, label: "Generate" },
  { id: "edit" as const, label: "Edit" },
  { id: "transform" as const, label: "Transform" },
];
type Tab = (typeof TABS)[number]["id"];

/** The row shape image-generate answers with, on both actions. */
type Picture = { id: string; createdAt: string; prompt: string; url: string | null };

function ImageScreen() {
  // THE URL IS THE STATE. `?mode=edit` already existed as the hero chip's
  // target (owner directive 2026-09-04g mapped "transform=Image edit"), so the
  // tab reads from it and writes back to it rather than holding a second copy
  // in useState. A reload, a back gesture and a shared link all land on the
  // tab the person was on, and there is no second truth to drift.
  const { mode } = Route.useSearch();
  const navigate = useNavigate({ from: "/app/image" });
  const tab: Tab = mode ?? "generate";
  const needsPicture = tab !== "generate";
  const transforming = tab === "transform";
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<ImageStyle>("auto");
  const [ratio, setRatio] = useState<AspectRatio | null>(null);
  const [reference, setReference] = useState<AttachedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [pictures, setPictures] = useState<Picture[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  // AN ATTACHMENT ON THE GENERATE TAB WOULD SILENTLY MAKE IT AN EDIT. The
  // server decides by whether an inlineData part is present, so a picture left
  // behind by a tab switch would quietly change what the button does while the
  // screen still said "Make a picture". Landing on Generate drops it.
  useEffect(() => {
    if (!needsPicture) setReference(null);
  }, [needsPicture]);

  // Transform's instruction is about what to KEEP, and an empty box on a tab
  // whose real control is the style chip is a needless obstacle. This puts a
  // starting sentence IN THE BOX — visible, editable, clearable — rather than
  // sending one from behind it. Only ever into an empty box, so it cannot
  // overwrite what somebody wrote.
  useEffect(() => {
    if (transforming) setPrompt((cur) => (cur.trim() ? cur : TRANSFORM_OPENER));
  }, [transforming]);

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

  // What the tab still needs before the button is allowed to spend anything.
  // Each is a real requirement, not a style rule: without the picture, Edit
  // and Transform would quietly become a fresh Generate from the instruction
  // alone; without a style, Transform would post the same request as Edit and
  // return the picture more or less unchanged.
  const missing = !prompt.trim()
    ? "prompt"
    : needsPicture && !reference
      ? "picture"
      : transforming && style === "auto"
        ? "style"
        : null;

  const generate = async () => {
    const text = prompt.trim();
    if (missing || busy) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("image-generate", {
      body: {
        prompt: text,
        // A SHORT TOKEN, not a sentence. The clause it stands for is built
        // server-side from a closed list, so this can never become a second
        // prompt slot the client writes.
        style,
        // The ratio, unlike the style, IS a request field — it reaches Google
        // verbatim, and the server checks it against the same allowlist.
        //
        // ONLY ON GENERATE, and the control is not shown on the other two
        // tabs either. What was measured on 2026-09-04 was aspectRatio on a
        // TEXT-ONLY call: control 1408x768, 1:1 -> 1024x1024, 9:16 ->
        // 768x1376. Whether it is honoured when an inlineData part goes first
        // is NOT measured, and an accepted-and-ignored parameter looks
        // identical to a working one from the status code alone. To settle it,
        // POST an edit twice with the same picture and prompt, aspectRatio 1:1
        // then 9:16, and compare the returned pixel dimensions — that spends
        // the metered Google key twice, so it is the owner's call to make.
        aspectRatio: needsPicture ? null : ratio,
        // The preview URL stays on this side — it is a data: URL for an <img>
        // and the server has no use for it. Only the bytes and the mime go.
        ...(reference
          ? { referenceImage: { mimeType: reference.mimeType, data: reference.data } }
          : {}),
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
      toast.error(message || "Couldn't draw that one. Try different words.");
      return;
    }
    setPictures((prev) => [data as Picture, ...(prev ?? [])]);
    // Transform's box refills itself from the effect above, which is right:
    // the tab's instruction is boilerplate about what to keep, and clearing it
    // would leave the tab in a state it can never be entered in.
    setPrompt("");
    // The attachment clears with the prompt. Keeping it would silently apply
    // the same reference to the NEXT picture too, which is not what "make a
    // picture" reads as after a result has already come back.
    setReference(null);
  };

  return (
    <OniqCanvas world="create" className="pb-28">
      <OniqHeader
        eyebrow="Create"
        title="Image 🖼️"
        subtitle={
          tab === "edit"
            ? "Add a picture and say what to change."
            : tab === "transform"
              ? "Add a picture and pick the style to redraw it in."
              : "Describe a picture and ONIQ draws it."
        }
        back="/app"
      />

      {/* THE THREE TABS, drawn the way the reference draws them and the way
          Create — Voice already draws its own three: OniqChip, so one
          component owns the pill for every tab row in Create.

          `tone="soft"` is the reference's treatment for a tab row inside a
          form — a pale wash of the world with the world's own ink on it — and
          it is also the LEGIBLE one. Measured in a browser 2026-09-04: white
          on the `create` gradient is 1.7:1 at the cyan end. The solid pill
          stays where the reference puts it, on content filters out on the
          canvas (Home's "Mast", Explore's "All"). */}
      <div className="mt-4 px-5">
        <div className="flex gap-1.5" role="tablist" aria-label="What to do with pictures">
          {TABS.map((t) => (
            <OniqChip
              key={t.id}
              role="tab"
              tone="soft"
              active={tab === t.id}
              testId={`image-tab-${t.id}`}
              // `replace` so flipping tabs does not stack history entries a
              // person then has to press back through to leave the screen.
              onClick={() =>
                void navigate({
                  search: { mode: t.id === "generate" ? undefined : t.id },
                  replace: true,
                })
              }
            >
              {t.label}
            </OniqChip>
          ))}
        </div>
      </div>

      <div className="mt-3 px-5" role="tabpanel" aria-label="Picture controls">
        <OniqCard variant="surface" className="p-4">
          <label htmlFor="image-prompt" className="sr-only">
            {tab === "edit"
              ? "Say what to change about your picture"
              : tab === "transform"
                ? "Say what to keep while the style changes"
                : "Describe the picture you want"}
          </label>
          <textarea
            id="image-prompt"
            data-testid="image-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
            rows={3}
            placeholder={
              tab === "edit"
                ? "make the wall green"
                : tab === "transform"
                  ? "keep the scene and composition"
                  : "a red bicycle against a blue wall"
            }
            className="w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {/*
            ATTACH A PICTURE TO CHANGE. Only offered because it was measured
            working on the direct Google route (an inlineData part before the
            text returns an edited picture); the gateway had no field for it.

            It lives on Edit and Transform and NOT on Generate. On Generate
            there is nothing to attach a picture to — the tab is a sentence and
            a result — and a control that quietly switched which operation ran
            would make the tab a decoration.
          */}
          {needsPicture ? (
            <OniqAttachImage
              value={reference}
              onChange={setReference}
              disabled={busy}
              className="mt-3"
            />
          ) : null}

          {/* STYLE, as the reference draws it. These are PROMPT TEXT, not an
              API parameter: neither this endpoint nor Lyria has a verified
              `style` field, and this repo does not write an unverified request
              field into code. A chip appends a clause the server builds, which
              is how a person would have written it themselves and which cannot
              400. "Auto" is the absence of a style, so it adds nothing — which
              is exactly why Transform will not fire while it is selected: a
              Transform with no style is an Edit with extra steps. */}
          <p className="mt-4 text-[11px] font-semibold text-muted-foreground">
            {transforming ? "Style" : "Style (optional)"}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Style">
            {IMAGE_STYLES.map((s) => (
              <OniqChip
                key={s}
                role="radio"
                tone="soft"
                active={style === s}
                onClick={() => setStyle(s)}
                testId={`image-style-${s}`}
              >
                {STYLE_LABEL[s] ?? s}
              </OniqChip>
            ))}
          </div>

          {/* ASPECT RATIO — a REAL request field, unlike Style, and measured
              before it was built: generationConfig.imageConfig.aspectRatio
              returns 200 and the pixels actually change (1:1 -> 1024x1024,
              9:16 -> 768x1376), with a nonsense sibling rejected as proof the
              200 means something. Tapping the active chip again clears it,
              which sends no imageConfig at all — the shape the control used. */}
          {needsPicture ? (
            // AND WHY THERE IS NO RATIO CONTROL ON THIS TAB. Silence reads as
            // an oversight; this reads as a decision, which is what it is.
            //
            // aspectRatio is measured and honoured on a TEXT-ONLY call
            // (2026-09-04: control 1408x768, 1:1 -> 1024x1024, 9:16 ->
            // 768x1376). It is UNMEASURED when an inlineData part goes first,
            // and this repo does not ship a control whose effect is unknown —
            // an accepted-and-ignored parameter is indistinguishable from a
            // working one by status code alone. Settling it costs two image
            // calls on the metered key against the same picture and prompt,
            // 1:1 then 9:16, comparing returned pixel dimensions.
            //
            // Note this sentence is also the honest DEFAULT behaviour and not
            // just an excuse: with no imageConfig sent, an edit comes back
            // shaped like what went in, which is what a person handing over
            // their own picture expects.
            <p
              data-testid="image-ratio-note"
              className="mt-4 text-[11px] leading-snug text-muted-foreground"
            >
              Your picture keeps its shape — {tab === "edit" ? "edits" : "transforms"} come back the
              same size you sent.
            </p>
          ) : (
            <>
              <p className="mt-4 text-[11px] font-semibold text-muted-foreground">Aspect Ratio</p>
              <div
                className="mt-1.5 flex flex-wrap gap-2"
                role="radiogroup"
                aria-label="Aspect ratio"
              >
                {ASPECT_RATIOS.map((r) => (
                  <OniqChip
                    key={r}
                    role="radio"
                    tone="soft"
                    active={ratio === r}
                    onClick={() => setRatio((cur) => (cur === r ? null : r))}
                    testId={`image-ratio-${r.replace(":", "x")}`}
                  >
                    {r}
                  </OniqChip>
                ))}
              </div>
            </>
          )}
          {/* WHY THE BUTTON IS GREY. A disabled control with no explanation is
              the app refusing without saying so; this names the one thing
              still missing, in the order the tab needs it. */}
          {missing && needsPicture ? (
            <p data-testid="image-needs" className="mt-2 text-[11px] text-muted-foreground">
              {missing === "picture"
                ? "Add a picture above to get started."
                : missing === "style"
                  ? "Pick a style — that is what Transform changes."
                  : tab === "edit"
                    ? "Say what to change about it."
                    : "Say what to keep while the style changes."}
            </p>
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">
              {prompt.length}/{PROMPT_MAX}
            </span>
            <button
              type="button"
              data-testid="image-generate"
              onClick={() => void generate()}
              // Every part the tab needs, or nothing happens. Without the
              // picture, Edit and Transform would quietly generate a NEW image
              // from the instruction alone — a billable call answering a
              // question nobody asked.
              disabled={missing !== null || busy}
              className="press inline-flex items-center gap-2 rounded-full bg-world px-4 py-2 text-[13px] font-semibold normal-case tracking-normal text-on-world world-glow disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {busy
                ? "Drawing…"
                : tab === "edit"
                  ? "Change this picture"
                  : tab === "transform"
                    ? "Restyle this picture"
                    : "Make a picture"}
            </button>
          </div>
        </OniqCard>

        <div className="mt-3 flex flex-wrap gap-2">
          {IDEAS[tab].map((idea) => (
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
              <OniqCard key={p.id} variant="surface" className="p-3" testId="image-picture">
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
                <OniqMadeLink kind="image" id={p.id} testId="image-open" />
              </OniqCard>
            ))}
          </div>
        )}
      </div>
    </OniqCanvas>
  );
}
