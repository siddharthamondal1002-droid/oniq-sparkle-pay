import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, ImageIcon, Mic, Music4, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  AI_OUTPUT_LABEL,
  AiOutputReport,
  type AiSurface,
} from "@/components/safety/AiOutputReport";
import {
  OniqAudioPlayer,
  OniqCanvas,
  OniqCard,
  OniqEmpty,
  OniqHeader,
  OniqResultActions,
  RESULT_TILE,
} from "@/components/oniq";

/** The three things ONIQ makes that have a result worth its own screen. */
const KINDS = ["image", "music", "voice"] as const;
type Kind = (typeof KINDS)[number];

export const Route = createFileRoute("/_authenticated/app/made/$kind/$id")({
  component: MadeScreen,
});

/**
 * "YOUR IMAGE" / "YOUR MUSIC" / "YOUR VOICE" — the result screens the owner's
 * reference draws, as ONE route with two layouts rather than three files.
 *
 * WHY ONE ROUTE. The reference draws three screens, but only two SHAPES: a
 * picture, or an orb over a transport. The differences beyond that are a
 * title, an icon and a noun. Three files would be three places for a share
 * button to drift out of step, which is the same argument that put the six
 * Create cards in one component.
 *
 * IT REFETCHES RATHER THAN BEING HANDED THE ROW. A result screen has to
 * survive a reload, a shared link and a return from the Creations list, and
 * an in-memory hand-off survives none of those. The `list` action is free —
 * it reads rows and signs URLs and passes none of the spend gates — so this
 * costs nothing but a round trip, and the URL it gets back is FRESH, which
 * matters because the previous one may have expired while the person was
 * looking at it.
 *
 * IT IS AN AI SURFACE. Everything shown here was generated, so it carries
 * AI_OUTPUT_LABEL and <AiOutputReport /> like the screens that made it —
 * `playCompliance` keys off the module, not the pipeline, and a result screen
 * showing generated media unlabelled is exactly the gap that shipped once
 * before on Lores.
 */
const KIND_META: Record<
  Kind,
  {
    title: string;
    fn: string;
    listKey: string;
    noun: string;
    ext: string;
    mime: string;
    /** Declared in playCompliance.ts — the guard greps this file for it. */
    surface: AiSurface;
  }
> = {
  image: {
    title: "Your Image 🖼️",
    fn: "image-generate",
    listKey: "images",
    noun: "picture",
    ext: "jpg",
    mime: "image/jpeg",
    surface: "image_ai_output",
  },
  music: {
    title: "Your Music 🎵",
    fn: "music-generate",
    listKey: "songs",
    noun: "song",
    ext: "mp3",
    mime: "audio/mpeg",
    surface: "music_ai_output",
  },
  voice: {
    title: "Your Voice 🎙️",
    fn: "voice-generate",
    listKey: "clips",
    noun: "clip",
    ext: "wav",
    mime: "audio/wav",
    surface: "voice_ai_output",
  },
};

type Made = {
  id: string;
  createdAt: string;
  prompt: string;
  url: string | null;
  reference?: string | null;
  brief?: string | null;
};

function MadeScreen() {
  const { kind, id } = useParams({ from: "/_authenticated/app/made/$kind/$id" });
  const valid = (KINDS as readonly string[]).includes(kind);
  const meta = valid ? KIND_META[kind as Kind] : null;
  const [item, setItem] = useState<Made | null | "missing">(null);

  useEffect(() => {
    if (!meta) return;
    let alive = true;
    void (async () => {
      const { data, error } = await supabase.functions.invoke(meta.fn, {
        body: { action: "list" },
      });
      if (!alive) return;
      const rows = (data as Record<string, unknown> | null)?.[meta.listKey];
      if (error || !Array.isArray(rows)) {
        setItem("missing");
        return;
      }
      setItem((rows as Made[]).find((r) => r.id === id) ?? "missing");
    })();
    return () => {
      alive = false;
    };
  }, [meta, id]);

  if (!meta) {
    return (
      <OniqCanvas world="create" className="pb-28">
        <OniqHeader eyebrow="Create" title="Not found" back="/app/creations" />
        <div className="mt-4 px-5">
          <OniqEmpty
            emoji="🤷"
            title="Nothing here"
            body="That link does not name anything ONIQ makes."
          />
        </div>
      </OniqCanvas>
    );
  }

  const Icon = kind === "image" ? ImageIcon : kind === "music" ? Music4 : Mic;

  return (
    <OniqCanvas world="create" className="pb-28">
      <OniqHeader eyebrow="Create" title={meta.title} back="/app/creations" />

      <div className="mt-4 px-5">
        {item === null ? (
          <div className="aspect-square w-full animate-pulse rounded-3xl oniq-surface" />
        ) : item === "missing" || !item.url ? (
          <OniqEmpty
            emoji="🕳️"
            title={`That ${meta.noun} isn't here`}
            body="It may have been removed, or the link may be for a different account."
          />
        ) : (
          <>
            <OniqCard variant="surface" className="overflow-hidden p-0">
              {kind === "image" ? (
                <img
                  src={item.url}
                  alt={item.prompt}
                  data-testid="made-image"
                  className="w-full bg-black"
                />
              ) : (
                <div className="flex flex-col items-center gap-4 bg-world-soft px-5 py-8">
                  <span className="grid h-24 w-24 place-items-center rounded-full bg-world world-glow">
                    <Icon className="h-9 w-9 text-white" aria-hidden="true" />
                  </span>
                  <div className="text-center">
                    {/* `normal-case` against the app-wide rule that shouts
                        every .font-display element. The reference writes it
                        "ONIQ Voice"; uppercased it reads as a system label
                        stamped on the track rather than the name of the thing
                        that made it. Same fix, same reason, as OniqChip. */}
                    <p className="font-display text-[15px] normal-case tracking-normal text-foreground">
                      {kind === "music" ? "ONIQ Music" : "ONIQ Voice"}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      Generated {meta.noun}
                    </p>
                  </div>
                  <OniqAudioPlayer src={item.url} label={`your ${meta.noun}`} className="mt-1" />
                </div>
              )}
            </OniqCard>

            <p className="mt-3 text-[13px] leading-snug text-foreground">{item.prompt}</p>

            {/* The brief, where there was one — the same sentence the Create
                screen showed, kept with the result so the provenance travels
                with the thing rather than living only in the moment it was
                made. */}
            {item.reference === "audio" && item.brief ? (
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                Heard in your track: {item.brief}
              </p>
            ) : item.reference === "image" ? (
              <p className="mt-1 text-[11px] text-muted-foreground">From a picture you added</p>
            ) : null}

            {/* The reference draws four tiles — Share, Download, Save and one
                contextual action. Three ship: Save is the identical call to
                Download on every platform ONIQ targets (see
                OniqResultActions), and of the contextual ones only Edit has
                somewhere real to go. "Use in Video" would be a dead button:
                the Story worker writes its own narration and takes no
                user-supplied track. */}
            <OniqResultActions
              className="mt-5 flex-wrap"
              url={item.url}
              filename={`oniq-${kind}-${item.id.slice(0, 8)}.${meta.ext}`}
              mime={meta.mime}
              title={item.prompt || `ONIQ ${meta.noun}`}
            >
              {kind === "image" ? (
                <Link
                  to="/app/image"
                  search={{ mode: "edit" }}
                  data-testid="made-edit"
                  className={RESULT_TILE}
                >
                  <Pencil className="h-5 w-5 text-world" aria-hidden="true" />
                  Edit
                </Link>
              ) : null}
            </OniqResultActions>

            {/* "Save" is not a tile here — see OniqResultActions. This is the
                fact a person actually wants, and it is already true. */}
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-world" aria-hidden="true" />
              Saved to your Creations
            </p>

            <p className="mt-4 text-[11px] text-muted-foreground">🤖 {AI_OUTPUT_LABEL}</p>
            <AiOutputReport surface={meta.surface} targetId={item.id} />
          </>
        )}
      </div>
    </OniqCanvas>
  );
}
