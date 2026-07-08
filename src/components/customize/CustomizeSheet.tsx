import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Palette, Upload, RotateCcw, X } from "lucide-react";

const SIGNED_TTL_SECONDS = 60 * 60 * 24 * 365 * 100; // ~100 years

export type TileKey =
  | "pulse"
  | "clips"
  | "wallet"
  | "ting"
  | "rides"
  | "miniapps"
  | "upi"
  | "learn"
  | "wander";

export const TILE_LABELS: Record<TileKey, string> = {
  pulse: "Pulse",
  clips: "Clips",
  wallet: "Wallet",
  ting: "Ting",
  rides: "Rides",
  miniapps: "Mini Apps",
  upi: "UPI Pay",
  learn: "Learn",
  wander: "Wander",
};

export type UserTheme = {
  user_id: string;
  wallpaper_url: string | null;
  tile_skins: Partial<Record<TileKey, string>>;
};

export function useUserTheme() {
  return useQuery({
    queryKey: ["user-theme"],
    queryFn: async (): Promise<UserTheme | null> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("user_theme")
        .select("user_id, wallpaper_url, tile_skins")
        .eq("user_id", u.user.id)
        .maybeSingle();
      return (data as UserTheme) ?? {
        user_id: u.user.id,
        wallpaper_url: null,
        tile_skins: {},
      };
    },
  });
}

async function uploadThemeFile(file: File): Promise<string> {
  if (!/\.(jpe?g|png|webp)$/i.test(file.name)) {
    throw new Error("use a jpg, png or webp");
  }
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    throw new Error("that's not an image");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("keep it under 5MB");
  }
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("sign in first");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${u.user.id}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("themes")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;
  const { data: signed, error: sErr } = await supabase.storage
    .from("themes")
    .createSignedUrl(path, SIGNED_TTL_SECONDS);
  if (sErr || !signed) throw sErr ?? new Error("could not sign url");
  return signed.signedUrl;
}

async function upsertTheme(patch: Partial<UserTheme>) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("sign in first");
  const { error } = await supabase
    .from("user_theme")
    .upsert(
      { user_id: u.user.id, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}

export function CustomizeButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="customize"
        aria-label="Customize home"
        onClick={() => setOpen(true)}
        className="press grid h-8 w-8 place-items-center rounded-full bg-surface-2 text-primary border border-border"
      >
        <Palette className="h-4 w-4" />
      </button>
      {open && <CustomizeSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function CustomizeSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: theme } = useUserTheme();
  const [busy, setBusy] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["user-theme"] });

  const wallpaperMut = useMutation({
    mutationFn: async (file: File) => {
      const url = await uploadThemeFile(file);
      await upsertTheme({ wallpaper_url: url });
    },
    onSuccess: () => {
      invalidate();
      toast.success("fresh fit applied ✨");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "upload failed"),
  });

  const resetWallpaperMut = useMutation({
    mutationFn: () => upsertTheme({ wallpaper_url: null }),
    onSuccess: () => {
      invalidate();
      toast.success("wallpaper cleared");
    },
    onError: () => toast.error("could not reset"),
  });

  const tileMut = useMutation({
    mutationFn: async ({ key, file }: { key: TileKey; file: File }) => {
      const url = await uploadThemeFile(file);
      const next = { ...(theme?.tile_skins ?? {}), [key]: url };
      await upsertTheme({ tile_skins: next });
    },
    onSuccess: () => {
      invalidate();
      toast.success("fresh fit applied ✨");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "upload failed"),
  });

  const resetTileMut = useMutation({
    mutationFn: async (key: TileKey) => {
      const next = { ...(theme?.tile_skins ?? {}) };
      delete next[key];
      await upsertTheme({ tile_skins: next });
    },
    onSuccess: () => {
      invalidate();
      toast.success("reset");
    },
    onError: () => toast.error("could not reset"),
  });

  const pickFile = (accept: string) =>
    new Promise<File | null>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.oncancel = () => resolve(null);
      input.click();
    });

  const handleWallpaper = async () => {
    setBusy("wallpaper");
    try {
      const f = await pickFile("image/jpeg,image/png,image/webp");
      if (f) await wallpaperMut.mutateAsync(f);
    } finally {
      setBusy(null);
    }
  };

  const handleTile = async (key: TileKey) => {
    setBusy(key);
    try {
      const f = await pickFile("image/jpeg,image/png,image/webp");
      if (f) await tileMut.mutateAsync({ key, file: f });
    } finally {
      setBusy(null);
    }
  };

  const tileKeys = Object.keys(TILE_LABELS) as TileKey[];
  const skins = theme?.tile_skins ?? {};

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <div className="glass relative z-10 w-full max-w-md rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-bold">customize ✨</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="press grid h-8 w-8 place-items-center rounded-full bg-surface-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <section className="mb-6">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Wallpaper
          </div>
          <div className="flex items-center gap-3">
            <div className="h-16 w-16 rounded-xl bg-surface-2 overflow-hidden border border-border">
              {theme?.wallpaper_url ? (
                <img
                  src={theme.wallpaper_url}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={(e) =>
                    ((e.currentTarget.style.display = "none"))
                  }
                />
              ) : null}
            </div>
            <button
              type="button"
              onClick={handleWallpaper}
              disabled={busy === "wallpaper"}
              className="press flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-2 font-medium disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              {busy === "wallpaper" ? "uploading…" : "Upload photo"}
            </button>
            {theme?.wallpaper_url && (
              <button
                type="button"
                onClick={() => resetWallpaperMut.mutate()}
                className="press grid h-10 w-10 place-items-center rounded-xl bg-surface-2"
                aria-label="Reset wallpaper"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
          </div>
        </section>

        <section>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Tile skins
          </div>
          <ul className="space-y-2">
            {tileKeys.map((k) => (
              <li
                key={k}
                className="flex items-center gap-3 rounded-xl bg-surface-2/60 p-2 border border-border"
              >
                <div className="h-10 w-10 rounded-lg bg-surface overflow-hidden grid place-items-center">
                  {skins[k] ? (
                    <img
                      src={skins[k]!}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={(e) =>
                        ((e.currentTarget.style.display = "none"))
                      }
                    />
                  ) : (
                    <Palette className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <span className="flex-1 text-sm font-medium">
                  {TILE_LABELS[k]}
                </span>
                <button
                  type="button"
                  onClick={() => handleTile(k)}
                  disabled={busy === k}
                  className="press inline-flex items-center gap-1 rounded-lg bg-primary/90 text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {busy === k ? "…" : "Upload"}
                </button>
                {skins[k] && (
                  <button
                    type="button"
                    onClick={() => resetTileMut.mutate(k)}
                    aria-label={`Reset ${TILE_LABELS[k]}`}
                    className="press grid h-8 w-8 place-items-center rounded-lg bg-surface"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
