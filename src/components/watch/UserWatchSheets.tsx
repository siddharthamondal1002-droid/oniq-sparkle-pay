/**
 * My TV and user-made genres — the writer half.
 *
 * The three sheets below are recovered from
 * src/components/landing/LiveNewsSection.tsx at d879305b^: AddGenreSheet,
 * AddChannelSheet and MyTvManageSheet, with their original copy, caps and
 * test ids. Read src/lib/userWatch.ts for what survived the removal and why
 * the `my-tv` edge function is not coming back with them.
 *
 * THE ONE BEHAVIOURAL CHANGE, and it is a narrowing. Adding to My TV used to
 * post the pasted text to that edge function, which fetched YouTube with a
 * spoofed browser User-Agent to turn a @handle into a channel id and to read
 * the channel's name. Here the id is read out of the pasted string — it is
 * literally in a /channel/ URL — and the user types the name. A paste with no
 * id in it is refused with a message saying what to paste instead. That is the
 * same conclusion the old function reached for handles; the difference is that
 * nothing is fetched to reach it.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  MAX_CHANNELS_PER_GENRE,
  MAX_MYTV_CHANNELS,
  MAX_USER_GENRES,
  channelIdFrom,
  parseYouTube,
  useMyTv,
  type MyTvRow,
} from "@/lib/userWatch";

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="glass w-full max-w-lg rounded-t-3xl border border-border bg-card p-5 shadow-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-lg font-bold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="press grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const INPUT =
  "w-full rounded-full border border-border bg-surface px-4 py-2 text-sm outline-none focus:border-primary";
const PRIMARY =
  "press rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50";
const GHOST = "press rounded-full border border-border bg-surface px-4 py-2 text-sm";

export function AddGenreSheet({
  userId,
  existingCount,
  onClose,
  onCreated,
}: {
  userId: string;
  existingCount: number;
  onClose: () => void;
  onCreated: (row: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const nm = name.trim();
    if (!nm) return;
    if (existingCount >= MAX_USER_GENRES) {
      toast.error("that's enough genres bestie 😭");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase
      .from("user_watch_genres")
      .insert({ user_id: userId, name: nm.slice(0, 40), position: existingCount })
      .select("id, name")
      .single();
    setBusy(false);
    if (error || !data) {
      toast.error("couldn't add");
      return;
    }
    toast.success(`${data.name} added 🎯`);
    onCreated(data);
    onClose();
  };
  return (
    <Sheet title="new genre 🎯" onClose={onClose}>
      <input
        data-testid="user-genre-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. F1, cooking, chess…"
        aria-label="Genre name"
        maxLength={40}
        className={INPUT}
      />
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={GHOST}>
          cancel
        </button>
        <button
          type="button"
          data-testid="user-genre-save"
          onClick={submit}
          disabled={busy || !name.trim()}
          className={PRIMARY}
        >
          {busy ? "…" : "add"}
        </button>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {existingCount}/{MAX_USER_GENRES} genres
      </div>
    </Sheet>
  );
}

export function AddChannelSheet({
  userId,
  genre,
  existingCount,
  onClose,
  onAdded,
}: {
  userId: string;
  genre: { id: string; name: string };
  existingCount: number;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const nm = name.trim();
    const u = url.trim();
    if (!nm || !u) return;
    if (existingCount >= MAX_CHANNELS_PER_GENRE) {
      toast.error(`${MAX_CHANNELS_PER_GENRE} channels max per genre — trim it 🧹`);
      return;
    }
    const parsed = parseYouTube(u);
    if (!parsed) {
      toast.error("drop a video or playlist link, channel pages can't autoplay 📺");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("user_watch_channels").insert({
      user_id: userId,
      genre_id: genre.id,
      name: nm.slice(0, 80),
      youtube_url: u,
      position: existingCount,
    });
    setBusy(false);
    if (error) {
      toast.error("couldn't add channel");
      return;
    }
    toast.success(`${nm} added 📺`);
    onAdded();
    onClose();
  };
  return (
    <Sheet title={`add to ${genre.name} 📺`} onClose={onClose}>
      <div className="space-y-2">
        <input
          data-testid="user-channel-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name (e.g. F1 highlights)"
          aria-label="Channel name"
          maxLength={80}
          className={INPUT}
        />
        <input
          data-testid="user-channel-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="paste youtu.be / youtube.com watch or playlist link"
          aria-label="YouTube link"
          className={INPUT}
        />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={GHOST}>
          cancel
        </button>
        <button
          type="button"
          data-testid="user-channel-save"
          onClick={submit}
          disabled={busy || !name.trim() || !url.trim()}
          className={PRIMARY}
        >
          {busy ? "…" : "add"}
        </button>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {existingCount}/{MAX_CHANNELS_PER_GENRE} in this genre
      </div>
    </Sheet>
  );
}

export function MyTvManageSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const list = useMyTv(userId);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["my-tv-channels"] });
  };

  const addMutation = useMutation({
    mutationFn: async ({ nm, raw }: { nm: string; raw: string }) => {
      const existing = list.data ?? [];
      if (existing.length >= MAX_MYTV_CHANNELS) throw new Error("cap");
      // NO NETWORK CALL. The channel id is in the URL the user pasted, or the
      // paste is unusable — see the file header for why the resolver is gone.
      const channelId = channelIdFrom(raw);
      if (!channelId) throw new Error("noid");
      const { error } = await supabase
        .from("user_channels")
        .insert({ user_id: userId, channel_id: channelId, name: nm.slice(0, 80) });
      if (error) throw error;
      return { name: nm };
    },
    onSuccess: ({ name: added }) => {
      toast.success(`${added} added to My TV 📺`);
      setName("");
      setUrl("");
      invalidate();
    },
    onError: (e: unknown) => {
      const err = e as { message?: string; code?: string };
      if (err?.message === "cap")
        toast.error(`Cap is ${MAX_MYTV_CHANNELS} channels — remove one first`);
      else if (err?.message === "noid")
        toast.error(
          "Paste the channel's link from its About page — the one with /channel/UC… in it",
        );
      else if (err?.code === "23505") toast.error("Already in your My TV");
      else toast.error("Couldn't add that channel");
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (channelId: string) => {
      const { error } = await supabase.from("user_channels").delete().eq("channel_id", channelId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast("Removed");
      invalidate();
    },
    onError: () => toast.error("Couldn't remove"),
  });

  const rows: MyTvRow[] = list.data ?? [];

  return (
    <Sheet title="My TV 📺" onClose={onClose}>
      <div className="space-y-2">
        <input
          data-testid="mytv-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name it (e.g. BBC News)"
          aria-label="Channel name"
          maxLength={80}
          className={INPUT}
        />
        <div className="flex gap-2">
          <input
            data-testid="mytv-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="paste a youtube.com/channel/UC… link"
            aria-label="Channel link"
            className={`${INPUT} flex-1`}
          />
          <button
            type="button"
            data-testid="mytv-add"
            onClick={() =>
              name.trim() && url.trim() && addMutation.mutate({ nm: name.trim(), raw: url.trim() })
            }
            disabled={addMutation.isPending || !name.trim() || !url.trim()}
            className={PRIMARY}
          >
            {addMutation.isPending ? "…" : "Add"}
          </button>
        </div>
      </div>

      <div className="mt-4 max-h-72 overflow-y-auto">
        {list.isLoading ? (
          <div className="py-6 text-center text-xs text-muted-foreground">loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Build your own lineup — paste any channel link ✨
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((c) => (
              <li key={c.channel_id} className="flex items-center justify-between py-2.5">
                <span className="truncate text-sm text-foreground">{c.name}</span>
                <button
                  type="button"
                  onClick={() => removeMutation.mutate(c.channel_id)}
                  className="press grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:text-red-400"
                  aria-label={`Remove ${c.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {rows.length}/{MAX_MYTV_CHANNELS} channels
      </div>
    </Sheet>
  );
}
