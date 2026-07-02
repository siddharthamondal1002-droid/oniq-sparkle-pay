import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, Save } from "lucide-react";
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

      <button
        onClick={signOut}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 py-3 text-sm font-semibold text-destructive hover:bg-destructive/20"
      >
        <LogOut className="h-4 w-4" /> Sign out
      </button>
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
