import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { openInApp } from "@/lib/miniapps";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/app/travel")({
  component: TravelScreen,
});

type Provider = { id: string; name: string; tagline: string; color: string; letter: string; url: string };
type Section = { key: string; label: string; providers: Provider[] };

const SECTIONS: Section[] = [
  {
    key: "buses",
    label: "🚌 Buses",
    providers: [
      { id: "redbus", name: "redBus", tagline: "India's largest bus network", color: "#D84E55", letter: "R", url: "https://www.redbus.in" },
      { id: "abhibus", name: "AbhiBus", tagline: "Sleepers, seats & offers", color: "#7B2D8E", letter: "A", url: "https://www.abhibus.com" },
    ],
  },
  {
    key: "trains",
    label: "🚆 Trains",
    providers: [
      { id: "irctc", name: "IRCTC", tagline: "Official Indian Railways", color: "#213D77", letter: "I", url: "https://www.irctc.co.in" },
      { id: "ixigo-trains", name: "ixigo Trains", tagline: "PNR, seats & running status", color: "#EC5B24", letter: "X", url: "https://www.ixigo.com/trains" },
      { id: "confirmtkt", name: "ConfirmTkt", tagline: "Predict confirmation chance", color: "#1E88E5", letter: "C", url: "https://www.confirmtkt.com" },
      { id: "railyatri", name: "RailYatri", tagline: "Trains, meals & buses", color: "#0C8442", letter: "R", url: "https://www.railyatri.in" },
    ],
  },
  {
    key: "flights",
    label: "✈️ Flights",
    providers: [
      { id: "google-flights", name: "Google Flights", tagline: "Compare fares fast", color: "#4285F4", letter: "G", url: "https://www.google.com/travel/flights" },
      { id: "skyscanner", name: "Skyscanner", tagline: "Cheapest days & routes", color: "#0770E3", letter: "S", url: "https://www.skyscanner.co.in" },
      { id: "makemytrip", name: "MakeMyTrip", tagline: "Flights + hotel combos", color: "#E7392C", letter: "M", url: "https://www.makemytrip.com/flights/" },
      { id: "cleartrip", name: "Cleartrip", tagline: "Simple domestic flights", color: "#3366CC", letter: "C", url: "https://www.cleartrip.com" },
      { id: "ixigo", name: "ixigo", tagline: "Flight & hotel deals", color: "#EC5B24", letter: "X", url: "https://www.ixigo.com/flights" },
    ],
  },
  {
    key: "ferries",
    label: "⛴️ Ferries & cruises",
    providers: [
      { id: "makruzz", name: "Makruzz", tagline: "Andaman ferry bookings", color: "#005B96", letter: "M", url: "https://www.makruzz.com" },
      { id: "cordelia", name: "Cordelia Cruises", tagline: "Indian sea cruises", color: "#8A1538", letter: "C", url: "https://www.cordeliacruises.com" },
    ],
  },
  {
    key: "stays",
    label: "🏨 Stays",
    providers: [
      { id: "oyo", name: "OYO", tagline: "Budget rooms, everywhere", color: "#EE2E24", letter: "O", url: "https://www.oyorooms.com" },
      { id: "booking", name: "Booking.com", tagline: "Hotels worldwide", color: "#003580", letter: "B", url: "https://www.booking.com" },
      { id: "agoda", name: "Agoda", tagline: "Asia stay specialist", color: "#5C2D91", letter: "A", url: "https://www.agoda.com" },
      { id: "airbnb", name: "Airbnb", tagline: "Homes & unique stays", color: "#FF385C", letter: "A", url: "https://www.airbnb.co.in" },
      { id: "goibibo", name: "Goibibo", tagline: "Hotels, flights & bus", color: "#2A2AC0", letter: "G", url: "https://www.goibibo.com" },
      { id: "makemytrip-hotels", name: "MakeMyTrip Hotels", tagline: "Hotels across India", color: "#E7392C", letter: "M", url: "https://www.makemytrip.com/hotels/" },
      { id: "cleartrip-hotels", name: "Cleartrip Hotels", tagline: "Simple hotel booking", color: "#3366CC", letter: "C", url: "https://www.cleartrip.com/hotels" },
      { id: "trivago", name: "Trivago", tagline: "Compare hotel prices", color: "#007FAD", letter: "T", url: "https://www.trivago.in" },
      { id: "expedia", name: "Expedia", tagline: "Hotels, flights & packages", color: "#FFC94D", letter: "E", url: "https://www.expedia.com" },
      { id: "hotels-com", name: "Hotels.com", tagline: "Stay 10 nights, get 1", color: "#D32F2F", letter: "H", url: "https://www.hotels.com" },
      { id: "marriott", name: "Marriott Bonvoy", tagline: "Global hotel group", color: "#8C2332", letter: "M", url: "https://www.marriott.com" },
      { id: "taj", name: "Taj Hotels", tagline: "IHCL luxury stays", color: "#9C7A32", letter: "T", url: "https://www.tajhotels.com" },
      { id: "treebo", name: "Treebo", tagline: "Quality budget hotels", color: "#00A5A8", letter: "T", url: "https://www.treebo.com" },
      { id: "fabhotels", name: "FabHotels", tagline: "Value hotels in India", color: "#F26B21", letter: "F", url: "https://www.fabhotels.com" },
      { id: "yatra-hotels", name: "Yatra Hotels", tagline: "Deals on Indian stays", color: "#E4002B", letter: "Y", url: "https://www.yatra.com/hotels" },
    ],
  },
];

const MODE_RE = /^(flights?|fly|trains?|buses?|bus|ferry|hotels?|stays?|stay)\b/i;

type GenieResult = { url: string } | { error: string };

function parseGenie(raw: string): GenieResult {
  const q = raw.trim();
  if (!q) return { error: "type something first ✨" };
  const m = q.match(MODE_RE);
  if (!m) return { error: "start with flight / train / bus / hotel / ferry 🧳" };
  const mode = m[1].toLowerCase();
  const rest = q.slice(m[0].length).trim();
  const toMatch = rest.match(/^(.+?)\s+to\s+(.+)$/i);
  const inMatch = rest.match(/^in\s+(.+)$/i);

  if (mode.startsWith("flight") || mode === "fly") {
    if (!toMatch) return { error: "flights need 'from X to Y' — try: flight kolkata to goa" };
    const from = toMatch[1].trim();
    const to = toMatch[2].trim();
    return {
      url: `https://www.google.com/travel/flights?q=Flights%20from%20${encodeURIComponent(from)}%20to%20${encodeURIComponent(to)}`,
    };
  }
  if (mode.startsWith("hotel") || mode.startsWith("stay")) {
    const place = inMatch ? inMatch[1] : rest;
    if (!place.trim()) return { error: "where you staying? try: hotel in darjeeling" };
    return { url: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(place.trim())}` };
  }
  if (mode.startsWith("train")) return { url: "https://www.ixigo.com/trains" };
  if (mode.startsWith("bus")) return { url: "https://www.redbus.in" };
  if (mode === "ferry") return { url: "https://www.makruzz.com" };
  return { error: "start with flight / train / bus / hotel / ferry 🧳" };
}

type StayRow = {
  site: string;
  hotel?: string | null;
  price_inr?: number | null;
  price_range_inr?: string | null;
  rating?: string | null;
  source_domain?: string | null;
  url?: string | null;
  verified?: boolean;
  note?: string | null;
};
type StayResponse = {
  stay: string;
  results: StayRow[];
  top_pick?: { site: string; hotel?: string | null; why?: string; cross_checked?: string[] } | null;
  disclaimer?: string;
};

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

function StayScout() {
  const [dest, setDest] = useState("");
  const [checkin, setCheckin] = useState("");
  const [checkout, setCheckout] = useState("");
  const [guests, setGuests] = useState(2);
  const [budget, setBudget] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(0);
  const [data, setData] = useState<StayResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) {
      setPhase(0);
      return;
    }
    const t = setInterval(() => setPhase((p) => (p + 1) % 4), 6000);
    return () => clearInterval(t);
  }, [loading]);

  async function scout() {
    if (!dest.trim()) {
      toast.error("where you staying? drop a city or hotel 🏨");
      return;
    }
    setLoading(true);
    setData(null);
    setErr(null);
    try {
      let lang = "en";
      try {
        const m = await import("@/lib/userLanguage");
        lang = await m.getUserLanguage();
      } catch {
        /* noop */
      }
      const { data: r, error } = await supabase.functions.invoke("hotel-scout", {
        body: {
          query: dest.trim(),
          checkin: checkin || undefined,
          checkout: checkout || undefined,
          guests,
          budget: budget ? Number(budget) : undefined,
          lang,
        },
      });
      const bodyErr = (r as any)?.error;
      if (bodyErr) throw new Error(bodyErr);
      if (error) throw error;
      setData({
        stay: (r as any)?.stay ?? dest.trim(),
        results: Array.isArray((r as any)?.results) ? (r as any).results : [],
        top_pick: (r as any)?.top_pick ?? null,
        disclaimer: (r as any)?.disclaimer,
      });
    } catch (e: any) {
      const msg = e?.message ?? "stay scout hit a wall 😵‍💫";
      setErr(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  function openRow(r: StayRow) {
    const url =
      r.url ??
      `https://www.google.com/search?q=${encodeURIComponent(`${r.hotel ?? dest} ${r.site} price`)}`;
    openInApp(url);
  }

  const rankBadge = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`);
  const ranked = (data?.results ?? []).filter((r) => typeof r.price_inr === "number");
  const rest = (data?.results ?? []).filter((r) => typeof r.price_inr !== "number");

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-2xl border border-primary/30 bg-card p-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-primary/80">
          smart stay scout — same room, every site, one best price 🏨
        </div>
        <input
          data-testid="stay-scout-dest"
          value={dest}
          onChange={(e) => setDest(e.target.value.slice(0, 300))}
          placeholder="taj bengal kolkata, homestay in manali, hotel near goa beach…"
          className="w-full min-w-0 rounded-xl border border-border bg-background p-3 text-sm focus:border-primary focus:outline-none"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            check-in
            <input
              type="date"
              value={checkin}
              onChange={(e) => setCheckin(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-background p-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            check-out
            <input
              type="date"
              value={checkout}
              onChange={(e) => setCheckout(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-background p-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            guests
            <input
              type="number"
              min={1}
              max={12}
              value={guests}
              onChange={(e) => setGuests(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
              className="mt-1 w-full rounded-xl border border-border bg-background p-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            budget / night (₹)
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value.slice(0, 7))}
              placeholder="optional"
              className="mt-1 w-full rounded-xl border border-border bg-background p-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>
        </div>
        <button
          onClick={scout}
          disabled={loading}
          data-testid="stay-scout-go"
          className="press glow-primary mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {loading
            ? phase === 0
              ? "scouting rooms 🕵️…"
              : phase === 1
                ? "checking booking.com, mmt, agoda 🔎"
                : phase === 2
                  ? "comparing taxes & cancellation 🧾"
                  : "almost there — picking the best value ✨"
            : "compare stay prices"}
        </button>
      </div>

      {err && !loading && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-center">
          <div className="text-sm font-medium text-red-300">stay scout hit a wall 😵‍💫</div>
          <div className="mt-1 break-words text-xs text-red-400/80">{err}</div>
          <button
            onClick={scout}
            className="mt-3 rounded-xl border border-red-400/40 bg-background px-4 py-2 text-xs font-semibold text-red-300"
          >
            retry
          </button>
        </div>
      )}

      {data && (
        <div className="space-y-2">
          <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-4">
            <div className="text-xs uppercase tracking-wider text-primary/80">stay</div>
            <div className="mt-1 break-words font-display text-lg font-bold">{data.stay}</div>
          </div>

          {data.top_pick?.site && (
            <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-amber-300">🏆 best value</div>
              <div className="mt-1 break-words font-display text-base font-bold">
                {data.top_pick.hotel ? `${data.top_pick.hotel} — ${data.top_pick.site}` : data.top_pick.site}
              </div>
              {data.top_pick.why && (
                <div className="mt-1 break-words text-xs leading-relaxed text-amber-100/90">
                  {data.top_pick.why}
                </div>
              )}
              {Array.isArray(data.top_pick.cross_checked) && data.top_pick.cross_checked.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-emerald-300/90">✓ confirmed via</span>
                  {data.top_pick.cross_checked.slice(0, 5).map((s, i) => (
                    <span
                      key={i}
                      className="break-words rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {data.results.length === 0 && (
            <div className="rounded-2xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
              nothing solid found rn — try naming the city or hotel
            </div>
          )}

          {ranked.map((r, i) => (
            <div key={`s-${i}`} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-lg font-bold">
                  {rankBadge(i)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <div className="truncate font-semibold">{r.hotel || r.site}</div>
                    {r.verified && (
                      <span className="shrink-0 text-[10px] font-medium text-emerald-400">✓ verified</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                    <span className="truncate">{r.site}</span>
                    {r.rating && <span>· ★ {r.rating}</span>}
                    {r.source_domain && <span className="truncate">· {r.source_domain}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-display text-lg font-bold">{inr(r.price_inr as number)}</div>
                  <div className="text-[10px] text-muted-foreground">/night</div>
                </div>
              </div>
              {r.note && <div className="mt-2 break-words text-xs text-muted-foreground">{r.note}</div>}
              <button
                onClick={() => openRow(r)}
                className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl border border-border bg-background py-2 text-xs font-semibold"
              >
                open on {r.site} <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          ))}

          {rest.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-3">
              <div className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                check these urself 👀
              </div>
              <div className="space-y-1.5">
                {rest.map((r, i) => (
                  <button
                    key={`u-${i}`}
                    onClick={() => openRow(r)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{r.hotel || r.site}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.price_range_inr
                          ? `${r.price_range_inr}${r.rating ? ` · ★ ${r.rating}` : ""}`
                          : (r.note ?? "couldn't verify live — check on site")}
                        {r.source_domain ? ` · ${r.source_domain}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                      open <ExternalLink className="h-3 w-3" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="pt-1 text-center text-xs text-muted-foreground">
            {data.disclaimer ?? "rates scouted live — taxes & fees can move them, tap through to confirm 📈"}
          </div>
        </div>
      )}
    </div>
  );
}

function TravelScreen() {
  const [q, setQ] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseGenie(q);
    if ("error" in parsed) {
      toast.error(parsed.error);
      return;
    }
    console.log("[travel-genie]", parsed.url);
    openInApp(parsed.url);
  }

  return (
    <div className="px-5 pt-12 pb-10">
      <div className="flex items-center gap-3">
        <Link to="/app" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold">Wanderlust 🌍</h1>
          <p className="text-xs text-muted-foreground">wanderlust activated — buses, trains, flights, ferries, stays</p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-4">
        <div className="flex items-center gap-2 rounded-2xl border border-primary/30 bg-card p-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <input
            data-testid="travel-genie"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`try: "flight kolkata to goa" or "hotel in darjeeling"`}
            className="flex-1 bg-transparent px-1 text-sm placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
          >
            Go
          </button>
        </div>
      </form>

      <StayScout />

      {SECTIONS.map((section) => (
        <section key={section.key}>
          <h2 className="mt-6 px-1 font-display text-sm uppercase tracking-wider text-muted-foreground">
            {section.label}
          </h2>
          <div className="mt-3 space-y-2">
            {section.providers.map((p) => (
              <button
                key={p.id}
                data-testid={`travel-app-${p.id}`}
                onClick={() => openInApp(p.url)}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition hover:border-primary/40"
              >
                <div
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl font-display text-lg font-bold text-white"
                  style={{ backgroundColor: p.color }}
                >
                  {p.letter}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.tagline}</div>
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>
      ))}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Bookings & payments happen in the provider's app — Wanderlust gets you there faster.
      </p>
    </div>
  );
}
