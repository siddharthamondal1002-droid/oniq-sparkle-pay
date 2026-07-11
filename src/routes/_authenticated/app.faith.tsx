import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, ChevronRight, ExternalLink, BookOpen, Headphones, Calendar as CalIcon, ShoppingBag, ArrowLeft } from "lucide-react";
import { launchMiniApp } from "@/lib/miniapps";

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
type Section = "read" | "listen" | "dates" | "shop";

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
            <div className="mt-5 grid grid-cols-4 gap-2">
              <TabBtn active={section === "read"} onClick={() => setSection("read")} icon={<BookOpen className="h-4 w-4" />} label="read 📖" />
              <TabBtn active={section === "listen"} onClick={() => setSection("listen")} icon={<Headphones className="h-4 w-4" />} label="listen 🎧" />
              <TabBtn active={section === "dates"} onClick={() => setSection("dates")} icon={<CalIcon className="h-4 w-4" />} label="dates 🗓" />
              <TabBtn active={section === "shop"} onClick={() => setSection("shop")} icon={<ShoppingBag className="h-4 w-4" />} label="shop 🛍" />
            </div>

            <div className="mt-5">
              {section === "read" && <ReadSection religion={religion} />}
              {section === "listen" && <ListenSection religion={religion} />}
              {section === "dates" && <DatesSection religion={religion} />}
              {section === "shop" && <ShopSection religion={religion} />}
            </div>
          </>
        )}
      </div>
    </div>
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
    { label: "Bhagavad Gita — audiobook (LibriVox)", url: "https://librivox.org/the-bhagavad-gita-by-vyasa/" },
    { label: "Vedic chants (archive.org)", url: "https://archive.org/details/VedicChants" },
  ],
  islam: [
    { label: "Quran recitation — Mishary Rashid (archive.org)", url: "https://archive.org/details/mishary-rashid-alafasy-quran" },
    { label: "Full Quran audio (archive.org)", url: "https://archive.org/details/quran-audio" },
  ],
  christian: [
    { label: "KJV Bible — audiobook (LibriVox)", url: "https://librivox.org/the-holy-bible-king-james-version-kjv/" },
    { label: "New Testament (LibriVox)", url: "https://librivox.org/the-new-testament-of-the-king-james-bible/" },
  ],
  sikh: [
    { label: "Kirtan — Harmandir Sahib (archive.org)", url: "https://archive.org/details/kirtan" },
  ],
  buddhist: [
    { label: "Dhammapada — audiobook (LibriVox)", url: "https://librivox.org/the-dhammapada-by-anonymous/" },
    { label: "Buddhist chants (archive.org)", url: "https://archive.org/details/buddhistchants" },
  ],
  jewish: [
    { label: "Torah readings (archive.org)", url: "https://archive.org/details/torah" },
    { label: "Psalms — audiobook (LibriVox)", url: "https://librivox.org/the-book-of-psalms/" },
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

const SHOP: Record<Religion, { label: string; query: string }[]> = {
  hindu: [
    { label: "puja thali sets", query: "puja+thali+set" },
    { label: "diya & incense", query: "diya+incense+combo" },
    { label: "idols & murtis", query: "hindu+god+idol" },
    { label: "wedding essentials", query: "hindu+wedding+essentials" },
    { label: "shraddha samagri", query: "shraddha+samagri" },
  ],
  islam: [
    { label: "prayer mat", query: "prayer+mat+islamic" },
    { label: "quran + rehal", query: "quran+with+rehal" },
    { label: "tasbeeh beads", query: "tasbeeh+beads" },
    { label: "hijab & abaya", query: "hijab+abaya" },
    { label: "attar / itr", query: "attar+itr" },
  ],
  christian: [
    { label: "holy bible", query: "holy+bible" },
    { label: "rosary beads", query: "rosary+beads" },
    { label: "crucifix wall art", query: "crucifix+wall+art" },
    { label: "communion candles", query: "communion+candles" },
    { label: "baptism gifts", query: "baptism+gifts" },
  ],
  sikh: [
    { label: "kirpan", query: "sikh+kirpan" },
    { label: "kara steel bracelet", query: "sikh+kara+steel" },
    { label: "gutka sahib", query: "gutka+sahib" },
    { label: "chola / bana", query: "sikh+chola" },
    { label: "nishan sahib", query: "nishan+sahib+flag" },
  ],
  buddhist: [
    { label: "buddha idol", query: "buddha+idol" },
    { label: "prayer wheel", query: "buddhist+prayer+wheel" },
    { label: "mala beads (108)", query: "mala+beads+108" },
    { label: "incense sticks", query: "buddhist+incense" },
    { label: "singing bowl", query: "tibetan+singing+bowl" },
  ],
  jewish: [
    { label: "menorah", query: "menorah" },
    { label: "mezuzah", query: "mezuzah" },
    { label: "tallit", query: "tallit+prayer+shawl" },
    { label: "kippah", query: "kippah+yarmulke" },
    { label: "shabbat candles", query: "shabbat+candles" },
  ],
};

function ShopSection({ religion }: { religion: Religion }) {
  const items = SHOP[religion];
  const open = (q: string) => {
    launchMiniApp({ name: "Amazon", url: `https://www.amazon.in/s?k=${q}`, androidPackage: "in.amazon.mShop.android.shopping" });
  };
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.query}>
          <button
            onClick={() => open(it.query)}
            className="press w-full flex items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left"
          >
            <ShoppingBag className="h-4 w-4 text-primary" />
            <span className="flex-1 text-sm">{it.label}</span>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </button>
        </li>
      ))}
      <li className="text-[11px] text-muted-foreground pt-1">opens Amazon — ONIQ doesn't sell these items 🛍</li>
    </ul>
  );
}
