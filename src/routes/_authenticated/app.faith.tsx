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
  Play,
  Video,
} from "lucide-react";
import { resolveTileLabel } from "@/lib/i18n/tileLabel";
import { itemsForFaith, type FaithId } from "@/data/faithContent";
import { WATCH_NOTICE, faithChannelsFor, playableOfChannelId } from "@/data/watchDirectory";
import {
  FAITH_LS_KEY,
  religionToFaithId as sharedReligionToFaithId,
  type Religion,
} from "@/lib/devotionalLoop";
import { WatchPlayer } from "@/components/watch/WatchPlayer";
import { openInApp } from "@/lib/miniapps";
import { useT } from "@/lib/i18n/LanguageProvider";

export const Route = createFileRoute("/_authenticated/app/faith")({
  component: FaithPage,
});

const RELIGIONS: { key: Religion; label: string; labelHi: string; emoji: string }[] = [
  { key: "hindu", label: "Hindu", labelHi: "हिन्दू", emoji: "🕉" },
  { key: "islam", label: "Islam", labelHi: "इस्लाम", emoji: "☪️" },
  { key: "christian", label: "Christian", labelHi: "ईसाई", emoji: "✝️" },
  { key: "sikh", label: "Sikh", labelHi: "सिख", emoji: "🪯" },
  { key: "buddhist", label: "Buddhist", labelHi: "बौद्ध", emoji: "☸️" },
  { key: "jain", label: "Jain", labelHi: "जैन", emoji: "🖐️" },
  { key: "jewish", label: "Jewish", labelHi: "यहूदी", emoji: "✡️" },
];

// The key Watch and Home read the user's faith from. Defined once, there.
const LS_KEY = FAITH_LS_KEY;
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
// DEVOTIONAL — channels play here; radio stays a directory.
// ============================================================
//
// The two halves are NOT the same case, and the difference is the whole
// reason only one of them changed on 2026-08-16.
//
// CHANNELS play again, in YouTube's own embedded player. YouTube serves the
// video, its ads, and its own geo and age rules; ONIQ resolves nothing and
// sits outside the delivery path. That is a supported use of their player.
//
// RADIO does NOT come back and should not be restored by reflex. It piped
// Radio Browser's `url_resolved` — a bare stream URL — straight into
// `new Audio()`. There is no rights-holder player in that path at all: ONIQ
// would be the one delivering the audio. The removal commit called it "a
// stronger form of the thing this loop removes than the embeds were", and
// that reading is correct. Stations stay links to their homepages.
//
// What survives across both, deliberately and unchanged: STRICT faith-ID
// equality. A faith with no entries shows ITS OWN empty state and never
// another faith's content — that was the Jain bleed bug, and the fix holds
// whether the destination is an embed or a link. No default list, no
// index-based access.
//
// Jain Read is a separate section and is untouched by any of this.

const FAITH_META: { id: FaithId; label: string }[] = [
  { id: "islamic", label: "🕌 Islamic" },
  { id: "sikh", label: "🪯 Sikh" },
  { id: "hindu", label: "🕉️ Hindu" },
  { id: "christian", label: "✝️ Christian" },
  { id: "buddhist", label: "☸️ Buddhist" },
  { id: "jain", label: "🖐️ Jain" },
  { id: "jewish", label: "✡️ Jewish" },
];

// ONE mapping, shared with Watch and Home. This screen WRITES the religion
// key that those two read, so a second copy of the rule here is a bleed bug
// waiting to happen — a user whose faith maps one way on this screen and
// another way on Watch is shown someone else's tradition.
const religionToFaithId = sharedReligionToFaithId;

/** One tappable row that leaves ONIQ. Shared by channels and radio stations. */
function DirectoryRow({
  name,
  description,
  url,
  emoji,
  outLabel,
}: {
  name: string;
  description: string;
  url: string;
  emoji: string;
  outLabel: string;
}) {
  return (
    <li>
      <button
        type="button"
        data-testid="faith-link"
        onClick={() => openInApp(url)}
        aria-label={`${name} — ${outLabel}`}
        className="press flex w-full items-start gap-3 rounded-2xl border border-border bg-card p-3 text-left"
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-lg">
          {emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {description}
          </div>
          <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-primary">
            {outLabel} <ExternalLink className="size-3" />
          </div>
        </div>
      </button>
    </li>
  );
}

/**
 * Darshan, kirtan, bayan — playing in place again.
 *
 * The removal commit's list included "the faith iframe", and it comes back
 * with the rest of Watch (owner note, 2026-08-16). It plays ON A TAP rather
 * than autoplaying: this screen is also where someone reads scripture, and a
 * page that starts chanting the moment it opens is a different thing from a
 * loop somebody chose. The full loop, with its timer, lives on the Watch
 * screen's Devotional tab and on Home.
 *
 * STRICT FAITH ISOLATION is unchanged and is the reason this section is
 * separate from the generic directory: this faith's channels or this faith's
 * own empty state, never a fallback and never an index-based lookup. That was
 * the Jain bleed bug, and it holds whether the destination is a frame or a
 * link.
 */
function DevotionalLiveSection({ religion }: { religion: Religion | null }) {
  // Static, from the bundle. The `live-channels` edge function that used to
  // serve this roster is retired — with nothing to resolve, a network call
  // bought nothing.
  const only = religionToFaithId(religion);
  const items = faithChannelsFor(only);
  const [playing, setPlaying] = useState<{ id: string; name: string } | null>(null);

  // Switching faith must drop whatever was playing. Without this the frame
  // outlives the selection and one faith's channel keeps playing under
  // another's heading — the bleed bug in its live-est form.
  useEffect(() => {
    setPlaying(null);
  }, [only]);

  const item = playing ? playableOfChannelId(playing.id, playing.name) : null;

  return (
    <section className="mt-8">
      <div className="mb-3">
        <div className="text-[11px] uppercase tracking-wider text-primary/80">watch 🙏</div>
        <h2 className="font-display text-lg font-bold">darshan · kirtan · bayan</h2>
      </div>

      {items.length === 0 ? (
        // This faith's OWN empty state. Never a fallback to another faith.
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          no {FAITH_META.find((f) => f.id === only)?.label ?? "devotional"} channels listed yet 🌙
        </div>
      ) : (
        <>
          {item && (
            <div className="mb-3">
              {/* Name and close ABOVE the frame — nothing may be drawn over
                  the player, which is a condition of the embed grant. */}
              <div className="mb-2 flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-sm font-semibold">{playing!.name}</div>
                <button
                  type="button"
                  onClick={() => setPlaying(null)}
                  aria-label="Close player"
                  className="press rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold"
                >
                  close
                </button>
              </div>
              <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-black">
                <WatchPlayer
                  key={playing!.id}
                  item={item}
                  autoplay
                  className="absolute inset-0 h-full w-full"
                />
              </div>
            </div>
          )}

          <ul className="space-y-2">
            {items.map((c) => (
              <li key={c.channelId}>
                <button
                  type="button"
                  data-testid="faith-play"
                  onClick={() => setPlaying({ id: c.channelId, name: c.name })}
                  aria-label={`Play ${c.name}`}
                  aria-current={playing?.id === c.channelId}
                  className={`press flex w-full items-start gap-3 rounded-2xl border bg-card p-3 text-start ${
                    playing?.id === c.channelId ? "border-primary" : "border-border"
                  }`}
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-lg">
                    📺
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{c.name}</div>
                    <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                      {c.description}
                    </div>
                    <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-primary">
                      Watch here <Play className="size-3" />
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{WATCH_NOTICE}</p>
    </section>
  );
}

// ============================================================
// DEVOTIONAL RADIO — a directory of stations, via Radio Browser
// ============================================================

type RadioStation = {
  faith: FaithId;
  name: string;
  homepage: string;
  favicon: string | null;
  tags: string[];
};

function DevotionalRadioSection({ religion }: { religion: Religion | null }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["blessed-devotional-radio"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("devotional-radio", { body: {} });
      if (error) throw error;
      const stations: RadioStation[] = Array.isArray(data?.stations) ? data.stations : [];
      return stations;
    },
  });

  const stations = data ?? [];
  const only = religionToFaithId(religion);

  return (
    <section className="mt-10">
      <div className="mb-3">
        <div className="text-[11px] uppercase tracking-wider text-primary/80">radio 📻</div>
        <h2 className="font-display text-lg font-bold">stations to tune in to</h2>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          scanning the airwaves…
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          <p>Couldn't load the stations right now — a connection problem, not an empty dial.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="press mt-3 rounded-full border border-border px-3 py-1.5 text-xs font-medium"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {FAITH_META.filter((f) => (only ? f.id === only : true)).map((f) => {
            // Same strict equality as the channel list above.
            const items = itemsForFaith(stations, f.id);
            if (items.length === 0)
              return (
                <div
                  key={f.id}
                  className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground"
                >
                  no {f.label} stations listed right now 📡
                </div>
              );
            return (
              <div key={f.id}>
                <div className="mb-2 text-sm font-semibold text-foreground/90">{f.label}</div>
                <ul className="space-y-2">
                  {items.map((s) => (
                    <DirectoryRow
                      key={s.homepage}
                      name={s.name}
                      description={
                        s.tags.length > 0
                          ? s.tags.slice(0, 3).join(" · ")
                          : "Internet radio station"
                      }
                      url={s.homepage}
                      emoji="📻"
                      outLabel="Opens in browser"
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Station listings come from Radio Browser, a community directory. ONIQ does not host, stream
        or play these stations — each link opens the station's own site, where it serves its own
        audio under its own terms.
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

type CalItem = {
  religion: Religion;
  name: string;
  date: string;
  alt_date?: string; // contested festivals — never presented as a single truth
  alt_note?: string;
  systems?: string[]; // which family calendars observe it; absent = everyone
};

// Regional Hindu calendar systems — an explicit, user-overridable choice.
// Defaulting everyone to the North Indian calendar is the classic offense;
// "all" stays the default until the user picks their family's system.
export const HINDU_CAL_SYSTEMS: { id: string; label: string; hint: string; era?: string }[] = [
  { id: "all", label: "All India (everything)", hint: "every region's festivals together" },
  {
    id: "north",
    label: "North Indian — Vikram Samvat",
    hint: "UP · Bihar · MP · Rajasthan · Haryana · HP · Uttarakhand · Jharkhand · Chhattisgarh · J&K",
    era: "Vikram Samvat 2083 · new year 19 Mar 2026",
  },
  {
    id: "marathi",
    label: "Marathi — Shalivahana Shaka",
    hint: "Maharashtra · Goa · Konkan",
    era: "Shaka Samvat 1948 · Gudi Padwa 19 Mar 2026",
  },
  {
    id: "telugu-kannada",
    label: "Telugu / Kannada",
    hint: "Andhra · Telangana · Karnataka",
    era: "Shaka Samvat 1948 · Ugadi 19 Mar 2026",
  },
  { id: "tamil", label: "Tamil (solar)", hint: "Tamil Nadu", era: "Puthandu 14 Apr 2026" },
  {
    id: "bengali",
    label: "Bengali Panjika",
    hint: "West Bengal · Tripura",
    era: "Bangabda 1433 · Poila Boishakh 15 Apr 2026",
  },
  {
    id: "gujarati",
    label: "Gujarati (Kartikadi)",
    hint: "Gujarat",
    era: "Vikram Samvat 2083 from Bestu Varas, 9 Nov 2026",
  },
  {
    id: "malayalam",
    label: "Malayalam — Kollavarsham",
    hint: "Kerala",
    era: "Kollavarsham 1201–02 · Vishu 14 Apr · Chingam 1 on 17 Aug",
  },
  { id: "odia", label: "Odia Panji", hint: "Odisha", era: "Pana Sankranti 14 Apr 2026" },
  {
    id: "assamese",
    label: "Assamese",
    hint: "Assam",
    era: "Bhaskarabda 1432–33 · Bohag Bihu 14 Apr 2026",
  },
  { id: "punjabi", label: "Punjabi", hint: "Punjab", era: "Nanakshahi 558 · Baisakhi 14 Apr 2026" },
];

const HINDU_CAL_KEY = "oniq.faith.hinducal.v1";

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
  const [calSystem, setCalSystem] = useState<string>(() => {
    try {
      return localStorage.getItem(HINDU_CAL_KEY) ?? "all";
    } catch {
      return "all";
    }
  });
  const pickSystem = (id: string) => {
    setCalSystem(id);
    try {
      localStorage.setItem(HINDU_CAL_KEY, id);
    } catch {
      /* noop */
    }
  };
  const activeSystem = HINDU_CAL_SYSTEMS.find((c) => c.id === calSystem) ?? HINDU_CAL_SYSTEMS[0];

  const items = (data ?? [])
    .filter((d) => d.religion === religion)
    .filter((d) =>
      religion !== "hindu" || calSystem === "all"
        ? true
        : !d.systems || d.systems.includes(calSystem),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div>
      {religion === "hindu" && (
        <div className="mb-3 rounded-2xl border border-border bg-card p-3">
          <label htmlFor="hindu-cal-picker" className="block text-sm font-semibold">
            which calendar does your family follow? 🗓
          </label>
          <select
            id="hindu-cal-picker"
            data-testid="hindu-cal-picker"
            value={calSystem}
            onChange={(e) => pickSystem(e.target.value)}
            className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          >
            {HINDU_CAL_SYSTEMS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{activeSystem.hint}</p>
          {activeSystem.era && (
            <p className="mt-0.5 text-[11px] font-medium text-primary/80">{activeSystem.era}</p>
          )}
        </div>
      )}
      <div className="mb-2 text-[11px] text-muted-foreground">
        dates may vary by region &amp; tradition 🌙
      </div>
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
                {it.alt_date && (
                  <div className="text-[11px] text-primary/80">
                    also observed{" "}
                    {new Date(it.alt_date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                    {it.alt_note ? ` — ${it.alt_note}` : ""}
                  </div>
                )}
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
