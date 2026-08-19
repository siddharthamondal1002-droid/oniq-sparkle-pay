import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Download,
  Pencil,
  Trash2,
  AlertTriangle,
  FileText,
  Sparkles,
  Brain,
  Clock,
} from "lucide-react";
import {
  PERSONALISATION_NOTICE,
  clearMySignals,
  getPersonalisationConsent,
  listMySignals,
  setPersonalisationConsent,
} from "@/lib/personalisation";
import {
  MEMORY_KEYS,
  confirmMemory,
  forgetAllMemory,
  forgetMemory,
  listMyMemory,
  type MemoryRow,
} from "@/lib/memory";
import {
  DSR_SLA_DAYS,
  DSR_TYPE_LABEL,
  type DsrRequest,
  canCancel,
  cancelDsrRequest,
  countdown,
  createDsrRequest,
  listMyDsrRequests,
} from "@/lib/dsr";
import { deliverFile, isShareCancelled } from "@/lib/saveFile";

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
  const [exporting, setExporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<DsrRequest[]>([]);
  const [reqLoaded, setReqLoaded] = useState(false);
  const [reqError, setReqError] = useState(false);

  const refreshRequests = useCallback(async () => {
    try {
      setRequests(await listMyDsrRequests());
      setReqLoaded(true);
      setReqError(false);
    } catch {
      // A failed read must NOT read as "no requests". Left unguarded it
      // re-enabled the Delete-account button even when an erasure was already
      // pending, letting the user file a duplicate. Surface it, keep the gate
      // closed until we have actually confirmed the current request state.
      setReqError(true);
    }
  }, []);

  useEffect(() => {
    void refreshRequests();
  }, [refreshRequests]);

  const pendingErasure = requests.find(
    (r) => r.request_type === "erasure" && (r.status === "received" || r.status === "soft_deleted"),
  );

  /**
   * Access / portability are fulfilled instantly by the DSR handler: it logs
   * the request, runs export_my_data as the caller, and closes the ticket.
   */
  async function exportData() {
    setExporting(true);
    try {
      const res = await createDsrRequest("portability");
      if (!res.export)
        throw new Error(
          "The export didn't come back — nothing was saved. Try again, or contact the Grievance Officer if it keeps failing.",
        );

      const blob = new Blob([JSON.stringify(res.export, null, 2)], { type: "application/json" });
      const filename = `oniq-data-${new Date().toISOString().slice(0, 10)}.json`;
      const outcome = await deliverFile(filename, "application/json", blob);
      await refreshRequests();
      toast.success(
        outcome === "shared"
          ? "Export ready — choose where to save it 📦"
          : "Data export downloaded 📦",
      );
    } catch (e) {
      if (isShareCancelled(e)) {
        await refreshRequests();
        toast("Save cancelled");
      } else {
        toast.error(e instanceof Error ? e.message : "Couldn't export data");
      }
    } finally {
      setExporting(false);
    }
  }

  async function requestCorrection() {
    setBusy(true);
    try {
      await createDsrRequest("correction", "Correction requested from Your data rights.");
      await refreshRequests();
      toast.success("Correction request logged — we'll respond within 30 days ✍️");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't log that request");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Erasure is no longer instant. It becomes a ticket: 48 hours of advance
   * notice, then sign-out + deactivation, then 30 days of grace before the
   * data is destroyed for good.
   */
  async function requestErasure() {
    if (typed.trim().toUpperCase() !== "DELETE") return;
    setBusy(true);
    try {
      await createDsrRequest("erasure");
      await refreshRequests();
      setConfirmOpen(false);
      setTyped("");
      toast.success("Erasure scheduled. You have 48 hours to change your mind 💙");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't schedule deletion");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    try {
      await cancelDsrRequest(id);
      await refreshRequests();
      toast.success("Request cancelled — you're staying 🎉");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't cancel that");
    } finally {
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
          Under India's Digital Personal Data Protection Act, 2023, you can access, correct, or
          delete your data at any time. Every request is answered within {DSR_SLA_DAYS} days.
        </p>

        {pendingErasure && (
          <ErasureBanner
            req={pendingErasure}
            busy={busy}
            onCancel={() => void cancel(pendingErasure.id)}
          />
        )}

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
            desc="Update your display name, bio, avatar, and language in the Profile screen. For anything not editable in-app, log a correction request or contact the Grievance Officer."
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
            <button
              onClick={() => void requestCorrection()}
              disabled={busy}
              className="mt-2 w-full rounded-xl border border-border bg-card py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              Log a formal correction request
            </button>
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

          <RequestsCard
            requests={requests}
            busy={busy}
            onCancel={(id) => void cancel(id)}
            error={reqError}
            onRetry={() => void refreshRequests()}
          />

          <RightsCard
            icon={<Trash2 className="h-5 w-5 text-destructive" />}
            title="Delete my account"
            desc="Permanently removes your ONIQ profile, messages, media, health data, learner profile, quiz history, consents, and more. You get 48 hours to change your mind, then 30 days before it's destroyed for good."
            danger
          >
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={!!pendingErasure || !reqLoaded}
              className="w-full rounded-xl bg-destructive py-2.5 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
            >
              {pendingErasure
                ? "Deletion already scheduled"
                : reqError
                  ? "Couldn't check your requests — retry above"
                  : !reqLoaded
                    ? "Checking your requests…"
                    : "Delete my account"}
            </button>
          </RightsCard>
        </div>

        <Link
          to="/app/attributions"
          className="mt-6 block rounded-xl border border-border bg-card py-2.5 text-center text-sm font-semibold hover:bg-muted"
        >
          Attributions &amp; licences
        </Link>

        <p className="mt-6 text-[11px] text-muted-foreground">
          Some records (anonymised transactions, grievance correspondence) may be retained up to 90
          days as required by Indian law.
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
              Your account is deactivated 48 hours from now, then erased for good 30 days after
              that. Type <span className="font-semibold text-foreground">DELETE</span> to confirm.
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
                onClick={() => {
                  setConfirmOpen(false);
                  setTyped("");
                }}
                disabled={busy}
                className="flex-1 rounded-2xl border border-border bg-card py-2.5 text-sm font-semibold hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => void requestErasure()}
                disabled={busy || typed.trim().toUpperCase() !== "DELETE"}
                className="flex-1 rounded-2xl bg-destructive py-2.5 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
              >
                {busy ? "Scheduling…" : "Schedule deletion"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The authoritative 48-hour advance notice: in-app, impossible to miss. */
function ErasureBanner({
  req,
  busy,
  onCancel,
}: {
  req: DsrRequest;
  busy: boolean;
  onCancel: () => void;
}) {
  const left = req.erasure_effective_at ? countdown(req.erasure_effective_at) : null;
  return (
    <div className="mt-4 rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-center gap-2 text-destructive">
        <Clock className="h-4 w-4" />
        <div className="text-sm font-semibold">
          {req.status === "soft_deleted" ? "Account deactivated" : "Deletion scheduled"}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {req.status === "soft_deleted"
          ? "Your account is signed out and deactivated. Your data is destroyed for good after the 30-day grace period — email the Grievance Officer to restore it before then."
          : left
            ? `Your account is deactivated in ${left}. You can still cancel until then.`
            : "Your account is being deactivated now."}
      </p>
      {canCancel(req) && (
        <button
          onClick={onCancel}
          disabled={busy}
          className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          Cancel deletion — keep my account
        </button>
      )}
    </div>
  );
}

/** Every formal request this account has made, with its 30-day clock. */
function RequestsCard({
  requests,
  busy,
  onCancel,
  error,
  onRetry,
}: {
  requests: DsrRequest[];
  busy: boolean;
  onCancel: (id: string) => void;
  error: boolean;
  onRetry: () => void;
}) {
  return (
    <RightsCard
      icon={<Clock className="h-5 w-5" />}
      title="My privacy requests"
      desc={`Every access, correction, erasure, or portability request you've made, and where it's up to. We answer all of them within ${DSR_SLA_DAYS} days.`}
    >
      {error ? (
        <div className="text-xs">
          <p className="text-muted-foreground">
            Couldn't load your requests right now — a connection problem, not confirmation that you
            have none.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="press mt-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium"
          >
            Try again
          </button>
        </div>
      ) : requests.length === 0 ? (
        <p className="text-xs text-muted-foreground">No requests yet — nothing pending 🧼</p>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2 rounded-xl border border-border bg-card p-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{DSR_TYPE_LABEL[r.request_type]}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {r.status.replace("_", " ")} · due {new Date(r.sla_deadline).toLocaleDateString()}
                </div>
              </div>
              {canCancel(r) && (
                <button
                  onClick={() => onCancel(r.id)}
                  disabled={busy}
                  className="rounded-lg border border-border px-2 py-1 text-xs disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </RightsCard>
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
    <div
      className={`rounded-2xl border p-4 ${danger ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"}`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`grid h-10 w-10 place-items-center rounded-xl ${danger ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}
        >
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
      toast.success(
        next
          ? "Personalisation on — thanks ✨"
          : "Personalisation off. Everything collected has been erased.",
      );
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
            on
              ? "border border-border bg-card hover:bg-muted"
              : "bg-primary text-primary-foreground"
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

/**
 * Loop 3 — everything ONIQ remembers about this account, in plain words.
 * Each item can be confirmed (pinned so it stops being re-guessed) or
 * forgotten individually. Nothing here is shared with anyone else.
 */
function MemoryCard() {
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = async () => setRows(await listMyMemory());

  useEffect(() => {
    void refresh();
  }, []);

  async function act(fn: () => Promise<void>, msg: string) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast.success(msg);
    } catch {
      toast.error("Couldn't update that");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RightsCard
      icon={<Brain className="h-5 w-5" />}
      title="What ONIQ remembers"
      desc="Short preferences worked out from your own activity, or that you told us. You can pin one so it stops changing, or forget it. Turning personalisation off erases all of it."
    >
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing remembered yet — clean slate, no cap 🧼
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2 rounded-xl border border-border bg-card p-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {MEMORY_KEYS[r.key] ?? r.key}
                </div>
                <div className="truncate text-sm font-medium">{r.value}</div>
                <div className="text-[10px] text-muted-foreground">
                  {r.confirmed || r.source === "stated"
                    ? "you confirmed this"
                    : "guessed from your activity"}
                </div>
              </div>
              {!r.confirmed && r.source === "derived" && (
                <button
                  onClick={() => void act(() => confirmMemory(r.id), "Pinned ✅")}
                  disabled={busy}
                  className="rounded-lg border border-border px-2 py-1 text-xs disabled:opacity-50"
                >
                  That's right
                </button>
              )}
              <button
                onClick={() => void act(() => forgetMemory(r.id), "Forgotten 🧹")}
                disabled={busy}
                aria-label="Forget this"
                className="rounded-lg border border-border px-2 py-1 text-xs disabled:opacity-50"
              >
                Forget
              </button>
            </div>
          ))}
          <button
            onClick={() => void act(forgetAllMemory, "Everything forgotten 🧹")}
            disabled={busy}
            className="w-full rounded-xl border border-border bg-card py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
          >
            Forget everything ({rows.length})
          </button>
        </div>
      )}
    </RightsCard>
  );
}
