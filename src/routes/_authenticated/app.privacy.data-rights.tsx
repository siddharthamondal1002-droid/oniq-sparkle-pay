import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Download, Pencil, Trash2, AlertTriangle, FileText, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  PERSONALISATION_NOTICE,
  clearMySignals,
  getPersonalisationConsent,
  listMySignals,
  setPersonalisationConsent,
} from "@/lib/personalisation";


export const Route = createFileRoute("/_authenticated/app/privacy/data-rights")({
  head: () => ({
    meta: [
      { title: "Your data rights — ONIQ" },
      {
        name: "description",
        content:
          "Export a copy of your ONIQ data, correct your profile, or permanently delete your account — DPDP Act, 2023 rights.",
      },
    ],
  }),
  component: DataRightsPage,
});

function DataRightsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  async function exportData() {
    setExporting(true);
    try {
      const { data, error } = await supabase.rpc("export_my_data");
      if (error) throw error;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `oniq-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Data export downloaded 📦");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't export data");
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
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
  }

  return (
    <div className="min-h-screen bg-background pt-[max(1rem,env(safe-area-inset-top))] pb-24">
      <div className="mx-auto max-w-2xl px-5">
        <Link
          to="/app/profile"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>

        <h1 className="mt-4 font-display text-2xl font-bold">Your data rights</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Under India's Digital Personal Data Protection Act, 2023, you can access, correct, or delete your data at any time.
        </p>

        <div className="mt-6 space-y-3">
          <RightsCard
            icon={<Download className="h-5 w-5" />}
            title="Export my data"
            desc="Download a JSON file with your profile, consents, learner profile, and grievances."
          >
            <button
              onClick={exportData}
              disabled={exporting}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {exporting ? "Preparing…" : "Download my data"}
            </button>
          </RightsCard>

          <RightsCard
            icon={<Pencil className="h-5 w-5" />}
            title="Correct my data"
            desc="Update your display name, bio, avatar, and language in the Profile screen. For anything not editable in-app, contact the Grievance Officer."
          >
            <div className="grid grid-cols-2 gap-2">
              <Link
                to="/app/profile"
                className="rounded-xl border border-border bg-card py-2.5 text-center text-sm font-semibold hover:bg-muted"
              >
                Open profile
              </Link>
              <Link
                to="/app/privacy/grievance"
                className="rounded-xl border border-border bg-card py-2.5 text-center text-sm font-semibold hover:bg-muted"
              >
                Contact officer
              </Link>
            </div>
          </RightsCard>

          <RightsCard
            icon={<FileText className="h-5 w-5" />}
            title="View my consents"
            desc="Every time you granted or withdrew permission for a data purpose (location, health, AI, general) is recorded with a timestamp for audit."
          >
            <button
              onClick={exportData}
              disabled={exporting}
              className="w-full rounded-xl border border-border bg-card py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              Included in "Download my data"
            </button>
          </RightsCard>

          <PersonalisationCard />

          <MemoryCard />


          <RightsCard

            icon={<Trash2 className="h-5 w-5 text-destructive" />}
            title="Delete my account"
            desc="Permanently removes your ONIQ profile, messages, media, health data, learner profile, quiz history, consents, and more. Cannot be undone."
            danger
          >
            <button
              onClick={() => setConfirmOpen(true)}
              className="w-full rounded-xl bg-destructive py-2.5 text-sm font-semibold text-destructive-foreground"
            >
              Delete my account
            </button>
          </RightsCard>
        </div>

        <p className="mt-6 text-[11px] text-muted-foreground">
          Some records (anonymised transactions, grievance correspondence) may be retained up to 90 days as required by Indian law.
        </p>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-[80] flex items-end bg-black/70 backdrop-blur-sm sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-t-3xl border-t border-border bg-background p-6 sm:rounded-3xl sm:border">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <div className="font-display text-lg font-semibold">Permanent deletion</div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              This will remove all your data. Type{" "}
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
                onClick={() => { setConfirmOpen(false); setTyped(""); }}
                disabled={busy}
                className="flex-1 rounded-2xl border border-border bg-card py-2.5 text-sm font-semibold hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={deleteAccount}
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

function RightsCard({
  icon,
  title,
  desc,
  danger,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${danger ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"}`}>
      <div className="flex items-center gap-3">
        <div className={`grid h-10 w-10 place-items-center rounded-xl ${danger ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
          {icon}
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">{title}</div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{desc}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/**
 * Behavioural personalisation — a separate consent purpose with its own
 * notice, never bundled with general app consent. Withdrawing it wipes the
 * derived signals server-side.
 */
function PersonalisationCard() {
  const [on, setOn] = useState<boolean | null>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [granted, rows] = await Promise.all([getPersonalisationConsent(), listMySignals()]);
    setOn(granted);
    setCount(rows.length);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await setPersonalisationConsent(next);
      await refresh();
      toast.success(next ? "Personalisation on — thanks ✨" : "Personalisation off. Everything collected has been erased.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't update that";
      toast.error(/minor/i.test(msg) ? "Personalisation isn't available on this account." : msg);
    } finally {
      setBusy(false);
    }
  }

  async function wipe() {
    setBusy(true);
    try {
      await clearMySignals();
      await refresh();
      toast.success("Collected signals erased 🧹");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RightsCard
      icon={<Sparkles className="h-5 w-5" />}
      title="Personalise my home screen"
      desc={PERSONALISATION_NOTICE}
    >
      <div className="space-y-2">
        <button
          onClick={() => void toggle(!on)}
          disabled={busy || on === null}
          className={`w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 ${
            on ? "border border-border bg-card hover:bg-muted" : "bg-primary text-primary-foreground"
          }`}
        >
          {on === null ? "Checking…" : on ? "Turn personalisation off" : "Turn personalisation on"}
        </button>
        {on && (
          <button
            onClick={() => void wipe()}
            disabled={busy}
            className="w-full rounded-xl border border-border bg-card py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
          >
            Erase collected signals ({count})
          </button>
        )}
      </div>
    </RightsCard>
  );
}

