/**
 * In-app reporting for AI-generated output.
 *
 * Google Play's AI-Generated Content policy requires an in-app way to report
 * or flag offensive or inaccurate generative output, WITHOUT the user leaving
 * the app. An email address in a policy page does not satisfy it.
 *
 * This is a straight extraction of the control that already existed on the CV
 * builder, so the other generative surfaces — Study Buddy and Ting — stop
 * being the gap. It writes to the existing `reports` table; no new table, no
 * new permission, nothing new leaves the device that was not already leaving
 * it.
 *
 * `surface` and `targetId` are what make a report actionable: "an AI answer
 * was wrong" with no idea which one is not a report, it is a feeling.
 */
import { useState } from "react";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type AiSurface = "cv_ai_output" | "study_ai_output" | "ting_ai_output";

export function AiOutputReport({
  surface,
  targetId,
  context,
  className,
}: {
  surface: AiSurface;
  /** Row id where one exists; "unsaved" when the output was never persisted. */
  targetId?: string | null;
  /** Small, non-sensitive detail that makes the report diagnosable. */
  context?: Record<string, unknown>;
  className?: string;
}) {
  const [sent, setSent] = useState(false);

  async function report() {
    if (sent) return;
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        toast.error("Sign in to report this");
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("reports").insert({
        reporter_id: auth.user.id,
        target_type: surface,
        target_id: targetId ?? "unsaved",
        reason: "bad_ai_output",
        // Capped: a report is a pointer, not a copy of the conversation.
        details: JSON.stringify(context ?? {}).slice(0, 2000),
      });
      setSent(true);
      toast.success("Reported. Thank you — we read these.");
    } catch {
      toast.error("Could not send that report");
    }
  }

  return (
    <button
      type="button"
      onClick={report}
      disabled={sent}
      aria-label="Report this AI output as inaccurate or offensive"
      className={
        className ??
        "mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-xs text-muted-foreground disabled:opacity-50"
      }
    >
      <Flag className="size-3.5" /> {sent ? "Reported" : "Report bad output"}
    </button>
  );
}

/** Rendered next to generative output. Play also requires the output be labelled. */
export const AI_OUTPUT_LABEL = "AI-generated — check it before you rely on it";
