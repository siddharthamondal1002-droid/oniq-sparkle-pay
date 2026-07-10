// ONIQ Mini Apps — partner integrations via universal/deep links + in-app browser.
// Strategy: no partner API keys needed. Apps open INSIDE ONIQ (Capacitor in-app
// browser sheet on device, new tab on web). Deep links hand off to the native
// partner app when installed, pre-filled with context (destination, amount).

export type MiniApp = {
  id: string;
  name: string;
  tagline: string;
  category: "food" | "rides" | "quickcommerce" | "payments" | "social" | "shopping";
  url: string; // web URL opened in the in-app browser / same-tab fallback
  color: string; // brand tile color
  letter: string; // fallback monogram
  androidPackage?: string; // Android package id for intent:// deep launch
  emoji?: string; // optional tile emoji instead of letter
};

export const MINI_APPS: MiniApp[] = [
  // Food
  { id: "swiggy", name: "Swiggy", tagline: "Food & grocery delivery", category: "food", url: "https://www.swiggy.com", color: "#FC8019", letter: "S" },
  { id: "zomato", name: "Zomato", tagline: "Restaurants & delivery", category: "food", url: "https://www.zomato.com", color: "#E23744", letter: "Z" },
  { id: "dominos", name: "Domino's", tagline: "Pizza delivery", category: "food", url: "https://www.dominos.co.in", color: "#0A6EBD", letter: "D" },
  // Rides
  { id: "uber", name: "Uber", tagline: "Book a cab", category: "rides", url: "https://m.uber.com", color: "#000000", letter: "U" },
  { id: "ola", name: "Ola", tagline: "Cabs & autos", category: "rides", url: "https://book.olacabs.com", color: "#a4c639", letter: "O" },
  { id: "rapido", name: "Rapido", tagline: "Bike taxis", category: "rides", url: "https://rapido.bike", color: "#A67C00", letter: "R" },
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
];

export const CATEGORY_LABELS: Record<MiniApp["category"], string> = {
  food: "Food delivery",
  rides: "Rides",
  payments: "Payments",
  social: "Social",
  shopping: "Shopping",
};

/**
 * Open a URL inside ONIQ. On device (Capacitor) this uses the in-app browser
 * sheet — the user never leaves ONIQ and swipes it away to return. On plain
 * web it falls back to a new tab.
 */
export async function openInApp(url: string) {
  try {
    const mod = await import(/* @vite-ignore */ "@capacitor/browser");
    await mod.Browser.open({ url, presentationStyle: "popover", toolbarColor: "#0E0F13" });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
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
