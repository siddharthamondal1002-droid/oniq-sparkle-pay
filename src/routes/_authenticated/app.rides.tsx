import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, MapPin, Navigation, Search, Car, Bike } from "lucide-react";
import { toast } from "sonner";
import {
  geocode,
  uberLink,
  olaLink,
  openInApp,
  type GeoResult,
} from "@/lib/miniapps";

export const Route = createFileRoute("/_authenticated/app/rides")({
  component: RidesScreen,
});

function RidesScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [destination, setDestination] = useState<GeoResult | null>(null);
  const [searching, setSearching] = useState(false);

  async function search() {
    if (query.trim().length < 3) {
      toast.error("Gimme at least 3 letters 💀");
      return;
    }
    setSearching(true);
    try {
      const r = await geocode(query.trim());
      setResults(r);
      if (!r.length) toast.info("Found nothing fr — add your city name, that helps");
    } catch {
      toast.error("Search failed. Check your connection.");
    } finally {
      setSearching(false);
    }
  }

  // Real hrefs when a destination is chosen — inspectable, accessible, and
  // universal links work best as genuine anchors on mobile.
  const uberHref = destination
    ? uberLink({ lat: destination.lat, lon: destination.lon, label: destination.label })
    : undefined;
  const olaHref = destination
    ? olaLink({ lat: destination.lat, lon: destination.lon, label: destination.label })
    : undefined;

  function needDestination(e: React.MouseEvent) {
    e.preventDefault();
    toast.error("Pick a destination first, bestie");
  }

  return (
    <div className="px-5 pt-12 pb-6">
      <div className="flex items-center gap-3">
        <Link to="/app" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-2xl font-bold">Book a ride</h1>
      </div>

      {/* Pickup (always current location) */}
      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-primary">
          <Navigation className="h-4 w-4" />
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">Pickup</div>
          <div className="text-sm font-medium">Your current location</div>
        </div>
      </div>

      {/* Destination search */}
      <div className="mt-3 rounded-2xl border border-border bg-card p-4">
        <div className="text-[11px] text-muted-foreground">Destination</div>
        <div className="mt-2 flex gap-2">
          <div className="relative flex-1">
            <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="where we going? 👀 e.g. Howrah Station"
              className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-3 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <button
            onClick={search}
            disabled={searching}
            className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>

        {searching && <div className="mt-3 h-10 animate-pulse rounded-xl bg-muted" />}

        {results.length > 0 && !destination && (
          <div className="mt-3 space-y-1">
            {results.map((r, i) => (
              <button
                key={i}
                onClick={() => {
                  setDestination(r);
                  setResults([]);
                  setQuery(r.label);
                }}
                className="flex w-full items-start gap-2 rounded-xl p-2.5 text-left text-sm hover:bg-muted"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="line-clamp-2">{r.label}</span>
              </button>
            ))}
          </div>
        )}

        {destination && (
          <button
            onClick={() => {
              setDestination(null);
              setQuery("");
            }}
            className="mt-3 flex w-full items-center gap-2 rounded-xl bg-primary/10 p-2.5 text-left text-sm text-primary"
          >
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="line-clamp-1 flex-1">{destination.label}</span>
            <span className="text-xs underline">change</span>
          </button>
        )}
      </div>

      {/* Providers */}
      <h2 className="mt-6 px-1 font-display text-sm uppercase tracking-wider text-muted-foreground">
        pick your ride, main character
      </h2>
      <div className="mt-3 space-y-2">
        <Provider
          name="Uber"
          desc={destination ? "Opens Uber with your destination pre-filled" : "Cabs, autos & moto"}
          color="#000000"
          icon={Car}
          href={uberHref}
          testId="ride-uber"
          onBlocked={needDestination}
        />
        <Provider
          name="Ola"
          desc={destination ? "Opens Ola booking with your drop location" : "Cabs & autos"}
          color="#3b7d0e"
          icon={Car}
          href={olaHref}
          testId="ride-ola"
          onBlocked={needDestination}
          inApp
        />
        <Provider
          name="Rapido"
          desc="Bike taxis & autos"
          color="#c99a00"
          icon={Bike}
          href="https://rapido.bike"
          testId="ride-rapido"
          inApp
        />
      </div>

      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        Rides are booked and paid in the provider's app. Pickup uses your live location.
      </p>
    </div>
  );
}

function Provider({
  name,
  desc,
  color,
  icon: Icon,
  href,
  testId,
  onBlocked,
  inApp,
}: {
  name: string;
  desc: string;
  color: string;
  icon: typeof Car;
  href?: string;
  testId: string;
  onBlocked?: (e: React.MouseEvent) => void;
  inApp?: boolean;
}) {
  const body = (
    <>
      <div className="grid h-11 w-11 place-items-center rounded-xl text-white" style={{ backgroundColor: color }}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <div className="text-sm font-semibold">{name}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
    </>
  );
  const cls =
    "flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/40";
  if (!href) {
    return (
      <a href="#" data-testid={testId} aria-disabled="true" onClick={onBlocked} className={cls + " opacity-70"}>
        {body}
      </a>
    );
  }
  return (
    <a
      href={href}
      data-testid={testId}
      className={cls}
      onClick={
        inApp
          ? (e) => {
              e.preventDefault();
              openInApp(href);
            }
          : undefined
      }
    >
      {body}
    </a>
  );
}
