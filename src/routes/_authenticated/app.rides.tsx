import { moneyIn } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { placesAutocomplete, placeDetails, type PlaceSuggestion } from "@/lib/places.functions";
import { staticRouteMap } from "@/lib/mapImage.functions";
import {
  MapPin,
  Navigation,
  Search,
  Car,
  Bike,
  Mic,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  IndianRupee,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  OniqAIOrb,
  OniqCanvas,
  OniqCard,
  OniqError,
  OniqHeader,
  OniqSectionHeader,
  OniqSkeleton,
  OniqSkeletonRows,
} from "@/components/oniq";
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
  const [pickupSuggests, setPickupSuggests] = useState<PlaceSuggestion[]>([]);
  const [destSuggests, setDestSuggests] = useState<PlaceSuggestion[]>([]);

  const autocompleteFn = useServerFn(placesAutocomplete);
  const detailsFn = useServerFn(placeDetails);

  const [genie, setGenie] = useState("");
  const [micSupported, setMicSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const [route, setRoute] = useState<{ km: number; mins: number } | null>(null);
  const [options, setOptions] = useState<ServerRideOption[]>([]);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  // Map-first: a picture of the route appears the moment both points are
  // known, before anyone presses "compare fares" — the map IS the first
  // confirmation that the two points make sense together.
  const mapFn = useServerFn(staticRouteMap);
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  // Detect mic support (browser-only)
  useEffect(() => {
    const w = window as any;
    if (w.SpeechRecognition || w.webkitSpeechRecognition) setMicSupported(true);
  }, []);

  // Google Places Autocomplete — debounced. Fails silently → user can still
  // press the search button (Mappls/Nominatim geocode) or type freely.
  useEffect(() => {
    const q = pickupQuery.trim();
    if (q.length < 2 || !pickupEditing) {
      setPickupSuggests([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const near = pickup ? { lat: pickup.lat, lon: pickup.lon } : undefined;
        const { suggestions } = await autocompleteFn({ data: { input: q, near } });
        if (!cancelled) setPickupSuggests(suggestions);
      } catch (e) {
        if (!cancelled) setPickupSuggests([]);
        console.warn("[places] pickup autocomplete failed", (e as Error)?.message);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [pickupQuery, pickupEditing, pickup, autocompleteFn]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || destination) {
      setDestSuggests([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const near = pickup ? { lat: pickup.lat, lon: pickup.lon } : undefined;
        const { suggestions } = await autocompleteFn({ data: { input: q, near } });
        if (!cancelled) setDestSuggests(suggestions);
      } catch (e) {
        if (!cancelled) setDestSuggests([]);
        console.warn("[places] destination autocomplete failed", (e as Error)?.message);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, destination, pickup, autocompleteFn]);

  async function resolveSuggest(s: PlaceSuggestion): Promise<Point | null> {
    try {
      const d = await detailsFn({ data: { placeId: s.placeId } });
      return { lat: d.lat, lon: d.lon, label: d.label };
    } catch (e) {
      console.warn("[places] details failed, falling back to geocode", (e as Error)?.message);
      const label = [s.label, s.secondary].filter(Boolean).join(", ");
      const r = await geocode(label);
      if (r[0]) return { lat: r[0].lat, lon: r[0].lon, label: r[0].label };
      toast.error("Couldn't resolve that address — try another");
      return null;
    }
  }

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
  }, []);

  // If the browser never surfaces the permission prompt, flip to denied after ~12s
  useEffect(() => {
    if (geoState !== "locating") return;
    const t = setTimeout(() => {
      setGeoState((s) => (s === "locating" && !pickup ? "denied" : s));
    }, 12000);
    return () => clearTimeout(t);
  }, [geoState, pickup]);

  // Fetch the map picture only when the two POINTS actually change, not on
  // every keystroke or re-render — pickup/destination change rarely, so this
  // costs one Static Maps call per route a person actually forms.
  useEffect(() => {
    if (!pickup || !destination) {
      setMapUrl(null);
      setMapFailed(false);
      return;
    }
    let alive = true;
    setMapFailed(false);
    mapFn({
      data: {
        pickup: { lat: pickup.lat, lon: pickup.lon },
        destination: { lat: destination.lat, lon: destination.lon },
      },
    })
      .then((res) => {
        if (alive) setMapUrl(res.dataUrl);
      })
      .catch(() => {
        // A map is a nice-to-have next to actually booking a ride — never
        // block the flow on it, just show nothing where it would have been.
        if (alive) {
          setMapUrl(null);
          setMapFailed(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [pickup?.lat, pickup?.lon, destination?.lat, destination?.lon, mapFn]);

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
      const payload = data as {
        route?: { km: number; mins: number };
        options?: ServerRideOption[];
        error?: string;
      };
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

  async function handleGenieRegex(text: string) {
    const raw = text.trim();
    if (!raw) return;
    const stripped = raw.replace(/^(book me a ride|book a ride|ride|cab)\s+/i, "").trim();
    const m = stripped.match(/(?:from\s+)?(.+?)\s+to\s+(.+)/i);
    try {
      let pickPt: Point | null = null;
      let dropPt: Point | null = null;
      if (m) {
        const [, fromStr, toStr] = m;
        const [fromRes, toRes] = await Promise.all([
          geocode(fromStr.trim()),
          geocode(toStr.trim()),
        ]);
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

  async function handleGenie(text: string) {
    const raw = text.trim();
    if (!raw) return;
    try {
      let lang = "en";
      try {
        const m = await import("@/lib/userLanguage");
        lang = await m.getUserLanguage();
      } catch {
        /* noop */
      }
      const { data, error } = await supabase.functions.invoke("ride-genie", {
        body: { text: raw, currentLabel: pickup?.label, lang },
      });
      if (error) return handleGenieRegex(raw);
      const payload = data as {
        source?: string;
        parsed?: {
          intent: "book" | "compare" | "unclear";
          pickup: string | null;
          destination: string | null;
          vehicle: "bike" | "auto" | "car" | "any" | null;
          reply: string | null;
        };
      };
      if (payload?.source !== "llm" || !payload.parsed) return handleGenieRegex(raw);
      const p = payload.parsed;
      if (p.intent === "unclear") {
        toast.info(p.reply ?? "couldn't catch that — try again bestie");
        return;
      }
      if (!p.destination) return handleGenieRegex(raw);

      const dropRes = await geocode(p.destination);
      if (!dropRes.length) {
        toast.error("couldn't find that place — add your city name");
        return;
      }
      const dropPt: Point = { lat: dropRes[0].lat, lon: dropRes[0].lon, label: dropRes[0].label };

      let pickPt: Point | null = pickup;
      if (p.pickup) {
        const pickRes = await geocode(p.pickup);
        if (!pickRes.length) {
          toast.error("couldn't find that pickup — add your city name");
          return;
        }
        pickPt = { lat: pickRes[0].lat, lon: pickRes[0].lon, label: pickRes[0].label };
        setPickup(pickPt);
        setPickupIsCurrent(false);
      }
      if (!pickPt) {
        toast.error("Waiting on your location — try again in a sec");
        return;
      }
      setDestination(dropPt);
      setQuery(dropPt.label);
      setResults([]);
      await runCompare(pickPt, dropPt);
    } catch {
      // silent fallback — no user-visible error
      return handleGenieRegex(raw);
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
        explicitPickup
          ? { lat: explicitPickup.lat, lon: explicitPickup.lon, label: explicitPickup.label }
          : undefined,
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
    <OniqCanvas world="rides" className="pb-8">
      <OniqHeader
        eyebrow="Rides"
        title="Book a ride"
        subtitle="Pickup, destination, then every fare in your city side by side."
        back="/app"
      >
        {/* Genie bar */}
        <div className="flex items-center gap-2 rounded-full oniq-surface py-1.5 pe-1.5 ps-2">
          <OniqAIOrb size="sm" still={!listening} />
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
            aria-label="Ride genie"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {micSupported && (
            <button
              type="button"
              data-testid="genie-mic"
              onClick={toggleMic}
              className={`press grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                listening
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-world text-white world-glow"
              }`}
              aria-label="Voice command"
            >
              <Mic className="h-4 w-4" />
            </button>
          )}
        </div>
      </OniqHeader>

      {/* Route panel — origin → destination, drawn in CSS. There is no map
          SDK and no map key on the client, and this needs neither. */}
      <section className="mt-5 px-5 rise rise-1">
        <OniqCard padding="none" className="overflow-hidden">
          <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 p-4">
            {/* Stop 1 — pickup */}
            <div className="flex flex-col items-center" aria-hidden="true">
              <span className="mt-1.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-world-soft">
                <span className="h-2.5 w-2.5 rounded-full bg-world" />
              </span>
              <span className="mt-1 w-0.5 flex-1 rounded-full bg-world opacity-60" />
            </div>
            <div className="min-w-0">
              <button
                type="button"
                data-testid="pickup-row"
                onClick={() => {
                  setPickupEditing((v) => !v);
                  if (!pickupEditing)
                    setPickupQuery(pickup && !pickupIsCurrent ? pickup.label : "");
                }}
                className="flex w-full items-center gap-3 text-start"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {pickup && pickupIsCurrent ? "Your location · 📍 current" : "Pickup"}
                  </div>
                  <div className="mt-0.5 truncate text-sm font-medium normal-case text-foreground">
                    {geoState === "locating" && !pickup
                      ? "Locating you…"
                      : pickup
                        ? pickup.label
                        : "tap to set pickup"}
                  </div>
                </div>
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition rtl:-scale-x-100 ${
                    pickupEditing ? "rotate-90" : ""
                  }`}
                />
              </button>

              {pickupEditing && (
                <div className="mt-3 space-y-3">
                  <button
                    type="button"
                    data-testid="use-current-location"
                    onClick={() => {
                      setPickupEditing(false);
                      setPickupResults([]);
                      setPickupQuery("");
                      locateMe(true);
                    }}
                    disabled={locating}
                    className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-world py-2.5 text-sm font-semibold text-white world-glow disabled:opacity-60"
                  >
                    <Navigation className="h-4 w-4" />
                    {locating ? "Locating…" : "📍 use current location"}
                  </button>

                  <div className="flex gap-2">
                    <div className="relative min-w-0 flex-1">
                      <MapPin className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        data-testid="pickup-search-input"
                        value={pickupQuery}
                        onChange={(e) => setPickupQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && searchPickup()}
                        placeholder="search a pickup address…"
                        className="w-full rounded-2xl border border-border-strong bg-background py-3 pe-3 ps-10 text-sm text-foreground focus:border-world focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={searchPickup}
                      aria-label="Search pickup address"
                      disabled={pickupSearching}
                      className="press grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-world text-white disabled:opacity-50"
                    >
                      <Search className="h-4 w-4" />
                    </button>
                  </div>

                  {pickupSearching && <OniqSkeleton className="h-10 w-full" />}

                  {pickupSuggests.length > 0 && (
                    <div className="space-y-1">
                      {pickupSuggests.map((s, i) => (
                        <button
                          key={s.placeId}
                          type="button"
                          data-testid={`pickup-suggest-${i}`}
                          onClick={async () => {
                            const pt = await resolveSuggest(s);
                            if (!pt) return;
                            setPickup(pt);
                            setPickupIsCurrent(false);
                            setPickupSuggests([]);
                            setPickupResults([]);
                            setPickupQuery(pt.label);
                            setPickupEditing(false);
                            toast.success("Pickup set 📍 " + pt.label);
                          }}
                          className="press flex w-full items-start gap-2 rounded-xl p-2.5 text-start text-sm normal-case hover:bg-surface-2"
                        >
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-world" />
                          <div className="min-w-0 flex-1">
                            <div className="line-clamp-1 font-medium text-foreground">
                              {s.label}
                            </div>
                            {s.secondary && (
                              <div className="line-clamp-1 text-xs font-normal text-muted-foreground">
                                {s.secondary}
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {pickupResults.length > 0 && (
                    <div className="space-y-1">
                      {pickupResults.map((r, i) => (
                        <button
                          key={i}
                          type="button"
                          data-testid={`pickup-result-${i}`}
                          onClick={() => {
                            setPickup({ lat: r.lat, lon: r.lon, label: r.label });
                            setPickupIsCurrent(false);
                            setPickupResults([]);
                            setPickupQuery(r.label);
                            setPickupEditing(false);
                            toast.success("Pickup set 📍 " + r.label);
                          }}
                          className="press flex w-full items-start gap-2 rounded-xl p-2.5 text-start text-sm font-medium normal-case text-foreground hover:bg-surface-2"
                        >
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-world" />
                          <span className="line-clamp-2">{r.label}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {geoState === "denied" && (
                    <p className="text-xs text-muted-foreground">
                      Location is blocked — search a pickup address, or allow location and tap "use
                      current location".
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Stop 2 — destination */}
            <div className="flex flex-col items-center" aria-hidden="true">
              <span className="h-5 w-0.5 rounded-full bg-world opacity-60" />
              <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-world text-white world-glow">
                <MapPin className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="min-w-0 pt-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Destination
              </div>
              {destination ? (
                <button
                  type="button"
                  onClick={() => {
                    setDestination(null);
                    setQuery("");
                    setRoute(null);
                    setOptions([]);
                  }}
                  className="mt-0.5 flex w-full items-center gap-2 text-start"
                >
                  <span className="line-clamp-1 flex-1 text-sm font-medium normal-case text-foreground">
                    {destination.label}
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold text-world">change</span>
                </button>
              ) : (
                <div className="mt-0.5 text-sm font-medium text-muted-foreground">where to?</div>
              )}
            </div>
          </div>

          {/* Map-first: the route as a picture, the moment both points exist —
              this appears before anyone presses compare, not after. */}
          {pickup && destination && (
            <div className="border-t border-border px-4 py-3" data-testid="ride-map">
              {mapUrl ? (
                <img
                  src={mapUrl}
                  alt={`Route from ${pickup.label} to ${destination.label}`}
                  className="w-full rounded-2xl"
                />
              ) : mapFailed ? null : (
                <OniqSkeleton className="h-40 w-full rounded-2xl" />
              )}
            </div>
          )}

          {/* Route summary — distance and time once the server has crunched it */}
          {!comparing && route && (
            <div className="flex items-center gap-2 border-t border-border px-4 py-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-world-soft px-3 py-1 text-[12px] font-semibold text-world">
                <Navigation className="h-3.5 w-3.5" /> {route.km} km
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-world-soft px-3 py-1 text-[12px] font-semibold text-world">
                <Clock className="h-3.5 w-3.5" /> ~{route.mins} min
              </span>
            </div>
          )}
        </OniqCard>
      </section>

      {/* Where to? — destination search */}
      <section className="mt-3 px-5 rise rise-2">
        <OniqCard>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-world">
            Where to?
          </div>
          <div className="mt-2 flex gap-2">
            <div className="relative min-w-0 flex-1">
              <MapPin className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search()}
                placeholder="where we going? 👀 e.g. Howrah Station"
                aria-label="Destination"
                className="w-full rounded-2xl border border-border-strong bg-background py-3 pe-3 ps-10 text-sm text-foreground focus:border-world focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={search}
              aria-label="Search destination"
              disabled={searching}
              className="press grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-world text-white world-glow disabled:opacity-50"
            >
              <Search className="h-4 w-4" />
            </button>
          </div>

          {searching && <OniqSkeleton className="mt-3 h-10 w-full" />}

          {destSuggests.length > 0 && !destination && (
            <div className="mt-3 space-y-1">
              {destSuggests.map((s, i) => (
                <button
                  key={s.placeId}
                  type="button"
                  data-testid={`dest-suggest-${i}`}
                  onClick={async () => {
                    const pt = await resolveSuggest(s);
                    if (!pt) return;
                    setDestination(pt);
                    setDestSuggests([]);
                    setResults([]);
                    setQuery(pt.label);
                  }}
                  className="press flex w-full items-start gap-2 rounded-xl p-2.5 text-start text-sm normal-case hover:bg-surface-2"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-world" />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-1 font-medium text-foreground">{s.label}</div>
                    {s.secondary && (
                      <div className="line-clamp-1 text-xs font-normal text-muted-foreground">
                        {s.secondary}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {results.length > 0 && !destination && (
            <div className="mt-3 space-y-1">
              {results.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setDestination({ lat: r.lat, lon: r.lon, label: r.label });
                    setResults([]);
                    setQuery(r.label);
                  }}
                  className="press flex w-full items-start gap-2 rounded-xl p-2.5 text-start text-sm font-medium normal-case text-foreground hover:bg-surface-2"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-world" />
                  <span className="line-clamp-2">{r.label}</span>
                </button>
              ))}
            </div>
          )}

          {destination && pickup && (
            <button
              type="button"
              data-testid="ride-compare"
              onClick={() => runCompare(pickup, destination)}
              disabled={comparing}
              className="press mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-world py-3 text-sm font-semibold text-white world-glow disabled:opacity-50"
            >
              <IndianRupee className="h-4 w-4" />
              {comparing ? "Crunching fares…" : "get best fare 💰"}
            </button>
          )}
        </OniqCard>
      </section>

      {/* Best options — only what estimate-fares actually returned */}
      {comparing && (
        <section className="mt-6">
          <OniqSectionHeader eyebrow="Best options" title="Crunching fares…" />
          <OniqSkeletonRows rows={3} className="mt-3 px-5" />
        </section>
      )}

      {!comparing && compareError && (
        <div className="mt-6 px-5">
          <OniqError label={compareError} onRetry={() => runCompare(pickup, destination)} />
        </div>
      )}

      {!comparing && route && options.length > 0 && (
        <section className="mt-6 rise rise-3">
          <OniqSectionHeader eyebrow="Best options" title="estimated fares" />
          <p className="mt-1 px-5 text-[11px] text-muted-foreground">
            actual prices set by the provider and may surge · {route.km} km · ~{route.mins} min
          </p>
          <div className="mt-3 grid gap-2 px-5">
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
          <p className="mt-2 px-5 text-[11px] text-muted-foreground">
            Final fare & driver assignment happen in the provider's app.
          </p>
        </section>
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

      <p className="mt-8 px-5 text-center text-[11px] text-muted-foreground">
        Rides are booked and paid in the provider's app. Pickup uses your live location.
      </p>
    </OniqCanvas>
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
        className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-card"
        style={{ backgroundColor: opt.color }}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-[13px] text-foreground">{opt.providerName}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{opt.vehicle}</div>
        <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" /> ~{opt.etaMins} min trip
        </div>
      </div>
      <div className="shrink-0 text-end">
        <div className="font-display text-[17px] leading-none text-foreground">
          {moneyIn(opt.fareLow, "INR")}–{moneyIn(opt.fareHigh, "INR")}
        </div>
        {best && (
          <span className="mt-1.5 inline-block rounded-full bg-world px-2 py-0.5 text-[11px] font-semibold text-white">
            Best price 💸
          </span>
        )}
      </div>
    </>
  );

  const cls = `press flex w-full items-center gap-3 rounded-3xl p-4 text-start ${
    best ? "border border-world bg-world-soft" : "oniq-surface"
  }`;
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
      <div
        className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-card"
        style={{ backgroundColor: color }}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate font-display text-[13px] text-foreground">{name}</div>
          {tag && (
            <span className="shrink-0 rounded-full bg-world-soft px-2 py-0.5 text-[11px] font-medium text-world">
              {tag}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{desc}</div>
      </div>
      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
    </>
  );

  const cls = "press flex w-full items-center gap-3 rounded-3xl oniq-surface p-4 text-start";
  if (!href) {
    return (
      <a
        href="#"
        data-testid={testId}
        aria-disabled="true"
        onClick={onBlocked}
        className={cls + " opacity-70"}
      >
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
    <section data-testid="city-providers" className="mt-7 rise rise-4">
      <OniqSectionHeader eyebrow="Ride apps" title="pick your ride, main character" />
      {hint && <p className="mt-1 px-5 text-[12px] font-medium text-world">{hint}</p>}
      <div className="mt-3 grid gap-2 px-5">
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
        <div className="mt-3 px-5">
          <button
            type="button"
            data-testid="toggle-elsewhere"
            onClick={() => setShowElsewhere(!showElsewhere)}
            className="press flex w-full items-center justify-between rounded-2xl border border-dashed border-border-strong px-4 py-3 text-start text-[12px] font-medium normal-case text-muted-foreground"
          >
            <span>
              not in {city?.label ?? "your area"} yet 🙅 ({elsewhere.length})
            </span>
            <ChevronDown className={`h-4 w-4 transition ${showElsewhere ? "rotate-180" : ""}`} />
          </button>
          {showElsewhere && (
            <div className="mt-2 grid gap-2">
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
    </section>
  );
}
