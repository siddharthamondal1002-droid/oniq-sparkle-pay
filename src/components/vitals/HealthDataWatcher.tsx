// Watches the HOME country. When Home is a country where health data may not
// be stored (UAE), device-local health data is cleared immediately and the
// user is prompted once to delete anything still held server-side.
// Crisis/emergency content is static reference material and is NOT touched.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCountry } from "@/lib/country";
import {
  clearLocalHealthData,
  countMyHealthRows,
  healthWritesAllowed,
  purgeMyHealthDataOnServer,
} from "@/lib/healthGuard";
import type { Country } from "@/data/countryRegistry";

export function HealthDataWatcher() {
  const [home] = useCountry();
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (healthWritesAllowed(home as Country)) return;
    // Device copy goes immediately — no confirmation needed for local data.
    clearLocalHealthData();
    let cancelled = false;
    void (async () => {
      try {
        const n = await countMyHealthRows();
        if (!cancelled && n > 0) setPending(n);
      } catch {
        /* offline — retried on next mount */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [home]);

  if (!pending) return null;

  async function purge() {
    setBusy(true);
    try {
      await purgeMyHealthDataOnServer();
      clearLocalHealthData();
      setPending(0);
      toast.success("health data deleted 🔒");
    } catch {
      toast.error("couldn't delete just now — we'll ask again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-5">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-lg font-bold">delete your health data?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          health tracking isn&apos;t available in your country, so we can&apos;t keep your{" "}
          {pending} saved health {pending === 1 ? "record" : "records"}. Deleting removes them
          from your account and this phone. Emergency and helpline numbers stay available.
        </p>
        <button
          type="button"
          onClick={purge}
          disabled={busy}
          className="press mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "deleting…" : "delete my health data"}
        </button>
      </div>
    </div>
  );
}
