// ONIQ Mini Apps — partner integrations via universal/deep links + in-app browser.
// Strategy: no partner API keys needed. Apps open INSIDE ONIQ (Capacitor in-app
// browser sheet on device, new tab on web). Deep links hand off to the native
// partner app when installed, pre-filled with context (destination, amount).

export type MiniApp = {
  id: string;
  name: string;
  tagline: string;
  category: "food" | "rides" | "quickcommerce" | "services" | "payments" | "social" | "shopping";
  url: string; // web URL opened in the in-app browser / same-tab fallback
  color: string; // brand tile color
  letter: string; // fallback monogram
  androidPackage?: string; // Android package id for intent:// deep launch
  appScheme?: string; // iOS/web deep-link scheme (e.g. "uber://"); triggers app-first with https fallback
  emoji?: string; // optional tile emoji instead of letter
};


export const MINI_APPS: MiniApp[] = [
  // Food
  { id: "swiggy", name: "Swiggy", tagline: "Food & grocery delivery", category: "food", url: "https://www.swiggy.com", color: "#FC8019", letter: "S" },
  { id: "zomato", name: "Zomato", tagline: "Restaurants & delivery", category: "food", url: "https://www.zomato.com", color: "#E23744", letter: "Z" },
  { id: "dominos", name: "Domino's", tagline: "Pizza delivery", category: "food", url: "https://www.dominos.co.in", color: "#0A6EBD", letter: "D" },
  // Rides 🚗
  { id: "uber", name: "Uber", tagline: "Book a cab", category: "rides", url: "https://m.uber.com", color: "#000000", letter: "U", androidPackage: "com.ubercab", emoji: "🚕" },
  { id: "ola", name: "Ola", tagline: "Cabs & autos", category: "rides", url: "https://book.olacabs.com", color: "#a4c639", letter: "O", androidPackage: "com.olacabs.customer", emoji: "🚖" },
  { id: "rapido", name: "Rapido", tagline: "Bike taxis & autos", category: "rides", url: "https://rapido.bike", color: "#FFCB05", letter: "R", androidPackage: "com.rapido.passenger", emoji: "🏍️" },
  { id: "indrive", name: "inDrive", tagline: "Name your fare", category: "rides", url: "https://indrive.com", color: "#C1F11D", letter: "I", androidPackage: "sinet.startup.inDriver", emoji: "💸" },
  { id: "nammayatri", name: "Namma Yatri", tagline: "Zero-commission autos", category: "rides", url: "https://nammayatri.in", color: "#FFCE00", letter: "N", androidPackage: "in.juspay.nammayatri", emoji: "🛺" },
  { id: "blusmart", name: "BluSmart", tagline: "All-electric cabs", category: "rides", url: "https://blu-smart.com", color: "#003DA5", letter: "B", androidPackage: "com.blusmart.rider", emoji: "⚡" },
  // Quick commerce 🛒
  { id: "zepto", name: "Zepto", tagline: "Groceries in 10 min", category: "quickcommerce", url: "https://www.zeptonow.com", color: "#7C3AED", letter: "Z", androidPackage: "com.zeptoconsumerapp", emoji: "⚡" },
  { id: "blinkit", name: "Blinkit", tagline: "Groceries in minutes", category: "quickcommerce", url: "https://blinkit.com", color: "#F8CB46", letter: "B", androidPackage: "com.grofers.customerapp", emoji: "🛍️" },
  { id: "instamart", name: "Swiggy Instamart", tagline: "Instant groceries", category: "quickcommerce", url: "https://www.swiggy.com/instamart", color: "#FC8019", letter: "I", androidPackage: "in.swiggy.android", emoji: "🥬" },
  { id: "bigbasket", name: "BigBasket", tagline: "Groceries & essentials", category: "quickcommerce", url: "https://www.bigbasket.com", color: "#84C225", letter: "B", androidPackage: "com.bigbasket.mobileapp", emoji: "🧺" },
  // Payments
  { id: "gpay", name: "Google Pay", tagline: "UPI payments", category: "payments", url: "https://pay.google.com", color: "#4285F4", letter: "G" },
  { id: "phonepe", name: "PhonePe", tagline: "UPI & recharges", category: "payments", url: "https://www.phonepe.com", color: "#5F259F", letter: "P" },
  { id: "paytm", name: "Paytm", tagline: "Payments & bills", category: "payments", url: "https://paytm.com", color: "#00BAF2", letter: "P" },
  // Social
  { id: "instagram", name: "Instagram", tagline: "Photos & reels", category: "social", url: "https://www.instagram.com", color: "#E1306C", letter: "I" },
  { id: "youtube", name: "YouTube", tagline: "Videos & shorts", category: "social", url: "https://m.youtube.com", color: "#FF0000", letter: "Y" },
  { id: "x", name: "X", tagline: "What's happening", category: "social", url: "https://x.com", color: "#111111", letter: "X" },
  { id: "reddit", name: "Reddit", tagline: "Communities", category: "social", url: "https://www.reddit.com", color: "#FF4500", letter: "R" },
  { id: "facebook", name: "Facebook", tagline: "Friends & groups", category: "social", url: "https://m.facebook.com", color: "#1877F2", letter: "F" },
  { id: "whatsapp", name: "WhatsApp", tagline: "Messaging", category: "social", url: "https://www.whatsapp.com", color: "#25D366", letter: "W" },
  { id: "telegram", name: "Telegram", tagline: "Chats & channels", category: "social", url: "https://web.telegram.org", color: "#26A5E4", letter: "T" },
  { id: "tiktok", name: "TikTok", tagline: "Short videos", category: "social", url: "https://www.tiktok.com", color: "#010101", letter: "T" },
  { id: "linkedin", name: "LinkedIn", tagline: "Professional network", category: "social", url: "https://www.linkedin.com", color: "#0A66C2", letter: "L" },
  { id: "snapchat", name: "Snapchat", tagline: "Snaps & stories", category: "social", url: "https://web.snapchat.com", color: "#C9A200", letter: "S" },
  { id: "pinterest", name: "Pinterest", tagline: "Ideas & inspo", category: "social", url: "https://www.pinterest.com", color: "#E60023", letter: "P" },
  { id: "threads", name: "Threads", tagline: "Text conversations", category: "social", url: "https://www.threads.net", color: "#1A1A1A", letter: "T" },
  { id: "discord", name: "Discord", tagline: "Servers & voice", category: "social", url: "https://discord.com/app", color: "#5865F2", letter: "D" },
  { id: "twitch", name: "Twitch", tagline: "Live streams", category: "social", url: "https://m.twitch.tv", color: "#9146FF", letter: "T" },
  // Shopping
  { id: "amazon", name: "Amazon", tagline: "Everything store", category: "shopping", url: "https://www.amazon.in", color: "#FF9900", letter: "A" },
  { id: "flipkart", name: "Flipkart", tagline: "Fashion & electronics", category: "shopping", url: "https://www.flipkart.com", color: "#2874F0", letter: "F" },
  // Services 🛠
  { id: "urbancompany", name: "Urban Company", tagline: "Home services on demand", category: "services", url: "https://www.urbancompany.com", color: "#E91E63", letter: "U", androidPackage: "com.urbanclap.urbanclap", emoji: "🧹" },
  { id: "snabbit", name: "Snabbit", tagline: "10-min home help", category: "services", url: "https://snabbit.com", color: "#FF6B35", letter: "S", androidPackage: "com.snabbit.customer", emoji: "⚡" },
  { id: "nobroker", name: "NoBroker", tagline: "Rent & buy, no brokerage", category: "services", url: "https://www.nobroker.in", color: "#DC2626", letter: "N", androidPackage: "com.nobroker.app", emoji: "🏠" },
  { id: "porter", name: "Porter", tagline: "Trucks, movers, couriers", category: "services", url: "https://porter.in", color: "#FBBF24", letter: "P", androidPackage: "com.theporter.android.customerapp", emoji: "🚚" },
];

export const CATEGORY_LABELS: Record<MiniApp["category"], string> = {
  food: "Food delivery",
  rides: "🚗 Rides",
  quickcommerce: "🛒 Quick commerce",
  services: "🛠 get it done",
  payments: "Payments",
  social: "Social",
  shopping: "Shopping",
};

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
  try {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) return;
  } catch {
    /* ignore */
  }
  window.location.href = url;
}

/**
 * Launch a partner mini app. On Android with a known package we try the
 * native app via intent:// (routed through the OS by Capacitor's App plugin),
 * with an https fallback baked into the intent so it never dead-ends.
 * Everywhere else we open the web URL in Chrome Custom Tab / new tab.
 */
export async function launchMiniApp(app: {
  name: string;
  url: string;
  androidPackage?: string;
}) {
  writePending({ app: app.name, at: Date.now() });
  if (typeof window === "undefined") return;
  const native = await isCapacitorNative();
  if (native && isAndroid() && app.androidPackage) {
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
}


/** Fire an OS-level deep link (upi://, uber:// etc). Returns immediately. */
export function openDeepLink(url: string) {
  window.location.href = url;
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

/** App-targeted UPI intents. */
export const UPI_APPS = [
  { id: "any", name: "Any UPI app", scheme: (p: UpiParams) => `upi://pay?${upiQuery(p)}`, color: "#00D4B8" },
  { id: "gpay", name: "Google Pay", scheme: (p: UpiParams) => `tez://upi/pay?${upiQuery(p)}`, color: "#4285F4" },
  { id: "phonepe", name: "PhonePe", scheme: (p: UpiParams) => `phonepe://pay?${upiQuery(p)}`, color: "#5F259F" },
  { id: "paytm", name: "Paytm", scheme: (p: UpiParams) => `paytmmp://pay?${upiQuery(p)}`, color: "#00BAF2" },
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

// ---------------- Free geocoding (OpenStreetMap Nominatim, no key) ----------------

export type GeoResult = { lat: number; lon: number; label: string };

export async function geocode(query: string): Promise<GeoResult[]> {
  const res = await fetch(
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
  const res = await fetch(url, { headers: { Accept: "application/json" } });
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

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
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
