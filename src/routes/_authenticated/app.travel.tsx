import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ExternalLink, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { openInApp } from "@/lib/miniapps";

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
          <h1 className="font-display text-2xl font-bold">Vanderlust 🌍</h1>
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
        Bookings & payments happen in the provider's app — Vanderlust gets you there faster.
      </p>
    </div>
  );
}
