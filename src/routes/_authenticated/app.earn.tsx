import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Check, Upload, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { launchMiniApp } from "@/lib/miniapps";

export const Route = createFileRoute("/_authenticated/app/earn")({
  component: EarnScreen,
});

type Tab = "hire" | "partner";

type Category = { id: string; label: string; emoji: string; providers?: Provider[] };

// declared below; forward type
type Provider = {
  id: string;
  name: string;
  url: string;
  androidPackage?: string;
  appScheme?: string;
  color: string;
  emoji: string;
};

const PROVIDERS: Provider[] = [
  {
    id: "urbancompany",
    name: "Urban Company",
    url: "https://www.urbancompany.com",
    androidPackage: "com.urbanclap.urbanclap",
    appScheme: "urbancompany://",
    color: "#E91E63",
    emoji: "🧹",
  },
  {
    id: "snabbit",
    name: "Snabbit",
    url: "https://www.snabbit.com",
    androidPackage: "com.snabbit.customer",
    color: "#FF6B35",
    emoji: "⚡",
  },
];

const GOMECHANIC: Provider = { id: "gomechanic", name: "GoMechanic", url: "https://gomechanic.in", color: "#E63946", emoji: "🔧" };
const READYASSIST: Provider = { id: "readyassist", name: "ReadyAssist", url: "https://readyassist.in", color: "#FF8500", emoji: "🛠️" };
const PRACTO: Provider = { id: "practo", name: "Practo", url: "https://www.practo.com", color: "#199FD9", emoji: "🩺" };
const PORTEA: Provider = { id: "portea", name: "Portea", url: "https://www.portea.com", color: "#00A0B0", emoji: "🏥" };
const CARE24: Provider = { id: "care24", name: "Care24", url: "https://www.care24.co.in", color: "#4CAF50", emoji: "🤲" };
const CLEARTAX: Provider = { id: "cleartax", name: "ClearTax", url: "https://cleartax.in", color: "#1F73B7", emoji: "🧾" };
const QUICKO: Provider = { id: "quicko", name: "Quicko", url: "https://quicko.com", color: "#7C3AED", emoji: "📊" };
const LAWRATO: Provider = { id: "lawrato", name: "LawRato", url: "https://lawrato.com", color: "#0B5394", emoji: "⚖️" };
const VAKILSEARCH: Provider = { id: "vakilsearch", name: "Vakilsearch", url: "https://vakilsearch.com", color: "#E85D26", emoji: "📜" };
const INDIAFILINGS: Provider = { id: "indiafilings", name: "IndiaFilings", url: "https://www.indiafilings.com", color: "#2E7D32", emoji: "🏢" };

const CATEGORIES: Category[] = [
  { id: "house_cleaning", label: "House Cleaning", emoji: "🧹", providers: PROVIDERS },
  { id: "kitchen_cleaning", label: "Kitchen Cleaning", emoji: "🍳", providers: PROVIDERS },
  { id: "bathroom_cleaning", label: "Bathroom Cleaning", emoji: "🛁", providers: PROVIDERS },
  { id: "cook", label: "Cook / Chef", emoji: "👨‍🍳", providers: PROVIDERS },
  { id: "dishwashing", label: "Dishwashing", emoji: "🍽️", providers: PROVIDERS },
  { id: "laundry", label: "Laundry", emoji: "🧺", providers: PROVIDERS },
  { id: "fan_window", label: "Fan/Window Cleaning", emoji: "🪟", providers: PROVIDERS },
  { id: "appliance_repair", label: "Appliance Repair", emoji: "🔧", providers: PROVIDERS },
  { id: "electrician", label: "Electrician", emoji: "💡", providers: PROVIDERS },
  { id: "plumber", label: "Plumber", emoji: "🚰", providers: PROVIDERS },
  { id: "beauty", label: "Beauty & Salon at home", emoji: "💅", providers: PROVIDERS },
  { id: "tutor", label: "Tutor", emoji: "📚", providers: PROVIDERS },
  { id: "bike_mechanic", label: "Bike Mechanic", emoji: "🏍️", providers: [GOMECHANIC, READYASSIST] },
  { id: "car_mechanic", label: "Car Mechanic", emoji: "🚗", providers: [GOMECHANIC, READYASSIST] },
  { id: "physiotherapist", label: "Physiotherapist", emoji: "🧑‍⚕️", providers: [PRACTO, PORTEA] },
  { id: "caregiver", label: "Caregiver / Attendant", emoji: "🧑‍🦽", providers: [PORTEA, CARE24] },
  { id: "babysitter", label: "Babysitter", emoji: "👶" },
  { id: "pet_sitter", label: "Pet Sitter", emoji: "🐾" },
  { id: "tax_ca", label: "Tax Consultant / CA", emoji: "🧾", providers: [CLEARTAX, QUICKO] },
  { id: "lawyer_civil", label: "Lawyer — Civil", emoji: "⚖️", providers: [LAWRATO, VAKILSEARCH] },
  { id: "lawyer_criminal", label: "Lawyer — Criminal", emoji: "⚖️", providers: [LAWRATO] },
  { id: "lawyer_corporate", label: "Lawyer — Corporate", emoji: "⚖️", providers: [VAKILSEARCH, INDIAFILINGS] },
];

const CITY_GROUPS = [
  {
    label: "Metro",
    cities: [
      "Kolkata",
      "Bengaluru",
      "Mumbai",
      "Delhi",
      "Hyderabad",
      "Chennai",
      "Pune",
      "Ahmedabad",
      "Gurugram",
      "Noida",
    ],
  },
  {
    label: "Tier 2",
    cities: [
      "Agra",
      "Amritsar",
      "Bhopal",
      "Bhubaneswar",
      "Chandigarh",
      "Coimbatore",
      "Dehradun",
      "Faridabad",
      "Ghaziabad",
      "Guwahati",
      "Indore",
      "Jaipur",
      "Kanpur",
      "Kochi",
      "Lucknow",
      "Ludhiana",
      "Madurai",
      "Mysuru",
      "Nagpur",
      "Nashik",
      "Patna",
      "Raipur",
      "Rajkot",
      "Ranchi",
      "Surat",
      "Thiruvananthapuram",
      "Vadodara",
      "Varanasi",
      "Vijayawada",
      "Visakhapatnam",
    ],
  },
  {
    label: "Tier 3",
    cities: [
      "Ajmer",
      "Aligarh",
      "Amravati",
      "Asansol",
      "Aurangabad",
      "Bareilly",
      "Belagavi",
      "Bhagalpur",
      "Bikaner",
      "Bilaspur",
      "Cuttack",
      "Dhanbad",
      "Durgapur",
      "Gaya",
      "Gorakhpur",
      "Guntur",
      "Gwalior",
      "Haridwar",
      "Hubballi",
      "Jabalpur",
      "Jalandhar",
      "Jammu",
      "Jamshedpur",
      "Jhansi",
      "Jodhpur",
      "Kolhapur",
      "Kota",
      "Kozhikode",
      "Mangaluru",
      "Moradabad",
      "Muzaffarpur",
      "Nellore",
      "Panaji",
      "Patiala",
      "Prayagraj",
      "Puducherry",
      "Rourkela",
      "Salem",
      "Shimla",
      "Siliguri",
      "Solapur",
      "Srinagar",
      "Thrissur",
      "Tiruchirappalli",
      "Tirupati",
      "Udaipur",
      "Ujjain",
      "Vellore",
      "Warangal",
    ],
  },
];

const AVAILABILITY = ["Mornings", "Afternoons", "Evenings", "Weekends", "Full-time"];

// Sentinel select value: user lives in a village/town not in the list.
const VILLAGE_OPTION = "__village__";
const REGION_TARGET = 20;

function regionKey(city: string, village: string): string {
  return (city === VILLAGE_OPTION ? village : city).trim().toLowerCase();
}
function regionLabel(city: string, village: string): string {
  return city === VILLAGE_OPTION ? village.trim() : city;
}
function catById(id: string) {
  return CATEGORIES.find((c) => c.id === id);
}

function RegionSelect({
  city,
  setCity,
  village,
  setVillage,
}: {
  city: string;
  setCity: (v: string) => void;
  village: string;
  setVillage: (v: string) => void;
}) {
  return (
    <>
      <select value={city} onChange={(e) => setCity(e.target.value)} className="input-base">
        {CITY_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </optgroup>
        ))}
        <optgroup label="Village">
          <option value={VILLAGE_OPTION}>My village / town (type name)</option>
        </optgroup>
      </select>
      {city === VILLAGE_OPTION && (
        <input
          value={village}
          onChange={(e) => setVillage(e.target.value)}
          maxLength={80}
          className="input-base mt-2"
          placeholder="Village / town name, e.g. Singur"
        />
      )}
    </>
  );
}




function EarnScreen() {
  const [tab, setTab] = useState<Tab>("hire");
  return (
    <div className="min-h-screen overflow-x-hidden px-5 pt-12 pb-10">
      <div className="flex items-center gap-3">
        <Link
          to="/app"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-card"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2 min-w-0 truncate">
          <span>💼</span> earn
        </h1>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">hire help or get hired ✨</div>

      <div className="mt-4 grid grid-cols-2 rounded-2xl border border-border bg-card p-1 text-xs">
        {(
          [
            ["hire", "hire help 🧹"],
            ["partner", "become a partner 💼"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`min-h-11 rounded-xl py-2 font-semibold truncate ${tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "hire" ? <HirePanel goPartner={() => setTab("partner")} /> : <PartnerPanel />}

      <style>{`
        .input-base {
          width: 100%;
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 0.75rem;
          padding: 0.625rem 0.75rem;
          font-size: 0.875rem;
          color: inherit;
          outline: none;
        }
        .input-base:focus { border-color: hsl(var(--primary)); }
      `}</style>
    </div>
  );
}

/* ---------------- HIRE HELP ---------------- */

function HirePanel({ goPartner }: { goPartner: () => void }) {
  const [chooserFor, setChooserFor] = useState<Category | null>(null);
  const [noProviderFor, setNoProviderFor] = useState<Category | null>(null);

  return (
    <div className="mt-5 space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => (c.providers && c.providers.length ? setChooserFor(c) : setNoProviderFor(c))}
            className="press flex flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-card p-3 text-center hover:brightness-110"
          >
            <span className="text-2xl">{c.emoji}</span>
            <span className="text-[11px] font-medium leading-tight">{c.label}</span>
          </button>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground text-center px-4">
        booking handled by our partner services — opens their app/site
      </p>

      <OniqPartnersSection goPartner={goPartner} />

      <button
        onClick={goPartner}
        className="press w-full rounded-2xl border border-primary/40 bg-primary/10 p-4 text-left"
      >
        <div className="text-sm font-semibold text-primary">
          want ONIQ's own service partners near you? tell us 👇
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Join the partner waitlist and we'll launch in your area soon.
        </div>
      </button>

      {chooserFor && (
        <ProviderChooser category={chooserFor} onClose={() => setChooserFor(null)} />
      )}
      {noProviderFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setNoProviderFor(null)} aria-hidden />
          <div className="glass relative z-10 w-full max-w-md rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <div className="font-display text-lg font-bold">
              {noProviderFor.emoji} {noProviderFor.label}
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              no partner service here yet — be the first ONIQ partner in your area 💼
            </div>
            <button
              onClick={() => {
                setNoProviderFor(null);
                goPartner();
              }}
              className="press mt-4 w-full rounded-2xl bg-primary py-3 font-semibold text-primary-foreground"
            >
              become a partner
            </button>
            <button
              onClick={() => setNoProviderFor(null)}
              className="press mt-2 w-full rounded-xl bg-surface-2 py-2 text-sm font-medium"
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- ONIQ REGION SERVICES (free bookings) ---------------- */

type RegionProvider = {
  id: string;
  full_name: string;
  skills: string[];
  area: string | null;
  village: string | null;
  experience_years: number;
};

type MyBooking = {
  id: string;
  provider_user_id: string;
  provider_name: string;
  note: string | null;
  status: string;
  created_at: string;
};

function OniqPartnersSection({ goPartner }: { goPartner: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [city, setCity] = useState(() => {
    try { return localStorage.getItem("oniq.earn.city") || "Kolkata"; } catch { return "Kolkata"; }
  });
  const [village, setVillage] = useState(() => {
    try { return localStorage.getItem("oniq.earn.village") || ""; } catch { return ""; }
  });
  const [bookingId, setBookingId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("oniq.earn.city", city);
      localStorage.setItem("oniq.earn.village", village);
    } catch { /* ignore */ }
  }, [city, village]);

  const region = regionKey(city, village);
  const label = regionLabel(city, village);

  const { data: status } = useQuery({
    queryKey: ["region-status", region],
    enabled: region.length > 0,
    queryFn: async (): Promise<{ provider_count: number; enabled: boolean } | null> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("get_region_status", { _region: region });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const enabled = !!status?.enabled;

  const { data: providers = [] } = useQuery({
    queryKey: ["region-providers", region],
    enabled,
    queryFn: async (): Promise<RegionProvider[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("list_region_providers", { _region: region });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: myBookings = [] } = useQuery({
    queryKey: ["my-service-bookings"],
    queryFn: async (): Promise<MyBooking[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("my_service_bookings");
      if (error) throw error;
      return data ?? [];
    },
  });

  const book = async (p: RegionProvider) => {
    setBookingId(p.id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("book_service", { _application_id: p.id, _note: null });
      if (error) throw error;
      toast.success("Booked for free 🎉 the partner will get your request");
      await qc.invalidateQueries({ queryKey: ["my-service-bookings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "couldn't book — try again");
    } finally {
      setBookingId(null);
    }
  };

  const openChat = async (otherId: string) => {
    const { data: id, error } = await supabase.rpc("find_or_create_direct_conversation", { other_user_id: otherId });
    if (error || !id) { toast.error(error?.message ?? "couldn't open chat"); return; }
    navigate({ to: "/app/chat/$conversationId", params: { conversationId: id as string } });
  };

  const cancelBooking = async (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("respond_booking", { _booking_id: id, _status: "cancelled" });
    if (error) return toast.error(error.message);
    await qc.invalidateQueries({ queryKey: ["my-service-bookings"] });
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">ONIQ partners near you</div>
        <span className="rounded-full bg-[#25D366]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#25D366]">
          free booking
        </span>
      </div>
      <div className="mt-2">
        <RegionSelect city={city} setCity={setCity} village={village} setVillage={setVillage} />
      </div>

      {region.length === 0 ? (
        <div className="mt-3 text-xs text-muted-foreground">type your village name to check availability</div>
      ) : !status ? (
        <div className="mt-3 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : enabled ? (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-semibold text-[#25D366]">🎉 ONIQ services are live in {label}</div>
          {providers.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-background/50 p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{p.full_name}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {p.skills.map((s) => catById(s)?.emoji ?? "").join(" ")}{" "}
                  {p.skills.map((s) => catById(s)?.label).filter(Boolean).slice(0, 2).join(", ")}
                  {p.experience_years > 0 && ` · ${p.experience_years} yr`}
                  {(p.village || p.area) && ` · ${p.village || p.area}`}
                </div>
              </div>
              <button
                onClick={() => book(p)}
                disabled={bookingId === p.id}
                className="press shrink-0 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                {bookingId === p.id ? "booking…" : "book free"}
              </button>
            </div>
          ))}
          <div className="text-center text-[10px] text-muted-foreground">
            ONIQ charges ₹0 for bookings — you deal with the partner directly
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-semibold">{status.provider_count}/{REGION_TARGET} partners registered in {label}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, (status.provider_count / REGION_TARGET) * 100)}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            when {REGION_TARGET} verified partners register here, ONIQ services go live for everyone in {label} — with 100% free booking.
          </div>
          <button onClick={goPartner} className="press mt-2 text-xs font-semibold text-primary">
            know someone who provides services? invite them to become a partner →
          </button>
        </div>
      )}

      {myBookings.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <div className="text-xs font-semibold text-muted-foreground">your bookings</div>
          <div className="mt-2 space-y-2">
            {myBookings.map((b) => (
              <div key={b.id} className="flex items-center gap-2 rounded-xl border border-border p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{b.provider_name}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{b.status}</div>
                </div>
                <button
                  onClick={() => openChat(b.provider_user_id)}
                  aria-label="Chat with partner"
                  className="press grid h-8 w-8 place-items-center rounded-full border border-border"
                >
                  <MessageCircle className="h-4 w-4" />
                </button>
                {b.status === "requested" && (
                  <button
                    onClick={() => cancelBooking(b.id)}
                    className="press rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground"
                  >
                    cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderChooser({ category, onClose }: { category: Category; onClose: () => void }) {
  const providers = category.providers ?? [];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div className="glass relative z-10 w-full max-w-md rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
          open with
        </div>
        <div className="font-display text-lg font-bold">
          {category.emoji} {category.label}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Independent services — coverage varies by city. Links checked July 2026.
        </div>
        <div className="mt-4 space-y-2">
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={async () => {
                await launchMiniApp(p);
                onClose();
              }}
              className="press flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left"
            >
              <div
                className="grid h-10 w-10 place-items-center rounded-xl text-lg"
                style={{ background: `${p.color}26`, color: p.color }}
              >
                {p.emoji}
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">{p.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  opens app if installed, else website
                </div>
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="press mt-4 w-full rounded-xl bg-surface-2 py-2 text-sm font-medium"
        >
          cancel
        </button>
      </div>
    </div>
  );
}

/* ---------------- BECOME A PARTNER ---------------- */

function PartnerPanel() {
  const qc = useQueryClient();
  const { data: me } = useQuery({
    queryKey: ["me-earn"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    },
  });

  const { data: existing, isLoading: existingLoading } = useQuery({
    queryKey: ["partner-application", me?.id],
    enabled: !!me?.id,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("partner_applications")
        .select("id, full_name, city, village, region, created_at, status, verification_status, aadhaar_path, pan_path, extra_doc_path")
        .eq("user_id", me!.id)
        .maybeSingle();
      if (error) throw error;
      return data as {
        id: string;
        full_name: string;
        city: string;
        village: string | null;
        region: string | null;
        created_at: string;
        status: string;
        verification_status: string;
        aadhaar_path: string | null;
        pan_path: string | null;
        extra_doc_path: string | null;
      } | null;
    },
  });

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("Kolkata");
  const [village, setVillage] = useState("");
  const [area, setArea] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [experience, setExperience] = useState<string>("0");
  const [availability, setAvailability] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (me?.phone && !phone) setPhone(me.phone);
  }, [me?.phone, phone]);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!me?.id) {
      toast.error("sign in first");
      return;
    }
    if (fullName.trim().length < 2 || phone.trim().length < 6) {
      toast.error("add your name & phone first");
      return;
    }
    if (skills.length === 0) {
      toast.error("pick at least one skill");
      return;
    }
    if (city === VILLAGE_OPTION && village.trim().length < 2) {
      toast.error("type your village / town name");
      return;
    }
    setSubmitting(true);
    try {
      const exp = Math.max(0, Math.min(60, parseInt(experience || "0", 10) || 0));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("partner_applications").insert({
        user_id: me.id,
        full_name: fullName.trim(),
        phone: phone.trim(),
        city: city === VILLAGE_OPTION ? village.trim() : city.trim(),
        village: city === VILLAGE_OPTION ? village.trim() : null,
        region: regionKey(city, village),
        area: area.trim() || null,
        skills,
        experience_years: exp,
        availability,
        note: note.trim() || null,
      });
      if (error) {
        if (error.code === "23505") {
          toast("you're already on the list ✅");
          await qc.invalidateQueries({ queryKey: ["partner-application", me.id] });
          return;
        }
        throw error;
      }
      toast.success("you're on the ONIQ partner waitlist 🎉");
      setFullName("");
      setArea("");
      setSkills([]);
      setAvailability([]);
      setNote("");
      setExperience("0");
      await qc.invalidateQueries({ queryKey: ["partner-application", me.id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "couldn't submit — try again");
    } finally {
      setSubmitting(false);
    }
  };

  if (existingLoading) {
    return (
      <div className="mt-8 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (existing && me) {
    const region = (existing.region || existing.city || "").trim().toLowerCase();
    const regionName = existing.village || existing.city;
    return (
      <div className="mt-6 space-y-4">
        <div className="rounded-2xl border border-primary/40 bg-primary/10 p-5 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-6 w-6" />
          </div>
          <div className="font-display text-lg font-bold">you're on the list ✅</div>
          <div className="mt-2 text-sm text-muted-foreground">
            we'll reach out as we launch in {regionName}.
          </div>
          <div className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground">
            status: {existing.status} · verification: {existing.verification_status}
          </div>
        </div>

        <VerificationSection meId={me.id} app={existing} />
        <PartnerRegionProgress region={region} regionName={regionName} />
        <PartnerRequests />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      <Field label="Full name">
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          maxLength={80}
          className="input-base"
          placeholder="Your full name"
        />
      </Field>

      <Field label="Phone">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={20}
          inputMode="tel"
          className="input-base"
          placeholder="e.g. +91 98xxxxxx"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="City / Village">
          <RegionSelect city={city} setCity={setCity} village={village} setVillage={setVillage} />
        </Field>
        <Field label="Area / locality">
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            maxLength={80}
            className="input-base"
            placeholder="e.g. Salt Lake"
          />
        </Field>
      </div>

      <Field label="Skills">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const on = skills.includes(c.id);
            return (
              <button
                type="button"
                key={c.id}
                onClick={() => toggle(skills, setSkills, c.id)}
                className={`press rounded-full border px-3 py-1.5 text-xs ${on ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border"}`}
              >
                {c.emoji} {c.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Experience (years)">
        <input
          type="number"
          min={0}
          max={60}
          value={experience}
          onChange={(e) => setExperience(e.target.value)}
          className="input-base"
        />
      </Field>

      <Field label="Availability">
        <div className="flex flex-wrap gap-2">
          {AVAILABILITY.map((a) => {
            const on = availability.includes(a);
            return (
              <button
                type="button"
                key={a}
                onClick={() => toggle(availability, setAvailability, a)}
                className={`press rounded-full border px-3 py-1.5 text-xs ${on ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border"}`}
              >
                {a}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Note (optional)">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
          rows={3}
          className="input-base resize-none"
          placeholder="Anything else we should know?"
        />
      </Field>

      <button
        type="submit"
        disabled={submitting}
        className="press w-full rounded-2xl bg-primary py-3 font-semibold text-primary-foreground disabled:opacity-60"
      >
        {submitting ? "submitting…" : "Join the partner waitlist"}
      </button>

    </form>
  );
}

/* ---------------- VERIFICATION (Aadhaar / PAN uploads) ---------------- */

type PartnerApp = {
  id: string;
  verification_status: string;
  aadhaar_path: string | null;
  pan_path: string | null;
  extra_doc_path: string | null;
};

const DOC_KINDS = [
  { key: "aadhaar_path" as const, kind: "aadhaar", label: "Aadhaar photo", required: true },
  { key: "pan_path" as const, kind: "pan", label: "PAN photo", required: true },
  { key: "extra_doc_path" as const, kind: "extra", label: "Extra attachment (optional)", required: false },
];

function VerificationSection({ meId, app }: { meId: string; app: PartnerApp }) {
  const qc = useQueryClient();
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);

  const upload = async (kind: string, key: keyof PartnerApp, file: File) => {
    setUploadingKind(kind);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("file too big — max 10 MB");
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${meId}/${kind}-${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from("verification-docs")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      const patch: Record<string, string> = { [key]: path };
      const aadhaarDone = key === "aadhaar_path" ? true : !!app.aadhaar_path;
      const panDone = key === "pan_path" ? true : !!app.pan_path;
      if (aadhaarDone && panDone && app.verification_status === "pending") {
        patch.verification_status = "submitted";
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("partner_applications")
        .update(patch)
        .eq("id", app.id);
      if (error) throw error;
      toast.success(
        patch.verification_status === "submitted"
          ? "documents submitted for verification ✅"
          : "uploaded ✅",
      );
      await qc.invalidateQueries({ queryKey: ["partner-application"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "upload failed — try again");
    } finally {
      setUploadingKind(null);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-sm font-semibold">verification</div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        upload your Aadhaar and PAN photos to get verified. Once {REGION_TARGET} verified partners register
        in your region, ONIQ services go live there. Documents are stored privately and only used for
        verification.
      </div>
      <div className="mt-3 space-y-2">
        {DOC_KINDS.map((d) => {
          const done = !!app[d.key];
          const busy = uploadingKind === d.kind;
          return (
            <label
              key={d.kind}
              className={`press flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${done ? "border-[#25D366]/50 bg-[#25D366]/10" : "border-border bg-background/50"}`}
            >
              <input
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(d.kind, d.key, f);
                  e.target.value = "";
                }}
              />
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${done ? "bg-[#25D366] text-black" : "bg-muted text-muted-foreground"}`}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : done ? <Check className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{d.label}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {done ? "uploaded — tap to replace" : busy ? "uploading…" : "tap to upload photo or PDF"}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function PartnerRegionProgress({ region, regionName }: { region: string; regionName: string }) {
  const { data: status } = useQuery({
    queryKey: ["region-status", region],
    enabled: region.length > 0,
    queryFn: async (): Promise<{ provider_count: number; enabled: boolean } | null> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("get_region_status", { _region: region });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
  if (!status) return null;
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      {status.enabled ? (
        <div className="text-sm font-semibold text-[#25D366]">
          🎉 ONIQ services are live in {regionName} — customers can now book you for free
        </div>
      ) : (
        <>
          <div className="text-xs font-semibold">
            {status.provider_count}/{REGION_TARGET} verified partners in {regionName}
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, (status.provider_count / REGION_TARGET) * 100)}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            when {REGION_TARGET} partners finish verification here, ONIQ services open up for your whole
            region — and customers book you at zero charge.
          </div>
        </>
      )}
    </div>
  );
}

type PartnerBooking = {
  id: string;
  customer_id: string;
  customer_name: string;
  note: string | null;
  status: string;
  created_at: string;
};

function PartnerRequests() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: bookings = [] } = useQuery({
    queryKey: ["my-partner-bookings"],
    queryFn: async (): Promise<PartnerBooking[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("my_partner_bookings");
      if (error) throw error;
      return data ?? [];
    },
  });

  const respond = async (id: string, status: "accepted" | "declined" | "done") => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("respond_booking", { _booking_id: id, _status: status });
    if (error) return toast.error(error.message);
    await qc.invalidateQueries({ queryKey: ["my-partner-bookings"] });
  };

  const openChat = async (otherId: string) => {
    const { data: id, error } = await supabase.rpc("find_or_create_direct_conversation", { other_user_id: otherId });
    if (error || !id) { toast.error(error?.message ?? "couldn't open chat"); return; }
    navigate({ to: "/app/chat/$conversationId", params: { conversationId: id as string } });
  };

  if (bookings.length === 0) return null;
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-sm font-semibold">booking requests</div>
      <div className="mt-2 space-y-2">
        {bookings.map((b) => (
          <div key={b.id} className="rounded-xl border border-border p-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{b.customer_name}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{b.status}</div>
              </div>
              <button
                onClick={() => openChat(b.customer_id)}
                aria-label="Chat with customer"
                className="press grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border"
              >
                <MessageCircle className="h-4 w-4" />
              </button>
            </div>
            {b.note && <div className="mt-1.5 text-xs text-muted-foreground">"{b.note}"</div>}
            {b.status === "requested" && (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => respond(b.id, "accepted")}
                  className="press flex-1 rounded-full bg-primary py-1.5 text-xs font-semibold text-primary-foreground"
                >
                  accept
                </button>
                <button
                  onClick={() => respond(b.id, "declined")}
                  className="press flex-1 rounded-full border border-border py-1.5 text-xs text-muted-foreground"
                >
                  decline
                </button>
              </div>
            )}
            {b.status === "accepted" && (
              <button
                onClick={() => respond(b.id, "done")}
                className="press mt-2 w-full rounded-full border border-[#25D366]/50 py-1.5 text-xs font-semibold text-[#25D366]"
              >
                mark as done
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}
