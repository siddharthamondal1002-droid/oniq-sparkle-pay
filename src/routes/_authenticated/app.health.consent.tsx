import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { OniqCard, OniqChip, OniqSectionHeader, OniqSkeletonRows } from "@/components/oniq";
import { useT } from "@/lib/i18n/LanguageProvider";
import { deliverFile } from "@/lib/saveFile";
import { HEALTH_ENABLED } from "@/health/flags";
import { healthApi, type ConsentRow, type HealthStatus } from "@/health/api";
import { CONSENT_PURPOSES, GRANTABLE_PURPOSES, type ConsentPurpose } from "@/health/domain";
import { fill } from "@/health/i18n";
import { formatDate, reasonText, todayIso } from "@/health/labels";

/**
 * ONIQ HEALTH — consents, export, purge.
 *
 * TWO SWITCHES: `store_records`, the consent under which anything is written
 * at all, and `ai_interpretation`, granted to the recipient the server's
 * registered provider names — since Phase 3 (owner directive 2026-09-09)
 * that is Google Cloud Vertex AI ("google_vertex"), read from `status`, never
 * typed here; the server refuses any other pair. The other purposes exist in
 * the model and are shown as "coming later" so the shape of what will be
 * asked is visible now and no purpose is ever granted by default. Turning a
 * switch off refuses the next write or AI request immediately; what is
 * already stored stays readable and one tap away from purge — withdrawal is
 * meant to be as easy as giving. The AI sentence here is placeholder wording
 * until counsel writes it (docs/health/04 D3); its detail names the recipient.
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
  // The AI consent names the recipient the SERVER's registered provider
  // names (Phase 3: "google_vertex"); the storage consent is always ONIQ's.
  // A screen that hard-coded a recipient would offer a pair the server
  // refuses the day the provider changes.
  const status = useQuery({
    queryKey: ["health", "status"],
    queryFn: () => healthApi<HealthStatus>("status"),
    enabled: HEALTH_ENABLED,
  });
  const aiRecipient = status.data?.ok ? (status.data.data.aiRecipient ?? null) : null;

  const grant = useMutation({
    mutationFn: async (purpose: ConsentPurpose) => {
      const recipient = purpose === "ai_interpretation" ? aiRecipient : "oniq";
      if (!recipient) throw new Error(t("health.ai.unavailable", "Health AI isn't answering yet."));
      const res = await healthApi<ConsentRow>("consents.grant", {
        purpose,
        recipient,
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
  const ai =
    rows.find(
      (c) =>
        c.purpose === "ai_interpretation" && c.recipient === aiRecipient && c.status === "active",
    ) ?? null;
  const later = CONSENT_PURPOSES.filter((p) => !GRANTABLE_PURPOSES.includes(p));

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
              onClick={() =>
                store ? revoke.mutate(store.consentId) : grant.mutate("store_records")
              }
            >
              {store
                ? t("health.consent.revoke", "Turn off")
                : t("health.consent.grant", "Turn on")}
            </button>
          </div>
        )}
        {consents.isPending ? null : (
          <div
            className="mt-4 flex items-start justify-between gap-3 border-t border-border pt-4"
            data-testid="health-consent-ai"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {t("health.consent.ai", "Let ONIQ's AI read my records")}
              </div>
              <div className="text-xs text-muted-foreground">
                {t(
                  "health.consent.ai.detail",
                  "Explains and summarises what you have stored. The records you ask about are sent to Google Cloud Vertex AI (Gemini), operated by Google, to write the answer — under Google Cloud's terms, which do not use them to train Google's models. ONIQ checks every answer before you see it.",
                )}
              </div>
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-testid="health-consent-ai-privacy"
              >
                {t(
                  "health.privacy.ai_processing",
                  "Health data may be processed by ONIQ's AI-assisted health features when you choose to use them and provide the required consent. AI-assisted features are subject to ONIQ's privacy, security, consent, audit, and safety controls.",
                )}
              </p>
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-testid="health-consent-ai-recipient"
              >
                {t(
                  "health.privacy.ai_recipient",
                  "When you use them, the records you ask about are sent to Google Cloud Vertex AI (Gemini), operated by Google, to produce the answer, and are not used to train Google's models.",
                )}
              </p>
              <div
                className="mt-1 text-xs text-muted-foreground"
                data-testid="health-consent-ai-state"
              >
                {ai
                  ? fill(t("health.consent.active", "On since {date}"), {
                      date: formatDate(ai.startTime, lang),
                    })
                  : t("health.consent.revoked", "Off")}
              </div>
            </div>
            <button
              type="button"
              data-testid="health-consent-ai-toggle"
              className="shrink-0 rounded-full bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
              disabled={grant.isPending || revoke.isPending}
              onClick={() => (ai ? revoke.mutate(ai.consentId) : grant.mutate("ai_interpretation"))}
            >
              {ai ? t("health.consent.revoke", "Turn off") : t("health.consent.grant", "Turn on")}
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
