// ONIQ Mini Apps — partner integrations via universal/deep links + in-app browser.
// Strategy: no partner API keys needed. Apps open INSIDE ONIQ (Capacitor in-app
// browser sheet on device, new tab on web). Deep links hand off to the native
// partner app when installed, pre-filled with context (destination, amount).

// Registry data moved to src/data/appRegistry.ts — this module keeps the
// launch helpers and re-exports the registry for existing imports.
export {
  APP_REGISTRY as MINI_APPS,
  CATEGORY_LABELS,
  appAvailableIn,
  visibleApps,
  effectiveLaunchType,
  queryPackageIds,
  ALL_COUNTRIES,
} from "@/data/appRegistry";
export type {
  AppEntry as MiniApp,
  Country as CountryCode,
  CategoryId,
  TileLabel,
} from "@/data/appRegistry";
import { effectiveLaunchType as _effLaunch, type AppEntry } from "@/data/appRegistry";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

// ---------------- Seamless switch-and-return launcher ----------------

type PendingReturn = { app: string; at: number };
let pendingReturnMem: PendingReturn | null = null;
const PENDING_KEY = "oniq:pendingMiniAppReturn";
const RETURN_WINDOW_MS = 30 * 60 * 1000;

function writePending(p: PendingReturn) {
  pendingReturnMem = p;
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* storage blocked — module var is enough */
  }
}

export function consumePendingReturn(): PendingReturn | null {
  let p: PendingReturn | null = pendingReturnMem;
  if (!p) {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (raw) p = JSON.parse(raw) as PendingReturn;
    } catch {
      /* ignore */
    }
  }
  pendingReturnMem = null;
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
  if (!p) return null;
  if (Date.now() - p.at > RETURN_WINDOW_MS) return null;
  return p;
}

function isAndroid() {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

async function isCapacitorNative(): Promise<boolean> {
  try {
    const { Capacitor } = await import(/* @vite-ignore */ "@capacitor/core");
    return Capacitor.isNativePlatform?.() ?? false;
  } catch {
    return false;
  }
}

/**
 * Open a URL outside the Capacitor webview.
 * - Native: Capacitor Browser (Chrome Custom Tab) — honours Android app links,
 *   so https universal links like m.uber.com/ul/ launch the installed app.
 * - Web: opens in a new tab.
 */
export async function openInApp(url: string) {
  try {
    if (await isCapacitorNative()) {
      const mod = await import(/* @vite-ignore */ "@capacitor/browser");
      await mod.Browser.open({ url, presentationStyle: "popover", toolbarColor: "#0E0F13" });
      return;
    }
  } catch {
    /* fall through to web */
  }
  // Anchor click works even when window.open is blocked, and always opens
  // in a new tab so ONIQ never navigates away.
  try {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener,noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  } catch {
    /* ignore */
  }
  try {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) return;
  } catch {
    /* ignore */
  }
  window.location.href = url;
}

/**
 * Web-only: try to launch a native app via its custom scheme (e.g. uber://).
 * Uses a hidden iframe + visibility change detection with a 1200ms timeout.
 * Resolves true if the app appears to have been opened (page went hidden),
 * false if the scheme handler didn't fire (app not installed).
 */
async function tryWebAppScheme(scheme: string): Promise<boolean> {
  if (typeof document === "undefined") return false;
  return new Promise((resolve) => {
    let done = false;
    const finish = (opened: boolean) => {
      if (done) return;
      done = true;
      document.removeEventListener("visibilitychange", onVis);
      try { iframe.remove(); } catch { /* ignore */ }
      resolve(opened);
    };
    const onVis = () => { if (document.hidden) finish(true); };
    document.addEventListener("visibilitychange", onVis);
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;left:-10000px;width:1px;height:1px;border:0;";
    iframe.src = scheme;
    try {
      document.body.appendChild(iframe);
    } catch {
      finish(false);
      return;
    }
    setTimeout(() => finish(document.hidden), 1200);
  });
}

/**
 * Launch a partner mini app.
 * - Native Android + androidPackage → intent:// with baked-in https fallback
 *   (OS opens the app when installed, otherwise Chrome opens the fallback).
 * - Native without a package → Chrome Custom Tab on the https URL.
 * - Web + appScheme → try scheme via hidden iframe, wait 1200ms, fall back to
 *   https in a new tab if the app didn't intercept.
 * - Web without appScheme → https in a new tab.
 * Any unrecoverable failure toasts and force-opens the https URL.
 */
export async function launchMiniApp(app: {
  name: string;
  url: string;
  androidPackage?: string;
  appScheme?: string;
}) {
  writePending({ app: app.name, at: Date.now() });
  if (typeof window === "undefined") return;
  try {
    const native = await isCapacitorNative();
    if (native) {
      if (isAndroid() && app.androidPackage) {
        const fallback = encodeURIComponent(app.url);
        const intent = `intent://#Intent;package=${app.androidPackage};S.browser_fallback_url=${fallback};end`;
        try {
          const mod: any = await import(/* @vite-ignore */ "@capacitor/app");
          await mod.App.openUrl({ url: intent });
          return;
        } catch {
          /* fall through to Custom Tab */
        }
      }
      await openInApp(app.url);
      return;
    }
    // Web path
    if (app.appScheme) {
      const opened = await tryWebAppScheme(app.appScheme);
      if (opened) return;
    }
    await openInApp(app.url);
  } catch {
    try {
      const { toast } = await import(/* @vite-ignore */ "sonner");
      toast("couldn't open that one 🤔 opening web instead");
    } catch { /* ignore */ }
    try { await openInApp(app.url); } catch { /* ignore */ }
  }
}



/**
 * Registry-driven launcher — the one three-tier fallback for every AppEntry:
 * 1) native app (package intent / scheme), 2) Play Store listing, 3) webUrl
 * in a Custom Tab. verified:false entries never attempt a native launch
 * (effectiveLaunchType forces webOnly). Built on the same primitives as the
 * Ride Genie launcher above — not a second launcher.
 */
export async function launchAppEntry(entry: AppEntry): Promise<void> {
  writePending({ app: entry.name, at: Date.now() });
  if (typeof window === "undefined") return;
  const mode = _effLaunch(entry);
  try {
    const native = await isCapacitorNative();
    if (native && isAndroid()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import(/* @vite-ignore */ "@capacitor/app");
      if (mode === "package" && entry.packageId) {
        // Tier 1 — the app itself; the intent carries a baked-in web fallback
        // the OS uses when neither the app nor a handler resolves.
        try {
          const intent = `intent://#Intent;package=${entry.packageId};S.browser_fallback_url=${encodeURIComponent(entry.webUrl)};end`;
          await mod.App.openUrl({ url: intent });
          return;
        } catch {
          /* not installed / not resolvable — Tier 2 */
        }
        try {
          await mod.App.openUrl({ url: `market://details?id=${entry.packageId}` });
          return;
        } catch {
          /* no Play Store — Tier 3 */
        }
      }
      if (mode === "scheme" && entry.scheme) {
        try {
          await mod.App.openUrl({ url: entry.scheme });
          return;
        } catch {
          /* scheme unhandled — Tier 3 */
        }
      }
      await openInApp(entry.webUrl);
      return;
    }
    if (native) {
      await openInApp(entry.webUrl);
      return;
    }
    // Web platform — scheme probe, then web.
    if (mode !== "webOnly" && entry.scheme) {
      const opened = await tryWebAppScheme(entry.scheme);
      if (opened) return;
    }
    await openInApp(entry.webUrl);
  } catch {
    try {
      await openInApp(entry.webUrl);
    } catch {
      /* ignore */
    }
  }
}

/** Fire an OS-level deep link (upi://, uber:// etc). Returns immediately. */
export function openDeepLink(url: string) {
  window.location.href = url;
}

/**
 * Launch a UPI intent so the OS resolves it to the user's UPI app
 * (GPay / PhonePe / Paytm / BHIM chooser on Android).
 * Native Capacitor: hand the URL to `@capacitor/app` App.openUrl — the
 * default Android WebViewClient silently rejects custom schemes on
 * <a href> clicks (`ERR_UNKNOWN_URL_SCHEME`), so we MUST go through
 * the OS intent system. Web: window.location.href.
 */
export async function launchUpiIntent(url: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const native = await isCapacitorNative();
    if (native) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod: any = await import(/* @vite-ignore */ "@capacitor/app");
        await mod.App.openUrl({ url });
        return;
      } catch (err) {
        // openUrl throws when no app can handle the scheme.
        try {
          const { toast } = await import(/* @vite-ignore */ "sonner");
          toast.error("No UPI app installed — try Google Pay, PhonePe, or Paytm");
        } catch { /* ignore */ }
        console.warn("[upi] openUrl failed", err);
        return;
      }
    }
    // Web path — Chrome handles upi:// via the OS intent chooser.
    window.location.href = url;
  } catch (err) {
    console.warn("[upi] launch failed", err);
    try { window.location.href = url; } catch { /* ignore */ }
  }
}


// ---------------- UPI (NPCI standard intent) ----------------

export type UpiParams = {
  vpa: string; // payee UPI ID, e.g. name@okhdfcbank
  name: string; // payee display name
  amount?: number; // optional; user can enter in the UPI app
  note?: string;
};

function upiQuery({ vpa, name, amount, note }: UpiParams) {
  const q = new URLSearchParams();
  q.set("pa", vpa.trim());
  q.set("pn", name.trim() || vpa.trim());
  if (Number.isFinite(amount) && amount! > 0 && amount! <= 100000) q.set("am", amount!.toFixed(2));
  q.set("cu", "INR");
  if (note?.trim()) q.set("tn", note.trim().slice(0, 50));
  return q.toString();
}

/** Generic UPI intent — Android shows a chooser of all installed UPI apps. */
export function upiLink(p: UpiParams) {
  return `upi://pay?${upiQuery(p)}`;
}

/**
 * Payee-only intent for manual P2P sends. PhonePe (and others) decline
 * third-party intents that pre-fill an amount — "declined for security
 * reasons" — so the payer types the amount inside their own UPI app.
 */
export function upiPayeeLink({ vpa, name }: Pick<UpiParams, "vpa" | "name">) {
  const q = new URLSearchParams();
  q.set("pa", vpa.trim());
  q.set("pn", name.trim() || vpa.trim());
  q.set("cu", "INR");
  return `upi://pay?${q.toString()}`;
}

/** App-targeted UPI intents. */
export const UPI_APPS = [
  { id: "any", name: "Any UPI app", scheme: (p: UpiParams) => `upi://pay?${upiQuery(p)}`, color: "#00D4B8" },
  { id: "gpay", name: "Google Pay", scheme: (p: UpiParams) => `tez://upi/pay?${upiQuery(p)}`, color: "#4285F4", emoji: "💳" },
  { id: "phonepe", name: "PhonePe", scheme: (p: UpiParams) => `phonepe://pay?${upiQuery(p)}`, color: "#5F259F", emoji: "📲" },
  { id: "paytm", name: "Paytm", scheme: (p: UpiParams) => `paytmmp://pay?${upiQuery(p)}`, color: "#00BAF2", emoji: "💰" },
] as const;

export function isValidVpa(vpa: string) {
  return /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}$/.test(vpa.trim());
}

// ---------------- Ride deep links ----------------

export type RidePoint = { lat: number; lon: number; label: string };

/**
 * Uber universal link. Pickup defaults to the rider's current location
 * (supported natively via pickup=my_location per Uber's deep link docs).
 */
export function uberLink(drop: RidePoint, pickup?: RidePoint) {
  if (!Number.isFinite(drop.lat) || !Number.isFinite(drop.lon)) throw new Error("Invalid destination");
  const q = new URLSearchParams();
  q.set("action", "setPickup");
  if (pickup) {
    q.set("pickup[latitude]", String(pickup.lat));
    q.set("pickup[longitude]", String(pickup.lon));
    q.set("pickup[nickname]", pickup.label.slice(0, 60));
  } else {
    q.set("pickup", "my_location");
  }
  q.set("dropoff[latitude]", String(drop.lat));
  q.set("dropoff[longitude]", String(drop.lon));
  q.set("dropoff[nickname]", drop.label.slice(0, 60));
  return `https://m.uber.com/ul/?${q.toString()}`;
}

export function olaLink(drop: RidePoint, pickup?: RidePoint) {
  if (!Number.isFinite(drop.lat) || !Number.isFinite(drop.lon)) throw new Error("Invalid destination");
  const q = new URLSearchParams();
  q.set("serviceType", "p2p");
  q.set("utm_source", "oniq");
  if (pickup) {
    q.set("lat", String(pickup.lat));
    q.set("lng", String(pickup.lon));
  }
  q.set("drop_lat", String(drop.lat));
  q.set("drop_lng", String(drop.lon));
  return `https://book.olacabs.com/?${q.toString()}`;
}

// ---------------- Geocoding (Mappls primary, Nominatim fallback) ----------------

export type GeoResult = { lat: number; lon: number; label: string };

async function invokeMappls(payload: { op: "geocode" | "reverse" | "autosuggest"; query?: string; lat?: number; lon?: number; near?: string }): Promise<any | null> {
  try {
    const { supabase } = await import(/* @vite-ignore */ "@/integrations/supabase/client");
    const { data, error } = await supabase.functions.invoke("mappls-geo", { body: payload });
    if (error) { console.warn("[mappls-geo] invoke error", error?.message ?? error); return null; }
    return data;
  } catch (e) {
    console.warn("[mappls-geo] invoke threw", e);
    return null;
  }
}

async function nominatimGeocode(query: string): Promise<GeoResult[]> {
  const res = await fetchWithTimeout(
    `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error("Search failed");
  const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  return rows
    .map((r) => ({
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      label: r.display_name.split(",").slice(0, 3).join(","),
    }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

export async function geocode(query: string): Promise<GeoResult[]> {
  const data = await invokeMappls({ op: "geocode", query });
  if (data?.source === "mappls" && Array.isArray(data.results) && data.results.length > 0) {
    return data.results as GeoResult[];
  }
  return nominatimGeocode(query);
}

/**
 * Mappls autosuggest — exported for future UI wiring. Silently falls back to
 * Nominatim forward search so callers always get something usable.
 */
export async function autosuggest(query: string, near?: { lat: number; lon: number }): Promise<GeoResult[]> {
  const data = await invokeMappls({ op: "autosuggest", query, lat: near?.lat, lon: near?.lon });
  if (data?.source === "mappls" && Array.isArray(data.results) && data.results.length > 0) {
    return data.results as GeoResult[];
  }
  return nominatimGeocode(query);
}

// ---------------- Ride Genie: routing + fare estimation ----------------

export type RouteInfo = { km: number; mins: number };

export async function getRoute(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): Promise<RouteInfo> {
  if (
    !Number.isFinite(from.lat) ||
    !Number.isFinite(from.lon) ||
    !Number.isFinite(to.lat) ||
    !Number.isFinite(to.lon)
  ) {
    throw new Error("Invalid coordinates");
  }
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Route service unavailable");
  const data = (await res.json()) as { routes?: Array<{ distance: number; duration: number }> };
  const r = data.routes?.[0];
  if (!r) throw new Error("No route found");
  return {
    km: Math.round((r.distance / 1000) * 10) / 10,
    mins: Math.ceil(r.duration / 60),
  };
}

export type RideOption = {
  providerId: "uber" | "ola" | "rapido-bike" | "rapido-auto";
  providerName: string;
  vehicle: string;
  color: string;
  fareLow: number;
  fareHigh: number;
  etaMins: number;
};

export function estimateRides(km: number, mins: number): RideOption[] {
  const models: Array<{
    providerId: RideOption["providerId"];
    providerName: string;
    vehicle: string;
    color: string;
    base: number;
  }> = [
    { providerId: "uber", providerName: "Uber", vehicle: "Uber Go", color: "#000000", base: 50 + 15 * km + 1.5 * mins },
    { providerId: "ola", providerName: "Ola", vehicle: "Ola Mini", color: "#3b7d0e", base: 55 + 14 * km + 1.5 * mins },
    { providerId: "rapido-bike", providerName: "Rapido", vehicle: "Bike", color: "#A67C00", base: 20 + 8 * km + 1.0 * mins },
    { providerId: "rapido-auto", providerName: "Rapido", vehicle: "Auto", color: "#A67C00", base: 30 + 11 * km + 1.25 * mins },
  ];
  return models
    .map((m) => ({
      providerId: m.providerId,
      providerName: m.providerName,
      vehicle: m.vehicle,
      color: m.color,
      fareLow: Math.round(m.base * 0.9),
      fareHigh: Math.round(m.base * 1.2),
      etaMins: mins,
    }))
    .sort((a, b) => a.fareLow - b.fareLow);
}

// ---------------- Phone GPS: native-first with browser fallback ----------------

export async function getCurrentLocation(): Promise<{ lat: number; lon: number }> {
  try {
    const mod: any = await import(/* @vite-ignore */ "@capacitor/geolocation");
    const Geolocation = mod.Geolocation;
    if (Geolocation) {
      try {
        await Geolocation.requestPermissions();
      } catch {
        // ignore — getCurrentPosition will surface a real failure
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      const lat = pos?.coords?.latitude;
      const lon = pos?.coords?.longitude;
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    }
  } catch {
    // native path unavailable — fall through to browser
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("location unavailable");
  }
  return await new Promise<{ lat: number; lon: number }>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => reject(new Error("location unavailable")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });
}

async function nominatimReverse(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return "Your current location";
    const data = (await res.json()) as { display_name?: string };
    const dn = data?.display_name;
    if (!dn) return "Your current location";
    return dn.split(",").slice(0, 3).join(",").trim();
  } catch {
    return "Your current location";
  }
}

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const data = await invokeMappls({ op: "reverse", lat, lon });
  if (data?.source === "mappls" && typeof data.label === "string" && data.label.trim()) {
    return data.label.trim();
  }
  return nominatimReverse(lat, lon);
}

export function relativeLuminance(hex: string): number {
  if (typeof hex !== "string") return 0;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return 0;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function readableInk(hex: string): string {
  return relativeLuminance(hex) > 0.179 ? "#0E0F13" : "#FFFFFF";
}
