import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Plane, Sparkles } from "lucide-react";
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
    ],
  },
];

const MODE_RE = /^(flights?|fly|trains?|buses?|bus|ferry|hotels?|stays?|stay)\b/i;

type GenieResult =
  | { url: string }
  | { flight: { from: string; to: string } }
  | { error: string };

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
    return { flight: { from: toMatch[1].trim(), to: toMatch[2].trim() } };
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

function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
function plusDaysISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function hhmm(iso?: string) {
  if (!iso) return "--:--";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "--:--";
  return d.toTimeString().slice(0, 5);
}
function durationLabel(mins: number) {
  if (!mins) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

type Offer = {
  price: number;
  airline: string;
  departure?: string;
  arrival?: string;
  durationMinutes: number;
  stops: number;
};

function TravelScreen() {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState(plusDaysISO(7));
  const [loading, setLoading] = useState(false);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [fromCode, setFromCode] = useState<string | null>(null);
  const [toCode, setToCode] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  async function runSearch(f: string, t: string, d: string) {
    if (!f.trim() || !t.trim()) {
      toast.error("enter both cities ✈️");
      return;
    }
    setLoading(true);
    setOffers(null);
    setUnconfigured(false);
    try {
      const { data, error } = await supabase.functions.invoke("flight-search", {
        body: { from: f.trim(), to: t.trim(), date: d },
      });
      if (error) throw error;
      if (data?.configured === false) {
        setUnconfigured(true);
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      setOffers(Array.isArray(data?.offers) ? data.offers : []);
      setFromCode(data?.fromCode ?? null);
      setToCode(data?.toCode ?? null);
    } catch (e: any) {
      toast.error(e?.message || "Flight search failed");
    } finally {
      setLoading(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseGenie(q);
    if ("error" in parsed) {
      toast.error(parsed.error);
      return;
    }
    if ("flight" in parsed) {
      setFrom(parsed.flight.from);
      setTo(parsed.flight.to);
      console.log("[travel-genie] flight", parsed.flight, date);
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      void runSearch(parsed.flight.from, parsed.flight.to, date);
      return;
    }
    console.log("[travel-genie]", parsed.url);
    openInApp(parsed.url);
  }

  function onSearchClick(e: React.FormEvent) {
    e.preventDefault();
    void runSearch(from, to, date);
  }

  return (
    <div className="px-5 pt-12 pb-10">
      <div className="flex items-center gap-3">
        <Link to="/app" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold">Wander 🌍</h1>
          <p className="text-xs text-muted-foreground">time to touch grass — buses, trains, flights, ferries, stays</p>
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

      <div ref={panelRef} className="mt-4 rounded-2xl border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-primary/15 text-primary">
            <Plane className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">Best price ✈️</div>
            <div className="text-[11px] text-muted-foreground">live fare compare — powered by Amadeus</div>
          </div>
        </div>
        <form onSubmit={onSearchClick} className="mt-3 grid grid-cols-2 gap-2">
          <input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="From (e.g. Kolkata)"
            className="col-span-1 rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary/40 focus:outline-none"
          />
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="To (e.g. Goa)"
            className="col-span-1 rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary/40 focus:outline-none"
          />
          <input
            type="date"
            value={date}
            min={todayISO()}
            onChange={(e) => setDate(e.target.value)}
            className="col-span-1 rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary/40 focus:outline-none"
          />
          <button
            type="submit"
            data-testid="flight-search"
            disabled={loading}
            className="col-span-1 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        {unconfigured && (
          <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
            Real-time fares need a free Amadeus key — add{" "}
            <span className="font-mono text-primary">AMADEUS_API_KEY</span> and{" "}
            <span className="font-mono text-primary">AMADEUS_API_SECRET</span> in project secrets. Grab them at
            developers.amadeus.com ✈️
          </div>
        )}

        {offers && offers.length === 0 && !unconfigured && (
          <div className="mt-3 rounded-xl border border-border bg-background p-3 text-center text-xs text-muted-foreground">
            No flights found for that day — try nearby dates 🛫
          </div>
        )}

        {offers && offers.length > 0 && (
          <>
            <div className="mt-3 space-y-2">
              {offers.map((o, i) => {
                const bookUrl = `https://www.google.com/travel/flights?q=Flights%20from%20${encodeURIComponent(
                  fromCode ?? from,
                )}%20to%20${encodeURIComponent(toCode ?? to)}%20on%20${date}`;
                return (
                  <div
                    key={i}
                    data-testid="flight-offer"
                    className="rounded-2xl border border-border bg-background p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] font-semibold">
                          {o.airline}
                        </span>
                        {i === 0 && (
                          <span className="rounded-md bg-primary/20 px-2 py-0.5 text-[11px] font-semibold text-primary">
                            Best price 💸
                          </span>
                        )}
                      </div>
                      <div className="text-base font-bold">₹{Math.round(o.price).toLocaleString("en-IN")}</div>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <div className="font-medium text-foreground">
                        {hhmm(o.departure)} → {hhmm(o.arrival)}
                      </div>
                      <div>{durationLabel(o.durationMinutes)}</div>
                      <div>{o.stops === 0 ? "Non-stop" : `${o.stops} stop${o.stops > 1 ? "s" : ""}`}</div>
                    </div>
                    <button
                      onClick={() => openInApp(bookUrl)}
                      className="mt-3 w-full rounded-xl border border-primary/40 bg-primary/10 py-2 text-xs font-semibold text-primary"
                    >
                      Book
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              Live fares via Amadeus (test data until production keys) — final price at booking.
            </p>
          </>
        )}
      </div>

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

      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        Bookings & payments happen in the provider's app — Wander gets you there faster.
      </p>
    </div>
  );
}
