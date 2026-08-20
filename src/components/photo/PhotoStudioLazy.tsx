import { lazy, Suspense, type ComponentProps } from "react";

/**
 * Lazy boundary for PhotoStudio.
 *
 * The photo editor (crop, filters, face-fx, metadata stripping) is only ever
 * rendered once a user has actually picked a photo to edit — every call site
 * gates it behind `studioFile && <PhotoStudio .../>`. Statically importing it
 * still pulled the editor into the initial JS of every screen that CAN edit a
 * photo (chat threads, the moments feed, the avatar sheet). This defers it to
 * its own chunk, fetched the moment the editor first opens.
 *
 * Drop-in: same name, same props. `fallback={null}` because the editor is a
 * full-screen modal that appears on user action — a spinner in its place would
 * flash nothing meaningful for the sub-second it takes to arrive.
 */
const PhotoStudioInner = lazy(() =>
  import("./PhotoStudio").then((m) => ({ default: m.PhotoStudio })),
);

export function PhotoStudio(props: ComponentProps<typeof PhotoStudioInner>) {
  return (
    <Suspense fallback={null}>
      <PhotoStudioInner {...props} />
    </Suspense>
  );
}
