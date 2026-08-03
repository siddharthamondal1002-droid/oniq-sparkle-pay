import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { getAgeGateStatus } from "@/lib/ageGate";

/**
 * Restricted-state banner. Shown app-wide while an under-threshold account has
 * no verified parental consent, so the user can always tell the difference
 * between "saved" and "not saved" before they try.
 */
export function RestrictedBanner() {
  const { data } = useQuery({
    queryKey: ["age-gate-status"],
    queryFn: getAgeGateStatus,
    staleTime: 60_000,
  });

  if (!data?.restricted) return null;

  return (
    <div className="mx-3 mt-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
        <div className="text-start text-xs leading-relaxed text-amber-100">
          <p className="font-semibold">Waiting for a parent to approve</p>
          <p className="mt-1 opacity-90">
            This account is under the age of digital consent ({data.threshold}). Until a
            parent or guardian verifies consent, nothing you post, ask or answer is saved
            — you will see an error, not a silent failure.
          </p>
          <Link
            to="/app/privacy/parental-consent"
            className="mt-2 inline-block rounded-full bg-amber-400 px-3 py-1 font-semibold text-black"
          >
            Get approved
          </Link>
        </div>
      </div>
    </div>
  );
}
