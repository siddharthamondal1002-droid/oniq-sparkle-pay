import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, ChevronRight, ExternalLink, BookOpen, Headphones, Calendar as CalIcon, ShoppingBag, ArrowLeft, Video } from "lucide-react";


export const Route = createFileRoute("/_authenticated/app/faith")({
  component: FaithPage,
});

type Religion = "hindu" | "islam" | "christian" | "sikh" | "buddhist" | "jewish";
const RELIGIONS: { key: Religion; label: string; emoji: string }[] = [
  { key: "hindu", label: "Hindu", emoji: "🕉" },
  { key: "islam", label: "Islam", emoji: "☪️" },
  { key: "christian", label: "Christian", emoji: "✝️" },
  { key: "sikh", label: "Sikh", emoji: "🪯" },
  { key: "buddhist", label: "Buddhist", emoji: "☸️" },
  { key: "jewish", label: "Jewish", emoji: "✡️" },
];

const LS_KEY = "oniq.faith.religion.v1";
type Section = "read" | "listen" | "dates" | "shop" | "watch";

function FaithPage() {
  const [religion, setReligion] = useState<Religion | null>(null);
  const [section, setSection] = useState<Section>("read");

  useEffect(() => {
    try {
      const r = localStorage.getItem(LS_KEY) as Religion | null;
      if (r) setReligion(r);
    } catch { /* noop */ }
  }, []);

  const pick = (r: Religion) => {
    setReligion(r);
    try { localStorage.setItem(LS_KEY, r); } catch { /* noop */ }
  };

  return (
    <div className="min-h-screen pb-24">
      <div className="px-5 pt-[max(3rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <Link to="/app" aria-label="Back" className="press grid h-9 w-9 place-items-center rounded-full bg-surface-2">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">blessed 🙏</div>
            <h1 className="font-display text-2xl font-bold">faith, ur way</h1>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {RELIGIONS.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => pick(r.key)}
              className={`press rounded-full px-3 py-1.5 text-sm font-medium border ${religion === r.key ? "bg-primary text-primary-foreground border-primary" : "bg-surface-2 border-border"}`}
            >
              <span className="mr-1">{r.emoji}</span>{r.label}
            </button>
          ))}
        </div>

        {!religion ? (
          <div className="mt-8 rounded-2xl border border-border bg-card p-5 text-center">
            <p className="text-sm text-muted-foreground">pick ur path above to get started ✨</p>
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-5 gap-2">
              <TabBtn active={section === "read"} onClick={() => setSection("read")} icon={<BookOpen className="h-4 w-4" />} label="read 📖" />
              <TabBtn active={section === "listen"} onClick={() => setSection("listen")} icon={<Headphones className="h-4 w-4" />} label="listen 🎧" />
              <TabBtn active={section === "dates"} onClick={() => setSection("dates")} icon={<CalIcon className="h-4 w-4" />} label="dates 🗓" />
              <TabBtn active={section === "shop"} onClick={() => setSection("shop")} icon={<ShoppingBag className="h-4 w-4" />} label="shop 🛍" />
              <TabBtn active={section === "watch"} onClick={() => setSection("watch")} icon={<Video className="h-4 w-4" />} label="watch 🎥" />
            </div>

            <div className="mt-5">
              {section === "read" && <ReadSection religion={religion} />}
              {section === "listen" && (<><ListenSection religion={religion} /><DevotionalRadioSection religion={religion} /></>)}
              {section === "dates" && <DatesSection religion={religion} />}
              {section === "shop" && <ShopSection religion={religion} />}
              {section === "watch" && <DevotionalLiveSection religion={religion} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// DEVOTIONAL LIVE — YouTube streams from official public channels
// ============================================================

type FaithId = "islamic" | "sikh" | "hindu" | "christian" | "buddhist" | "jewish";
type LiveVideo = {
  videoId: string;
  title: string;
  channelName: string;
  publishedAt: string;
  thumbnail: string;
  isLive?: boolean;
  faith?: FaithId;
};
type LiveGenreResp = { id: string; name: string; emoji: string; live: boolean; videos: LiveVideo[] };

const FAITH_META: { id: FaithId; label: string }[] = [
  { id: "islamic", label: "🕌 Islamic" },
  { id: "sikh", label: "🪯 Sikh" },
  { id: "hindu", label: "🕉️ Hindu" },
  { id: "christian", label: "✝️ Christian" },
  { id: "buddhist", label: "☸️ Buddhist" },
  { id: "jewish", label: "✡️ Jewish" },
];

function religionToFaithId(religion: Religion | null): FaithId | null {
  if (!religion) return null;
  if (religion === "islam") return "islamic";
  if (
    religion === "hindu" ||
    religion === "sikh" ||
    religion === "christian" ||
    religion === "buddhist" ||
    religion === "jewish"
  ) return religion;
  return null;
}

function DevotionalLiveSection({ religion }: { religion: Religion | null }) {
  const [playing, setPlaying] = useState<LiveVideo | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["blessed-devotional-live"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("live-channels", { body: {} });
      if (error) throw error;
      const genres: LiveGenreResp[] = Array.isArray(data?.genres) ? data.genres : [];
      return genres.find((g) => g.id === "devotional") ?? null;
    },
  });

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-primary/80">watch 🙏</div>
          <h2 className="font-display text-lg font-bold">live darshan · kirtan · bayan</h2>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          tuning in…
        </div>
      ) : !data || data.videos.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          no live streams right now — check back later 🌙
        </div>
      ) : playing ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-black">
          <div className="relative aspect-video w-full">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${playing.videoId}?autoplay=1&rel=0`}
              title={playing.title}
              allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          </div>
          <div className="flex items-center justify-between gap-3 bg-card p-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{playing.channelName}</div>
              <div className="truncate text-[11px] text-muted-foreground">{playing.title}</div>
            </div>
            <button
              type="button"
              onClick={() => setPlaying(null)}
              className="press rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium"
            >
              back to list
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground/70">
            Video content is hosted by YouTube and owned by the respective creators/channels — played via YouTube's official embedded player. Rights-holders can report a specific video or channel via{" "}
            <Link to="/app/privacy/grievance" className="underline">Privacy → Grievance</Link> (category: Content takedown).
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Prefer the user's own faith, but never render an empty section:
              if their faith's channels have nothing right now, fall back to
              showing every faith that does have streams. */}
          {(() => {
            const only = religionToFaithId(religion);
            const hasOwn = only ? data.videos.some((v) => v.faith === only) : false;
            const metas = only && hasOwn ? FAITH_META.filter((f) => f.id === only) : FAITH_META;
            return (
              <>
                {only && !hasOwn && (
                  <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                    your faith's channels are quiet right now — here's what's playing across faiths 🌙
                  </div>
                )}
                {metas.map((f) => {
            const items = data.videos.filter((v) => v.faith === f.id);
            if (items.length === 0) return null;
            return (
              <div key={f.id}>
                <div className="mb-2 text-sm font-semibold text-foreground/90">{f.label}</div>
                <ul className="grid grid-cols-2 gap-2">
                  {items.map((v) => (
                    <li key={v.videoId}>
                      <button
                        type="button"
                        onClick={() => setPlaying(v)}
                        className="press w-full overflow-hidden rounded-2xl border border-border bg-card text-left"
                      >
                        <div className="relative aspect-video w-full bg-black">
                          <img src={v.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                          {v.isLive ? (
                            <span className="absolute left-2 top-2 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">● live</span>
                          ) : null}
                        </div>
                        <div className="p-2">
                          <div className="truncate text-xs font-semibold">{v.channelName}</div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
                })}
              </>
            );
          })()}
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        Live streams from official public YouTube channels. ONIQ does not host or own this content 🌐
      </p>
    </section>
  );
}

// ============================================================
// DEVOTIONAL RADIO — real internet radio via Radio Browser
// ============================================================

type RadioStation = { faith: FaithId; name: string; streamUrl: string; favicon: string | null; tags: string[] };

function DevotionalRadioSection({ religion }: { religion: Religion | null }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useMemo(() => ({ current: null as HTMLAudioElement | null }), []);

  const { data, isLoading } = useQuery({
    queryKey: ["blessed-devotional-radio"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("devotional-radio", { body: {} });
      if (error) throw error;
      const stations: RadioStation[] = Array.isArray(data?.stations) ? data.stations : [];
      return stations;
    },
  });

  useEffect(() => () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } }, [audioRef]);

  const toggle = (s: RadioStation) => {
    if (playing === s.streamUrl) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(s.streamUrl);
    audio.crossOrigin = "anonymous";
    audio.play().catch(() => { setPlaying(null); });
    audioRef.current = audio;
    setPlaying(s.streamUrl);
  };

  const stations = data ?? [];
  const hasAny = stations.length > 0;

  return (
    <section className="mt-10">
      <div className="mb-3">
        <div className="text-[11px] uppercase tracking-wider text-primary/80">live radio 📻</div>
        <h2 className="font-display text-lg font-bold">24/7 internet radio</h2>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">scanning the airwaves…</div>
      ) : !hasAny ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">no reachable stations right now 📡</div>
      ) : (
        <div className="space-y-5">
          {FAITH_META.filter((f) => {
            const only = religionToFaithId(religion);
            return only ? f.id === only : true;
          }).map((f) => {
            const items = stations.filter((s) => s.faith === f.id);
            if (items.length === 0) return null;
            return (
              <div key={f.id}>
                <div className="mb-2 text-sm font-semibold text-foreground/90">{f.label}</div>
                <ul className="space-y-2">
                  {items.map((s) => {
                    const isPlaying = playing === s.streamUrl;
                    return (
                      <li key={s.streamUrl}>
                        <button
                          type="button"
                          onClick={() => toggle(s)}
                          className="press flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left"
                        >
                          <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2">
                            {s.favicon ? (
                              <img src={s.favicon} alt="" className="h-full w-full object-cover" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                            ) : (
                              <span className="text-lg">📻</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{s.name}</div>
                            {s.tags.length > 0 && (
                              <div className="truncate text-[11px] text-muted-foreground">{s.tags.slice(0, 3).join(" · ")}</div>
                            )}
                          </div>
                          <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${isPlaying ? "bg-primary text-primary-foreground" : "bg-surface-2"}`}>
                            {isPlaying ? "⏸" : "▶"}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        Live internet radio via Radio Browser (community directory). ONIQ does not host or own these streams 🌐
      </p>
    </section>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`press flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium border ${active ? "bg-primary text-primary-foreground border-primary" : "bg-surface-2 border-border"}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ============================================================
// READ
// ============================================================

type BookDef = { book?: string; chapter: number; label: string };
const READ_INDEX: Record<Religion, { title: string; items: BookDef[] }> = {
  hindu: { title: "Bhagavad Gita", items: Array.from({ length: 18 }, (_, i) => ({ chapter: i + 1, label: `Chapter ${i + 1}` })) },
  islam: { title: "Al-Quran", items: [1,2,36,55,67,112,113,114].map((n) => ({ chapter: n, label: `Surah ${n}` })) },
  christian: { title: "Bible", items: [
    { book: "john", chapter: 3, label: "John 3" },
    { book: "matthew", chapter: 5, label: "Matthew 5" },
    { book: "psalms", chapter: 23, label: "Psalm 23" },
    { book: "romans", chapter: 8, label: "Romans 8" },
    { book: "genesis", chapter: 1, label: "Genesis 1" },
  ]},
  sikh: { title: "Gurbani", items: [{ chapter: 1, label: "Selected Passages" }] },
  buddhist: { title: "Dhammapada", items: [{ chapter: 1, label: "Selected Verses" }] },
  jewish: { title: "Torah", items: [
    { book: "Genesis", chapter: 1, label: "Genesis 1" },
    { book: "Exodus", chapter: 20, label: "Exodus 20" },
    { book: "Psalms", chapter: 23, label: "Psalms 23" },
    { book: "Deuteronomy", chapter: 6, label: "Deuteronomy 6" },
  ]},
};

function ReadSection({ religion }: { religion: Religion }) {
  const idx = READ_INDEX[religion];
  const [active, setActive] = useState<number>(0);
  useEffect(() => { setActive(0); }, [religion]);
  const sel = idx.items[active];

  const { data, isLoading, error } = useQuery({
    queryKey: ["faith", religion, sel?.book, sel?.chapter],
    enabled: !!sel,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("faith-scripture", {
        body: { religion, book: sel.book, chapter: sel.chapter },
      });
      if (error) throw error;
      return data as { title: string; verses: { ref: string; text: string; translation?: string }[]; note?: string };
    },
  });

  const prev = () => setActive((i) => Math.max(0, i - 1));
  const next = () => setActive((i) => Math.min(idx.items.length - 1, i + 1));

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 overflow-x-auto no-scrollbar">
        {idx.items.map((it, i) => (
          <button
            key={it.label}
            onClick={() => setActive(i)}
            className={`press shrink-0 rounded-full px-3 py-1 text-xs border ${active === i ? "bg-primary text-primary-foreground border-primary" : "bg-surface-2 border-border"}`}
          >
            {it.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-display text-lg font-bold">{data?.title || sel?.label || idx.title}</div>
          <div className="flex gap-1">
            <button onClick={prev} disabled={active === 0} className="press grid h-8 w-8 place-items-center rounded-full bg-surface-2 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={next} disabled={active === idx.items.length - 1} className="press grid h-8 w-8 place-items-center rounded-full bg-surface-2 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
        {isLoading && <div className="text-sm text-muted-foreground">loading verses…</div>}
        {error && <div className="text-sm text-amber-400">couldn't reach the scripture source — try again in a moment 🙏</div>}
        {data && (
          <div className="space-y-3">
            {data.note && <div className="text-[11px] text-muted-foreground">{data.note}</div>}
            {data.verses.map((v) => (
              <div key={v.ref} className="rounded-xl bg-surface-2/50 p-3">
                <div className="text-[11px] uppercase tracking-wider text-primary/80 mb-1">{v.ref}</div>
                <div className="text-sm leading-relaxed">{v.text}</div>
                {v.translation && <div className="mt-1 text-xs text-muted-foreground italic">{v.translation}</div>}
              </div>
            ))}
            {!data.verses.length && <div className="text-sm text-muted-foreground">no verses came back — try another chapter</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// LISTEN
// ============================================================

const LISTEN: Record<Religion, { label: string; url: string }[]> = {
  hindu: [
    { label: "Bhagavad Gita — LibriVox audiobook (archive.org)", url: "https://archive.org/details/bhagavad-gita_1502_librivox_201711" },
  ],
  islam: [
    { label: "Holy Quran — ʿAbd al-Raḥmān Al-Awsī (archive.org)", url: "https://archive.org/details/coranpro-abdurrahman-alausi" },
    { label: "Quran — Warsh narration, Al-Daghoshi (archive.org)", url: "https://archive.org/details/warsh_abdalkreem_daghoshi" },
  ],
  christian: [
    { label: "Psalms (KJV) — LibriVox audiobook (archive.org)", url: "https://archive.org/details/psalms_kjv_1202_librivox" },
    { label: "Deuteronomy (KJV) — LibriVox (archive.org)", url: "https://archive.org/details/deuteronomy_kjv_1110_librivox" },
  ],
  sikh: [
    { label: "Gurbani Kirtan (archive.org)", url: "https://archive.org/details/gurbani-kirtan" },
    { label: "Japji Sahib (archive.org)", url: "https://archive.org/details/JapjiSahib" },
    { label: "Asa Di Vaar (archive.org)", url: "https://archive.org/details/AsaDiVaar" },
    { label: "SikhNet Gurbani player", url: "https://www.sikhnet.com/gurbani" },
  ],
  buddhist: [
    { label: "Dhammapada — LibriVox audiobook (archive.org)", url: "https://archive.org/details/dhammapada_0707_librivox" },
    { label: "Dhammapada — alt reading (archive.org)", url: "https://archive.org/details/dhammapada_2105_librivox" },
  ],
  jewish: [
    { label: "Sefaria — audio texts library", url: "https://www.sefaria.org/texts/audio" },
    { label: "Psalms (KJV) — LibriVox audiobook (archive.org)", url: "https://archive.org/details/psalms_kjv_1202_librivox" },
  ],
};

function ListenSection({ religion }: { religion: Religion }) {
  const items = LISTEN[religion];
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.url}>
          <a
            href={it.url}
            target="_blank"
            rel="noopener noreferrer"
            className="press flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
          >
            <Headphones className="h-4 w-4 text-primary" />
            <span className="flex-1 text-sm">{it.label}</span>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </a>
        </li>
      ))}
      <li className="text-[11px] text-muted-foreground pt-1">audio hosted on LibriVox / archive.org — public domain 🌐</li>
    </ul>
  );
}

// ============================================================
// DATES
// ============================================================

type CalItem = { religion: Religion; name: string; date: string };

function DatesSection({ religion }: { religion: Religion }) {
  const { data } = useQuery({
    queryKey: ["faith-calendar-2026"],
    staleTime: Infinity,
    queryFn: async () => {
      const r = await fetch("/faith-calendar-2026.json");
      return (await r.json()) as CalItem[];
    },
  });
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const items = (data ?? []).filter((d) => d.religion === religion).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div>
      <div className="mb-2 text-[11px] text-muted-foreground">dates may vary by region 🌙</div>
      <ul className="space-y-2">
        {items.map((it) => {
          const days = Math.round((new Date(it.date).getTime() - new Date(today).getTime()) / 86400000);
          const past = days < 0;
          return (
            <li key={`${it.name}-${it.date}`} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-surface-2 text-xs font-semibold">
                {new Date(it.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{it.name}</div>
                <div className="text-[11px] text-muted-foreground">{it.date}</div>
              </div>
              <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${past ? "bg-surface-2 text-muted-foreground" : days <= 30 ? "bg-primary/20 text-primary" : "bg-surface-2 text-foreground"}`}>
                {past ? "past" : days === 0 ? "today ✨" : `in ${days}d`}
              </span>
            </li>
          );
        })}
        {!items.length && <li className="text-sm text-muted-foreground">no dates yet</li>}
      </ul>
    </div>
  );
}

// ============================================================
// SHOP
// ============================================================

const SHOP: Record<Religion, { label: string; desc: string; url: string }[]> = {
  hindu: [
    { label: "Vedic Vaani", desc: "puja samagri, idols, yajna kits — ships worldwide", url: "https://vedicvaani.com/" },
    { label: "Krishna Store", desc: "ISKCON devotional books, deity wear, japa malas", url: "https://krishnastore.com/" },
    { label: "Hindu Gallery", desc: "brass idols, temple decor, prayer accessories", url: "https://www.hindugallery.com/" },
    { label: "Exotic India Art", desc: "murtis, ritual items, sacred art", url: "https://www.exoticindiaart.com/" },
  ],
  islam: [
    { label: "Kitaabun", desc: "classical Islamic books, Quran editions, tafsir", url: "https://kitaabun.com/" },
    { label: "Islamic Bookstore", desc: "Quran, hadith, prayer mats, tasbeeh", url: "https://islamicbookstore.com/" },
    { label: "Islamic Goods", desc: "prayer rugs, thobes, hijabs, attar", url: "https://www.islamicgoods.com/" },
    { label: "Hidaya (India)", desc: "Islamic essentials — books, mats, itr", url: "https://www.hidaya.in/" },
  ],
  christian: [
    { label: "Bible Society of India", desc: "Bibles in every Indian language", url: "https://www.biblesociety.in/" },
    { label: "Christian Art Gifts", desc: "devotionals, journals, wall art, gifts", url: "https://www.christianartgifts.com/" },
    { label: "St Pauls India", desc: "catholic books, rosaries, sacramentals", url: "https://stpauls.in/" },
  ],
  sikh: [
    { label: "Sikh Book Club", desc: "gurbani books, pothis, sikh literature", url: "https://sikhbookclub.com/" },
    { label: "Singh Brothers Amritsar", desc: "gutkas, saroops, sikh publications", url: "https://www.singhbrothers.com/" },
  ],
  buddhist: [
    { label: "Tibet Shop", desc: "prayer wheels, thangkas, singing bowls", url: "https://www.tibetshop.com/" },
    { label: "Exotic India — Buddhist", desc: "buddha statues, malas, ritual items", url: "https://www.exoticindiaart.com/" },
  ],
  jewish: [
    { label: "A Holy Land", desc: "judaica from Israel — mezuzahs, tallits, menorahs", url: "https://www.aholyland.com/" },
    { label: "Judaism.com", desc: "seforim, kippot, shabbat & holiday essentials", url: "https://www.judaism.com/" },
  ],
};

function ShopSection({ religion }: { religion: Religion }) {
  const items = SHOP[religion];
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.url}>
          <a
            href={it.url}
            target="_blank"
            rel="noopener noreferrer"
            className="press w-full flex items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left"
          >
            <ShoppingBag className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{it.label}</div>
              <div className="text-[11px] text-muted-foreground truncate">{it.desc}</div>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
          </a>
        </li>
      ))}
      <li className="text-[11px] text-muted-foreground pt-1">opens third-party stores — ONIQ doesn't sell these items 🛍</li>
    </ul>
  );
}
