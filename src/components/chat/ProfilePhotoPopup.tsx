/**
 * WhatsApp-style avatar popup: tap a DP anywhere and the photo opens large in
 * a centred card — name on top, quick actions underneath (message, voice,
 * video, info). Before this, tapping a DP either did nothing (thread header of
 * a 1:1) or navigated into the chat (list row), and the one thing the tap was
 * asking for — SEE THE PHOTO — never happened.
 *
 * Purely presentational + event dispatch. Calls go through the same
 * `oniq:start-call` event the thread's call buttons use, so this works from
 * any screen without mounting call machinery of its own.
 */
import { useNavigate } from "@tanstack/react-router";
import { MessageSquareText, Phone, Video, Users, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CALLS_ENABLED } from "@/lib/flags";

export type ProfilePhotoTarget = {
  conversationId: string;
  title: string;
  avatarUrl: string | null;
  isGroup?: boolean;
  isChannel?: boolean;
};

export function ProfilePhotoPopup({
  target,
  onClose,
}: {
  target: ProfilePhotoTarget;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const monogram = (target.title || "?").charAt(0).toUpperCase();

  const message = () => {
    onClose();
    navigate({
      to: "/app/chat/$conversationId" as const,
      params: { conversationId: target.conversationId },
    });
  };

  const call = async (type: "audio" | "video") => {
    onClose();
    const { data } = await supabase.auth.getUser();
    const me = data.user;
    const meName =
      (me?.user_metadata as { display_name?: string; full_name?: string } | undefined)
        ?.display_name ||
      (me?.user_metadata as { display_name?: string; full_name?: string } | undefined)?.full_name ||
      me?.email ||
      "Someone";
    window.dispatchEvent(
      new CustomEvent("oniq:start-call", {
        detail: {
          conversationId: target.conversationId,
          callType: type,
          peerName: target.title,
          isGroup: target.isGroup,
          groupTitle: target.isGroup ? target.title : undefined,
          meId: me?.id,
          meName,
        },
      }),
    );
    navigate({
      to: "/app/chat/$conversationId" as const,
      params: { conversationId: target.conversationId },
    });
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${target.title} profile photo`}
    >
      <div
        className="w-full max-w-[320px] overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative aspect-square w-full bg-surface-2">
          {target.avatarUrl ? (
            <img src={target.avatarUrl} alt={target.title} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-primary/60 to-accent/60 text-7xl font-bold text-white">
              {target.isGroup ? <Users className="h-20 w-20" /> : monogram}
            </div>
          )}
          {/* Name bar over the top edge, like the reference. */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-3 py-2">
            <span className="truncate text-[15px] font-semibold normal-case tracking-normal text-white">
              {target.isChannel ? `📢 ${target.title}` : target.title}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/40 text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-around bg-card py-2.5">
          <button
            type="button"
            onClick={message}
            aria-label="Message"
            className="grid h-11 w-11 place-items-center rounded-full text-primary hover:bg-primary/10"
          >
            <MessageSquareText className="h-5 w-5" />
          </button>
          {CALLS_ENABLED && !target.isChannel ? (
            <>
              <button
                type="button"
                onClick={() => void call("audio")}
                aria-label="Voice call"
                className="grid h-11 w-11 place-items-center rounded-full text-primary hover:bg-primary/10"
              >
                <Phone className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => void call("video")}
                aria-label="Video call"
                className="grid h-11 w-11 place-items-center rounded-full text-primary hover:bg-primary/10"
              >
                <Video className="h-5 w-5" />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
