/**
 * Persistent, non-blocking prompt for existing accounts that have no date of
 * birth on file.
 *
 * Deliberate choices:
 * - It never locks the app. The only consequence of no DOB is the fail-closed
 *   state that already exists (Jobs unreachable, personalisation off).
 * - Dismissal is session-only (sessionStorage) and writes NOTHING to the
 *   database — `profiles_private.date_of_birth` stays NULL. It reappears at
 *   the next sign-in.
 * - The field starts empty. No default date, because a default is a nudge that
 *   produces garbage from people who tap through.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { X, CalendarDays } from "lucide-react";
import { getAgeGateStatus, setMyDateOfBirth } from "@/lib/ageGate";
import { DOB_PROMPT_TITLE, DOB_REASON } from "@/lib/dobNotice";
import { useFormat } from "@/lib/format";

const DISMISS_KEY = "oniq.dob.prompt.dismissed";

export function DobPrompt() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fmt = useFormat();
  const [dismissed, setDismissed] = useState(true);
  const [dob, setDob] = useState("");
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const { data: status } = useQuery({
    queryKey: ["age-gate-status"],
    queryFn: getAgeGateStatus,
    staleTime: 60_000,
  });

  if (dismissed || !status || status.has_dob) return null;

  const dismiss = () => {
    // Writes nothing anywhere. The value stays NULL.
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* noop */
    }
    setDismissed(true);
  };

  const age = dob ? (Date.now() - new Date(dob).getTime()) / (365.25 * 864e5) : null;
  const under = age !== null && age < status.threshold;

  const save = async () => {
    if (!dob) return;
    setBusy(true);
    try {
      await setMyDateOfBirth(dob, {
        parentName: under ? parentName : undefined,
        parentEmail: under ? parentEmail : undefined,
      });
      await qc.invalidateQueries({ queryKey: ["age-gate-status"] });
      if (under) {
        toast.success("Saved — this account now needs a parent's approval");
        void navigate({ to: "/app/privacy/parental-consent" });
      } else {
        toast.success("Date of birth saved");
      }
      setDismissed(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-3 mt-3 rounded-2xl border border-primary/40 bg-primary/10 p-3">
      <div className="flex items-start gap-2">
        <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="flex-1 text-start text-xs leading-relaxed">
          <p className="font-semibold">{DOB_PROMPT_TITLE.en}</p>
          <p className="mt-1 opacity-80">{DOB_REASON.en}</p>
          <p className="mt-1 opacity-70" lang="hi">
            {DOB_REASON.hi}
          </p>
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            min="1900-01-01"
            aria-label={DOB_PROMPT_TITLE.en}
            className="mt-2 w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none"
          />
          {dob ? (
            <p className="mt-1 opacity-60">{fmt.date(dob, { dateStyle: "long" })}</p>
          ) : null}
          {under ? (
            <div className="mt-2 space-y-2">
              <p className="opacity-80">
                Under {status.threshold} — a parent or guardian has to approve this account.
              </p>
              <input
                value={parentName}
                onChange={(e) => setParentName(e.target.value)}
                placeholder="Parent/guardian full name"
                maxLength={120}
                className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none"
              />
              <input
                type="email"
                value={parentEmail}
                onChange={(e) => setParentEmail(e.target.value)}
                placeholder="Parent/guardian email"
                maxLength={254}
                className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none"
              />
            </div>
          ) : null}
          <button
            type="button"
            disabled={busy || !dob}
            onClick={() => void save()}
            className="mt-2 rounded-full bg-primary px-4 py-1.5 font-semibold text-primary-foreground disabled:opacity-50"
          >
            Save
          </button>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss for now"
          className="rounded-full p-1 opacity-60"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
