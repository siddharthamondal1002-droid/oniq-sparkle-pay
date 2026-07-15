import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Check } from "lucide-react";
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
  { id: "bike_mechanic", label: "Bike Mechanic", emoji: "🏍️" },
  { id: "car_mechanic", label: "Car Mechanic", emoji: "🚗" },
  { id: "physiotherapist", label: "Physiotherapist", emoji: "🧑‍⚕️" },
  { id: "caregiver", label: "Caregiver / Attendant", emoji: "🧑‍🦽" },
  { id: "babysitter", label: "Babysitter", emoji: "👶" },
  { id: "pet_sitter", label: "Pet Sitter", emoji: "🐾" },
  { id: "tax_ca", label: "Tax Consultant / CA", emoji: "🧾" },
  { id: "lawyer_civil", label: "Lawyer — Civil", emoji: "⚖️" },
  { id: "lawyer_criminal", label: "Lawyer — Criminal", emoji: "⚖️" },
  { id: "lawyer_corporate", label: "Lawyer — Corporate", emoji: "⚖️" },
];

const CITIES = [
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
];

const AVAILABILITY = ["Mornings", "Afternoons", "Evenings", "Weekends", "Full-time"];

const PROVIDERS = [
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
    </div>
  );
}

/* ---------------- HIRE HELP ---------------- */

function HirePanel({ goPartner }: { goPartner: () => void }) {
  const [chooserFor, setChooserFor] = useState<Category | null>(null);

  return (
    <div className="mt-5 space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setChooserFor(c)}
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
    </div>
  );
}

function ProviderChooser({ category, onClose }: { category: Category; onClose: () => void }) {
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
        <div className="mt-4 space-y-2">
          {PROVIDERS.map((p) => (
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
      const { data, error } = await supabase
        .from("partner_applications")
        .select("id, full_name, city, created_at, status")
        .eq("user_id", me!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("Kolkata");
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
    setSubmitting(true);
    try {
      const exp = Math.max(0, Math.min(60, parseInt(experience || "0", 10) || 0));
      const { error } = await supabase.from("partner_applications").insert({
        user_id: me.id,
        full_name: fullName.trim(),
        phone: phone.trim(),
        city: city.trim(),
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

  if (existing) {
    return (
      <div className="mt-6 rounded-2xl border border-primary/40 bg-primary/10 p-5 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-6 w-6" />
        </div>
        <div className="font-display text-lg font-bold">you're on the list ✅</div>
        <div className="mt-2 text-sm text-muted-foreground">
          we'll reach out as we launch in {existing.city}.
        </div>
        <div className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          status: {existing.status}
        </div>
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
        <Field label="City">
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="input-base"
          >
            {CITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
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
    </form>
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
