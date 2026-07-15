import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ExternalLink, Car, IndianRupee } from "lucide-react";
import { MINI_APPS, CATEGORY_LABELS, launchMiniApp, relativeLuminance, readableInk, type MiniApp } from "@/lib/miniapps";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/app/miniapps")({
  component: MiniAppsScreen,
});

const CATEGORY_ORDER: MiniApp["category"][] = ["rides", "quickcommerce", "services", "food", "payments", "social", "shopping"];

type FolderItem = {
  id: string;
  name: string;
  tagline: string;
  color: string;
  emoji?: string;
  letter?: string;
  onTap: () => void;
};

type Folder = {
  key: string;
  label: string;
  items: FolderItem[];
  disclaimer?: string;
};

const GOV_PORTALS: { name: string; tagline: string; url: string; emoji: string }[] = [
  { name: "Grievances (CPGRAMS)", tagline: "File & track public grievances", url: "https://pgportal.gov.in", emoji: "📝" },
  { name: "Court case status (eCourts)", tagline: "Check case status online", url: "https://services.ecourts.gov.in", emoji: "⚖️" },
  { name: "All gov services", tagline: "India.gov.in services portal", url: "https://services.india.gov.in", emoji: "🏛️" },
  { name: "DigiLocker", tagline: "Your documents, digital", url: "https://www.digilocker.gov.in", emoji: "🗂️" },
  { name: "Income Tax", tagline: "File returns & track refunds", url: "https://www.incometax.gov.in", emoji: "💸" },
  { name: "GST", tagline: "GST portal", url: "https://www.gst.gov.in", emoji: "🧾" },
  { name: "Passport Seva", tagline: "Apply & track passport", url: "https://www.passportindia.gov.in", emoji: "🛂" },
  { name: "Aadhaar (UIDAI)", tagline: "Aadhaar services", url: "https://uidai.gov.in", emoji: "🆔" },
  { name: "EPFO", tagline: "Provident fund services", url: "https://www.epfindia.gov.in", emoji: "🏦" },
  { name: "RTO / vehicle (Parivahan)", tagline: "License & vehicle services", url: "https://parivahan.gov.in", emoji: "🚘" },
  { name: "Cybercrime", tagline: "Report cybercrime", url: "https://cybercrime.gov.in", emoji: "🛡️" },
  { name: "Consumer Helpline", tagline: "Consumer complaints", url: "https://consumerhelpline.gov.in", emoji: "📞" },
  { name: "KMC (Kolkata)", tagline: "Kolkata Municipal Corporation", url: "https://www.kmcgov.in", emoji: "🏙️" },
  { name: "West Bengal gov", tagline: "Government of West Bengal", url: "https://wb.gov.in", emoji: "🌆" },
];

const GOV_DISCLAIMER =
  "Official government portals. ONIQ is not affiliated with, endorsed by, or acting on behalf of any government body. Links open the official websites.";

function MiniAppsScreen() {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const folders: Folder[] = CATEGORY_ORDER.map((cat) => {
    const apps = MINI_APPS.filter((a) => a.category === cat);
    return {
      key: cat,
      label: CATEGORY_LABELS[cat],
      items: apps.map((app) => ({
        id: app.id,
        name: app.name,
        tagline: app.tagline,
        color: app.color,
        emoji: app.emoji,
        letter: app.letter,
        onTap: () => launchMiniApp({ name: app.name, url: app.url, androidPackage: app.androidPackage }),
      })),
    };
  }).filter((f) => f.items.length > 0);

  folders.push({
    key: "gov",
    label: "gov 🇮🇳",
    disclaimer: GOV_DISCLAIMER,
    items: GOV_PORTALS.map((g) => ({
      id: g.url,
      name: g.name,
      tagline: g.tagline,
      color: "#1B1E26",
      emoji: g.emoji,
      onTap: () => launchMiniApp({ name: g.name, url: g.url }),
    })),
  });

  const activeFolder = folders.find((f) => f.key === openKey) ?? null;

  return (
    <div className="px-5 pt-12 pb-6">
      <div className="flex items-center gap-3">
        <Link to="/app" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-2xl font-bold">the plug 🔌</h1>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Every app you're lowkey addicted to, one tap away. Tap a folder to dive in.
      </p>
      <p className="mt-1 text-xs text-muted-foreground/80">
        Apps open with your own accounts — ONIQ never sees their logins.
      </p>

      {/* Native ONIQ shortcuts */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link
          to="/app/rides"
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
        >
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <Car className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">Book a ride</div>
            <div className="text-xs text-muted-foreground">Uber · Ola · Rapido</div>
          </div>
        </Link>
        <Link
          to="/app/upi"
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
        >
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <IndianRupee className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">Pay via UPI</div>
            <div className="text-xs text-muted-foreground">GPay · PhonePe · Paytm</div>
          </div>
        </Link>
      </div>

      {/* Folder grid */}
      <div className="mt-6 grid grid-cols-2 gap-4">
        {folders.map((f) => (
          <FolderCard key={f.key} folder={f} onOpen={() => setOpenKey(f.key)} />
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Third-party apps are independent services. ONIQ opens them for your convenience.
      </p>

      <Sheet open={!!activeFolder} onOpenChange={(o) => !o && setOpenKey(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-3xl border-border bg-background">
          {activeFolder && (
            <>
              <SheetHeader>
                <SheetTitle className="text-left font-display text-xl">{activeFolder.label}</SheetTitle>
              </SheetHeader>
              {activeFolder.disclaimer && (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {activeFolder.disclaimer}
                </p>
              )}
              <div className="mt-4 space-y-2 pb-6">
                {activeFolder.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      item.onTap();
                      setOpenKey(null);
                    }}
                    data-testid={`miniapp-${item.id}`}
                    className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition hover:border-primary/40"
                  >
                    <div
                      className={`relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl font-display text-lg font-bold${
                        relativeLuminance(item.color) < 0.05 ? " ring-1 ring-inset ring-white/15" : ""
                      }`}
                      style={{ backgroundColor: item.color, color: item.emoji ? undefined : readableInk(item.color) }}
                    >
                      <span className="relative z-10">{item.emoji ?? item.letter}</span>
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-[40%] rounded-t-2xl bg-gradient-to-b from-white/20 to-transparent" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold">{item.name}</div>
                      <div className="text-xs text-muted-foreground">{item.tagline}</div>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AppTile({ item, size }: { item: FolderItem; size: "lg" | "sm" }) {
  const isDark = relativeLuminance(item.color) < 0.05;
  const base =
    size === "lg"
      ? "relative h-full w-full overflow-hidden rounded-2xl grid place-items-center font-display font-bold"
      : "relative h-full w-full overflow-hidden rounded-[4px] grid place-items-center font-display font-bold leading-none";
  const cls = `${base}${isDark ? " ring-1 ring-inset ring-white/15" : ""}`;
  const ink = item.emoji ? undefined : readableInk(item.color);
  return (
    <div className={cls} style={{ backgroundColor: item.color, color: ink }}>
      <span className={`relative z-10 ${size === "lg" ? "text-xl" : "text-[10px]"}`}>
        {item.emoji ?? item.letter}
      </span>
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-[40%] bg-gradient-to-b from-white/20 to-transparent ${
          size === "lg" ? "rounded-t-2xl" : "rounded-t-[4px]"
        }`}
      />
    </div>
  );
}

function FolderCard({ folder, onOpen }: { folder: Folder; onOpen: () => void }) {
  const items = folder.items;
  const overflow = items.length > 4;
  const bigs = overflow ? items.slice(0, 3) : items.slice(0, 4);
  const minis = overflow ? items.slice(3, 7) : [];

  return (
    <button
      onClick={onOpen}
      className="flex flex-col items-center gap-2 transition active:scale-95"
    >
      <div className="relative aspect-square w-full rounded-[28px] border border-white/10 bg-card/60 p-3 shadow-card backdrop-blur-xl">
        <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-2">
          {bigs.map((item) => (
            <AppTile key={item.id} item={item} size="lg" />
          ))}
          {overflow && (
            <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-0.5 rounded-xl bg-white/5 p-1">
              {minis.map((item) => (
                <AppTile key={item.id} item={item} size="sm" />
              ))}
              {Array.from({ length: Math.max(0, 4 - minis.length) }).map((_, i) => (
                <div key={`empty-${i}`} className="rounded-[4px]" />
              ))}
            </div>
          )}
          {!overflow &&
            Array.from({ length: Math.max(0, 4 - bigs.length) }).map((_, i) => (
              <div key={`slot-${i}`} className="rounded-xl" />
            ))}
        </div>
      </div>
      <div className="w-full text-center">
        <div
          className="truncate text-xs text-white/90"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}
        >
          {folder.label}
        </div>
        <div
          className="text-[10px] text-white/60"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}
        >
          {items.length} app{items.length === 1 ? "" : "s"}
        </div>
      </div>
    </button>
  );
}
