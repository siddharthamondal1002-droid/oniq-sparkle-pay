import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ExternalLink, Car, IndianRupee, Landmark } from "lucide-react";
import { launchAppEntry, relativeLuminance, readableInk } from "@/lib/miniapps";
import { CATEGORY_LABELS, visibleApps, APP_REGISTRY, type CategoryId } from "@/data/appRegistry";
import { COUNTRIES, useCountry } from "@/lib/country";
import { resolveTileLabel } from "@/lib/i18n/tileLabel";
import { useT } from "@/lib/i18n/LanguageProvider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/app/miniapps")({
  component: MiniAppsScreen,
});

const CATEGORY_ORDER: CategoryId[] = ["rides", "quickcommerce", "services", "food", "payments", "social", "shopping", "beauty", "fashion", "entertainment"];

// The Pay-via-UPI shortcut is registry-driven: the "oniq-upi" entry carries
// hidden:true — hidden, not deleted. /app/upi and /app/scan stay reachable
// (deep links, chat attachments) and keep their anti-fraud UX.
const UPI_ENTRY = APP_REGISTRY.find((a) => a.id === "oniq-upi");
const SHOW_UPI_SHORTCUT = !!UPI_ENTRY && !UPI_ENTRY.hidden;

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

function MiniAppsScreen() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [country, setCountry] = useCountry();
  const { lang } = useT();

  const folders: Folder[] = CATEGORY_ORDER.map((cat) => {
    // visibleApps enforces status==="active", hidden and country in one place.
    const apps = visibleApps(country, cat);
    return {
      key: cat,
      label: resolveTileLabel(lang, CATEGORY_LABELS[cat].label, CATEGORY_LABELS[cat].labelHi),
      items: apps.map((app) => ({
        id: app.id,
        name: app.name,
        tagline: app.tagline,
        color: app.color,
        emoji: app.emoji,
        letter: app.letter,
        onTap: () => launchAppEntry(app),
      })),
    };
  }).filter((f) => f.items.length > 0);

  const activeFolder = folders.find((f) => f.key === openKey) ?? null;

  return (
    <div className="px-5 pt-12 pb-6">
      <div className="flex items-center gap-3">
        <Link to="/app" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-2xl font-bold">{resolveTileLabel(lang, "Hacks 🔌", "जुगाड़ 🔌")}</h1>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Every app you're lowkey addicted to, one tap away. Tap a folder to dive in.
      </p>
      <p className="mt-1 text-xs text-muted-foreground/80">
        Apps open with your own accounts — ONIQ never sees their logins.
      </p>

      {/* Country selector — app lists below re-render instantly */}
      <div className="no-scrollbar mt-4 flex gap-1.5 overflow-x-auto" data-testid="country-picker">
        {COUNTRIES.map((c) => (
          <button
            key={c.code}
            type="button"
            onClick={() => setCountry(c.code)}
            aria-pressed={country === c.code}
            className={`press shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${
              country === c.code
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            {c.flag} {c.code}
          </button>
        ))}
      </div>

      {/* Native ONIQ shortcuts */}
      <div className={`mt-4 grid gap-3 ${SHOW_UPI_SHORTCUT ? "grid-cols-3" : "grid-cols-2"}`}>
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
          to="/app/official"
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
        >
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">{resolveTileLabel(lang, "Official", "सरकारी")}</div>
            <div className="text-xs text-muted-foreground">gov services & visas</div>
          </div>
        </Link>
        {SHOW_UPI_SHORTCUT && (
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
        )}
      </div>

      {/* Folder grid */}
      <div className="mt-6 grid grid-cols-2 gap-4">
        {folders.map((f, i) => (
          <FolderCard key={f.key} folder={f} index={i} onOpen={() => setOpenKey(f.key)} />
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Third-party apps are independent services. ONIQ opens them for your convenience.
      </p>

      <Dialog open={!!activeFolder} onOpenChange={(o) => !o && setOpenKey(null)}>
        <DialogContent
          className="max-h-[80vh] w-[90vw] max-w-md gap-0 overflow-y-auto rounded-3xl border border-white/10 bg-card p-5 motion-reduce:animate-none"
        >
          {activeFolder && (
            <>
              <DialogTitle className="text-left font-display text-xl">{activeFolder.label}</DialogTitle>
              {activeFolder.disclaimer && (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {activeFolder.disclaimer}
                </p>
              )}
              <div className="mt-4 space-y-2 pb-2">
                {activeFolder.items.map((item, idx) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      item.onTap();
                      setOpenKey(null);
                    }}
                    data-testid={`miniapp-${item.id}`}
                    style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
                    className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition active:scale-[0.97] hover:border-primary/40 animate-in fade-in-0 slide-in-from-bottom-2 duration-300 fill-mode-both motion-reduce:animate-none motion-reduce:transition-none"
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
        </DialogContent>
      </Dialog>
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

function FolderCard({ folder, index, onOpen }: { folder: Folder; index: number; onOpen: () => void }) {
  const items = folder.items;
  const overflow = items.length > 4;
  const bigs = overflow ? items.slice(0, 3) : items.slice(0, 4);
  const minis = overflow ? items.slice(3, 7) : [];

  return (
    <button
      onClick={onOpen}
      style={{ animationDelay: `${index * 40}ms` }}
      className="flex flex-col items-center gap-2 transition-transform duration-150 active:scale-95 animate-in fade-in-0 zoom-in-95 duration-300 fill-mode-both motion-reduce:animate-none motion-reduce:transition-none"
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
