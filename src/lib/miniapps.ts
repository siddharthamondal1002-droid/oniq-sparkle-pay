// ONIQ Mini Apps — partner integrations via universal/deep links + in-app browser.
// Strategy: no partner API keys needed. Apps open INSIDE ONIQ (Capacitor in-app
// browser sheet on device, new tab on web). Deep links hand off to the native
// partner app when installed, pre-filled with context (destination, amount).

export type MiniApp = {
  id: string;
  name: string;
  tagline: string;
  category: "food" | "rides" | "payments" | "social" | "shopping";
  url: string; // web URL opened in the in-app browser
  color: string; // brand tile color
  letter: string; // fallback monogram
};

export const MINI_APPS: MiniApp[] = [
  // Food
  { id: "swiggy", name: "Swiggy", tagline: "Food & grocery delivery", category: "food", url: "https://www.swiggy.com", color: "#FC8019", letter: "S" },
  { id: "zomato", name: "Zomato", tagline: "Restaurants & delivery", category: "food", url: "https://www.zomato.com", color: "#E23744", letter: "Z" },
  { id: "dominos", name: "Domino's", tagline: "Pizza delivery", category: "food", url: "https://www.dominos.co.in", color: "#0A6EBD", letter: "D" },
  // Rides
  { id: "uber", name: "Uber", tagline: "Book a cab", category: "rides", url: "https://m.uber.com", color: "#000000", letter: "U" },
  { id: "ola", name: "Ola", tagline: "Cabs & autos", category: "rides", url: "https://book.olacabs.com", color: "#a4c639", letter: "O" },
  { id: "rapido", name: "Rapido", tagline: "Bike taxis", category: "rides", url: "https://rapido.bike", color: "#FFCB05", letter: "R" },
  // Payments
  { id: "gpay", name: "Google Pay", tagline: "UPI payments", category: "payments", url: "https://pay.google.com", color: "#4285F4", letter: "G" },
  { id: "phonepe", name: "PhonePe", tagline: "UPI & recharges", category: "payments", url: "https://www.phonepe.com", color: "#5F259F", letter: "P" },
  { id: "paytm", name: "Paytm", tagline: "Payments & bills", category: "payments", url: "https://paytm.com", color: "#00BAF2", letter: "P" },
  // Social
  { id: "instagram", name: "Instagram", tagline: "Photos & reels", category: "social", url: "https://www.instagram.com", color: "#E1306C", letter: "I" },
  { id: "youtube", name: "YouTube", tagline: "Videos & shorts", category: "social", url: "https://m.youtube.com", color: "#FF0000", letter: "Y" },
  { id: "x", name: "X", tagline: "What's happening", category: "social", url: "https://x.com", color: "#111111", letter: "X" },
  { id: "reddit", name: "Reddit", tagline: "Communities", category: "social", url: "https://www.reddit.com", color: "#FF4500", letter: "R" },
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
