import { createFileRoute } from "@tanstack/react-router";
import { MomentsFeed } from "@/components/moments/MomentsFeed";

export const Route = createFileRoute("/_authenticated/app/chat/moments")({
  component: MomentsTab,
});

function MomentsTab() {
  return (
    <div className="pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="px-5 pt-6">
        <h1 className="font-display text-3xl font-bold">Moments</h1>
        <p className="mt-1 text-sm text-muted-foreground">Moments from your worlds</p>
      </div>
      <MomentsFeed />
    </div>
  );
}
