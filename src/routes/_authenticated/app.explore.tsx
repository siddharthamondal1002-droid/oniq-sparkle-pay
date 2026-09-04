/**
 * EXPLORE — every world, grouped, searchable. The fourth tab of the bottom
 * nav (owner mission, 2026-09-03). The list is src/data/worlds.ts; the
 * three visibility gates are the same ones Home applies, so a world a
 * person cannot use in their country, hid themselves, or is not old enough
 * for is not drawn here either.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  OniqAskBar,
  OniqCanvas,
  OniqChip,
  OniqEmpty,
  OniqHeader,
  OniqSectionHeader,
  OniqStoryRail,
  OniqWorldCard,
} from "@/components/oniq";
import { useHiddenTiles } from "@/components/customize/CustomizeSheet";
import { isAvailable } from "@/data/countryRegistry";
import { WORLD_GROUPS, type WorldEntry } from "@/data/worlds";
import { WORLD_ICON } from "@/data/worldIcons";
import { useCountry } from "@/lib/country";
import { useT } from "@/lib/i18n/LanguageProvider";
import { tileName, tileNamePlain } from "@/lib/i18n/tileLabel";
import { recordSignal } from "@/lib/personalisation";
import { useIsAdult18 } from "@/lib/useIsAdult18";

const GROUP_IDS = ["connect", "learn", "live", "discover", "work"] as const;
type GroupId = (typeof GROUP_IDS)[number];
type ExploreSearch = { group?: GroupId };

export const Route = createFileRoute("/_authenticated/app/explore")({
  // ?group=connect from Home's experience cards. Anything else is dropped.
  validateSearch: (s: Record<string, unknown>): ExploreSearch => ({
    group: (GROUP_IDS as readonly string[]).includes(String(s.group))
      ? (s.group as GroupId)
      : undefined,
  }),
  component: ExploreScreen,
  head: () => ({ meta: [{ title: "Explore — ONIQ" }] }),
});

function ExploreScreen() {
  const { group } = Route.useSearch();
  const navigate = useNavigate();
  const { lang } = useT();
  const [home] = useCountry();
  const [hidden] = useHiddenTiles();
  const isAdult = useIsAdult18();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const show = (w: WorldEntry) =>
      !(hidden as Set<string>).has(w.key) &&
      isAvailable(w.key, home) &&
      (!w.adultOnly || isAdult) &&
      (!q ||
        tileName(lang, w.key, home).toLowerCase().includes(q) ||
        w.hint.toLowerCase().includes(q));
    return WORLD_GROUPS.filter((g) => !group || g.id === group)
      .map((g) => ({ ...g, worlds: g.worlds.filter(show) }))
      .filter((g) => g.worlds.length > 0);
  }, [query, hidden, home, isAdult, lang, group]);

  return (
    <OniqCanvas world="home" className="pb-8">
      <OniqHeader eyebrow="ONIQ" title="Explore" subtitle="Every world, one login." back={null}>
        <label className="flex items-center gap-3 rounded-full oniq-surface py-2 pe-4 ps-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search worlds"
            aria-label="Search worlds"
            data-testid="explore-search"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </OniqHeader>

      <div className="mt-4 px-5">
        <OniqAskBar testId="explore-ask" />
      </div>

      <div className="mt-4 px-5">
        <OniqStoryRail ariaLabel="Groups" role="tablist">
          <OniqChip
            role="tab"
            active={!group}
            onClick={() => navigate({ to: "/app/explore", search: {} })}
            testId="explore-group-all"
          >
            All
          </OniqChip>
          {WORLD_GROUPS.map((g) => (
            <OniqChip
              key={g.id}
              role="tab"
              active={group === g.id}
              onClick={() => navigate({ to: "/app/explore", search: { group: g.id } })}
              testId={`explore-group-${g.id}`}
            >
              {g.title}
            </OniqChip>
          ))}
        </OniqStoryRail>
      </div>

      {groups.length === 0 ? (
        <div className="mt-6 px-5">
          <OniqEmpty emoji="🔍" title="No world matches that" body="Try a shorter word." />
        </div>
      ) : (
        groups.map((g, gi) => (
          <section key={g.id} className={`mt-7 rise rise-${Math.min(gi + 1, 5)}`}>
            <OniqSectionHeader eyebrow={g.eyebrow} title={g.title} />
            <div className="mt-3 grid gap-2 px-5">
              {g.worlds.map((w) => {
                // The same drawn glyph and hue Home's tiles use. A world has
                // ONE identity; it cannot be a green car here and a teal
                // gradient there, which is what it was when each screen chose
                // its own treatment.
                const art = WORLD_ICON[w.key];
                return (
                  <OniqWorldCard
                    key={w.key}
                    layout="row"
                    world={w.world}
                    emoji={w.emoji}
                    icon={art ? <art.Icon /> : undefined}
                    tint={art?.tint}
                    label={tileNamePlain(lang, w.key, home)}
                    sublabel={w.hint}
                    to={w.to}
                    search={w.search}
                    onClick={() => void recordSignal("hub_open", w.key)}
                    testId={`explore-${w.key}`}
                  />
                );
              })}
            </div>
          </section>
        ))
      )}
    </OniqCanvas>
  );
}
