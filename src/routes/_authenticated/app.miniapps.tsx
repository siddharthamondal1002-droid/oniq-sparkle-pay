/**
 * PLUG — every third-party app ONIQ can open, one tap away.
 *
 * The registry (src/data/appRegistry.ts) is the only source of apps, and
 * visibleApps() applies status, hidden and country in one place, so the
 * search and the folders can never disagree about what a person may see.
 * Owner rule: 150 apps are never drawn as a wall of icons — search first,
 * folders for browsing, and every tap goes through launchAppEntry().
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ExternalLink, Car, IndianRupee, Landmark, Search, X } from "lucide-react";
import { launchAppEntry, relativeLuminance, readableInk } from "@/lib/miniapps";
import { CATEGORY_LABELS, visibleApps, APP_REGISTRY, type CategoryId } from "@/data/appRegistry";
import { COUNTRIES, useCountry } from "@/lib/country";
import { resolveTileLabel } from "@/lib/i18n/tileLabel";
import { useT } from "@/lib/i18n/LanguageProvider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { OniqCanvas, OniqChip, OniqEmpty, OniqHeader, OniqSectionHeader } from "@/components/oniq";

export const Route = createFileRoute("/_authenticated/app/miniapps")({
  component: MiniAppsScreen,
});

const CATEGORY_ORDER: CategoryId[] = [
  "rides",
  "quickcommerce",
  "services",
  "food",
  "payments",
  "social",
  "shopping",
  "beauty",
  "fashion",
  "entertainment",
];

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

/** A search hit — the app plus the folder it lives in, for the subline. */
type Hit = FolderItem & { folderLabel: string };

const SHORTCUT_CLASS = "press flex flex-col items-start gap-3 rounded-2xl oniq-surface p-4";
const SHORTCUT_WELL = "grid h-10 w-10 place-items-center rounded-xl bg-world text-white world-glow";

function MiniAppsScreen() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useCountry();
  const { lang } = useT();

  const folders: Folder[] = useMemo(
    () =>
      CATEGORY_ORDER.map((cat) => {
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
      }).filter((f) => f.items.length > 0),
    [country, lang],
  );

  // The search reads the folders, never the registry directly, so it cannot
  // surface an app the country gate hid. Name or category label, any case.
  const q = query.trim().toLowerCase();
  const hits: Hit[] = useMemo(() => {
    if (!q) return [];
    return folders.flatMap((f) => {
      const folderMatches = f.label.toLowerCase().includes(q);
      return f.items
        .filter((it) => folderMatches || it.name.toLowerCase().includes(q))
        .map((it) => ({ ...it, folderLabel: f.label }));
    });
  }, [folders, q]);

  const activeFolder = folders.find((f) => f.key === openKey) ?? null;
  const searching = q.length > 0;

  return (
    <OniqCanvas world="plug" className="pb-8">
      <OniqHeader
        eyebrow="Plug"
        title={resolveTileLabel(lang, "Hacks 🔌", "जुगाड़ 🔌")}
        subtitle="Every app you're lowkey addicted to, one tap away. Tap a folder to dive in."
        back="/app"
      >
        <div
          role="search"
          className="flex items-center gap-3 rounded-full oniq-surface py-2 pe-2 ps-4"
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps"
            aria-label="Search apps"
            data-testid="miniapps-search"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {searching ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="tap press grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className="h-7 w-7 shrink-0" aria-hidden="true" />
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Apps open with your own accounts — ONIQ never sees their logins.
        </p>

        {/* Country selector — app lists below re-render instantly */}
        <div
          className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto"
          data-testid="country-picker"
        >
          {COUNTRIES.map((c) => (
            <OniqChip key={c.code} active={country === c.code} onClick={() => setCountry(c.code)}>
              {c.flag} {c.code}
            </OniqChip>
          ))}
        </div>
      </OniqHeader>

      {searching ? (
        <section className="mt-6 rise rise-1">
          <OniqSectionHeader
            eyebrow="Search"
            title={hits.length === 1 ? "1 app" : `${hits.length} apps`}
          />
          <div className="mt-3 grid gap-2 px-5">
            {hits.length === 0 ? (
              <OniqEmpty
                emoji="🔌"
                title="No app matches that"
                body="Try the app's name, or a category like rides."
              />
            ) : (
              hits.map((item) => (
                <AppRow
                  key={item.id}
                  item={item}
                  subline={`${item.folderLabel} · ${item.tagline}`}
                  onTap={item.onTap}
                />
              ))
            )}
          </div>
        </section>
      ) : (
        <>
          {/* Folders first (owner reference): search, then every app by category. */}
          <section className="mt-6 rise rise-1">
            <OniqSectionHeader eyebrow="Folders" title="Every app, by category" />
            <div className="mt-3 grid grid-cols-2 gap-3 px-5">
              {folders.map((f) => (
                <FolderCard key={f.key} folder={f} onOpen={() => setOpenKey(f.key)} />
              ))}
            </div>
          </section>

          {/* Native ONIQ shortcuts */}
          <section className="mt-7 rise rise-2">
            <OniqSectionHeader eyebrow="Inside ONIQ" title="Shortcuts" />
            <div
              className={`mt-3 grid gap-3 px-5 ${SHOW_UPI_SHORTCUT ? "grid-cols-3" : "grid-cols-2"}`}
            >
              <Link to="/app/rides" className={SHORTCUT_CLASS}>
                <div className={SHORTCUT_WELL}>
                  <Car className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-display text-[13px] text-foreground">Book a ride</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    Uber · Ola · Rapido
                  </div>
                </div>
              </Link>
              <Link to="/app/official" className={SHORTCUT_CLASS}>
                <div className={SHORTCUT_WELL}>
                  <Landmark className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-display text-[13px] text-foreground">
                    {resolveTileLabel(lang, "Official", "सरकारी")}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    gov services & visas
                  </div>
                </div>
              </Link>
              {SHOW_UPI_SHORTCUT && (
                <Link to="/app/upi" className={SHORTCUT_CLASS}>
                  <div className={SHORTCUT_WELL}>
                    <IndianRupee className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-display text-[13px] text-foreground">Pay via UPI</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      GPay · PhonePe · Paytm
                    </div>
                  </div>
                </Link>
              )}
            </div>
          </section>
        </>
      )}

      <p className="mt-8 px-5 text-center text-[11px] text-muted-foreground">
        Third-party apps are independent services. ONIQ opens them for your convenience.
      </p>

      <Dialog open={!!activeFolder} onOpenChange={(o) => !o && setOpenKey(null)}>
        <DialogContent
          data-world="plug"
          className="max-h-[80vh] w-[90vw] max-w-md gap-0 overflow-y-auto rounded-3xl border border-border bg-card p-5 shadow-card motion-reduce:animate-none"
        >
          {activeFolder && (
            <>
              <DialogTitle className="text-start font-display text-xl">
                {activeFolder.label}
              </DialogTitle>
              {activeFolder.disclaimer && (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {activeFolder.disclaimer}
                </p>
              )}
              <div className="mt-4 space-y-2 pb-2">
                {activeFolder.items.map((item) => (
                  <AppRow
                    key={item.id}
                    item={item}
                    subline={item.tagline}
                    onTap={() => {
                      item.onTap();
                      setOpenKey(null);
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </OniqCanvas>
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
      <span className={`relative z-10 ${size === "lg" ? "text-xl" : "text-[11px]"}`}>
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

/** One app, as a row: the same shape in the search results and inside a folder. */
function AppRow({
  item,
  subline,
  onTap,
}: {
  item: FolderItem;
  subline: string;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      data-testid={`miniapp-${item.id}`}
      className="press flex w-full items-center gap-3 rounded-2xl oniq-surface p-3 text-start"
    >
      <div className="h-11 w-11 shrink-0">
        <AppTile item={item} size="lg" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{item.name}</div>
        <div className="truncate text-xs text-muted-foreground">{subline}</div>
      </div>
      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

function FolderCard({ folder, onOpen }: { folder: Folder; onOpen: () => void }) {
  const items = folder.items;
  const overflow = items.length > 4;
  const bigs = overflow ? items.slice(0, 3) : items.slice(0, 4);
  const minis = overflow ? items.slice(3, 7) : [];

  return (
    <button type="button" onClick={onOpen} className="press flex flex-col gap-2 text-start">
      <div className="relative aspect-square w-full rounded-[28px] oniq-surface p-3">
        <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-2">
          {bigs.map((item) => (
            <AppTile key={item.id} item={item} size="lg" />
          ))}
          {overflow && (
            <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-0.5 rounded-xl bg-surface-2 p-1">
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
      <div className="w-full px-1">
        <div className="truncate font-display text-[13px] leading-tight text-foreground">
          {folder.label}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {items.length} app{items.length === 1 ? "" : "s"}
        </div>
      </div>
    </button>
  );
}
