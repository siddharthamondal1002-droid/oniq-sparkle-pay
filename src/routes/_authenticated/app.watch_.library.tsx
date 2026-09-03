// /app/watch/library — the Watch library (owner mission, 2026-09-03).
//
// `watch_` with the trailing underscore keeps this route OUT of the Watch
// channel screen's tree: app.watch.tsx is a leaf, not a layout, and stays
// exactly as it was.
import { createFileRoute } from "@tanstack/react-router";
import { WatchLibrary } from "@/components/watch/library/WatchLibrary";
import { parseSurface, type WatchSurface } from "@/lib/watch/surfaces";

type LibrarySearch = { surface?: WatchSurface; save?: true };

export const Route = createFileRoute("/_authenticated/app/watch_/library")({
  // Home deep-links here: ?surface=inbox opens that surface, ?save=1 opens
  // the Save-a-link sheet. Anything else is dropped, never thrown on.
  validateSearch: (s: Record<string, unknown>): LibrarySearch => ({
    surface: parseSurface(s.surface),
    ...(s.save === true || s.save === 1 || s.save === "1" ? { save: true as const } : {}),
  }),
  component: WatchLibraryRoute,
});

function WatchLibraryRoute() {
  const { surface, save } = Route.useSearch();
  return <WatchLibrary initialSurface={surface} openSave={!!save} />;
}
