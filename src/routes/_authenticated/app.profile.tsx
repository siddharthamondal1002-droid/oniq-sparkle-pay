import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GRIEVANCE_OFFICER } from "@/config/privacy";
import { LogOut, Save, Shield, Flag, ScrollText, Trash2, AlertTriangle, Music2, Database, Camera } from "lucide-react";
import { AvatarEditorSheet } from "@/components/profile/AvatarEditorSheet";
import { COUNTRIES, useCountry } from "@/lib/country";
import type { CountryCode } from "@/lib/miniapps";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import {
  RINGTONES,
  PINGS,
  getSelectedRingtone,
  setSelectedRingtone,
  getSelectedPing,
  setSelectedPing,
  playRingtone,
  playPing,
  stopAllCallSounds,
  type RingtoneId,
  type PingId,
} from "@/lib/callSounds";

import { z } from "zod";

export const Route = createFileRoute("/_authenticated/app/profile")({
  component: ProfileScreen,
});

const profileSchema = z.object({
  display_name: z.string().trim().min(1, "Display name required").max(60),
  bio: z.string().trim().max(240, "Bio must be 240 characters or fewer"),
  avatar_url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https?:\/\//i.test(v), "Must be a valid URL"),
});

function ProfileScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({ display_name: "", bio: "", avatar_url: "" });
  const [editAvatar, setEditAvatar] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("display_name, username, bio, avatar_url")
        .eq("id", u.user.id)
        .maybeSingle();
      return { ...data, email: u.user.email };
    },
  });

  useEffect(() => {
    if (profile) {
      setForm({
        display_name: profile.display_name ?? "",
        bio: profile.bio ?? "",
        avatar_url: profile.avatar_url ?? "",
      });
    }
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => {
      const parsed = profileSchema.safeParse(form);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
      }
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: parsed.data.display_name,
          bio: parsed.data.bio,
          avatar_url: parsed.data.avatar_url || null,
        })
        .eq("id", u.user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile saved");
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="px-5 pt-[max(3rem,env(safe-area-inset-top))] pb-24 min-h-screen">
      <div className="flex flex-col items-center text-center">
        <button
          type="button"
          onClick={() => setEditAvatar(true)}
          aria-label="Edit profile photo"
          className="relative grid h-20 w-20 place-items-center rounded-3xl bg-primary text-primary-foreground font-bold text-3xl overflow-visible"
        >
          <span className="grid h-full w-full place-items-center overflow-hidden rounded-3xl">
            {form.avatar_url ? (
              <img src={form.avatar_url} alt="Your profile picture" className="h-full w-full object-cover" />
            ) : (
              (form.display_name || profile?.username || "O").charAt(0).toUpperCase()
            )}
          </span>
          <span className="absolute -bottom-1.5 -right-1.5 grid h-7 w-7 place-items-center rounded-full border-2 border-background bg-card text-foreground">
            <Camera className="h-3.5 w-3.5" />
          </span>
        </button>
        <h1 className="mt-4 font-display text-2xl font-bold">
          {profile?.display_name ?? "Your profile"}
        </h1>
        <div className="text-sm text-muted-foreground">@{profile?.username}</div>
        {profile?.email && (
          <div className="mt-1 text-xs text-muted-foreground">{profile.email}</div>
        )}
      </div>

      {isLoading ? (
        <div className="mt-8 space-y-3">
          <div className="h-14 rounded-2xl bg-surface animate-pulse" />
          <div className="h-24 rounded-2xl bg-surface animate-pulse" />
          <div className="h-14 rounded-2xl bg-surface animate-pulse" />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="mt-7 space-y-3"
        >
          <Field label="Display name">
            <input
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              maxLength={60}
              className="w-full bg-transparent outline-none text-sm"
              placeholder="Your name"
            />
          </Field>
          <Field label="Bio">
            <textarea
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              maxLength={240}
              rows={3}
              className="w-full bg-transparent outline-none text-sm resize-none"
              placeholder="A short bio"
            />
          </Field>
          <button
            type="button"
            onClick={() => setEditAvatar(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <Camera className="h-4 w-4" /> change profile photo
          </button>

          <button
            type="submit"
            disabled={save.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> {save.isPending ? "Saving…" : "Save changes"}
          </button>
        </form>
      )}

      <SoundsSection />

      <LanguageSection />

      <MyDataSection />

      <SafetySection />

      <button
        onClick={signOut}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 py-3 text-sm font-semibold text-destructive hover:bg-destructive/20"
      >
        <LogOut className="h-4 w-4" /> Sign out
      </button>

      <DangerZone />

      {editAvatar && (
        <AvatarEditorSheet
          currentUrl={form.avatar_url || null}
          onClose={() => setEditAvatar(false)}
          onChanged={(url) => {
            setEditAvatar(false);
            setForm((f) => ({ ...f, avatar_url: url ?? "" }));
            qc.invalidateQueries({ queryKey: ["profile"] });
            qc.invalidateQueries({ queryKey: ["my-page-profile"] });
            qc.invalidateQueries({ queryKey: ["conversations"] });
          }}
        />
      )}
    </div>
  );
}

function DangerZone() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const doDelete = async () => {
    if (typed.trim().toUpperCase() !== "DELETE") return;
    setBusy(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("You're signed out");
      const { error } = await supabase.functions.invoke("delete-account", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      await qc.cancelQueries();
      qc.clear();
      await supabase.auth.signOut();
      toast.success("Account deleted. Take care 💙");
      navigate({ to: "/", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete account");
      setBusy(false);
    }
  };

  return (
    <div className="mt-10 space-y-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" /> Danger zone
      </div>
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
        <div className="text-sm font-semibold">Delete my account</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Permanently removes your ONIQ account and profile. This can't be undone.
        </p>
        <button
          data-testid="delete-account"
          onClick={() => setOpen(true)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/60 bg-destructive/10 py-2.5 text-sm font-semibold text-destructive hover:bg-destructive/20"
        >
          <Trash2 className="h-4 w-4" /> Delete my account
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end bg-black/70 backdrop-blur-sm sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-t-3xl border-t border-border bg-background p-6 sm:rounded-3xl sm:border">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <div className="font-display text-lg font-semibold">This is permanent</div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Your account, profile, and personal data will be removed. Type{" "}
              <span className="font-semibold text-foreground">DELETE</span> to confirm.
            </p>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="DELETE"
              className="mt-4 w-full rounded-2xl border border-border bg-input/40 px-4 py-3 text-sm focus:border-destructive focus:outline-none"
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => { setOpen(false); setTyped(""); }}
                disabled={busy}
                className="flex-1 rounded-2xl border border-border bg-card py-2.5 text-sm font-semibold hover:bg-muted"
              >
                Cancel
              </button>
              <button
                data-testid="delete-account-confirm"
                onClick={doDelete}
                disabled={busy || typed.trim().toUpperCase() !== "DELETE"}
                className="flex-1 rounded-2xl bg-destructive py-2.5 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
              >
                {busy ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function SafetySection() {
  const [isAdmin, setIsAdmin] = useState(false);
  const { data: myReports = [] } = useQuery({
    queryKey: ["my-reports"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data } = await supabase
        .from("reports")
        .select("id, target_type, reason, status, created_at")
        .eq("reporter_id", u.user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase.rpc("is_admin", { _uid: u.user.id });
      setIsAdmin(!!data);
    })();
  }, []);

  return (
    <div className="mt-8 space-y-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Shield className="h-3.5 w-3.5" /> Safety & Grievances
      </div>
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="text-sm font-semibold">Grievance Officer</div>
        <div className="text-xs text-muted-foreground">{GRIEVANCE_OFFICER.name}</div>
        <a href={`mailto:${GRIEVANCE_OFFICER.email}`} className="text-xs text-primary hover:underline">{GRIEVANCE_OFFICER.email}</a>
        <p className="mt-2 text-xs text-muted-foreground">
          Complaints acknowledged in 7 days · Serious complaints resolved in 36 hours.
        </p>
        <Link
          to="/app/privacy/notice"
          className="mt-3 block rounded-xl border border-border bg-muted/30 py-2 text-center text-xs font-semibold hover:bg-muted/50"
        >
          Consent notice &amp; my consents
        </Link>
        <Link
          to="/app/privacy/parental-consent"
          className="mt-2 block rounded-xl border border-border bg-muted/30 py-2 text-center text-xs font-semibold hover:bg-muted/50"
        >
          Parental consent (under-age accounts)
        </Link>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Link
            to="/app/privacy/grievance"
            className="rounded-xl border border-border bg-muted/30 py-2 text-center text-xs font-semibold hover:bg-muted/50"
          >
            File a complaint
          </Link>
          <Link
            to="/app/privacy/data-rights"
            className="rounded-xl border border-border bg-muted/30 py-2 text-center text-xs font-semibold hover:bg-muted/50"
          >
            My data rights
          </Link>
        </div>
      </div>
      <ViewIdentityToggle />
      <div className="flex gap-2">
        <Link to="/terms" className="flex-1 rounded-2xl border border-border bg-card p-3 text-center text-xs font-semibold hover:bg-muted">
          <ScrollText className="mx-auto mb-1 h-4 w-4" /> Terms
        </Link>
        <Link to="/privacy" className="flex-1 rounded-2xl border border-border bg-card p-3 text-center text-xs font-semibold hover:bg-muted">
          <Shield className="mx-auto mb-1 h-4 w-4" /> Privacy
        </Link>
      </div>
      {isAdmin && (
        <Link to="/app/admin" className="block rounded-2xl border border-primary/50 bg-primary/10 p-3 text-center text-sm font-semibold text-primary hover:bg-primary/20">
          Moderation inbox
        </Link>
      )}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Flag className="h-4 w-4" /> My reports
        </div>
        {myReports.length === 0 ? (
          <p className="text-xs text-muted-foreground">You haven't filed any reports.</p>
        ) : (
          <ul className="space-y-1.5">
            {myReports.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs">
                <span className="truncate">
                  <span className="font-semibold">{r.target_type}</span>
                  <span className="text-muted-foreground"> · {r.reason}</span>
                </span>
                <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  r.status === "open" ? "bg-red-500/20 text-red-400"
                  : r.status === "resolved" ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-muted text-muted-foreground"
                }`}>{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SoundsSection() {
  const [ring, setRing] = useState<RingtoneId>("classic");
  const [ping, setPing] = useState<PingId>("chime");
  useEffect(() => {
    setRing(getSelectedRingtone());
    setPing(getSelectedPing());
    return () => stopAllCallSounds();
  }, []);
  const pickRing = (id: RingtoneId) => {
    setRing(id);
    setSelectedRingtone(id);
    stopAllCallSounds();
    playRingtone(id);
    window.setTimeout(() => stopAllCallSounds(), 2400);
  };
  const pickPing = (id: PingId) => {
    setPing(id);
    setSelectedPing(id);
    playPing(id);
  };
  return (
    <div className="mt-8 space-y-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Music2 className="h-3.5 w-3.5" /> Sounds 🎵
      </div>
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-2 text-sm font-semibold">Call ringtone</div>
        <div className="grid grid-cols-2 gap-2">
          {RINGTONES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => pickRing(r.id)}
              className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm ${
                ring === r.id
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border bg-muted/30 text-foreground hover:bg-muted/50"
              }`}
            >
              <span>{r.emoji} {r.label}</span>
              {ring === r.id && <span className="text-[10px] font-bold uppercase text-primary">on</span>}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">tap to preview · saves right away</p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-2 text-sm font-semibold">Chat ping</div>
        <div className="grid grid-cols-2 gap-2">
          {PINGS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pickPing(p.id)}
              className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm ${
                ping === p.id
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border bg-muted/30 text-foreground hover:bg-muted/50"
              }`}
            >
              <span>{p.emoji} {p.label}</span>
              {ping === p.id && <span className="text-[10px] font-bold uppercase text-primary">on</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block rounded-2xl border border-border bg-card p-3.5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}

type WipeKind = "clips" | "moments" | "chat_media";
const WIPE_META: Record<WipeKind, { emoji: string; label: string; desc: string; rpc: "wipe_my_clips" | "wipe_my_moments" | "wipe_my_chat_media" }> = {
  clips: { emoji: "🎬", label: "wipe my clips", desc: "deletes every clip you've posted — likes, comments, views, gone.", rpc: "wipe_my_clips" },
  moments: { emoji: "📸", label: "wipe my moments", desc: "removes all your moments posts and their comments/likes.", rpc: "wipe_my_moments" },
  chat_media: { emoji: "🎙", label: "wipe voice notes & media in chats", desc: "marks all your images, videos, voice notes and files as deleted in every chat.", rpc: "wipe_my_chat_media" },
};

function MyDataSection() {
  const [pending, setPending] = useState<WipeKind | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const doWipe = async () => {
    if (!pending || typed.trim().toUpperCase() !== "YES") return;
    setBusy(true);
    try {
      const meta = WIPE_META[pending];
      const { data, error } = await supabase.rpc(meta.rpc);
      if (error) throw error;
      const n = typeof data === "number" ? data : 0;
      toast.success(n > 0 ? `wiped ${n} · this is forever fr 🫡` : "nothing to wipe — squeaky clean already ✨");
      setPending(null); setTyped("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "couldn't wipe rn — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-8 space-y-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Database className="h-3.5 w-3.5" /> my data 🔐
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <p className="text-[11px] text-muted-foreground">bulk-delete your own content. each action is permanent — no undo.</p>
        {(Object.keys(WIPE_META) as WipeKind[]).map((k) => (
          <button
            key={k}
            onClick={() => { setPending(k); setTyped(""); }}
            className="flex w-full items-center justify-between rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm hover:bg-muted/50"
          >
            <span>{WIPE_META[k].emoji} {WIPE_META[k].label}</span>
            <Trash2 className="h-4 w-4 text-destructive" />
          </button>
        ))}
      </div>
      {pending && (
        <div className="fixed inset-0 z-[80] flex items-end bg-black/70 backdrop-blur-sm sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-t-3xl border-t border-border bg-background p-6 sm:rounded-3xl sm:border">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <div className="font-display text-lg font-semibold">this is forever fr</div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{WIPE_META[pending].desc} type <span className="font-semibold text-foreground">YES</span> to confirm.</p>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="YES"
              className="mt-4 w-full rounded-2xl border border-border bg-input/40 px-4 py-3 text-sm focus:border-destructive focus:outline-none"
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => { setPending(null); setTyped(""); }}
                disabled={busy}
                className="flex-1 rounded-2xl border border-border bg-card py-2.5 text-sm font-semibold hover:bg-muted"
              >
                nvm, keep it
              </button>
              <button
                onClick={doWipe}
                disabled={busy || typed.trim().toUpperCase() !== "YES"}
                className="flex-1 rounded-2xl bg-destructive py-2.5 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
              >
                {busy ? "wiping…" : "wipe forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LanguageSection() {
  const [lang, setLang] = useState<string>("en");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) return;
        const { data } = await supabase
          .from("profiles")
          .select("language")
          .eq("id", u.user.id)
          .maybeSingle();
        if (data?.language && LANG_ENTRIES.some(([c]) => c === data.language)) {
          setLang(data.language);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function onChange(next: string) {
    setLang(next);
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({ language: next })
        .eq("id", u.user.id);
      if (error) throw error;
      const { setUserLanguageCache } = await import("@/lib/userLanguage");
      setUserLanguageCache(next);
      toast.success("language locked in ✨");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "couldn't save language");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-8 space-y-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        Language 🌐
      </div>
      <div className="rounded-2xl border border-border bg-card p-4">
        <label className="block text-sm font-semibold">AI answer language</label>
        <select
          value={lang}
          disabled={loading || saving}
          onChange={(e) => onChange(e.target.value)}
          className="mt-3 w-full rounded-xl border border-border bg-input/40 px-3 py-2.5 text-sm outline-none focus:border-primary disabled:opacity-60"
        >
          {LANG_ENTRIES.map(([code, native]) => (
            <option key={code} value={code}>{native}</option>
          ))}
        </select>
        <p className="mt-2 text-xs text-muted-foreground">
          AI answers appear in this language. The app menus stay in English.
        </p>
      </div>
      <CountrySection />
    </div>
  );
}

function CountrySection() {
  const [country, setCountry] = useCountry();
  return (
    <div className="rounded-2xl border border-border bg-card p-4" data-testid="country-section">
      <label className="block text-sm font-semibold">Country 🌍</label>
      <select
        value={country}
        onChange={(e) => setCountry(e.target.value as CountryCode)}
        className="mt-3 w-full rounded-xl border border-border bg-input/40 px-3 py-2.5 text-sm outline-none focus:border-primary"
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>{c.flag} {c.label}</option>
        ))}
      </select>
      <p className="mt-2 text-xs text-muted-foreground">
        Picks which apps show in Hacks, Shop, Entertainment & Official. Saved on this device only.
      </p>
      <p className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
        Third-party app names and trademarks belong to their respective owners. ONIQ
        links to them for convenience and implies no partnership or endorsement.
      </p>
    </div>
  );
}

const LANG_ENTRIES: Array<[string, string]> = [
  ["en", "English"],
  ["hi", "हिन्दी"],
  ["bn", "বাংলা"],
  ["te", "తెలుగు"],
  ["mr", "मराठी"],
  ["ta", "தமிழ்"],
  ["gu", "ગુજરાતી"],
  ["kn", "ಕನ್ನಡ"],
  ["ml", "മലയാളം"],
  ["pa", "ਪੰਜਾਬੀ"],
  ["or", "ଓଡ଼ିଆ"],
  ["as", "অসমীয়া"],
  ["ur", "اردو"],
];



/* Viewer-identity privacy toggle (P4). Symmetric: hiding your own views
   also anonymises everyone in YOUR viewer lists (enforced server-side). */
function ViewIdentityToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("profiles")
        .select("show_view_identity")
        .eq("id", u.user.id)
        .maybeSingle();
      setOn(data?.show_view_identity ?? true);
    })();
  }, []);

  async function toggle() {
    if (on === null || busy) return;
    setBusy(true);
    const next = !on;
    setOn(next);
    const { data: u } = await supabase.auth.getUser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("profiles")
      .update({ show_view_identity: next })
      .eq("id", u.user!.id);
    if (error) {
      setOn(!next);
      toast.error("couldn't save — try again");
    }
    setBusy(false);
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Show my name in view lists 👀</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Off = you still count in view numbers but appear anonymous — and
            you won't see who viewed your posts either (fair's fair).
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={on === null || busy}
          role="switch"
          aria-checked={on ?? true}
          aria-label="Show my name in view lists"
          className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? "bg-primary" : "bg-muted"} disabled:opacity-50`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-[calc(100%-1.625rem)]" : "left-0.5"}`}
          />
        </button>
      </div>
    </div>
  );
}
