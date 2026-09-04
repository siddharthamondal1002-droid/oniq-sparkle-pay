import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Clapperboard, ImageIcon, Mic, Music4 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isWatchable, listStories, type StoryJobRow } from "@/components/stories/storyJobsClient";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";
import {
  OniqCanvas,
  OniqCard,
  OniqChip,
  OniqEmpty,
  OniqHeader,
  OniqMadeLink,
  OniqSkeletonRows,
} from "@/components/oniq";

export const Route = createFileRoute("/_authenticated/app/creations")({
  component: CreationsScreen,
});

/**
 * MY CREATIONS — everything ONIQ has made for this person, in one place.
 *
 * Owner reference, 2026-09-04. Create can now make more than one kind of
 * thing, and until this screen existed each kind lived only where it was
 * made: films under Lores, songs under Music, with nothing that answered
 * "what have I made?". This is that answer.
 *
 * IT INVENTS NOTHING. Every part comes from the same source its own screen
 * reads — listStories() for films, and the list action of music-generate,
 * image-generate and voice-generate for the rest — so a row here is a row
 * there. When one source fails and the others do not, the screen shows what
 * loaded and says plainly what did not, rather than presenting a short list as
 * if it were the whole shelf.
 *
 * It is an AI surface: every item on it was generated, so it carries the
 * label and the report control, and it is declared in playCompliance.
 */
/** The list shape the music, image and voice functions all answer with. */
type Made = { id: string; createdAt: string; prompt: string; url: string | null };
type Item =
  | { kind: "film"; id: string; at: string; title: string; row: StoryJobRow }
  | { kind: "song"; id: string; at: string; title: string; url: string | null }
  | { kind: "picture"; id: string; at: string; title: string; url: string | null }
  | { kind: "clip"; id: string; at: string; title: string; url: string | null };

type Filter = "all" | "film" | "song" | "picture" | "clip";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "film", label: "Films" },
  { id: "song", label: "Songs" },
  { id: "picture", label: "Pictures" },
  { id: "clip", label: "Voice" },
];

function CreationsScreen() {
  const [films, setFilms] = useState<StoryJobRow[] | null>(null);
  const [songs, setSongs] = useState<Made[] | null>(null);
  const [pictures, setPictures] = useState<Made[] | null>(null);
  const [filmsFailed, setFilmsFailed] = useState(false);
  const [songsFailed, setSongsFailed] = useState(false);
  const [picturesFailed, setPicturesFailed] = useState(false);
  const [voices, setVoices] = useState<Made[] | null>(null);
  const [voicesFailed, setVoicesFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rows = await listStories(30);
        if (alive) setFilms(rows);
      } catch {
        if (alive) {
          setFilms([]);
          setFilmsFailed(true);
        }
      }
    })();
    void (async () => {
      const { data, error } = await supabase.functions.invoke("music-generate", {
        body: { action: "list" },
      });
      if (!alive) return;
      if (error || !Array.isArray(data?.songs)) {
        setSongs([]);
        setSongsFailed(true);
        return;
      }
      setSongs(data.songs as Made[]);
    })();
    void (async () => {
      const { data, error } = await supabase.functions.invoke("image-generate", {
        body: { action: "list" },
      });
      if (!alive) return;
      if (error || !Array.isArray(data?.images)) {
        setPictures([]);
        setPicturesFailed(true);
        return;
      }
      setPictures(data.images as Made[]);
    })();
    void (async () => {
      const { data, error } = await supabase.functions.invoke("voice-generate", {
        body: { action: "list" },
      });
      if (!alive) return;
      if (error || !Array.isArray(data?.clips)) {
        setVoices([]);
        setVoicesFailed(true);
        return;
      }
      setVoices(data.clips as Made[]);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loading = films === null || songs === null || pictures === null || voices === null;
  const items: Item[] = [
    ...(films ?? []).map((row) => ({
      kind: "film" as const,
      id: row.id,
      at: row.created_at,
      title: row.prompt?.trim() || "Untitled film",
      row,
    })),
    ...(songs ?? []).map((s) => ({
      kind: "song" as const,
      id: s.id,
      at: s.createdAt,
      title: s.prompt?.trim() || "Untitled song",
      url: s.url,
    })),
    ...(pictures ?? []).map((p) => ({
      kind: "picture" as const,
      id: p.id,
      at: p.createdAt,
      title: p.prompt?.trim() || "Untitled picture",
      url: p.url,
    })),
    ...(voices ?? []).map((v) => ({
      kind: "clip" as const,
      id: v.id,
      at: v.createdAt,
      title: v.prompt?.trim() || "Untitled clip",
      url: v.url,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  const shown = filter === "all" ? items : items.filter((i) => i.kind === filter);
  // Said only when something is missing, and it names WHICH part — a person
  // looking at a short list deserves to know it is short for a reason. Built
  // from the list rather than nested ternaries, because a third source made
  // that chain eight cases and a fourth would make it sixteen.
  const failed = [
    filmsFailed ? "films" : null,
    songsFailed ? "songs" : null,
    picturesFailed ? "pictures" : null,
    voicesFailed ? "voice clips" : null,
  ].filter((x): x is string => x !== null);
  const missing =
    failed.length === 0
      ? null
      : failed.length === 1
        ? failed[0]
        : `${failed.slice(0, -1).join(", ")} and ${failed[failed.length - 1]}`;

  return (
    <OniqCanvas world="create" className="pb-28">
      <OniqHeader
        eyebrow="Create"
        title="My Creations"
        subtitle="Everything you've made with ONIQ."
        back="/app"
      />

      <div className="mt-4 px-5">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <OniqChip
              key={f.id}
              role="tab"
              active={filter === f.id}
              onClick={() => setFilter(f.id)}
              testId={`creations-filter-${f.id}`}
            >
              {f.label}
            </OniqChip>
          ))}
        </div>

        {missing ? (
          <p role="alert" className="mt-3 text-[12px] text-muted-foreground">
            Couldn't load your {missing} — a connection problem, so this list may be short.
          </p>
        ) : null}

        <p className="mt-3 text-[11px] text-muted-foreground">🤖 {AI_OUTPUT_LABEL}</p>
        <AiOutputReport surface="creations_ai_output" targetId="my-creations" />
      </div>

      <div className="mt-4 px-5">
        {loading ? (
          <OniqSkeletonRows rows={3} />
        ) : shown.length === 0 ? (
          <OniqEmpty
            emoji="✨"
            title="Nothing here yet"
            body="Make a film, a song, a picture or a voice clip and it lands here."
          />
        ) : (
          <div className="grid gap-2">
            {shown.map((item) =>
              item.kind === "picture" ? (
                <OniqCard key={item.id} variant="surface" className="p-3" testId="creation-picture">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="h-4 w-4 shrink-0 text-world" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                      {item.title}
                    </span>
                  </div>
                  {item.url ? (
                    <img
                      src={item.url}
                      alt={item.title}
                      loading="lazy"
                      className="mt-2 w-full rounded-xl bg-black"
                    />
                  ) : (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      This one could not be loaded.
                    </p>
                  )}
                  <OniqMadeLink kind="image" id={item.id} testId="creation-picture-open" />
                </OniqCard>
              ) : item.kind === "song" || item.kind === "clip" ? (
                <OniqCard
                  key={item.id}
                  variant="surface"
                  className="p-3"
                  testId={item.kind === "song" ? "creation-song" : "creation-clip"}
                >
                  <div className="flex items-center gap-2">
                    {item.kind === "song" ? (
                      <Music4 className="h-4 w-4 shrink-0 text-world" aria-hidden="true" />
                    ) : (
                      <Mic className="h-4 w-4 shrink-0 text-world" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                      {item.title}
                    </span>
                  </div>
                  {item.url ? (
                    <audio controls preload="none" src={item.url} className="mt-2 w-full">
                      <track kind="captions" />
                    </audio>
                  ) : (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      This one could not be loaded.
                    </p>
                  )}
                  <OniqMadeLink
                    kind={item.kind === "song" ? "music" : "voice"}
                    id={item.id}
                    testId={item.kind === "song" ? "creation-song-open" : "creation-clip-open"}
                  />
                </OniqCard>
              ) : (
                <OniqCard key={item.id} variant="surface" className="p-3" testId="creation-film">
                  <div className="flex items-center gap-2">
                    <Clapperboard className="h-4 w-4 shrink-0 text-world" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                      {item.title}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {/* The job's own word for where it is. A film still rendering
                        is not a broken film, and saying so beats a dead play button. */}
                    {isWatchable(item.row.status) ? "Ready to watch" : item.row.status}
                  </p>
                  <Link
                    to="/app/lores"
                    search={{ tab: "library" }}
                    className="press mt-2 inline-flex text-[12px] font-semibold text-world"
                  >
                    Open in Lores →
                  </Link>
                </OniqCard>
              ),
            )}
          </div>
        )}
      </div>
    </OniqCanvas>
  );
}
