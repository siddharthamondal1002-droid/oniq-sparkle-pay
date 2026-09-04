import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ImageIcon, Mic, Music4 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { OniqAIOrb, OniqCanvas, OniqCard, OniqCreateGrid, OniqHeader } from "@/components/oniq";

export const Route = createFileRoute("/_authenticated/app/create")({
  component: CreateScreen,
});

/**
 * CREATE — a screen, not a sheet. OWNER DIRECTIVE 2026-09-04f.
 *
 * The reference draws Create with its own header, the bottom nav still
 * visible with Create highlighted, a hero, the six cards and "My Creations".
 * ONIQ had it as a sheet that slid up from the nav button — the cards inside
 * already matched, but a sheet has no URL, cannot be linked to, cannot be
 * returned to with a back gesture, and cannot hold a section like My
 * Creations without becoming a scroll inside a scroll. Asked which to build,
 * the owner chose the screen as drawn.
 *
 * THE HERO CARRIES NO CHIPS YET, AND THAT IS DELIBERATE. The reference draws
 * four — Imagine, Transform, Create, Explore — and what they DO is not
 * legible from a picture. Guessing would put four controls on the most
 * prominent surface in the app that go nowhere, or somewhere wrong, which is
 * precisely the failure this codebase keeps deciding not to ship. The owner
 * is telling us what they are; they land here when they do.
 *
 * MY CREATIONS IS THE PERSON'S OWN WORK, so it is fetched rather than
 * decorated: three `list` actions, which are free — they read rows and sign
 * URLs and pass none of the spend gates. Films are deliberately absent: that
 * list is a different shape and /app/creations already joins all four. This
 * is the four most recent things with something to show, and a way through.
 */

type Made = { id: string; createdAt: string; prompt: string; url: string | null };
type Recent = { id: string; kind: "picture" | "song" | "voice"; at: string; url: string | null };

/** Newest first, at most four, and nothing that has no URL to show. */
function pickRecent(pictures: Made[], songs: Made[], voices: Made[]): Recent[] {
  const all: Recent[] = [
    ...pictures.map((p) => ({ id: p.id, kind: "picture" as const, at: p.createdAt, url: p.url })),
    ...songs.map((s) => ({ id: s.id, kind: "song" as const, at: s.createdAt, url: s.url })),
    ...voices.map((v) => ({ id: v.id, kind: "voice" as const, at: v.createdAt, url: v.url })),
  ];
  return all
    .filter((r) => r.url)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 4);
}

const KIND_ICON = { picture: ImageIcon, song: Music4, voice: Mic } as const;

function CreateScreen() {
  const [recent, setRecent] = useState<Recent[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const ask = async (fn: string, key: string): Promise<Made[]> => {
        const { data, error } = await supabase.functions.invoke(fn, { body: { action: "list" } });
        const rows = (data as Record<string, unknown> | null)?.[key];
        return error || !Array.isArray(rows) ? [] : (rows as Made[]);
      };
      // In parallel: three independent reads, and one failing must not hide
      // the other two. A person with songs and no pictures still has songs.
      const [pictures, songs, voices] = await Promise.all([
        ask("image-generate", "images"),
        ask("music-generate", "songs"),
        ask("voice-generate", "clips"),
      ]);
      if (alive) setRecent(pickRecent(pictures, songs, voices));
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <OniqCanvas world="create" className="pb-28">
      <OniqHeader
        eyebrow="Create"
        title="Create ✨"
        subtitle="Turn your ideas into reality."
        back={null}
      />

      <div className="mt-4 px-5">
        {/* THE HERO. One orb on a soft wash of the world, and the question the
            reference asks. Nothing here is tappable, so nothing here can
            disappoint. */}
        <OniqCard variant="surface" className="overflow-hidden p-0">
          <div className="flex flex-col items-center gap-3 bg-world-soft px-5 py-7 text-center">
            <OniqAIOrb size="xl" />
            <p className="font-display text-[17px] leading-tight text-foreground">
              What will you create today?
            </p>
          </div>
        </OniqCard>

        <OniqCreateGrid className="mt-4" />
      </div>

      <div className="mt-6 px-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[15px] text-foreground">My Creations</h2>
          <Link
            to="/app/creations"
            data-testid="create-see-all"
            className="press text-[12px] font-semibold text-world"
          >
            See all
          </Link>
        </div>

        {recent === null ? (
          <div className="mt-3 grid grid-cols-4 gap-2" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="aspect-square animate-pulse rounded-2xl oniq-surface" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Nothing yet. Whatever you make appears here.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-4 gap-2" data-testid="create-recent">
            {recent.map((r) => {
              const Icon = KIND_ICON[r.kind];
              return (
                <Link
                  key={`${r.kind}-${r.id}`}
                  to="/app/creations"
                  className="press grid aspect-square place-items-center overflow-hidden rounded-2xl oniq-surface"
                  aria-label={`Open your ${r.kind === "picture" ? "picture" : r.kind}`}
                >
                  {r.kind === "picture" && r.url ? (
                    <img src={r.url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Icon className="h-5 w-5 text-world" aria-hidden="true" />
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </OniqCanvas>
  );
}
