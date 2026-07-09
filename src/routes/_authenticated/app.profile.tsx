import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, Save, Shield, Flag, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
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
        <div className="grid h-20 w-20 place-items-center rounded-3xl bg-primary text-primary-foreground font-bold text-3xl overflow-hidden">
          {form.avatar_url ? (
            <img src={form.avatar_url} alt="avatar" className="h-full w-full object-cover" />
          ) : (
            (form.display_name || profile?.username || "O").charAt(0).toUpperCase()
          )}
        </div>
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
          <Field label="Avatar URL">
            <input
              value={form.avatar_url}
              onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
              maxLength={500}
              className="w-full bg-transparent outline-none text-sm"
              placeholder="https://..."
            />
          </Field>

          <button
            type="submit"
            disabled={save.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> {save.isPending ? "Saving…" : "Save changes"}
          </button>
        </form>
      )}

      <SafetySection />

      <button
        onClick={signOut}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 py-3 text-sm font-semibold text-destructive hover:bg-destructive/20"
      >
        <LogOut className="h-4 w-4" /> Sign out
      </button>
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
      const { data } = await supabase.from("profiles").select("is_admin").eq("id", u.user.id).maybeSingle();
      setIsAdmin(!!data?.is_admin);
    })();
  }, []);

  return (
    <div className="mt-8 space-y-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Shield className="h-3.5 w-3.5" /> Safety & Grievances
      </div>
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="text-sm font-semibold">Grievance Officer</div>
        <div className="text-xs text-muted-foreground">Siddhartha Mondal</div>
        <a href="mailto:grievance@oniqhub.com" className="text-xs text-primary hover:underline">grievance@oniqhub.com</a>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Complaints acknowledged in 7 days · Serious complaints resolved in 36 hours.
        </p>
      </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block rounded-2xl border border-border bg-card p-3.5">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}
