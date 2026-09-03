import { createFileRoute } from "@tanstack/react-router";
import { OniqCanvas, OniqHeader } from "@/components/oniq";
import { MomentsFeed } from "@/components/moments/MomentsFeed";

export const Route = createFileRoute("/_authenticated/app/chat/moments")({
  component: MomentsTab,
});

function MomentsTab() {
  return (
    <OniqCanvas world="moments" className="pb-4">
      <OniqHeader eyebrow="Chat" title="Moments" subtitle="Moments from your worlds" back={null} />
      <MomentsFeed />
    </OniqCanvas>
  );
}
