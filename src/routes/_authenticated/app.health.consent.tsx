import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { OniqCard, OniqChip, OniqSectionHeader, OniqSkeletonRows } from "@/components/oniq";
import { useT } from "@/lib/i18n/LanguageProvider";
import { deliverFile } from "@/lib/saveFile";
import { HEALTH_ENABLED } from "@/health/flags";
import { healthApi, type ConsentRow } from "@/health/api";
import { CONSENT_PURPOSES, PHASE1_GRANTABLE_PURPOSES } from "@/health/domain";
import { fill } from "@/health/i18n";
import { formatDate, reasonText, todayIso } from "@/health/labels";

/**
 * ONIQ HEALTH — consents, export, purge.
 *
 * ONE SWITCH IN PHASE 1: `store_records`, the consent under which anything
 * is written at all. The other five purposes exist in the model and are
 * shown as "coming later" so the shape of what will be asked is visible now
 * and no purpose is ever granted by default. Turning the switch off refuses
 * the next write immediately; what is already stored stays readable and one
 * tap away from purge — withdrawal is meant to be as easy as giving.
 *
 * EXPORT is the person's own data as JSON, through the same delivery helper
 * every other download uses (on native it goes to the share sheet). PURGE
 * marks every record and document and removes the bytes; the audit rows,
 * which carry no content, stay as the record that it happened.
 */
export const Route = createFileRoute("/_authenticated/app/health/consent")({
  component: HealthConsent,
});

function HealthConsent() {
  const { t, lang } = useT();
  const qc = useQueryClient();
  const [purgeArmed, setPurgeArmed] = useState(false);

  const consents = useQuery({
    queryKey: ["health", "consents"],
    queryFn: () => healthApi<ConsentRow[]>("consents.list"),
    enabled: HEALTH_ENABLED,
  });

  const grant = useMutation({
    mutationFn: async () => {
      const res = await healthApi<ConsentRow>("consents.grant", {
        purpose: "store_records",
        noticeLocale: ["en", "hi", "bn"].includes(lang) ? lang : "en",
      });
      if (!res.ok) throw new Error(reasonText(t, res));
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["health"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (consentId: string) => {
      const res = await healthApi<{ consentId: string }>("consents.revoke", { consentId });
      if (!res.ok) throw new Error(reasonText(t, res));
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["health"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const exportData = useMutation({
    mutationFn: async () => {
      const res = await healthApi<unknown>("export");
      if (!res.ok) throw new Error(reasonText(t, res));
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      await deliverFile(`oniq-health-${todayIso()}.json`, "application/json", blob);
    },
    onSuccess: () => toast.success(t("health.export.done", "Export ready.")),
    onError: () => toast.error(t("health.export.failed", "Couldn't export right now.")),
  });

  const purge = useMutation({
    mutationFn: async () => {
      const res = await healthApi<{ records: number; documents: number }>("purge");
      if (!res.ok) throw new Error(reasonText(t, res));
      return res.data;
    },
    onSuccess: () => {
      toast.success(t("health.purge.done", "All health records deleted."));
      setPurgeArmed(false);
      void qc.invalidateQueries({ queryKey: ["health"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = consents.data?.ok ? consents.data.data : [];
  const store = rows.find((c) => c.purpose === "store_records" && c.status === "active") ?? null;
  const later = CONSENT_PURPOSES.filter((p) => !PHASE1_GRANTABLE_PURPOSES.includes(p));

  return (
    <div className="space-y-4">
      <OniqCard variant="surface" padding="md" testId="health-consent-store">
        <OniqSectionHeader title={t("health.consent.title", "Your consents")} />
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            "health.consent.body",
            "Nothing is stored without your say-so. Turn a switch off and new records in that category are refused immediately.",
          )}
        </p>
        {consents.isPending ? (
          <div className="mt-3">
            <OniqSkeletonRows rows={1} />
          </div>
        ) : (
          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {t("health.consent.store", "Store my health records in ONIQ")}
              </div>
              <div className="text-xs text-muted-foreground">
                {t(
                  "health.consent.store.detail",
                  "Readings, documents and notes you add, kept only for you to read back.",
                )}
              </div>
              <div
                className="mt-1 text-xs text-muted-foreground"
                data-testid="health-consent-state"
              >
                {store
                  ? fill(t("health.consent.active", "On since {date}"), {
                      date: formatDate(store.startTime, lang),
                    })
                  : t("health.consent.revoked", "Off")}
              </div>
            </div>
            <button
              type="button"
              data-testid="health-consent-toggle"
              className="shrink-0 rounded-full bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
              disabled={grant.isPending || revoke.isPending}
              onClick={() => (store ? revoke.mutate(store.consentId) : grant.mutate())}
            >
              {store
                ? t("health.consent.revoke", "Turn off")
                : t("health.consent.grant", "Turn on")}
            </button>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {later.map((p) => (
            <OniqChip key={p} ariaLabel={`${p}: ${t("health.consent.later", "Coming later")}`}>
              {p.replace(/_/g, " ")} ·{" "}
              {t("health.consent.later", "Coming later — not offered yet.")}
            </OniqChip>
          ))}
        </div>
      </OniqCard>

      <OniqCard variant="surface" padding="md" testId="health-data-controls">
        <div className="grid gap-2">
          <button
            type="button"
            data-testid="health-export"
            className="rounded-full oniq-surface px-4 py-2 text-sm disabled:opacity-50"
            disabled={exportData.isPending}
            onClick={() => exportData.mutate()}
          >
            {t("health.export", "Export my health data")}
          </button>
          <button
            type="button"
            data-testid="health-purge"
            className="rounded-full px-4 py-2 text-sm text-destructive underline disabled:opacity-50"
            disabled={purge.isPending}
            onClick={() => (purgeArmed ? purge.mutate() : setPurgeArmed(true))}
          >
            {purgeArmed
              ? t("health.purge.confirm", "This removes every record and document. Delete?")
              : t("health.purge", "Delete all my health records")}
          </button>
        </div>
      </OniqCard>
    </div>
  );
}
