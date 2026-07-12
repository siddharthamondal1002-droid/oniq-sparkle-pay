// Ride providers with city availability. Small static metro table + haversine
// nearest-match. Cached in localStorage under `oniq.city`.

export type RideProvider = {
  id: string;
  name: string;
  desc: string;
  color: string;
  icon: "car" | "bike";
  webUrl: string;
  androidPackage?: string;
  tag?: string;
  cities: "all" | string[]; // city ids
};

export const PROVIDERS: RideProvider[] = [
  {
    id: "uber",
    name: "Uber",
    desc: "Cabs, autos & moto",
    color: "#000000",
    icon: "car",
    webUrl: "https://m.uber.com",
    androidPackage: "com.ubercab",
    cities: "all",
  },
  {
    id: "ola",
    name: "Ola",
    desc: "Cabs & autos",
    color: "#3b7d0e",
    icon: "car",
    webUrl: "https://book.olacabs.com",
    androidPackage: "com.olacabs.customer",
    cities: "all",
  },
  {
    id: "rapido",
    name: "Rapido",
    desc: "Bike taxis & autos",
    color: "#A67C00",
    icon: "bike",
    webUrl: "https://rapido.bike",
    androidPackage: "com.rapido.passenger",
    cities: "all",
  },
  {
    id: "indrive",
    name: "inDrive",
    desc: "Pick your own fare",
    color: "#C1F11D",
    icon: "car",
    webUrl: "https://indrive.com",
    androidPackage: "sinet.startup.inDriver",
    tag: "name ur price 💰",
    cities: "all",
  },
  {
    id: "yatri-sathi",
    name: "Yatri Sathi",
    desc: "Kolkata's govt-backed cab app",
    color: "#0E7A4A",
    icon: "car",
    webUrl: "https://yatrisathi.in",
    androidPackage: "in.juspay.jatrisaathi",
    tag: "govt-backed, lower fares 🤝",
    cities: ["kolkata"],
  },
  {
    id: "namma-yatri",
    name: "Namma Yatri",
    desc: "Auto & cabs, zero commission",
    color: "#F7C948",
    icon: "car",
    webUrl: "https://nammayatri.in",
    androidPackage: "in.juspay.nammayatri",
    tag: "zero commission 🚖",
    cities: ["bangalore", "mysore"],
  },
  {
    id: "blusmart",
    name: "BluSmart",
    desc: "All-electric cabs",
    color: "#1F6FEB",
    icon: "car",
    webUrl: "https://blusmart.com",
    androidPackage: "com.blusmart.rider",
    tag: "all-EV fleet ⚡",
    cities: ["delhi", "bangalore"],
  },
  {
    id: "meru",
    name: "Meru",
    desc: "Scheduled + airport rides",
    color: "#E53935",
    icon: "car",
    webUrl: "https://meru.in",
    androidPackage: "com.winit.merucab",
    tag: "scheduled + airport 🛫",
    cities: ["delhi", "mumbai", "bangalore", "hyderabad", "chennai", "kolkata"],
  },
  {
    id: "quick-ride",
    name: "Quick Ride",
    desc: "Carpool with verified riders",
    color: "#00A9A5",
    icon: "car",
    webUrl: "https://quickride.in",
    androidPackage: "com.disha.quickride",
    tag: "carpool, cheapest 🚙",
    cities: ["bangalore", "hyderabad", "chennai", "pune"],
  },
];

export type CityId =
  | "kolkata" | "delhi" | "mumbai" | "bangalore" | "hyderabad" | "chennai"
  | "pune" | "ahmedabad" | "jaipur" | "lucknow" | "kochi" | "chandigarh" | "mysore";

type CityEntry = { id: CityId; label: string; lat: number; lon: number };

const CITIES: CityEntry[] = [
  { id: "kolkata",    label: "Kolkata",    lat: 22.5726, lon: 88.3639 },
  { id: "delhi",      label: "Delhi NCR",  lat: 28.6139, lon: 77.2090 },
  { id: "mumbai",     label: "Mumbai",     lat: 19.0760, lon: 72.8777 },
  { id: "bangalore",  label: "Bangalore",  lat: 12.9716, lon: 77.5946 },
  { id: "hyderabad",  label: "Hyderabad",  lat: 17.3850, lon: 78.4867 },
  { id: "chennai",    label: "Chennai",    lat: 13.0827, lon: 80.2707 },
  { id: "pune",       label: "Pune",       lat: 18.5204, lon: 73.8567 },
  { id: "ahmedabad",  label: "Ahmedabad",  lat: 23.0225, lon: 72.5714 },
  { id: "jaipur",     label: "Jaipur",     lat: 26.9124, lon: 75.7873 },
  { id: "lucknow",    label: "Lucknow",    lat: 26.8467, lon: 80.9462 },
  { id: "kochi",      label: "Kochi",      lat: 9.9312,  lon: 76.2673 },
  { id: "chandigarh", label: "Chandigarh", lat: 30.7333, lon: 76.7794 },
  { id: "mysore",     label: "Mysore",     lat: 12.2958, lon: 76.6394 },
];

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export type DetectedCity = { id: CityId | "other"; label: string } | null;

export function detectCity(lat: number, lon: number): DetectedCity {
  let best: { c: CityEntry; d: number } | null = null;
  for (const c of CITIES) {
    const d = haversineKm({ lat, lon }, { lat: c.lat, lon: c.lon });
    if (!best || d < best.d) best = { c, d };
  }
  if (best && best.d <= 60) return { id: best.c.id, label: best.c.label };
  return { id: "other", label: "your area" };
}

const CACHE_KEY = "oniq.city";

export function getCachedCity(): DetectedCity {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as DetectedCity) : null;
  } catch {
    return null;
  }
}

export function setCachedCity(city: DetectedCity) {
  if (typeof window === "undefined" || !city) return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(city));
  } catch {
    // ignore quota errors
  }
}

export function splitByCity(city: DetectedCity): {
  available: RideProvider[];
  elsewhere: RideProvider[];
} {
  if (!city || city.id === "other") {
    return { available: PROVIDERS.filter((p) => p.cities === "all"), elsewhere: PROVIDERS.filter((p) => p.cities !== "all") };
  }
  const available: RideProvider[] = [];
  const elsewhere: RideProvider[] = [];
  for (const p of PROVIDERS) {
    if (p.cities === "all" || (Array.isArray(p.cities) && p.cities.includes(city.id))) {
      available.push(p);
    } else {
      elsewhere.push(p);
    }
  }
  return { available, elsewhere };
}
