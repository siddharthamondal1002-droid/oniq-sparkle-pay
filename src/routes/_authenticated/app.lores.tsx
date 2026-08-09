import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Play, Clapperboard } from "lucide-react";
import { LORE_COLLECTIONS, type LoreVideo } from "@/data/lores";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";
import { StoryStudio } from "@/components/stories/StoryStudio";

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

function LoreCard({ v }: { v: LoreVideo }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card/70">
      <div className="relative aspect-video bg-black">
        {v.url ? (
          playing ? (
            <video
              src={v.url}
              controls
              autoPlay
              playsInline
              className="h-full w-full object-contain"
            />
          ) : (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="group grid h-full w-full place-items-center bg-gradient-to-br from-[#1a1230] via-[#241a40] to-[#0d0a18]"
              aria-label={`Play ${v.title}`}
            >
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground transition-transform group-active:scale-95">
                <Play className="h-5 w-5" />
              </span>
            </button>
          )
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
      </div>
    </div>
  );
}

const TABS = [
  { id: "originals", label: "Originals" },
  { id: "stories", label: "Make a Story" },
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
      ) : (
        <div role="tabpanel" id="lores-panel-stories" aria-labelledby="lores-tab-stories">
          <StoryStudio />
        </div>
      )}
    </div>
  );
}
