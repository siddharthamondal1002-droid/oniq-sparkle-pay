import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Play, Clapperboard } from "lucide-react";
import { LORE_COLLECTIONS, type LoreVideo } from "@/data/lores";

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

function LoresPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 pb-28 pt-6">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary/80">
        <Clapperboard className="h-3.5 w-3.5" /> ONIQ Originals
      </div>
      <h1 className="mt-1 font-display text-2xl font-bold text-foreground">Lores 🎬</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        stories made in-house — no cap, all ours
      </p>

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
  );
}
