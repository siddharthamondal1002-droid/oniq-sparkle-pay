// /app/watch/library — the Watch library (owner mission, 2026-09-03).
//
// `watch_` with the trailing underscore keeps this route OUT of the Watch
// channel screen's tree: app.watch.tsx is a leaf, not a layout, and stays
// exactly as it was.
import { createFileRoute } from "@tanstack/react-router";
import { WatchLibrary } from "@/components/watch/library/WatchLibrary";

export const Route = createFileRoute("/_authenticated/app/watch_/library")({
  component: WatchLibrary,
});
