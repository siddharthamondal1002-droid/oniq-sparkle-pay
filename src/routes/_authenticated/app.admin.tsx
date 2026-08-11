import { homeFormat } from "@/lib/format";
import { formatPaise } from "@/lib/storyPricing";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldAlert, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/admin")({
  component: AdminInbox,
});

type Report = {
  id: string;
  reporter_id: string | null;
  target_type: string;
  target_id: string;
  conversation_id: string | null;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
};

type ReporterMap = Record<string, { username: string | null; display_name: string | null }>;

function AdminInbox() {
  const qc = useQueryClient();
  const [section, setSection] = useState<"reports" | "kyc" | "takedowns" | "proofs" | "payouts">(
    "reports",
  );
  const [statusFilter, setStatusFilter] = useState<"open" | "resolved" | "dismissed" | "all">(
    "open",
  );
  const [me, setMe] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      setMe(uid);
      if (!uid) {
        setIsAdmin(false);
        return;
      }
      const { data: p } = await supabase.rpc("is_admin", { _uid: uid });
      setIsAdmin(!!p);
    })();
  }, []);

  const {
    data: reports = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["admin-reports", statusFilter],
    enabled: isAdmin === true,
    queryFn: async (): Promise<Report[]> => {
      let q = supabase
        .from("reports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Report[];
    },
  });

  const { data: reporters = {} } = useQuery<ReporterMap>({
    queryKey: ["admin-reporters", reports.map((r) => r.reporter_id).join(",")],
    enabled: reports.length > 0,
    queryFn: async () => {
      const ids = Array.from(
        new Set(reports.map((r) => r.reporter_id).filter(Boolean)),
      ) as string[];
      if (ids.length === 0) return {};
      const { data } = await supabase
        .from("profiles")
        .select("id, username, display_name")
        .in("id", ids);
      const map: ReporterMap = {};
      for (const p of data ?? [])
        map[p.id] = { username: p.username, display_name: p.display_name };
      return map;
    },
  });

  const remove = async (r: Report) => {
    const { error } = await supabase.rpc("admin_remove_content", {
      _target_type: r.target_type,
      _target_id: r.target_id,
      _note: `report ${r.id}`,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase
      .from("reports")
      .update({
        status: "resolved",
        resolution: "content removed",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", r.id);
    toast.success("Content removed");
    qc.invalidateQueries({ queryKey: ["admin-reports"] });
  };
  const resolve = async (r: Report, dismiss = false) => {
    const status = dismiss ? "dismissed" : "resolved";
    const resolution = dismiss ? "dismissed after review" : "resolved after review";
    const { error } = await supabase
      .from("reports")
      .update({ status, resolution, resolved_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.from("admin_actions").insert({
      admin_id: me,
      action: status,
      target_type: r.target_type,
      target_id: r.target_id,
      note: `report ${r.id}`,
    });
    toast.success(dismiss ? "Dismissed" : "Marked resolved");
    refetch();
  };

  if (isAdmin === null) {
    return <div className="min-h-screen px-5 pt-16 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto min-h-screen max-w-md px-5 pt-16 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-muted-foreground" />
        <div className="mt-4 font-display text-lg font-semibold">Admins only</div>
        <p className="mt-2 text-sm text-muted-foreground">
          This inbox is restricted to designated moderators.
        </p>
        <Link
          to="/app/profile"
          className="mt-6 inline-block rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
        >
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 pt-12 pb-8">
      <div className="flex items-center gap-2">
        <Link
          to="/app/profile"
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl font-bold">Moderation inbox</h1>
      </div>

      <div className="mt-4 grid grid-cols-2 rounded-2xl border border-border bg-card p-1 text-xs">
        {(
          [
            ["reports", "reports 🚩"],
            ["kyc", "partner KYC 🪪"],
            ["takedowns", "takedowns ⚖️"],
            ["proofs", "proofs ✅"],
            ["payouts", "payouts 💸"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSection(k)}
            className={`rounded-xl py-2 font-semibold ${section === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "kyc" && <PartnerKycPanel />}

      {section === "takedowns" && <TakedownPanel />}

      {section === "proofs" && <DeletionProofPanel />}

      {section === "payouts" && <PayoutsPanel />}

      {section === "reports" && (
        <>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {(["open", "resolved", "dismissed", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                  statusFilter === s
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-3">
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : reports.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No {statusFilter === "all" ? "" : statusFilter} reports.
              </div>
            ) : (
              reports.map((r) => {
                const reporter = r.reporter_id ? reporters[r.reporter_id] : null;
                return (
                  <div key={r.id} className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        {homeFormat().dateTime(r.created_at)}
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          r.status === "open"
                            ? "bg-red-500/20 text-red-400"
                            : r.status === "resolved"
                              ? "bg-emerald-500/20 text-emerald-400"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                    <div className="mt-2 text-sm">
                      <span className="font-semibold">{r.target_type}</span>
                      <span className="text-muted-foreground"> · reason: </span>
                      <span className="font-semibold">{r.reason}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground break-all">
                      target: {r.target_id}
                    </div>
                    {r.details && (
                      <div className="mt-2 rounded-lg bg-muted/40 p-2 text-xs">{r.details}</div>
                    )}
                    <div className="mt-2 text-xs text-muted-foreground">
                      reporter:{" "}
                      {reporter
                        ? `${reporter.display_name ?? reporter.username} (@${reporter.username})`
                        : (r.reporter_id ?? "unknown")}
                    </div>
                    {r.status === "open" && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(r.target_type === "message" ||
                          r.target_type === "clip" ||
                          r.target_type === "moment") && (
                          <button
                            onClick={() => remove(r)}
                            className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
                          >
                            Remove content
                          </button>
                        )}
                        <button
                          onClick={() => resolve(r, false)}
                          className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() => resolve(r, true)}
                          className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                    {r.resolution && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        resolution: {r.resolution}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Partner KYC review ---------------- */

type PartnerApp = {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  city: string;
  village: string | null;
  region: string | null;
  skills: string[];
  verification_status: string;
  aadhaar_path: string | null;
  pan_path: string | null;
  extra_doc_path: string | null;
  created_at: string;
};

function PartnerKycPanel() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: apps = [], isLoading } = useQuery({
    queryKey: ["admin-partner-kyc"],
    queryFn: async (): Promise<PartnerApp[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("admin_list_partner_verifications");
      if (error) throw error;
      return data ?? [];
    },
  });

  const openDoc = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("verification-docs")
      .createSignedUrl(path, 600);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "couldn't open document");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const setStatus = async (app: PartnerApp, status: "verified" | "rejected" | "pending") => {
    setBusyId(app.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("admin_set_partner_verification", {
      _application_id: app.id,
      _status: status,
    });
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      status === "verified"
        ? `${app.full_name} verified ✅`
        : status === "rejected"
          ? "marked rejected"
          : "moved back to pending",
    );
    qc.invalidateQueries({ queryKey: ["admin-partner-kyc"] });
  };

  const statusChip = (s: string) =>
    s === "verified"
      ? "bg-emerald-500/20 text-emerald-400"
      : s === "submitted"
        ? "bg-amber-500/20 text-amber-400"
        : s === "rejected"
          ? "bg-red-500/20 text-red-400"
          : "bg-muted text-muted-foreground";

  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs text-muted-foreground">
        review each partner's Aadhaar/PAN and verify or reject. verified & submitted partners count
        toward a region's 20-partner unlock; rejected ones don't.
      </p>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : apps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          no partner applications yet
        </div>
      ) : (
        apps.map((a) => (
          <div key={a.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{a.full_name}</div>
                <div className="text-xs text-muted-foreground">
                  {a.phone} · {a.village || a.city} · {a.skills.length} skill
                  {a.skills.length === 1 ? "" : "s"}
                </div>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusChip(a.verification_status)}`}
              >
                {a.verification_status}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  ["Aadhaar", a.aadhaar_path],
                  ["PAN", a.pan_path],
                  ["Extra", a.extra_doc_path],
                ] as const
              ).map(([label, path]) =>
                path ? (
                  <button
                    key={label}
                    onClick={() => openDoc(path)}
                    className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
                  >
                    📄 {label}
                  </button>
                ) : (
                  <span
                    key={label}
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground/60"
                  >
                    {label}: not uploaded
                  </span>
                ),
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {a.verification_status !== "verified" && (
                <button
                  onClick={() => setStatus(a, "verified")}
                  disabled={busyId === a.id || (!a.aadhaar_path && !a.pan_path)}
                  className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Verify ✅
                </button>
              )}
              {a.verification_status !== "rejected" && (
                <button
                  onClick={() => setStatus(a, "rejected")}
                  disabled={busyId === a.id}
                  className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  Reject
                </button>
              )}
              {(a.verification_status === "verified" || a.verification_status === "rejected") && (
                <button
                  onClick={() => setStatus(a, "pending")}
                  disabled={busyId === a.id}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  Undo
                </button>
              )}
            </div>
            <div className="mt-2 text-[10px] text-muted-foreground">
              applied {homeFormat().dateTime(a.created_at)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------------- Takedown queue (B4 / IT Rules 2026) ----------------
   Ids and references only — never content previews. SLA clock is set by a
   DB trigger (2h NCII/CSAM, 3h court/govt). Actions write the audit log. */
function TakedownPanel() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    source: "government",
    authority: "",
    order_ref: "",
    content_type: "moment",
    content_id: "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data: orders = [], refetch } = useQuery({
    queryKey: ["admin-takedowns"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("takedown_orders")
        .select("*")
        .order("received_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function addOrder() {
    if (!form.content_id.trim()) {
      toast.error("content id required");
      return;
    }
    setBusy(true);
    const { error } = await sb.from("takedown_orders").insert({
      source: form.source,
      authority: form.authority.trim() || null,
      order_ref: form.order_ref.trim() || null,
      content_type: form.content_type,
      content_id: form.content_id.trim(),
      reason: form.reason.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("order logged — SLA clock started ⏱️");
    setForm({ ...form, order_ref: "", content_id: "", reason: "" });
    qc.invalidateQueries({ queryKey: ["admin-takedowns"] });
    void refetch();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function executeTakedown(o: any) {
    if (!window.confirm(`Remove ${o.content_type} ${o.content_id}?`)) return;
    setBusy(true);
    try {
      if (o.content_type === "moment" || o.content_type === "clip") {
        const { error } = await sb.rpc("admin_takedown_content", {
          _content_type: o.content_type,
          _content_id: o.content_id,
          _reason: o.order_ref ?? o.source,
        });
        if (error) throw error;
      }
      const { data: u } = await supabase.auth.getUser();
      const { error: upErr } = await sb
        .from("takedown_orders")
        .update({
          status: "removed",
          removed_at: new Date().toISOString(),
          handled_by: u.user?.id ?? null,
        })
        .eq("id", o.id);
      if (upErr) throw upErr;
      await sb.rpc("log_moderation_action", {
        _action: "takedown_order_fulfilled",
        _target_type: o.content_type,
        _target_id: String(o.content_id),
        _reason: o.order_ref ?? o.source,
      });
      toast.success("taken down + audited ✅");
      qc.invalidateQueries({ queryKey: ["admin-takedowns"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "takedown failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="text-sm font-semibold">log an incoming order</div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Rule 3(1)(d): record the issuing authority (Joint Secretary+ / DIG+). SLA: 3h court/govt ·
          2h NCII/CSAM.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <select
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
            className="input-base"
          >
            {["court", "government", "grievance", "ncii_csam", "internal"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={form.content_type}
            onChange={(e) => setForm({ ...form, content_type: e.target.value })}
            className="input-base"
          >
            {["moment", "clip", "message", "profile", "other"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <input
            value={form.authority}
            onChange={(e) => setForm({ ...form, authority: e.target.value })}
            placeholder="issuing authority"
            className="input-base col-span-2"
          />
          <input
            value={form.order_ref}
            onChange={(e) => setForm({ ...form, order_ref: e.target.value })}
            placeholder="order reference no."
            className="input-base col-span-2"
          />
          <input
            value={form.content_id}
            onChange={(e) => setForm({ ...form, content_id: e.target.value })}
            placeholder="content id (uuid)"
            className="input-base col-span-2"
          />
          <input
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="reason / provision cited"
            className="input-base col-span-2"
          />
        </div>
        <button
          onClick={addOrder}
          disabled={busy}
          className="press mt-3 w-full rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          log order ⏱️
        </button>
      </div>

      <div className="space-y-2">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {orders.map((o: any) => {
          const overdue =
            o.status === "received" && o.sla_deadline && new Date(o.sla_deadline) < new Date();
          return (
            <div
              key={o.id}
              className={`rounded-2xl border p-3 text-xs ${overdue ? "border-red-500/50 bg-red-500/5" : "border-border bg-card"}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold uppercase tracking-wider">
                  {o.source} · {o.content_type}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${o.status === "removed" ? "bg-green-500/15 text-green-400" : overdue ? "bg-red-500/20 text-red-300" : "bg-amber-400/15 text-amber-300"}`}
                >
                  {o.status}
                  {overdue ? " · SLA BREACHED" : ""}
                </span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                id {o.content_id}
              </div>
              {o.authority && (
                <div className="mt-0.5 text-muted-foreground">
                  authority: {o.authority} {o.order_ref ? `· ref ${o.order_ref}` : ""}
                </div>
              )}
              <div className="mt-0.5 text-muted-foreground">
                received {homeFormat().dateTime(o.received_at)} · SLA{" "}
                {o.sla_deadline ? homeFormat().dateTime(o.sla_deadline) : "—"}
              </div>
              {o.status === "received" && (
                <button
                  onClick={() => executeTakedown(o)}
                  disabled={busy}
                  className="press mt-2 w-full rounded-xl border border-red-500/50 py-2 text-[11px] font-semibold text-red-400 disabled:opacity-50"
                >
                  execute takedown (soft-delete + audit) 🗑️
                </button>
              )}
            </div>
          );
        })}
        {orders.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            no takedown orders logged
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Creator Program payouts ----------------
   The owner's money desk. One button computes a payout run — the pool is
   split across qualified channels by measured views, 70% to the creator,
   20% retained by ONIQ, 10% shared among the subscribers who watched —
   and the same request dispatches every queued rupee through RazorpayX
   straight to each recipient's UPI ID. No wallet anywhere; Razorpay's
   answer is the only thing that marks a row paid. */

type PayoutRun = {
  id: string;
  pool_paise: number;
  distributed_paise: number;
  channels: number;
  ran_at: string;
};

type ProgramConfig = {
  period_pool_paise: number;
  enabled: boolean;
};

function PayoutsPanel() {
  const qc = useQueryClient();
  const [poolRupees, setPoolRupees] = useState("");
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: config = null } = useQuery<ProgramConfig | null>({
    queryKey: ["admin-payout-config"],
    queryFn: async () => {
      const { data } = await sb
        .from("creator_program_config")
        .select("period_pool_paise, enabled")
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
  });

  const { data: runs = [] } = useQuery({
    queryKey: ["admin-payout-runs"],
    queryFn: async (): Promise<PayoutRun[]> => {
      const { data } = await sb
        .from("creator_payout_runs")
        .select("*")
        .order("ran_at", { ascending: false })
        .limit(12);
      return data ?? [];
    },
  });

  const { data: queue = null } = useQuery({
    queryKey: ["admin-payout-queue"],
    queryFn: async (): Promise<Record<string, { n: number; paise: number }>> => {
      const { data } = await sb.from("payout_queue").select("status, amount_paise").limit(5000);
      const sum: Record<string, { n: number; paise: number }> = {};
      for (const r of (data ?? []) as { status: string; amount_paise: number }[]) {
        sum[r.status] = sum[r.status] ?? { n: 0, paise: 0 };
        sum[r.status].n += 1;
        sum[r.status].paise += r.amount_paise;
      }
      return sum;
    },
  });

  async function runCycle() {
    setRunning(true);
    setLastResult(null);
    try {
      const rupees = Number(poolRupees);
      const poolPaise =
        poolRupees.trim() !== "" && Number.isFinite(rupees) && rupees > 0
          ? Math.round(rupees * 100)
          : undefined;
      const { data, error } = await supabase.functions.invoke("razorpay-order", {
        body: { runPayouts: true, ...(poolPaise ? { poolPaise } : {}) },
      });
      if (error || data?.error) {
        toast.error(data?.error ?? error?.message ?? "payout run failed");
        return;
      }
      const run = (data?.run ?? {}) as { ok?: boolean; reason?: string } & Record<string, number>;
      if (run.ok === false) {
        const why =
          run.reason === "no-qualified-channels"
            ? "no channel is qualified yet (10,000 subscribers · 50 videos · 1M total views · 14 days old)"
            : run.reason === "disabled"
              ? "the program is switched off in creator_program_config"
              : run.reason === "no-pool"
                ? "the pool is zero"
                : String(run.reason ?? "unknown");
        setLastResult(`No run: ${why}.`);
        toast.info("Nothing to distribute");
      } else {
        const channels = run.channels ?? 0;
        const parts = [
          `${channels} channel${channels === 1 ? "" : "s"}`,
          `${formatPaise(run.distributedPaise ?? 0)} allocated`,
          `${data?.dispatched ?? 0} payouts sent via RazorpayX`,
        ];
        if (data?.noMethod) parts.push(`${data.noMethod} waiting for a UPI ID`);
        if (data?.failed) parts.push(`${data.failed} failed`);
        setLastResult(parts.join(" · ") + (data?.note ? ` — ${data.note}` : ""));
        toast.success("Payout run complete");
      }
      qc.invalidateQueries({ queryKey: ["admin-payout-runs"] });
      qc.invalidateQueries({ queryKey: ["admin-payout-queue"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "payout run failed");
    } finally {
      setRunning(false);
    }
  }

  const statusLabel: Record<string, string> = {
    queued: "queued",
    paid: "paid out",
    no_method: "no UPI ID yet",
    failed: "failed",
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-2xl border border-border bg-card p-4 text-xs">
        <div className="font-semibold">Run a payout cycle</div>
        <p className="mt-1 text-muted-foreground">
          Splits the pool across qualified channels by views — 70% creator · 20% ONIQ · 10% shared
          among watching subscribers — then pays every UPI ID through RazorpayX in the same request.
          Recipients without a UPI ID stay queued until they add one in their profile.
        </p>
        {config && !config.enabled && (
          <div className="mt-2 rounded-lg bg-red-500/10 p-2 font-semibold text-red-400">
            The program is currently disabled — runs will refuse until it is enabled.
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <input
            value={poolRupees}
            onChange={(e) => setPoolRupees(e.target.value)}
            inputMode="decimal"
            placeholder={
              config ? `pool: ${formatPaise(config.period_pool_paise)}` : "pool override"
            }
            className="input-base flex-1"
          />
          <button
            onClick={runCycle}
            disabled={running}
            className="press rounded-xl bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-50"
          >
            {running ? "Running…" : "Run payouts ▶️"}
          </button>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          leave the box empty to use the configured pool; a number here is this run&apos;s pool in
          rupees.
        </p>
        {lastResult && <div className="mt-2 rounded-lg bg-muted/40 p-2">{lastResult}</div>}
      </div>

      {queue && Object.keys(queue).length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 text-xs">
          <div className="font-semibold">Queue ledger</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(["queued", "paid", "no_method", "failed"] as const).map((s) =>
              queue[s] ? (
                <div key={s} className="rounded-lg bg-muted/30 p-2">
                  <div className="font-semibold">{statusLabel[s]}</div>
                  <div className="mt-0.5 text-muted-foreground">
                    {queue[s].n} · {formatPaise(queue[s].paise)}
                  </div>
                </div>
              ) : null,
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {runs.map((r) => (
          <div key={r.id} className="rounded-2xl border border-border bg-card p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                {formatPaise(r.distributed_paise)} / {formatPaise(r.pool_paise)} distributed
              </span>
              <span className="text-muted-foreground">{homeFormat().dateTime(r.ran_at)}</span>
            </div>
            <div className="mt-0.5 text-muted-foreground">
              {r.channels} qualified channel{r.channels === 1 ? "" : "s"}
            </div>
          </div>
        ))}
        {runs.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            no payout runs yet
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Deletion proofs (B2) ----------------
   One tap runs the deletion-proof edge function: it creates a throwaway
   account, seeds fixture data, deletes it through the production path,
   and stores a dated zero-row/zero-object report. No keys ever touch
   the client — the service role lives only inside the edge function. */
function DeletionProofPanel() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data: proofs = [] } = useQuery({
    queryKey: ["admin-deletion-proofs"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("deletion_proofs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  async function runProof() {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("deletion-proof", { body: {} });
      if (error || data?.error) {
        toast.error(data?.error || error?.message || "Proof run failed");
      } else if (data?.pass) {
        toast.success("PASS — zero rows, zero objects left behind ✅");
      } else {
        toast.error("FAIL — residue found, see the report below");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Proof run failed");
    } finally {
      setRunning(false);
      qc.invalidateQueries({ queryKey: ["admin-deletion-proofs"] });
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-2xl border border-border bg-card p-4 text-xs">
        <div className="font-semibold">Account-deletion proof</div>
        <p className="mt-1 text-muted-foreground">
          Creates a temporary test account, deletes it through the real deletion flow, then checks
          15 tables + 4 storage areas for anything left behind. Takes ~10 seconds. Run it twice
          before applying for Play production.
        </p>
        <button
          onClick={runProof}
          disabled={running}
          className="press mt-3 w-full rounded-xl bg-primary py-2.5 font-semibold text-primary-foreground disabled:opacity-50"
        >
          {running ? "Running proof…" : "Run deletion proof ▶️"}
        </button>
      </div>

      {proofs.map((p: any) => (
        <div
          key={p.id}
          className={`rounded-2xl border p-3 text-xs ${p.pass ? "border-emerald-500/40" : "border-red-500/50"}`}
        >
          <div className="flex items-center justify-between">
            <span className={`font-semibold ${p.pass ? "text-emerald-400" : "text-red-400"}`}>
              {p.pass ? "PASS ✅" : "FAIL ❌"}
            </span>
            <span className="text-muted-foreground">{homeFormat().dateTime(p.created_at)}</span>
          </div>
          <div className="mt-1 text-muted-foreground">
            {p.tables_checked} tables · {p.buckets_checked} buckets · test {p.test_email}
          </div>
          {Array.isArray(p.residues) && p.residues.length > 0 && (
            <div className="mt-1 font-mono text-[10px] text-red-400">
              {p.residues.map((r: any, i: number) => (
                <div key={i}>
                  {r.where}: {r.count}
                </div>
              ))}
            </div>
          )}
          <div className="mt-1 break-all font-mono text-[9px] text-muted-foreground">
            sha256 {p.report_sha256}
          </div>
        </div>
      ))}
      {proofs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          no proof runs yet
        </div>
      )}
    </div>
  );
}
