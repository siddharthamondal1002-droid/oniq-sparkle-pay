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
  const [statusFilter, setStatusFilter] = useState<"open" | "resolved" | "dismissed" | "all">("open");
  const [me, setMe] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      setMe(uid);
      if (!uid) { setIsAdmin(false); return; }
      const { data: p } = await supabase.rpc("is_admin", { _uid: uid });
      setIsAdmin(!!p);
    })();
  }, []);

  const { data: reports = [], isLoading, refetch } = useQuery({
    queryKey: ["admin-reports", statusFilter],
    enabled: isAdmin === true,
    queryFn: async (): Promise<Report[]> => {
      let q = supabase.from("reports").select("*").order("created_at", { ascending: false }).limit(200);
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
      const ids = Array.from(new Set(reports.map((r) => r.reporter_id).filter(Boolean))) as string[];
      if (ids.length === 0) return {};
      const { data } = await supabase.from("profiles").select("id, username, display_name").in("id", ids);
      const map: ReporterMap = {};
      for (const p of data ?? []) map[p.id] = { username: p.username, display_name: p.display_name };
      return map;
    },
  });

  const remove = async (r: Report) => {
    const { error } = await supabase.rpc("admin_remove_content", {
      _target_type: r.target_type, _target_id: r.target_id, _note: `report ${r.id}`,
    });
    if (error) { toast.error(error.message); return; }
    await supabase.from("reports").update({ status: "resolved", resolution: "content removed", resolved_at: new Date().toISOString() }).eq("id", r.id);
    toast.success("Content removed");
    qc.invalidateQueries({ queryKey: ["admin-reports"] });
  };
  const resolve = async (r: Report, dismiss = false) => {
    const status = dismiss ? "dismissed" : "resolved";
    const resolution = dismiss ? "dismissed after review" : "resolved after review";
    const { error } = await supabase.from("reports").update({ status, resolution, resolved_at: new Date().toISOString() }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("admin_actions").insert({ admin_id: me, action: status, target_type: r.target_type, target_id: r.target_id, note: `report ${r.id}` });
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
        <p className="mt-2 text-sm text-muted-foreground">This inbox is restricted to designated moderators.</p>
        <Link to="/app/profile" className="mt-6 inline-block rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">Back</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 pt-12 pb-8">
      <div className="flex items-center gap-2">
        <Link to="/app/profile" className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl font-bold">Moderation inbox</h1>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {(["open", "resolved", "dismissed", "all"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              statusFilter === s ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
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
                    {new Date(r.created_at).toLocaleString()}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    r.status === "open" ? "bg-red-500/20 text-red-400"
                    : r.status === "resolved" ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-muted text-muted-foreground"
                  }`}>{r.status}</span>
                </div>
                <div className="mt-2 text-sm">
                  <span className="font-semibold">{r.target_type}</span>
                  <span className="text-muted-foreground"> · reason: </span>
                  <span className="font-semibold">{r.reason}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground break-all">target: {r.target_id}</div>
                {r.details && <div className="mt-2 rounded-lg bg-muted/40 p-2 text-xs">{r.details}</div>}
                <div className="mt-2 text-xs text-muted-foreground">
                  reporter: {reporter ? `${reporter.display_name ?? reporter.username} (@${reporter.username})` : (r.reporter_id ?? "unknown")}
                </div>
                {r.status === "open" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(r.target_type === "message" || r.target_type === "clip" || r.target_type === "moment") && (
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
                {r.resolution && <div className="mt-2 text-xs text-muted-foreground">resolution: {r.resolution}</div>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
