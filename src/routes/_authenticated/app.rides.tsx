import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MapPin, Navigation, Search, Car, Bike, Mic, Sparkles, ChevronDown, ChevronRight, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  geocode,
  uberLink,
  olaLink,
  openInApp,
  getCurrentLocation,
  reverseGeocode,
  type GeoResult,
} from "@/lib/miniapps";
import {
  detectCity,
  getCachedCity,
  setCachedCity,
  splitByCity,
  type DetectedCity,
  type RideProvider as RP,
} from "@/lib/rideProviders";

export const Route = createFileRoute("/_authenticated/app/rides")({
  component: RidesScreen,
});


type Point = { lat: number; lon: number; label: string };

type ServerRideOption = {
  providerId: string;
  providerName: string;
  vehicle: string;
  color: string;
  icon: "car" | "bike" | "auto";
  fareLow: number;
  fareHigh: number;
  etaMins: number;
};

function RidesScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [destination, setDestination] = useState<Point | null>(null);
  const [pickup, setPickup] = useState<Point | null>(null);
  const [pickupIsCurrent, setPickupIsCurrent] = useState(true);
  const [geoState, setGeoState] = useState<"locating" | "ready" | "denied">("locating");
  const [city, setCity] = useState<DetectedCity>(() => getCachedCity());
  const [showElsewhere, setShowElsewhere] = useState(false);

  const [locating, setLocating] = useState(false);
  const [searching, setSearching] = useState(false);

  const [pickupEditing, setPickupEditing] = useState(false);
  const [pickupQuery, setPickupQuery] = useState("");
  const [pickupResults, setPickupResults] = useState<GeoResult[]>([]);
  const [pickupSearching, setPickupSearching] = useState(false);


  const [genie, setGenie] = useState("");
  const [micSupported, setMicSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const [route, setRoute] = useState<{ km: number; mins: number } | null>(null);
  const [options, setOptions] = useState<ServerRideOption[]>([]);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  // Detect mic support (browser-only)
  useEffect(() => {
    const w = window as any;
    if (w.SpeechRecognition || w.webkitSpeechRecognition) setMicSupported(true);
  }, []);

  // Default pickup = current phone location (native GPS on device, browser API on web)
  async function locateMe(fromTap = false) {
    setGeoState("locating");
    setLocating(true);
    try {
      const { lat, lon } = await getCurrentLocation();
      const label = await reverseGeocode(lat, lon);
      setPickup({ lat, lon, label });
      setPickupIsCurrent(true);
      const c = detectCity(lat, lon);
      setCity(c);
      setCachedCity(c);
      setGeoState("ready");
      if (fromTap) toast.success("Locked in 📍 " + label);

    } catch {
      setGeoState("denied");
      if (fromTap) {
        toast.error(
          "Location is blocked for this site — tap the padlock/⋮ in your browser bar → Permissions → Location → Allow, then retry",
        );
      }
    } finally {
      setLocating(false);
    }
  }
  useEffect(() => {
    locateMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the browser never surfaces the permission prompt, flip to denied after ~12s
  useEffect(() => {
    if (geoState !== "locating") return;
    const t = setTimeout(() => {
      setGeoState((s) => (s === "locating" && !pickup ? "denied" : s));
    }, 12000);
    return () => clearTimeout(t);
  }, [geoState, pickup]);

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

  async function searchPickup() {
    if (pickupQuery.trim().length < 3) {
      toast.error("Gimme at least 3 letters 💀");
      return;
    }
    setPickupSearching(true);
    try {
      const r = await geocode(pickupQuery.trim());
      setPickupResults(r);
      if (!r.length) toast.info("Found nothing fr — add your city name, that helps");
    } catch {
      toast.error("Search failed. Check your connection.");
    } finally {
      setPickupSearching(false);
    }
  }


  async function runCompare(from: Point | null, to: Point | null) {
    if (!from || !to) {
      toast.error("Need pickup and destination first");
      return;
    }
    setComparing(true);
    setRoute(null);
    setOptions([]);
    setCompareError(null);
    try {
      const { data, error } = await supabase.functions.invoke("estimate-fares", {
        body: {
          pickup: { lat: from.lat, lon: from.lon, label: from.label },
          destination: { lat: to.lat, lon: to.lon, label: to.label },
        },
      });
      if (error) throw error;
      const payload = data as { route?: { km: number; mins: number }; options?: ServerRideOption[]; error?: string };
      if (payload?.error || !payload?.route || !payload?.options?.length) {
        throw new Error(payload?.error ?? "no options");
      }
      setRoute(payload.route);
      setOptions(payload.options);
    } catch {
      setCompareError("couldn't crunch that route 🧮 try again");
      toast.error("couldn't crunch that route 🧮 try again");
    } finally {
      setComparing(false);
    }
  }

  async function handleGenie(text: string) {
    const raw = text.trim();
    if (!raw) return;
    const stripped = raw.replace(/^(book me a ride|book a ride|ride|cab)\s+/i, "").trim();
    const m = stripped.match(/(?:from\s+)?(.+?)\s+to\s+(.+)/i);
    try {
      let pickPt: Point | null = null;
      let dropPt: Point | null = null;
      if (m) {
        const [, fromStr, toStr] = m;
        const [fromRes, toRes] = await Promise.all([geocode(fromStr.trim()), geocode(toStr.trim())]);
        if (!fromRes.length || !toRes.length) {
          toast.error("couldn't find that place — add your city name");
          return;
        }
        pickPt = { lat: fromRes[0].lat, lon: fromRes[0].lon, label: fromRes[0].label };
        dropPt = { lat: toRes[0].lat, lon: toRes[0].lon, label: toRes[0].label };
        setPickup(pickPt);
        setPickupIsCurrent(false);
      } else {
        const toRes = await geocode(stripped);
        if (!toRes.length) {
          toast.error("couldn't find that place — add your city name");
          return;
        }
        dropPt = { lat: toRes[0].lat, lon: toRes[0].lon, label: toRes[0].label };
        pickPt = pickup;
        if (!pickPt) {
          toast.error("Waiting on your location — try again in a sec");
        }
      }
      if (dropPt) {
        setDestination(dropPt);
        setQuery(dropPt.label);
        setResults([]);
      }
      if (pickPt && dropPt) await runCompare(pickPt, dropPt);
    } catch {
      toast.error("Genie glitched — try again");
    }
  }

  function toggleMic() {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const rec = new SR();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      const t = e.results?.[0]?.[0]?.transcript ?? "";
      setGenie(t);
      handleGenie(t);
    };
    rec.onerror = () => toast.error("Mic didn't catch that — type it instead");
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  const explicitPickup = !pickupIsCurrent ? pickup : undefined;
  const uberHref = destination
    ? uberLink(
        { lat: destination.lat, lon: destination.lon, label: destination.label },
        explicitPickup ? { lat: explicitPickup.lat, lon: explicitPickup.lon, label: explicitPickup.label } : undefined,
      )
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

      {/* Genie bar */}
      <div className="mt-4 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-primary">
          <Sparkles className="h-3 w-3" /> Ride Genie
        </div>
        <div className="flex gap-2">
          <input
            data-testid="genie-input"
            value={genie}
            onChange={(e) => setGenie(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleGenie(genie);
              }
            }}
            placeholder={`try: "ride from Park Street to Howrah" 🧞`}
            className="flex-1 rounded-xl border border-border bg-background py-3 px-3 text-sm focus:border-primary focus:outline-none"
          />
          {micSupported && (
            <button
              data-testid="genie-mic"
              onClick={toggleMic}
              className={`grid h-11 w-11 place-items-center rounded-xl ${listening ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}
              aria-label="Voice command"
            >
              <Mic className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Pickup */}
      <div className="mt-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-primary">
            <Navigation className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">Pickup</div>
            <div className="text-sm font-medium truncate">
              {geoState === "locating" && !pickup
                ? "Locating you…"
                : pickup
                  ? pickup.label
                  : "Location off — tap below"}
            </div>
          </div>
          {!pickupIsCurrent && (
            <button
              onClick={() => {
                setPickup(null);
                locateMe();
              }}
              className="text-xs text-primary underline"
            >
              reset
            </button>
          )}
        </div>
        {geoState === "denied" && pickupIsCurrent && (
          <div className="mt-3">
            <button
              data-testid="retry-gps"
              onClick={() => locateMe(true)}
              disabled={locating}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {locating ? "Locating…" : "📍 Use my location"}
            </button>
            <p className="mt-2 text-xs text-muted-foreground">
              or type a pickup in the Genie: "from X to Y"
            </p>
          </div>
        )}
      </div>

      {/* Destination search */}
      <div className="mt-3 rounded-2xl border border-border bg-card p-4">
        <div className="text-xs text-muted-foreground">Destination</div>
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
                  setDestination({ lat: r.lat, lon: r.lon, label: r.label });
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
              setRoute(null);
              setOptions([]);
            }}
            className="mt-3 flex w-full items-center gap-2 rounded-xl bg-primary/10 p-2.5 text-left text-sm text-primary"
          >
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="line-clamp-1 flex-1">{destination.label}</span>
            <span className="text-xs underline">change</span>
          </button>
        )}

        {destination && pickup && (
          <button
            data-testid="ride-compare"
            onClick={() => runCompare(pickup, destination)}
            disabled={comparing}
            className="mt-3 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Wallet className="h-4 w-4" />
            {comparing ? "Crunching fares…" : "get best fare 💰"}
          </button>
        )}
      </div>

      {/* Comparison results */}
      {comparing && (
        <div className="mt-4 space-y-2">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="h-20 animate-pulse rounded-2xl bg-muted" />
          <div className="h-20 animate-pulse rounded-2xl bg-muted" />
          <div className="h-20 animate-pulse rounded-2xl bg-muted" />
        </div>
      )}

      {!comparing && compareError && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          {compareError}
        </div>
      )}

      {!comparing && route && options.length > 0 && (
        <div className="mt-5">
          <p className="px-1 text-[11px] font-medium uppercase tracking-wider text-primary/80">
            estimated fares — actual prices set by the provider and may surge
          </p>
          <div className="mt-1 px-1 text-xs text-muted-foreground">
            {route.km} km · ~{route.mins} min
          </div>
          <div className="mt-2 space-y-2">
            {options.map((opt, i) => (
              <FareCard
                key={opt.providerId}
                opt={opt}
                best={i === 0}
                uberHref={uberHref}
                olaHref={olaHref}
                onBlocked={needDestination}
              />
            ))}
          </div>
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            Final fare & driver assignment happen in the provider's app.
          </p>
        </div>
      )}

      {/* Providers, filtered by city */}
      <CityProviders
        city={city}
        geoState={geoState}
        destination={destination}
        uberHref={uberHref}
        olaHref={olaHref}
        showElsewhere={showElsewhere}
        setShowElsewhere={setShowElsewhere}
        onBlocked={needDestination}
      />


      <p className="mt-6 text-center text-xs text-muted-foreground">
        Rides are booked and paid in the provider's app. Pickup uses your live location.
      </p>
    </div>
  );
}

function FareCard({
  opt,
  best,
  uberHref,
  olaHref,
  onBlocked,
}: {
  opt: ServerRideOption;
  best: boolean;
  uberHref?: string;
  olaHref?: string;
  onBlocked: (e: React.MouseEvent) => void;
}) {
  const isUber = opt.providerId === "uber";
  const isOla = opt.providerId === "ola";
  const href = isUber
    ? uberHref
    : isOla
      ? olaHref
      : opt.providerId.startsWith("rapido")
        ? "https://rapido.bike"
        : opt.providerId === "indrive"
          ? "https://indrive.com"
          : undefined;
  const inApp = !isUber && !!href;
  const Icon = opt.icon === "bike" ? Bike : Car;

  const inner = (
    <>
      <div
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white"
        style={{ backgroundColor: opt.color }}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">{opt.providerName}</div>
          <div className="text-xs text-muted-foreground">{opt.vehicle}</div>
          {best && (
            <span className="ml-auto rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">
              Best price 💸
            </span>
          )}
        </div>
        <div className="mt-1 text-base font-bold">
          ₹{opt.fareLow}–{opt.fareHigh}
        </div>
        <div className="text-xs text-muted-foreground">~{opt.etaMins} min trip</div>
      </div>
    </>
  );

  const cls = "flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/40";
  if (!href) {
    return (
      <a
        href="#"
        data-testid={`fare-card-${opt.providerId}`}
        aria-disabled="true"
        onClick={onBlocked}
        className={cls + " opacity-70"}
      >
        {inner}
      </a>
    );
  }
  return (
    <a
      href={href}
      data-testid={`fare-card-${opt.providerId}`}
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
      {inner}
    </a>
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
  tag,
}: {
  name: string;
  desc: string;
  color: string;
  icon: typeof Car;
  href?: string;
  testId: string;
  onBlocked?: (e: React.MouseEvent) => void;
  inApp?: boolean;
  tag?: string;
}) {
  const body = (
    <>
      <div className="grid h-11 w-11 place-items-center rounded-xl text-white" style={{ backgroundColor: color }}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">{name}</div>
          {tag && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
              {tag}
            </span>
          )}
        </div>
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

function CityProviders({
  city,
  geoState,
  destination,
  uberHref,
  olaHref,
  showElsewhere,
  setShowElsewhere,
  onBlocked,
}: {
  city: DetectedCity;
  geoState: "locating" | "ready" | "denied";
  destination: Point | null;
  uberHref?: string;
  olaHref?: string;
  showElsewhere: boolean;
  setShowElsewhere: (v: boolean) => void;
  onBlocked: (e: React.MouseEvent) => void;
}) {
  const { available, elsewhere } = useMemo(() => splitByCity(city), [city]);

  function hrefFor(p: RP): string | undefined {
    if (p.id === "uber") return uberHref ?? p.webUrl;
    if (p.id === "ola") return olaHref ?? p.webUrl;
    return p.webUrl;
  }
  function descFor(p: RP): string {
    if (p.id === "uber" && destination) return "Opens Uber with your destination pre-filled";
    if (p.id === "ola" && destination) return "Opens Ola booking with your drop location";
    return p.desc;
  }

  const hint =
    geoState === "denied"
      ? "turn on location for ur city's full lineup 📍"
      : city && city.id !== "other"
        ? `in ${city.label} rn`
        : null;

  return (
    <div data-testid="city-providers">
      <h2 className="mt-6 px-1 font-display text-sm uppercase tracking-wider text-muted-foreground">
        pick your ride, main character
      </h2>
      {hint && <p className="mt-1 px-1 text-xs text-primary/80">{hint}</p>}
      <div className="mt-3 space-y-2">
        {available.map((p) => (
          <Provider
            key={p.id}
            name={p.name}
            desc={descFor(p)}
            color={p.color}
            icon={p.icon === "bike" ? Bike : Car}
            href={hrefFor(p)}
            testId={`ride-${p.id}`}
            onBlocked={p.id === "uber" || p.id === "ola" ? onBlocked : undefined}
            inApp
            tag={p.tag}
          />
        ))}
      </div>

      {elsewhere.length > 0 && (
        <div className="mt-4">
          <button
            data-testid="toggle-elsewhere"
            onClick={() => setShowElsewhere(!showElsewhere)}
            className="flex w-full items-center justify-between rounded-2xl border border-dashed border-border bg-card/50 px-4 py-2.5 text-left text-xs text-muted-foreground"
          >
            <span>
              not in {city?.label ?? "your area"} yet 🙅 ({elsewhere.length})
            </span>
            <ChevronDown className={`h-4 w-4 transition ${showElsewhere ? "rotate-180" : ""}`} />
          </button>
          {showElsewhere && (
            <div className="mt-2 space-y-2">
              {elsewhere.map((p) => (
                <Provider
                  key={p.id}
                  name={p.name}
                  desc={descFor(p)}
                  color={p.color}
                  icon={p.icon === "bike" ? Bike : Car}
                  href={hrefFor(p)}
                  testId={`ride-${p.id}`}
                  inApp
                  tag={p.tag}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

