import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Play, Clapperboard } from "lucide-react";
import { LORE_COLLECTIONS, type LoreVideo } from "@/data/lores";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";
import { AI_OUTPUT_LABEL_TEXT, provenanceFor } from "@/config/aiProvenance";
import { StoryStudio } from "@/components/stories/StoryStudio";
import { YourVideos } from "@/components/stories/YourVideos";

export const Route = createFileRoute("/_authenticated/app/lores")({
  head: () => ({
    meta: [
      { title: "Lores — ONIQ Originals" },
      {
        name: "description",
        content:
          "ONIQ Lores: every ONIQ Original in one place — illustrated shorts and the Arabian Nights season.",
      },
      { property: "og:title", content: "Lores — ONIQ Originals" },
      {
        property: "og:description",
        content: "Every ONIQ Original in one place — illustrated shorts and full seasons.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LoresPage,
});

/** Seconds of an episode the preview shows before asking for a real play. */
const PREVIEW_SECONDS = 15;

function LoreCard({ v }: { v: LoreVideo }) {
  // ONE persistent <video> for every mode. The first build swapped in a
  // fresh element per mode and leaned on autoPlay — which mobile browsers
  // BLOCK for unmuted video after a React remount (the tap's activation
  // does not survive the re-render), so "Watch the full episode" froze on
  // a black frame in the field. Calling .play() synchronously inside the
  // tap handler on an element that already exists keeps the gesture and
  // the playback position.
  const [mode, setMode] = useState<"idle" | "preview" | "previewEnded" | "playing">("idle");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Hooks stay above every branch; this is a plain lookup, not a hook.
  const prov = provenanceFor(v.id);

  const startPreview = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
    el.currentTime = 0;
    void el.play().catch(() => {});
    setMode("preview");
  };
  const startFull = (fromStart: boolean) => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    if (fromStart) el.currentTime = 0;
    void el.play().catch(() => {});
    setMode("playing");
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card/70">
      <div className="relative aspect-video bg-black">
        {v.url ? (
          <>
            <video
              ref={videoRef}
              src={v.url}
              preload="metadata"
              playsInline
              controls={mode === "playing"}
              onTimeUpdate={(e) => {
                // A capped taste, not the film: stop at the mark rather than
                // trusting a second source or a trimmed asset to exist.
                if (
                  modeRef.current === "preview" &&
                  e.currentTarget.currentTime >= PREVIEW_SECONDS
                ) {
                  e.currentTarget.pause();
                  setMode("previewEnded");
                }
              }}
              onEnded={() => setMode((m) => (m === "preview" ? "previewEnded" : m))}
              className="h-full w-full object-contain"
            />
            {mode === "idle" && (
              <div className="absolute inset-0 flex items-center justify-center gap-3 bg-black/30">
                <button
                  type="button"
                  onClick={startPreview}
                  className="rounded-full border border-white/30 bg-black/50 px-4 py-2 text-xs font-semibold text-white backdrop-blur-sm transition active:scale-95"
                  aria-label={`Preview ${v.title}`}
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => startFull(true)}
                  className="grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
                  aria-label={`Play ${v.title}`}
                >
                  <Play className="h-5 w-5" />
                </button>
              </div>
            )}
            {mode === "preview" && (
              <button
                type="button"
                onClick={() => startFull(false)}
                className="absolute inset-0 block h-full w-full"
                aria-label={`Watch ${v.title} in full`}
              >
                <span className="absolute start-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white/90">
                  Preview
                </span>
                <span className="absolute bottom-2 end-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white/90 normal-case tracking-normal">
                  Tap for full episode
                </span>
              </button>
            )}
            {mode === "previewEnded" && (
              <div className="absolute inset-0 grid h-full w-full place-items-center bg-gradient-to-br from-[#1a1230]/95 via-[#241a40]/95 to-[#0d0a18]/95">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[11px] text-white/70">That was a taste 🎬</span>
                  <button
                    type="button"
                    onClick={() => startFull(true)}
                    className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
                  >
                    Watch the full episode
                  </button>
                </div>
              </div>
            )}
            {/* THE LABEL THAT ACTUALLY HAS TO BE HERE.
                India's IT Amendment Rules 2026 ask for PROMINENT labelling,
                and the panel banner above the grid is not prominent once
                someone has scrolled to an episode and tapped play — it is off
                screen at exactly the moment the video is on it. This badge is
                inside the player frame, in every mode including full playback,
                so a screenshot or a screen recording carries the disclosure
                with it the way the file's metadata does.
                Rendered under the controls row, top-start, so it never covers
                the scrubber. pointer-events-none so it cannot eat a tap meant
                for the video. */}
            <span className="pointer-events-none absolute start-2 top-2 z-10 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white/90 backdrop-blur-sm">
              🤖 {AI_OUTPUT_LABEL_TEXT}
            </span>
          </>
        ) : (
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#1a1230] via-[#241a40] to-[#0d0a18] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            in production
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="text-sm font-semibold text-foreground">{v.title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {v.blurb} · {v.runtime}
        </div>
        {/* PER-EPISODE report, not one hub-level control. The takedown window
            is three hours — two where the complaint is sexual content or a
            deepfake — and a report that says only "something in Lores" spends
            most of that window being triaged into which episode it meant. */}
        {prov && (
          <details className="mt-2 rounded-xl bg-muted/30 px-2.5 py-1.5">
            <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              How this was made
            </summary>
            <div className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
              <div>Stills: {prov.imageModel}</div>
              <div>Motion: {prov.videoModel}</div>
              <div>Voice: {prov.voice}</div>
              <div>Assembly: {prov.assembly}</div>
            </div>
          </details>
        )}
        <div className="mt-2">
          <AiOutputReport
            surface="lores_ai_output"
            targetId={v.id}
            context={{ title: v.title, collection: v.collection }}
          />
        </div>
      </div>
    </div>
  );
}


const TABS = [
  { id: "originals", label: "Originals" },
  { id: "stories", label: "Make a Story" },
  // A film outlives the form that started it — six minutes of render is long
  // enough to lock a phone — so finished Stories need somewhere of their own to
  // be found rather than living inside the studio's component state.
  { id: "library", label: "Your videos" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function LoresPage() {
  // Hook above every return, always. rules-of-hooks is a release blocker here.
  const [tab, setTab] = useState<TabId>("originals");

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-28 pt-6">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary/80">
        <Clapperboard className="h-3.5 w-3.5" /> ONIQ Originals
      </div>
      <h1 className="mt-1 font-display text-2xl font-bold text-foreground">Lores 🎬</h1>
      <p className="mt-1 text-xs text-muted-foreground">stories made in-house — no cap, all ours</p>

      <div
        role="tablist"
        aria-label="Lores sections"
        // STICKY. The Stories panel is taller than a phone screen, so a tab
        // strip that scrolls away leaves someone stranded in the studio with no
        // visible route back to the Originals — reported from a real device as
        // "tabs are not live", because from where the page had scrolled to,
        // they were not.
        className="sticky top-0 z-20 -mx-1 mt-4 flex gap-1 rounded-2xl border border-border bg-background/95 p-1 backdrop-blur"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`lores-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`lores-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={
              "flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-colors " +
              (tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Each tab is its OWN generative surface with its own label and its own
          report control, rather than one banner covering both. They are
          different content from different authors — the Originals are ONIQ's,
          a Story is the user's — and a single shared label would attach the
          wrong provenance to whichever one you happened to be looking at. */}
      {tab === "originals" ? (
        <div role="tabpanel" id="lores-panel-originals" aria-labelledby="lores-tab-originals">
          {/* Every clip here is generated, so the whole PANEL is a generative
              surface rather than one output inside it — hence the label at the
              top rather than per card. Play's AI-Generated Content policy
              requires the label AND an in-app way to report it; see AI_SURFACES
              in config/playCompliance.ts. */}
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-3 py-2">
            <span className="text-[11px] font-semibold text-amber-300">
              AI-generated video 🤖 — {AI_OUTPUT_LABEL}
            </span>
            <AiOutputReport surface="lores_ai_output" targetId="lores-hub" />
          </div>

          {LORE_COLLECTIONS.map((c) => (
            <section key={c.name} className="mt-6">
              <h2 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {c.name}
              </h2>
              <div className="grid gap-3">
                {c.videos.map((v) => (
                  <LoreCard key={v.id} v={v} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : tab === "stories" ? (
        <div role="tabpanel" id="lores-panel-stories" aria-labelledby="lores-tab-stories">
          <StoryStudio />
        </div>
      ) : (
        <div role="tabpanel" id="lores-panel-library" aria-labelledby="lores-tab-library">
          <YourVideos />
        </div>
      )}
    </div>
  );
}
