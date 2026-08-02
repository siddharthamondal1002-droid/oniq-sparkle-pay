import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  BookOpen,
  Headphones,
  Calendar as CalIcon,
  ShoppingBag,
  ArrowLeft,
  Video,
} from "lucide-react";
import { resolveTileLabel } from "@/lib/i18n/tileLabel";
import { itemsForFaith, type FaithId } from "@/data/faithContent";
import { useT } from "@/lib/i18n/LanguageProvider";

export const Route = createFileRoute("/_authenticated/app/faith")({
  component: FaithPage,
});

type Religion = "hindu" | "islam" | "christian" | "sikh" | "buddhist" | "jain" | "jewish";
const RELIGIONS: { key: Religion; label: string; labelHi: string; emoji: string }[] = [
  { key: "hindu", label: "Hindu", labelHi: "हिन्दू", emoji: "🕉" },
  { key: "islam", label: "Islam", labelHi: "इस्लाम", emoji: "☪️" },
  { key: "christian", label: "Christian", labelHi: "ईसाई", emoji: "✝️" },
  { key: "sikh", label: "Sikh", labelHi: "सिख", emoji: "🪯" },
  { key: "buddhist", label: "Buddhist", labelHi: "बौद्ध", emoji: "☸️" },
  { key: "jain", label: "Jain", labelHi: "जैन", emoji: "🖐️" },
  { key: "jewish", label: "Jewish", labelHi: "यहूदी", emoji: "✡️" },
];

const LS_KEY = "oniq.faith.religion.v1";
type Section = "read" | "listen" | "dates" | "shop" | "watch";

function FaithPage() {
  const [religion, setReligion] = useState<Religion | null>(null);
  const [section, setSection] = useState<Section>("read");
  const { lang } = useT();

  useEffect(() => {
    try {
      const r = localStorage.getItem(LS_KEY) as Religion | null;
      if (r) setReligion(r);
    } catch {
      /* noop */
    }
  }, []);

  const pick = (r: Religion) => {
    setReligion(r);
    try {
      localStorage.setItem(LS_KEY, r);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="min-h-screen pb-24">
      <div className="px-5 pt-[max(3rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <Link
            to="/app"
            aria-label="Back"
            className="press grid h-9 w-9 place-items-center rounded-full bg-surface-2"
          >
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
              <span className="mr-1">{r.emoji}</span>
              {resolveTileLabel(lang, r.label, r.labelHi)}
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
              <TabBtn
                active={section === "read"}
                onClick={() => setSection("read")}
                icon={<BookOpen className="h-4 w-4" />}
                label="read 📖"
              />
              <TabBtn
                active={section === "listen"}
                onClick={() => setSection("listen")}
                icon={<Headphones className="h-4 w-4" />}
                label="listen 🎧"
              />
              <TabBtn
                active={section === "dates"}
                onClick={() => setSection("dates")}
                icon={<CalIcon className="h-4 w-4" />}
                label="dates 🗓"
              />
              <TabBtn
                active={section === "shop"}
                onClick={() => setSection("shop")}
                icon={<ShoppingBag className="h-4 w-4" />}
                label="shop 🛍"
              />
              <TabBtn
                active={section === "watch"}
                onClick={() => setSection("watch")}
                icon={<Video className="h-4 w-4" />}
                label="watch 🎥"
              />
            </div>

            <div className="mt-5">
              {section === "read" && <ReadSection religion={religion} />}
              {section === "listen" && (
                <>
                  <ListenSection religion={religion} />
                  <DevotionalRadioSection religion={religion} />
                </>
              )}
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

type LiveVideo = {
  videoId: string;
  title: string;
  channelName: string;
  publishedAt: string;
  thumbnail: string;
  isLive?: boolean;
  faith?: FaithId;
};
type LiveGenreResp = {
  id: string;
  name: string;
  emoji: string;
  live: boolean;
  videos: LiveVideo[];
};

const FAITH_META: { id: FaithId; label: string }[] = [
  { id: "islamic", label: "🕌 Islamic" },
  { id: "sikh", label: "🪯 Sikh" },
  { id: "hindu", label: "🕉️ Hindu" },
  { id: "christian", label: "✝️ Christian" },
  { id: "buddhist", label: "☸️ Buddhist" },
  { id: "jain", label: "🖐️ Jain" },
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
    religion === "jain" ||
    religion === "jewish"
  )
    return religion;
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
            Video content is hosted by YouTube and owned by the respective creators/channels —
            played via YouTube's official embedded player. Rights-holders can report a specific
            video or channel via{" "}
            <Link to="/app/privacy/grievance" className="underline">
              Privacy → Grievance
            </Link>{" "}
            (category: Content takedown).
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* STRICT faith isolation: only the selected faith's own channels
              may render here. On a miss, show this faith's empty state —
              never another faith's content (that was the Jain bleed bug). */}
          {(() => {
            const only = religionToFaithId(religion);
            const items = itemsForFaith(data.videos, only);
            if (items.length === 0) {
              return (
                <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
                  no {FAITH_META.find((f) => f.id === only)?.label ?? "devotional"} streams right
                  now — check back later 🌙
                </div>
              );
            }
            return (
              <div>
                <ul className="grid grid-cols-2 gap-2">
                  {items.map((v) => (
                    <li key={v.videoId}>
                      <button
                        type="button"
                        onClick={() => setPlaying(v)}
                        className="press w-full overflow-hidden rounded-2xl border border-border bg-card text-left"
                      >
                        <div className="relative aspect-video w-full bg-black">
                          <img
                            src={v.thumbnail}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                            loading="lazy"
                          />
                          {v.isLive ? (
                            <span className="absolute left-2 top-2 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                              ● live
                            </span>
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
          })()}
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        Live streams from official public YouTube channels. ONIQ does not host or own this content
        🌐
      </p>
    </section>
  );
}

// ============================================================
// DEVOTIONAL RADIO — real internet radio via Radio Browser
// ============================================================

type RadioStation = {
  faith: FaithId;
  name: string;
  streamUrl: string;
  favicon: string | null;
  tags: string[];
};

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

  useEffect(
    () => () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    },
    [audioRef],
  );

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
    audio.play().catch(() => {
      setPlaying(null);
    });
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
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          scanning the airwaves…
        </div>
      ) : !hasAny ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          no reachable stations right now 📡
        </div>
      ) : (
        <div className="space-y-5">
          {FAITH_META.filter((f) => {
            const only = religionToFaithId(religion);
            return only ? f.id === only : true;
          }).map((f) => {
            const items = itemsForFaith(stations, f.id);
            if (items.length === 0)
              return (
                <div
                  key={f.id}
                  className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground"
                >
                  no {f.label} stations right now 📡
                </div>
              );
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
                              <img
                                src={s.favicon}
                                alt=""
                                className="h-full w-full object-cover"
                                loading="lazy"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : (
                              <span className="text-lg">📻</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{s.name}</div>
                            {s.tags.length > 0 && (
                              <div className="truncate text-[11px] text-muted-foreground">
                                {s.tags.slice(0, 3).join(" · ")}
                              </div>
                            )}
                          </div>
                          <div
                            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${isPlaying ? "bg-primary text-primary-foreground" : "bg-surface-2"}`}
                          >
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
        Live internet radio via Radio Browser (community directory). ONIQ does not host or own these
        streams 🌐
      </p>
    </section>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
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

type LocalVerse = { ref: string; text: string; roman?: string; translation?: string };
type BookDef = {
  book?: string;
  chapter: number;
  label: string;
  verses?: LocalVerse[];
  tradition?: "shared" | "digambar" | "shwetambar";
};
export const READ_INDEX: Record<Religion, { title: string; items: BookDef[] }> = {
  hindu: {
    title: "Bhagavad Gita",
    items: Array.from({ length: 18 }, (_, i) => ({ chapter: i + 1, label: `Chapter ${i + 1}` })),
  },
  islam: {
    title: "Al-Quran",
    items: [1, 2, 36, 55, 67, 112, 113, 114].map((n) => ({ chapter: n, label: `Surah ${n}` })),
  },
  christian: {
    title: "Bible",
    items: [
      { book: "john", chapter: 3, label: "John 3" },
      { book: "matthew", chapter: 5, label: "Matthew 5" },
      { book: "psalms", chapter: 23, label: "Psalm 23" },
      { book: "romans", chapter: 8, label: "Romans 8" },
      { book: "genesis", chapter: 1, label: "Genesis 1" },
    ],
  },
  sikh: { title: "Gurbani", items: [{ chapter: 1, label: "Selected Passages" }] },
  buddhist: { title: "Dhammapada", items: [{ chapter: 1, label: "Selected Verses" }] },
  // Jain readings are served locally (public-domain originals with plain
  // renderings) — the remote scripture source has no Jain corpus yet.
  // Jain readings — served locally (ancient originals are public domain;
  // meanings are plain summaries in ONIQ's own words, no copied translations).
  // SECT BALANCE: every entry is tagged shared / digambar / shwetambar and
  // both traditions are represented — enforced by the healSafety test suite.
  jain: {
    title: "Jain Paath",
    items: [
      {
        chapter: 1,
        label: "Namokar Mantra",
        tradition: "shared",
        verses: [
          {
            ref: "1",
            text: "णमो अरिहंताणं",
            roman: "Ṇamo Arihantāṇaṁ",
            translation: "I bow to the Arihants — the victors over their inner enemies.",
          },
          {
            ref: "2",
            text: "णमो सिद्धाणं",
            roman: "Ṇamo Siddhāṇaṁ",
            translation: "I bow to the Siddhas — the liberated souls.",
          },
          {
            ref: "3",
            text: "णमो आयरियाणं",
            roman: "Ṇamo Āyariyāṇaṁ",
            translation: "I bow to the Acharyas — the spiritual leaders.",
          },
          {
            ref: "4",
            text: "णमो उवज्झायाणं",
            roman: "Ṇamo Uvajjhāyāṇaṁ",
            translation: "I bow to the Upadhyayas — the teachers of scripture.",
          },
          {
            ref: "5",
            text: "णमो लोए सव्वसाहूणं",
            roman: "Ṇamo Loe Savva-Sāhūṇaṁ",
            translation: "I bow to all the Sadhus in the world — the seekers on the path.",
          },
          {
            ref: "6",
            text: "एसो पंच णमोक्कारो, सव्वपावप्पणासणो",
            roman: "Eso pañca ṇamokkāro, savva-pāva-ppaṇāsaṇo",
            translation: "This five-fold salutation destroys all sins.",
          },
          {
            ref: "7",
            text: "मंगलाणं च सव्वेसिं, पढमं हवइ मंगलं",
            roman: "Maṅgalāṇaṁ ca savvesiṁ, paḍhamaṁ havai maṅgalaṁ",
            translation:
              "Of all that is auspicious, it is the foremost. It salutes qualities, not individuals — every Jain tradition shares it.",
          },
        ],
      },
      {
        chapter: 2,
        label: "Tattvartha Sutra",
        tradition: "shared",
        verses: [
          {
            ref: "1.1",
            text: "सम्यग्दर्शनज्ञानचारित्राणि मोक्षमार्गः",
            roman: "Samyag-darśana-jñāna-cāritrāṇi mokṣa-mārgaḥ",
            translation:
              "Right faith, right knowledge and right conduct — together, the path to liberation. Umaswami's work is the one text both traditions accept.",
          },
          {
            ref: "1.2",
            text: "तत्त्वार्थश्रद्धानं सम्यग्दर्शनम्",
            roman: "Tattvārtha-śraddhānaṁ samyag-darśanam",
            translation: "Belief in the true nature of reality is right faith.",
          },
          {
            ref: "1.4",
            text: "जीवाजीवास्रवबन्धसंवरनिर्जरामोक्षास्तत्त्वम्",
            roman: "Jīva-ajīva-āsrava-bandha-saṁvara-nirjarā-mokṣāḥ tattvam",
            translation:
              "The seven realities: soul, non-soul, inflow, bondage, stoppage, shedding, liberation.",
          },
          {
            ref: "5.21",
            text: "परस्परोपग्रहो जीवानाम्",
            roman: "Parasparopagraho jīvānām",
            translation: "Souls exist to help one another — the Jain motto.",
          },
        ],
      },
      {
        chapter: 3,
        label: "Ratnatraya — the Three Jewels",
        tradition: "shared",
        verses: [
          {
            ref: "1",
            text: "सम्यग्दर्शन",
            roman: "Samyag-darśana",
            translation: "Right faith — seeing reality as it is, without distortion.",
          },
          {
            ref: "2",
            text: "सम्यग्ज्ञान",
            roman: "Samyag-jñāna",
            translation: "Right knowledge — understanding the nature of soul and non-soul.",
          },
          {
            ref: "3",
            text: "सम्यक्चारित्र",
            roman: "Samyak-cāritra",
            translation:
              "Right conduct — living what one knows to be true. The three together are the frame everything else in Jain practice hangs on.",
          },
        ],
      },
      {
        chapter: 4,
        label: "Anekantavada & Syadvada",
        tradition: "shared",
        verses: [
          {
            ref: "1",
            text: "अनेकान्तवाद",
            roman: "Anekāntavāda",
            translation:
              "Reality has many aspects — no single viewpoint captures the whole truth. The blind men and the elephant: each is partly right, none is completely right.",
          },
          {
            ref: "2",
            text: "स्याद्वाद",
            roman: "Syādvāda",
            translation:
              "Every statement is true conditionally — 'in some respect'. An invitation to intellectual humility: hold your view, and stay curious about the other person's.",
          },
        ],
      },
      {
        chapter: 5,
        label: "The Five Vows",
        tradition: "shared",
        verses: [
          {
            ref: "1",
            text: "अहिंसा",
            roman: "Ahiṁsā",
            translation:
              "Non-violence — cause no harm to any living being, in thought, word or deed.",
          },
          {
            ref: "2",
            text: "सत्य",
            roman: "Satya",
            translation: "Truth — speak what is true, kind and helpful.",
          },
          {
            ref: "3",
            text: "अस्तेय",
            roman: "Asteya",
            translation: "Non-stealing — take nothing that is not freely given.",
          },
          {
            ref: "4",
            text: "ब्रह्मचर्य",
            roman: "Brahmacharya",
            translation: "Chastity — restraint of the senses.",
          },
          {
            ref: "5",
            text: "अपरिग्रह",
            roman: "Aparigraha",
            translation:
              "Non-possessiveness — attachment to nothing, openness to all. Taken absolutely by ascetics (mahavratas) and in scaled-down form by householders (anuvratas).",
          },
        ],
      },
      {
        chapter: 6,
        label: "The Nine Tattvas",
        tradition: "shared",
        verses: [
          {
            ref: "1–2",
            text: "जीव · अजीव",
            roman: "Jīva · Ajīva",
            translation: "Soul and non-soul — the conscious and the inert.",
          },
          {
            ref: "3–4",
            text: "आस्रव · बन्ध",
            roman: "Āsrava · Bandha",
            translation: "Influx of karma, and its bondage to the soul.",
          },
          {
            ref: "5–6",
            text: "संवर · निर्जरा",
            roman: "Saṁvara · Nirjarā",
            translation: "Stopping new karma, and shedding what has accumulated.",
          },
          {
            ref: "7",
            text: "मोक्ष",
            roman: "Mokṣa",
            translation: "Liberation — the soul in its pure state.",
          },
          {
            ref: "8–9",
            text: "पुण्य · पाप",
            roman: "Puṇya · Pāpa",
            translation: "Merit and demerit — the two flavours of karmic result.",
          },
        ],
      },
      {
        chapter: 7,
        label: "Bhaktamar Stotra",
        tradition: "shared",
        verses: [
          {
            ref: "1",
            text: "भक्तामरप्रणतमौलिमणिप्रभाणा-मुद्योतकं दलितपापतमोवितानम्। सम्यक्प्रणम्य जिनपादयुगं युगादा-वालम्बनं भवजले पततां जनानाम्॥",
            roman: "Bhaktāmara-praṇata-maulimaṇi-prabhāṇām udyotakaṁ dalita-pāpa-tamo-vitānam...",
            translation:
              "The Jina's feet brighten the jewelled crowns of the bowing devas and tear apart the darkness of sin — refuge for all who are adrift. Opening of Manatunga's 48-verse hymn to Rishabhanatha, recited across both traditions.",
          },
        ],
      },
      {
        chapter: 8,
        label: "Michhami Dukkadam (Kshamavani)",
        tradition: "shared",
        verses: [
          {
            ref: "1",
            text: "खामेमि सव्वजीवे, सव्वे जीवा खमंतु मे",
            roman: "Khāmemi savva-jīve, savve jīvā khamantu me",
            translation: "I forgive all living beings; may all living beings forgive me.",
          },
          {
            ref: "2",
            text: "मित्ती मे सव्वभूएसु, वेरं मज्झ न केणवि",
            roman: "Mittī me savva-bhūesu, veraṁ majjha na keṇavi",
            translation: "My friendship is with all beings; my enmity is with none.",
          },
          {
            ref: "3",
            text: "मिच्छामि दुक्कडं",
            roman: "Micchāmi Dukkaḍaṁ",
            translation:
              "May any harm I have caused be without fruit. The forgiveness practice of Paryushana and Kshamavani — asking pardon of every living being.",
          },
        ],
      },
      {
        chapter: 9,
        label: "Kalpa Sutra",
        tradition: "shwetambar",
        verses: [
          {
            ref: "about",
            text: "कल्पसूत्र",
            roman: "Kalpa Sūtra — attributed to Bhadrabahu",
            translation:
              "Lives of the Tirthankaras, read publicly during Paryushana in Shwetambar tradition.",
          },
          {
            ref: "§118",
            text: "The Venerable Ascetic Mahāvīra was benevolent to all living beings.",
            translation:
              "From the account of Mahavira's conduct (tr. Jacobi, 1884, public domain).",
          },
          {
            ref: "§119",
            text: "With supreme knowledge, with supreme intuition, he meditated on himself — circumspect in walking, in speaking, in thought.",
            translation: "Care in every act, so that no being is harmed.",
          },
        ],
      },
      {
        chapter: 10,
        label: "Acharanga Sutra",
        tradition: "shwetambar",
        verses: [
          {
            ref: "about",
            text: "आचारांग सूत्र",
            roman: "Āchārāṅga Sūtra",
            translation:
              "The oldest of the Angas — the foundational text on ahimsa and ascetic conduct.",
          },
          {
            ref: "I.4.1",
            text: "All breathing, existing, living, sentient creatures should not be slain, nor treated with violence, nor abused, nor tormented, nor driven away.",
            translation:
              "This is the pure, unchangeable, eternal law. (tr. Jacobi, 1884, public domain)",
          },
        ],
      },
      {
        chapter: 11,
        label: "Pratikraman & Samayik",
        tradition: "shwetambar",
        verses: [
          {
            ref: "1",
            text: "प्रतिक्रमण",
            roman: "Pratikraman",
            translation:
              "The daily practice of turning back — reviewing the day, acknowledging harm done, and returning to the path.",
          },
          {
            ref: "2",
            text: "सामायिक",
            roman: "Sāmāyik",
            translation:
              "48 minutes of equanimity — sitting apart from possessions and roles, treating all beings as equal. The householder's taste of the ascetic's calm.",
          },
        ],
      },
      {
        chapter: 12,
        label: "Samayasara",
        tradition: "digambar",
        verses: [
          {
            ref: "about",
            text: "समयसार",
            roman: "Samayasāra — Ācārya Kundakunda",
            translation:
              "The central Digambar work on the pure soul: the self in its true nature is consciousness itself, distinct from body, karma and every outer role. Kundakunda's call is to know that self directly.",
          },
        ],
      },
      {
        chapter: 13,
        label: "Shatkhandagama",
        tradition: "digambar",
        verses: [
          {
            ref: "about",
            text: "षट्खंडागम",
            roman: "Ṣaṭkhaṇḍāgama",
            translation:
              "The oldest surviving Digambar canonical text — 'the scripture in six parts', preserving the teaching traced to Mahavira through Ācārya Dharasena. Its opening benediction is the Namokar Mantra itself.",
          },
        ],
      },
      {
        chapter: 14,
        label: "Chhahdhala",
        tradition: "digambar",
        verses: [
          {
            ref: "about",
            text: "छहढाला",
            roman: "Chhahḍhālā — Pandit Daulatram",
            translation:
              "Six 'shields' in verse — a beloved Digambar primer that walks from the soul's wandering through wrong belief to the freedom of right faith, knowledge and conduct. Widely memorised and sung.",
          },
        ],
      },
    ],
  },
  jewish: {
    title: "Torah",
    items: [
      { book: "Genesis", chapter: 1, label: "Genesis 1" },
      { book: "Exodus", chapter: 20, label: "Exodus 20" },
      { book: "Psalms", chapter: 23, label: "Psalms 23" },
      { book: "Deuteronomy", chapter: 6, label: "Deuteronomy 6" },
    ],
  },
};

function ReadSection({ religion }: { religion: Religion }) {
  const idx = READ_INDEX[religion];
  const [active, setActive] = useState<number>(0);
  useEffect(() => {
    setActive(0);
  }, [religion]);
  const sel = idx.items[active];

  // Local readings (e.g. Jain) render without a network fetch; everything
  // else pulls from the scripture source keyed strictly on this religion.
  const {
    data: fetched,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["faith", religion, sel?.book, sel?.chapter],
    enabled: !!sel && !sel.verses,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("faith-scripture", {
        body: { religion, book: sel.book, chapter: sel.chapter },
      });
      if (error) throw error;
      return data as {
        title: string;
        verses: { ref: string; text: string; translation?: string }[];
        note?: string;
      };
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
            aria-label={`${it.label}${it.tradition && it.tradition !== "shared" ? ` — ${it.tradition === "digambar" ? "Digambar" : "Shwetambar"} tradition` : ""}`}
            className={`press shrink-0 rounded-full px-3 py-1 text-xs border ${active === i ? "bg-primary text-primary-foreground border-primary" : "bg-surface-2 border-border"}`}
          >
            {it.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-display text-lg font-bold">
              {(sel?.verses ? sel.label : fetched?.title) || sel?.label || idx.title}
            </div>
            {sel?.tradition && sel.tradition !== "shared" && (
              <span className="mt-0.5 inline-block rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {sel.tradition === "digambar" ? "Digambar" : "Shwetambar"}
              </span>
            )}
          </div>
          <div className="flex gap-1">
            <button
              onClick={prev}
              disabled={active === 0}
              className="press grid h-8 w-8 place-items-center rounded-full bg-surface-2 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={next}
              disabled={active === idx.items.length - 1}
              className="press grid h-8 w-8 place-items-center rounded-full bg-surface-2 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        {!sel?.verses && isLoading && (
          <div className="text-sm text-muted-foreground">loading verses…</div>
        )}
        {!sel?.verses && error && (
          <div className="text-sm text-amber-400">
            couldn't reach the scripture source — try again in a moment 🙏
          </div>
        )}
        {(() => {
          const view = sel?.verses
            ? { verses: sel.verses, note: undefined as string | undefined }
            : fetched;
          if (!view) return null;
          return (
            <div className="space-y-3">
              {view.note && <div className="text-[11px] text-muted-foreground">{view.note}</div>}
              {view.verses.map((v) => (
                <div key={v.ref} className="rounded-xl bg-surface-2/50 p-3">
                  <div className="text-[11px] uppercase tracking-wider text-primary/80 mb-1">
                    {v.ref}
                  </div>
                  <div
                    className="text-sm leading-relaxed"
                    lang={/[\u0900-\u097F]/.test(v.text) ? "hi" : undefined}
                  >
                    {v.text}
                  </div>
                  {"roman" in v && v.roman && (
                    <div className="mt-0.5 text-xs text-foreground/70">{v.roman}</div>
                  )}
                  {v.translation && (
                    <div className="mt-1 text-xs text-muted-foreground italic">{v.translation}</div>
                  )}
                </div>
              ))}
              {!view.verses.length && (
                <div className="text-sm text-muted-foreground">
                  no verses came back — try another chapter
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ============================================================
// LISTEN
// ============================================================

export const LISTEN: Record<Religion, { label: string; url: string }[]> = {
  hindu: [
    {
      label: "Bhagavad Gita — LibriVox audiobook (archive.org)",
      url: "https://archive.org/details/bhagavad-gita_1502_librivox_201711",
    },
  ],
  islam: [
    {
      label: "Holy Quran — ʿAbd al-Raḥmān Al-Awsī (archive.org)",
      url: "https://archive.org/details/coranpro-abdurrahman-alausi",
    },
    {
      label: "Quran — Warsh narration, Al-Daghoshi (archive.org)",
      url: "https://archive.org/details/warsh_abdalkreem_daghoshi",
    },
  ],
  christian: [
    {
      label: "Psalms (KJV) — LibriVox audiobook (archive.org)",
      url: "https://archive.org/details/psalms_kjv_1202_librivox",
    },
    {
      label: "Deuteronomy (KJV) — LibriVox (archive.org)",
      url: "https://archive.org/details/deuteronomy_kjv_1110_librivox",
    },
  ],
  sikh: [
    { label: "Gurbani Kirtan (archive.org)", url: "https://archive.org/details/gurbani-kirtan" },
    { label: "Japji Sahib (archive.org)", url: "https://archive.org/details/JapjiSahib" },
    { label: "Asa Di Vaar (archive.org)", url: "https://archive.org/details/AsaDiVaar" },
    { label: "SikhNet Gurbani player", url: "https://www.sikhnet.com/gurbani" },
  ],
  buddhist: [
    {
      label: "Dhammapada — LibriVox audiobook (archive.org)",
      url: "https://archive.org/details/dhammapada_0707_librivox",
    },
    {
      label: "Dhammapada — alt reading (archive.org)",
      url: "https://archive.org/details/dhammapada_2105_librivox",
    },
  ],
  jain: [
    {
      label: "Navkar Mantra & jain bhajans (archive.org)",
      url: "https://archive.org/search?query=navkar+mantra",
    },
    { label: "Vitragvani — pravachans & shastra audio", url: "https://www.vitragvani.com" },
  ],
  jewish: [
    { label: "Sefaria — audio texts library", url: "https://www.sefaria.org/texts/audio" },
    {
      label: "Psalms (KJV) — LibriVox audiobook (archive.org)",
      url: "https://archive.org/details/psalms_kjv_1202_librivox",
    },
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
      <li className="text-[11px] text-muted-foreground pt-1">
        audio hosted on LibriVox / archive.org — public domain 🌐
      </li>
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
  const items = (data ?? [])
    .filter((d) => d.religion === religion)
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div>
      <div className="mb-2 text-[11px] text-muted-foreground">dates may vary by region 🌙</div>
      <ul className="space-y-2">
        {items.map((it) => {
          const days = Math.round(
            (new Date(it.date).getTime() - new Date(today).getTime()) / 86400000,
          );
          const past = days < 0;
          return (
            <li
              key={`${it.name}-${it.date}`}
              className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
            >
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-surface-2 text-xs font-semibold">
                {new Date(it.date).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{it.name}</div>
                <div className="text-[11px] text-muted-foreground">{it.date}</div>
              </div>
              <span
                className={`rounded-full px-2 py-1 text-[11px] font-semibold ${past ? "bg-surface-2 text-muted-foreground" : days <= 30 ? "bg-primary/20 text-primary" : "bg-surface-2 text-foreground"}`}
              >
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

export const SHOP: Record<Religion, { label: string; desc: string; url: string }[]> = {
  hindu: [
    {
      label: "Vedic Vaani",
      desc: "puja samagri, idols, yajna kits — ships worldwide",
      url: "https://vedicvaani.com/",
    },
    {
      label: "Krishna Store",
      desc: "ISKCON devotional books, deity wear, japa malas",
      url: "https://krishnastore.com/",
    },
    {
      label: "Hindu Gallery",
      desc: "brass idols, temple decor, prayer accessories",
      url: "https://www.hindugallery.com/",
    },
    {
      label: "Exotic India Art",
      desc: "murtis, ritual items, sacred art",
      url: "https://www.exoticindiaart.com/",
    },
  ],
  islam: [
    {
      label: "Kitaabun",
      desc: "classical Islamic books, Quran editions, tafsir",
      url: "https://kitaabun.com/",
    },
    {
      label: "Islamic Bookstore",
      desc: "Quran, hadith, prayer mats, tasbeeh",
      url: "https://islamicbookstore.com/",
    },
    {
      label: "Islamic Goods",
      desc: "prayer rugs, thobes, hijabs, attar",
      url: "https://www.islamicgoods.com/",
    },
    {
      label: "Hidaya (India)",
      desc: "Islamic essentials — books, mats, itr",
      url: "https://www.hidaya.in/",
    },
  ],
  christian: [
    {
      label: "Bible Society of India",
      desc: "Bibles in every Indian language",
      url: "https://www.biblesociety.in/",
    },
    {
      label: "Christian Art Gifts",
      desc: "devotionals, journals, wall art, gifts",
      url: "https://www.christianartgifts.com/",
    },
    {
      label: "St Pauls India",
      desc: "catholic books, rosaries, sacramentals",
      url: "https://stpauls.in/",
    },
  ],
  sikh: [
    {
      label: "Sikh Book Club",
      desc: "gurbani books, pothis, sikh literature",
      url: "https://sikhbookclub.com/",
    },
    {
      label: "Singh Brothers Amritsar",
      desc: "gutkas, saroops, sikh publications",
      url: "https://www.singhbrothers.com/",
    },
  ],
  buddhist: [
    {
      label: "Tibet Shop",
      desc: "prayer wheels, thangkas, singing bowls",
      url: "https://www.tibetshop.com/",
    },
    {
      label: "Exotic India — Buddhist",
      desc: "buddha statues, malas, ritual items",
      url: "https://www.exoticindiaart.com/",
    },
  ],
  jain: [
    {
      label: "Exotic India — Jain",
      desc: "jain murtis, books, ritual items",
      url: "https://www.exoticindiaart.com/",
    },
    {
      label: "Vitragvani Store",
      desc: "jain shastras, pravachan media",
      url: "https://www.vitragvani.com/",
    },
  ],
  jewish: [
    {
      label: "A Holy Land",
      desc: "judaica from Israel — mezuzahs, tallits, menorahs",
      url: "https://www.aholyland.com/",
    },
    {
      label: "Judaism.com",
      desc: "seforim, kippot, shabbat & holiday essentials",
      url: "https://www.judaism.com/",
    },
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
      <li className="text-[11px] text-muted-foreground pt-1">
        opens third-party stores — ONIQ doesn't sell these items 🛍
      </li>
    </ul>
  );
}
