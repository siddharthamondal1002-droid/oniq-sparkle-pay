import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Radio, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  image?: string;
};

function relTime(iso: string): string {
  if (!iso) return "just now";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (isNaN(diffMs)) return "just now";
  const m = Math.max(1, Math.round(diffMs / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function useLiveNews() {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("news", {
          body: { category: "top" },
        });
        if (!alive) return;
        if (error) throw error;
        const list: NewsItem[] = Array.isArray(data?.items) ? data.items.slice(0, 10) : [];
        if (list.length === 0) setFailed(true);
        else setItems(list);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!items || items.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 5000);
    return () => clearInterval(t);
  }, [items]);

  return { items, failed, idx };
}

export function CompactLiveNews() {
  const { items, failed, idx } = useLiveNews();
  const navigate = useNavigate();
  if (failed) return null;
  const current = items?.[idx];
  return (
    <button
      onClick={() => navigate({ to: "/app/news" })}
      className="press glass fade-up mt-5 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors"
      aria-label="Open Pulse news"
    >
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-400">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
        </span>
        LIVE
      </span>
      <span className="text-xs font-semibold text-primary">Pulse</span>
      <div className="min-w-0 flex-1">
        {!current ? (
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
        ) : (
          <>
            <div className="truncate text-sm font-medium text-foreground">{current.title}</div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {current.source} · {relTime(current.publishedAt)}
            </div>
          </>
        )}
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ---- Watch Live (YouTube official live embeds) ----
type Channel = { id: string; name: string };
const LIVE_CHANNELS: Channel[] = [
  { id: "UCNye-wNBqNL5ZzHSJj3l8Bg", name: "Al Jazeera" },
  { id: "UCknLrEdhRCp1aegoMqRaCZg", name: "DW News" },
  { id: "UCQfwfsi5VrQ8yKZ-UWmAEFg", name: "France 24" },
  { id: "UCoMdktPbSTixAyNGwb-UYkQ", name: "Sky News" },
  { id: "UC83jt4dlz1Gjl58fzQrrKZg", name: "CNA" },
  { id: "UC_gUM8rL-Lrg6O3adPW9K1g", name: "WION" },
  { id: "UCZFMm1mMw0F81Z37aaEzTUA", name: "NDTV 24x7" },
  { id: "UCYPvAwZP8pZhSMW8qs7cVCw", name: "India Today" },
];

const YT_API_SRC = "https://www.youtube.com/iframe_api";

function loadYouTubeApi(): Promise<any> {
  const w = window as any;
  if (w.YT && w.YT.Player) return Promise.resolve(w.YT);
  if (w.__ytApiPromise) return w.__ytApiPromise;
  w.__ytApiPromise = new Promise((resolve) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") try { prev(); } catch { /* noop */ }
      resolve(w.YT);
    };
    if (!document.querySelector(`script[src="${YT_API_SRC}"]`)) {
      const s = document.createElement("script");
      s.src = YT_API_SRC;
      s.async = true;
      document.head.appendChild(s);
    }
  });
  return w.__ytApiPromise;
}

export function WatchLive() {
  const [idx, setIdx] = useState(0);
  const [allDead, setAllDead] = useState(false);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const failStreakRef = useRef(0);
  const advanceTimerRef = useRef<number | null>(null);

  const ch = LIVE_CHANNELS[idx];

  const advance = (reason: "error" | "ended") => {
    failStreakRef.current += reason === "error" ? 1 : 0;
    if (failStreakRef.current >= LIVE_CHANNELS.length) {
      setAllDead(true);
      return;
    }
    if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = window.setTimeout(() => {
      setIdx((i) => (i + 1) % LIVE_CHANNELS.length);
    }, 800);
  };

  const pickChannel = (i: number) => {
    failStreakRef.current = 0;
    setAllDead(false);
    setIdx(i);
  };

  useEffect(() => {
    if (allDead) return;
    let cancelled = false;
    const host = mountRef.current;
    if (!host) return;
    host.innerHTML = "";
    const div = document.createElement("div");
    div.id = `yt-live-${Date.now()}`;
    host.appendChild(div);

    loadYouTubeApi().then((YT) => {
      if (cancelled || !YT) return;
      try {
        playerRef.current = new YT.Player(div.id, {
          width: "100%",
          height: "100%",
          host: "https://www.youtube-nocookie.com",
          playerVars: {
            channel: ch.id,
            live: 1,
            autoplay: 1,
            mute: 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onReady: (e: any) => { try { e.target.playVideo(); } catch { /* noop */ } },
            onError: (e: any) => {
              // 2 invalid param, 5 html5 err, 100 not found, 101/150 embed disabled
              console.warn("[WatchLive] error", e?.data, "for", ch.name);
              advance("error");
            },
            onStateChange: (e: any) => {
              if (e?.data === 0) advance("ended"); // ENDED
              if (e?.data === 1) failStreakRef.current = 0; // PLAYING
            },
          },
        });
      } catch (err) {
        console.warn("[WatchLive] player init failed", err);
        advance("error");
      }
    });

    return () => {
      cancelled = true;
      if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
      try { playerRef.current?.destroy?.(); } catch { /* noop */ }
      playerRef.current = null;
      if (host) host.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch.id, allDead]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {LIVE_CHANNELS.map((c, i) => {
          const active = c.id === ch.id && !allDead;
          return (
            <button
              key={c.id}
              onClick={() => pickChannel(i)}
              className={`press whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary shadow-[0_0_16px_-4px_var(--primary)]"
                  : "bg-surface text-muted-foreground border-border hover:text-foreground"
              }`}
            >
              {c.name}
            </button>
          );
        })}
        <button
          onClick={() => {
            if (allDead) { setAllDead(false); setIdx(0); failStreakRef.current = 0; return; }
            setIdx((i) => (i + 1) % LIVE_CHANNELS.length);
          }}
          className="press ml-auto inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-medium hover:text-foreground"
          aria-label="Next channel"
        >
          <SkipForward className="h-3 w-3" /> Next
        </button>
      </div>
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-border bg-black">
        {allDead ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">
            streams are napping — try later 📺
          </div>
        ) : (
          <div ref={mountRef} className="h-full w-full" />
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Live streams by broadcasters via YouTube
      </p>
    </div>
  );
}

export function LiveNewsSection() {
  const { items, failed, idx } = useLiveNews();

  const tickerItems = useMemo(() => (items ? items.slice(1) : []), [items]);
  const tickerText = useMemo(
    () => tickerItems.map((it) => `${it.title}  ·  ${it.source}`).join("   •   "),
    [tickerItems],
  );

  if (failed) return null;

  const current = items?.[idx];

  const open = (url: string) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="relative overflow-hidden py-16 md:py-20">
      <div className="pointer-events-none absolute -left-24 top-10 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-10 h-72 w-72 rounded-full bg-fuchsia-500/15 blur-3xl" />

      <div className="relative mx-auto max-w-6xl px-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            LIVE
          </span>
          <h2 className="font-display text-2xl font-bold md:text-3xl">
            Pulse <span aria-hidden>📰</span>{" "}
            <span className="text-muted-foreground">— happening right now</span>
          </h2>
        </div>

        <div className="mt-6 rounded-3xl border border-border bg-[image:var(--gradient-card)] p-6 md:p-8 shadow-card">
          {!items ? (
            <div className="animate-pulse space-y-4">
              <div className="h-4 w-32 rounded bg-muted" />
              <div className="h-8 w-3/4 rounded bg-muted" />
              <div className="h-8 w-2/3 rounded bg-muted" />
              <div className="h-4 w-40 rounded bg-muted" />
            </div>
          ) : (
            current && (
              <div className="min-h-[9rem] flex gap-6">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 font-semibold text-primary">
                      <Radio className="h-3 w-3" /> {current.source}
                    </span>
                    <span className="text-muted-foreground">{relTime(current.publishedAt)}</span>
                  </div>
                  <button
                    key={idx}
                    onClick={() => open(current.link)}
                    className="mt-4 block w-full text-left font-display text-2xl font-bold leading-snug tracking-tight animate-fade-in md:text-4xl hover:text-primary transition-colors"
                  >
                    {current.title}
                  </button>
                  <div className="mt-6 flex items-center gap-1.5">
                    {items.map((_, i) => (
                      <span
                        key={i}
                        className={`h-1 rounded-full transition-all ${
                          i === idx ? "w-6 bg-primary" : "w-1.5 bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                </div>
                {current.image && (
                  <img
                    key={current.image}
                    src={current.image}
                    alt=""
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    className="hidden md:block h-40 w-56 shrink-0 rounded-2xl object-cover animate-fade-in"
                  />
                )}
              </div>
            )
          )}
        </div>

        {/* Watch Live */}
        <div className="mt-8">
          <div className="mb-3 text-sm font-semibold text-foreground">
            Watch Live <span aria-hidden>📺</span>
          </div>
          <WatchLive />
        </div>

        {tickerText && (
          <div
            className="group relative mt-6 overflow-hidden rounded-full border border-border bg-surface/60 py-2.5"
            aria-label="More headlines"
          >
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-background to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-background to-transparent" />
            <div className="oniq-ticker-track flex min-w-max whitespace-nowrap text-sm text-muted-foreground group-hover:[animation-play-state:paused]">
              {[0, 1].map((k) => (
                <div key={k} className="flex shrink-0 items-center gap-6 px-6" aria-hidden={k === 1}>
                  {tickerItems.map((it, i) => (
                    <button
                      key={`${k}-${i}`}
                      onClick={() => open(it.link)}
                      className="hover:text-primary transition-colors"
                    >
                      <span className="font-medium text-foreground">{it.title}</span>
                      <span className="ml-2 text-primary">· {it.source}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-center">
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 glow"
          >
            Read it all in ONIQ <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <style>{`
        @keyframes oniq-ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .oniq-ticker-track { animation: oniq-ticker 45s linear infinite; }
      `}</style>
    </section>
  );
}
