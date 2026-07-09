import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { X, Flag } from "lucide-react";

export type ReportTarget = {
  type: "message" | "user" | "clip" | "moment";
  id: string;
  conversationId?: string | null;
};

const REASONS: { value: string; label: string }[] = [
  { value: "spam", label: "Spam or scam" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "impersonation", label: "Impersonation / identity theft" },
  { value: "sexual_content", label: "Sexual or exploitative content" },
  { value: "violence", label: "Violence or threats" },
  { value: "ai_deepfake", label: "AI-generated / deepfake misuse" },
  { value: "other", label: "Something else" },
];

export function ReportSheet({
  target,
  onClose,
}: {
  target: ReportTarget;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string>("spam");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      toast.error("Sign in first");
      setSubmitting(false);
      return;
    }
    const { error } = await supabase.from("reports").insert({
      reporter_id: u.user.id,
      target_type: target.type,
      target_id: target.id,
      conversation_id: target.conversationId ?? null,
      reason,
      details: details.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message || "Couldn't submit report");
      return;
    }
    toast.success(
      "Report received — serious complaints are resolved within 36 hours.",
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full rounded-t-3xl border-t border-border bg-background p-5 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <Flag className="h-4 w-4 text-red-500" /> Report {target.type}
          </h2>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2">
          {REASONS.map((r) => (
            <label
              key={r.value}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${
                reason === r.value ? "border-primary bg-primary/10" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="report-reason"
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                className="accent-primary"
              />
              {r.label}
            </label>
          ))}
        </div>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value.slice(0, 500))}
          placeholder="Add details (optional, max 500 chars)"
          rows={3}
          className="mt-3 w-full resize-none rounded-xl border border-border bg-input/40 p-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="mt-4 w-full rounded-2xl bg-red-600 py-3 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60"
        >
          {submitting ? "Submitting…" : "Submit report"}
        </button>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Reports are reviewed by our Grievance Officer. Acknowledged within 7 days; serious complaints (identity theft, non-consensual imagery) resolved within 36 hours.
        </p>
      </div>
    </div>
  );
}
