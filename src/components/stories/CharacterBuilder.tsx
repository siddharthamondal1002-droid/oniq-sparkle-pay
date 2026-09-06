/**
 * CharacterBuilder — "draw this character", and STOP there.
 *
 * Mega loop, 2026-08-27. An explicit tap turns one saved character (name +
 * lock text) into ONE image through the existing story-still engine, stores
 * the bytes in the private story-actors bucket, and records the asset via
 * save_story_actor. That is the whole pipeline: no film, no audio, no clip,
 * no GPU job, no story_jobs row — a source-pinning test holds this file to
 * exactly those calls. Every tap is explicit and spends one image credit;
 * nothing here retries a refused frame (a refusal is shown, with its why).
 *
 * The character stays the user's words. The prompt is built by
 * actorReferencePrompt, which adds photography framing only — the identity
 * content is the lock text verbatim (see actorBuild.ts and its tests).
 *
 * These portraits render on the Stories studio surface, which is a declared
 * AI surface (stories_ai_output) with the label and report control.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Brush, ImagePlus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ACTOR_PHOTO_HEAD_BYTES, actorPortraitAlt, validateActorPhoto } from "@/lib/actorPhoto";
import type { CastMember } from "@/lib/castLibrary";
import {
  ACTOR_MIMES,
  actorAssetPath,
  actorReferencePrompt,
  validateActorBuild,
} from "@/lib/actorBuild";

const BUCKET = "story-actors";

type ActorAssetRow = {
  id: string;
  name: string;
  lock: string;
  style: string | null;
  storage_path: string;
  mime: string;
  /** 'generated' (drawn) or 'uploaded' (the person's own photo). */
  source: string;
  created_at: string;
};

/** Generation result held only until its save lands — never regenerated free. */
type PendingSave = {
  memberId: string;
  mime: string;
  /** A Blob, never a materialised buffer — see saveBytes. */
  blob: Blob;
  /** Carried through the retry so "Save again" cannot relabel a photo as AI. */
  source: "generated" | "uploaded";
};

type CharacterBuilderProps = {
  cast: CastMember[];
};

const assetKey = (name: string, lock: string) =>
  `${name.trim().toLowerCase()}\u0000${lock.trim().toLowerCase()}`;

/**
 * ADDING A PHOTO instead of drawing one — owner directive 2026-09-06, asked
 * what a picture should do in a film: "character reference — a face that
 * recurs". A film previously took no picture at all.
 *
 * It rides the EXISTING save path rather than a new one: the same bucket, the
 * same `save_story_actor` RPC, the same 24-portrait library cap. The only new
 * things are where the bytes come from and the `source` that records it. It
 * also costs nothing — drawing spends an image credit, choosing a photo does
 * not.
 *
 * THE FILE'S OWN `type` IS NOT TRUSTED. A picker reports a mime derived from
 * the extension, so a renamed file lies; `validateActorPhoto` sniffs the
 * leading bytes instead, reading 12 of them rather than pulling a 40 MB file
 * into memory to reject it.
 */
export function CharacterBuilder({ cast }: CharacterBuilderProps) {
  const [assets, setAssets] = useState<ActorAssetRow[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [building, setBuilding] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSave | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const thumbsRef = useRef<Record<string, string>>({});

  const loadAssets = useCallback(async () => {
    const { data } = await supabase
      .from("story_actor_assets" as never)
      .select("id, name, lock, style, storage_path, mime, source, created_at")
      .order("created_at", { ascending: false });
    setAssets((data ?? []) as unknown as ActorAssetRow[]);
  }, []);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  // Thumbnails: private bucket, so bytes are downloaded with the caller's own
  // session and held as object URLs — revoked when this panel unmounts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const a of assets) {
        if (thumbsRef.current[a.id]) continue;
        const { data } = await supabase.storage.from(BUCKET).download(a.storage_path);
        if (cancelled || !data) continue;
        const url = URL.createObjectURL(data);
        thumbsRef.current = { ...thumbsRef.current, [a.id]: url };
        setThumbs(thumbsRef.current);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assets]);

  useEffect(
    () => () => {
      for (const url of Object.values(thumbsRef.current)) URL.revokeObjectURL(url);
    },
    [],
  );

  const saveBytes = useCallback(
    async (
      member: CastMember,
      mime: string,
      /**
       * THE BYTES ARE NEVER PULLED INTO MEMORY. A picked photo is already a
       * Blob and Supabase's upload takes one directly, so a 40 MB file streams
       * to storage instead of becoming a 40 MB array first — the rule
       * megaLoopGuardrails enforces repo-wide, and the reason readAsDataURL
       * kills an Android process with no dialog. The draw path wraps its
       * decoded bytes in a Blob to use the same door.
       */
      blob: Blob,
      /**
       * WHERE THE PIXELS CAME FROM, and it is not bookkeeping. A drawn
       * portrait is AI-generated content ONIQ must label for Play; a photo the
       * person supplied is not, and labelling it as AI is a false claim in the
       * other direction. Postgres records it and the grid below reads it back.
       */
      source: "generated" | "uploaded" = "generated",
    ) => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) {
        setNotice("You are signed out.");
        return false;
      }
      const path = actorAssetPath(userId, crypto.randomUUID(), mime);
      const { error: upError } = await supabase.storage.from(BUCKET).upload(path, blob, {
        contentType: mime,
        upsert: false,
      });
      if (upError) {
        setNotice(`The portrait did not upload (${upError.message}). Save again — it's free.`);
        setPending({ memberId: member.id, mime, blob, source });
        return false;
      }
      const { data: saved } = await supabase.rpc(
        "save_story_actor" as never,
        {
          _name: member.name,
          _lock: member.lock,
          _style: null,
          _path: path,
          _mime: mime,
          _source: source,
        } as never,
      );
      const res = (saved ?? {}) as { ok?: boolean; reason?: string };
      if (!res.ok) {
        setNotice(
          res.reason === "library-full"
            ? "Your portrait library is full — delete one first."
            : `The portrait could not be recorded (${res.reason ?? "unknown"}). Save again — it's free.`,
        );
        setPending({ memberId: member.id, mime, blob, source });
        return false;
      }
      setPending(null);
      await loadAssets();
      return true;
    },
    [loadAssets],
  );

  /**
   * Take a picture the person chose and save it as this character's reference.
   *
   * NOT NAMED `usePhoto`. ESLint reads a `use` prefix as a hook and refuses it
   * inside the onChange callback — `react-hooks/rules-of-hooks`, which this
   * repo treats as a release blocker after three of them reached production.
   *
   * THE HEAD IS STREAMED, NOT BUFFERED. `file.slice(0, N).arrayBuffer()` would
   * read only 12 bytes and still be the banned shape; a stream reader gets the
   * same 12 bytes without the call that megaLoopGuardrails forbids, and the
   * full file is never read at all — the Blob goes straight to storage.
   *
   * The input is cleared on the way out so choosing the SAME file twice still
   * fires a change event; without that, a failed save cannot be retried by
   * picking the same photo again, which is the obvious thing to try.
   */
  const attachPhoto = useCallback(
    async (member: CastMember, file: File | null | undefined) => {
      if (!file) return;
      setNotice(null);
      try {
        const reader = file.slice(0, ACTOR_PHOTO_HEAD_BYTES).stream().getReader();
        const first = await reader.read();
        void reader.cancel();
        const head = first.value ?? new Uint8Array();
        const verdict = validateActorPhoto(file.size, head);
        if (!verdict.ok) {
          setNotice(verdict.message);
          return;
        }
        await saveBytes(member, verdict.mime, file, "uploaded");
      } catch {
        setNotice("That picture could not be read. Try another one.");
      }
    },
    [saveBytes],
  );

  const draw = useCallback(
    async (member: CastMember) => {
      setNotice(null);
      const verdict = validateActorBuild({ name: member.name, lock: member.lock });
      if (!verdict.ok) {
        setNotice("That character needs a name and a description first.");
        return;
      }
      setBuilding(member.id);
      try {
        const { data, error: fnError } = await supabase.functions.invoke("story-still", {
          body: { prompt: actorReferencePrompt(verdict.input) },
        });
        const payload = (data ?? {}) as {
          configured?: boolean;
          mime?: string;
          data?: string;
          error?: string;
        };
        if (fnError || payload.error) {
          setNotice(payload.error ?? fnError?.message ?? "That portrait could not be drawn.");
          return;
        }
        if (payload.configured === false) {
          setNotice("Drawing is not available right now.");
          return;
        }
        const mime = ACTOR_MIMES.includes(payload.mime as (typeof ACTOR_MIMES)[number])
          ? (payload.mime as string)
          : "image/png";
        if (!payload.data) {
          setNotice("No image came back — nothing was saved.");
          return;
        }
        const bin = atob(payload.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        // Wrapped here rather than inside saveBytes, so the photo path can
        // hand its File over untouched instead of both paths meeting as a
        // buffer. These bytes are already in memory — they arrived as base64
        // in a JSON response — so this Blob copies nothing new.
        await saveBytes(member, mime, new Blob([bytes.buffer as ArrayBuffer], { type: mime }));
      } catch {
        setNotice("Something went sideways — nothing was saved.");
      } finally {
        setBuilding(null);
      }
    },
    [saveBytes],
  );

  const remove = useCallback(
    async (asset: ActorAssetRow) => {
      // Bytes first, then the row: a dangling row shows as a broken thumbnail;
      // dangling bytes would be invisible.
      await supabase.storage.from(BUCKET).remove([asset.storage_path]);
      await supabase
        .from("story_actor_assets" as never)
        .delete()
        .eq("id", asset.id);
      const url = thumbsRef.current[asset.id];
      if (url) {
        URL.revokeObjectURL(url);
        const rest = { ...thumbsRef.current };
        delete rest[asset.id];
        thumbsRef.current = rest;
        setThumbs(rest);
      }
      await loadAssets();
    },
    [loadAssets],
  );

  const byKey = new Map<string, ActorAssetRow>();
  for (const a of assets) {
    const k = assetKey(a.name, a.lock);
    if (!byKey.has(k)) byKey.set(k, a); // newest first — the shown version
  }

  if (cast.length === 0 && assets.length === 0) return null;

  return (
    <div className="mt-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        character portraits
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground/80">
        Draw a reference portrait for a saved character — exactly as you described them, nothing
        added. Each draw uses one image credit. Portraits are AI-generated.
      </p>
      {notice && <p className="mt-1 text-[11px] text-destructive">{notice}</p>}
      {/* grid-cols-1 = minmax(0,1fr): rows may shrink below their text, so
          the name/lock truncate instead of pushing Draw off-screen (measured
          on the owner's phone, 2026-08-27 — the button rendered past the
          right edge). */}
      <ul className="mt-1.5 grid grid-cols-1 gap-1.5">
        {cast.map((m) => {
          const asset = byKey.get(assetKey(m.name, m.lock)) ?? null;
          const thumb = asset ? thumbs[asset.id] : undefined;
          const busy = building === m.id;
          const unsaved = pending?.memberId === m.id ? pending : null;
          return (
            <li
              key={m.id}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-border p-1.5"
            >
              {thumb ? (
                <img
                  src={thumb}
                  alt={actorPortraitAlt(m.name, asset?.source ?? "generated")}
                  className="h-10 w-10 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                  <Brush className="h-3.5 w-3.5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-semibold text-foreground">{m.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{m.lock}</div>
              </div>
              {unsaved ? (
                <button
                  type="button"
                  onClick={() => void saveBytes(m, unsaved.mime, unsaved.blob, unsaved.source)}
                  className="shrink-0 rounded-lg border border-primary/50 px-2 py-1 text-[11px] font-semibold text-primary"
                >
                  Save again
                </button>
              ) : (
                <>
                  <label
                    data-testid="actor-photo-pick"
                    className="press shrink-0 cursor-pointer rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground"
                  >
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        void attachPhoto(m, f);
                      }}
                    />
                    <ImagePlus className="inline h-3 w-3" aria-hidden="true" />
                    <span className="ms-1">Photo</span>
                  </label>
                  <button
                    type="button"
                    disabled={busy || building !== null}
                    onClick={() => void draw(m)}
                    className="shrink-0 rounded-lg border border-primary/50 px-2 py-1 text-[11px] font-semibold text-primary disabled:opacity-40"
                  >
                    {busy ? "Drawing…" : asset ? "Redraw" : "Draw"}
                  </button>
                </>
              )}
              {asset && (
                <button
                  type="button"
                  aria-label={`Delete ${m.name}'s portrait`}
                  onClick={() => void remove(asset)}
                  className="shrink-0 text-muted-foreground"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
