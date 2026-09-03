/**
 * Save a link. The link is parsed here (never fetched); the provider's own
 * public metadata endpoint fills the title, creator, length and — for the
 * Archive — the rights fields, server-side. The person confirms, optionally
 * says why they saved it, and picks a collection. Nothing is forced.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { addToCollection, resolveWatchRef, saveWatchItem } from "@/lib/watch/library";
import {
  WATCH_PROVIDERS,
  parseWatchUrl,
  titleFromSlug,
  type ParsedWatchRef,
} from "@/lib/watch/providers";
import { classifyArchiveRights, type Rights } from "@/lib/watch/rights";
import {
  SAVE_REASONS,
  type SaveReason,
  type WatchCollection,
  type WatchItem,
} from "@/lib/watch/types";
import {
  BottomSheet,
  Chip,
  GHOST,
  INPUT,
  PRIMARY,
  ProviderBadge,
  RightsBadge,
} from "@/components/watch/library/shared";

export function SaveLinkSheet({
  userId,
  collections,
  initialUrl,
  onClose,
  onSaved,
}: {
  userId: string;
  collections: WatchCollection[];
  initialUrl?: string;
  onClose: () => void;
  onSaved: (item: WatchItem, existed: boolean) => void;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [parsed, setParsed] = useState<ParsedWatchRef | null>(null);
  const [title, setTitle] = useState("");
  const [creator, setCreator] = useState("");
  const [minutes, setMinutes] = useState("");
  const [reason, setReason] = useState<SaveReason | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [rights, setRights] = useState<Rights | null>(null);
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [thumb, setThumb] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupNote, setLookupNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Parse on every keystroke; look up once per distinct reference.
  useEffect(() => {
    const ref = parseWatchUrl(url);
    setParsed(ref);
    setRights(null);
    setMeta({});
    setThumb(null);
    setLookupNote("");
    if (!ref) return;
    if (ref.provider === "nebula") {
      setTitle((t) => t || titleFromSlug(ref.contentId));
      setLookupNote("Nebula publishes no public details; the title is read from the link.");
      return;
    }
    if (!WATCH_PROVIDERS[ref.provider].capabilities.metadata || ref.provider === "twitch") {
      setLookupNote("No public details for this provider; type the title.");
      return;
    }
    let alive = true;
    setLooking(true);
    resolveWatchRef(ref.provider, ref.contentId)
      .then((m) => {
        if (!alive) return;
        if (!m.resolved) {
          setLookupNote("Couldn't read details from the provider; type the title.");
          return;
        }
        if (m.title) setTitle(m.title);
        if (m.creator) setCreator(m.creator);
        if (m.durationSeconds) setMinutes(String(Math.max(1, Math.round(m.durationSeconds / 60))));
        if (m.thumbnailUrl) setThumb(m.thumbnailUrl);
        setMeta(m.metadata ?? {});
        if (ref.provider === "internet_archive") setRights(classifyArchiveRights(m.archive ?? {}));
      })
      .catch(() => {
        if (alive) setLookupNote("Couldn't read details from the provider; type the title.");
      })
      .finally(() => {
        if (alive) setLooking(false);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  const save = async () => {
    if (!parsed || !title.trim()) return;
    setBusy(true);
    try {
      const mins = Number(minutes);
      const { item, existed } = await saveWatchItem(userId, {
        provider: parsed.provider,
        contentId: parsed.contentId,
        canonicalUrl: parsed.canonicalUrl,
        title,
        creator: creator || null,
        durationSeconds: Number.isFinite(mins) && mins > 0 ? Math.round(mins * 60) : null,
        thumbnailUrl: thumb,
        reason,
        rights: rights ?? undefined,
        metadata: meta,
        state: "inbox",
      });
      if (collectionId) await addToCollection(userId, collectionId, item.id);
      toast.success(
        existed ? "Already in your Watch library — opened it" : "Saved to your Inbox 📥",
      );
      onSaved(item, existed);
      onClose();
    } catch (e) {
      console.warn("watch: save failed", (e as { code?: string })?.code ?? "");
      toast.error("Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet title="Save a link" onClose={onClose} testId="watch-save-sheet">
      <div className="space-y-3">
        <input
          data-testid="watch-save-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="paste a YouTube, Vimeo, Nebula, Internet Archive, Dailymotion or Twitch link"
          aria-label="Video link"
          inputMode="url"
          className={INPUT}
        />
        {url.trim() && !parsed ? (
          <p className="text-xs text-amber-300">
            That isn&apos;t a link Watch can hold. Paste a video, playlist, channel or archive item
            link.
          </p>
        ) : null}
        {parsed ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <ProviderBadge provider={parsed.provider} />
            {looking ? (
              <span>Looking up details…</span>
            ) : lookupNote ? (
              <span>{lookupNote}</span>
            ) : null}
            {rights ? <RightsBadge rights={rights} /> : null}
          </div>
        ) : null}
        <input
          data-testid="watch-save-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="title"
          aria-label="Title"
          maxLength={200}
          className={INPUT}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={creator}
            onChange={(e) => setCreator(e.target.value)}
            placeholder="creator / channel"
            aria-label="Creator"
            maxLength={120}
            className={INPUT}
          />
          <input
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="length in minutes"
            aria-label="Length in minutes"
            inputMode="numeric"
            className={INPUT}
          />
        </div>
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            why did you save this? (optional)
          </div>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
            {SAVE_REASONS.map((r) => (
              <Chip
                key={r.key}
                active={reason === r.key}
                onClick={() => setReason(reason === r.key ? null : r.key)}
              >
                {r.label}
              </Chip>
            ))}
          </div>
        </div>
        {collections.length > 0 ? (
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              collection
            </div>
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
              {collections.map((c) => (
                <Chip
                  key={c.id}
                  active={collectionId === c.id}
                  onClick={() => setCollectionId(collectionId === c.id ? null : c.id)}
                >
                  {c.name}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={GHOST}>
            cancel
          </button>
          <button
            type="button"
            data-testid="watch-save-submit"
            onClick={save}
            disabled={busy || !parsed || !title.trim()}
            className={PRIMARY}
          >
            {busy ? "…" : "save"}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
