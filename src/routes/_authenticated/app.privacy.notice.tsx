import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, FileText, ShieldCheck, ShieldAlert, Check } from "lucide-react";
import { useT } from "@/lib/i18n/LanguageProvider";
import { GRIEVANCE_OFFICER, DATA_PROTECTION_BOARD } from "@/config/privacy";
import {
  CONSENT_PURPOSES,
  NOTICE_INTRO,
  NOTICE_STRINGS,
  NOTICE_VERSION,
  REGIME_BEHAVIOUR,
  defaultPurposeState,
  resolveNoticeLocale,
  tr,
} from "@/lib/consent/notice";
import {
  latestStates,
  listMyConsents,
  verifyMyChain,
  writeConsent,
  type ConsentRow,
} from "@/lib/consent/ledger";
import { getCountryConfig, type Country } from "@/data/countryRegistry";

export const Route = createFileRoute("/_authenticated/app/privacy/notice")({
  head: () => ({
    meta: [
      { title: "Consent notice — ONIQ" },
      {
        name: "description",
        content:
          "ONIQ's standalone consent notice: every category of personal data collected, the purpose of each, and one-tap withdrawal.",
      },
      { property: "og:title", content: "Consent notice — ONIQ" },
      {
        property: "og:description",
        content:
          "Itemised data categories, per-purpose consent and a tamper-evident consent record.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConsentNoticePage,
});

function ConsentNoticePage() {
  const { lang } = useT();
  const locale = resolveNoticeLocale(lang);
  const [home, setHome] = useState<Country | null>(null);
  const [rows, setRows] = useState<ConsentRow[]>([]);
  const [chain, setChain] = useState<{ ok: boolean; rows_checked: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { data: prof } = await supabase
      .from("profiles")
      .select("country_code")
      .eq("id", auth.user.id)
      .maybeSingle();
    setHome((prof?.country_code as Country | null) ?? null);
    try {
      const list = await listMyConsents();
      setRows(list);
      setChain(await verifyMyChain());
    } catch {
      /* the notice must still render if the ledger read fails */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const config = getCountryConfig(home);
  const regime = REGIME_BEHAVIOUR[config.legalRegime];
  const states = latestStates(rows);

  async function toggle(purposeId: string, next: boolean) {
    setBusy(purposeId);
    try {
      await writeConsent({
        purposeId,
        state: next ? "granted" : "withdrawn",
        locale,
        home,
      });
      // Keep the live personalisation enforcement in step with the ledger.
      if (purposeId === "personalisation") {
        await supabase.rpc("record_consent", {
          _purpose: "personalisation",
          _granted: next,
          _source: "consent-notice",
        });
      }
      toast.success(
        next ? tr(NOTICE_STRINGS.granted, locale) : tr(NOTICE_STRINGS.withdrawn, locale),
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record that");
    } finally {
      setBusy(null);
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

        <div className="mt-4 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/15 text-primary">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">
              {tr(NOTICE_STRINGS.title, locale)}
            </h1>
            <p className="text-xs text-muted-foreground">
              v{NOTICE_VERSION} · {locale.toUpperCase()} · {config.legalRegime}
            </p>
          </div>
        </div>

        <p className="mt-5 rounded-2xl border border-border bg-card p-4 text-sm leading-relaxed">
          {tr(NOTICE_INTRO, locale)}
        </p>
        <p className="mt-2 px-1 text-xs text-muted-foreground">{tr(regime.notice, locale)}</p>

        {/* Itemised, per-purpose. Nothing pre-ticked. */}
        <div className="mt-6 space-y-3">
          {CONSENT_PURPOSES.map((p) => {
            const decided = p.id in states;
            const on = decided ? states[p.id] : defaultPurposeState(config.legalRegime);
            return (
              <section key={p.id} className="rounded-2xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold">{tr(p.title, locale)}</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {tr(NOTICE_STRINGS.purposeLabel, locale)}:{" "}
                  </span>
                  {tr(p.purpose, locale)}
                </p>
                <div className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground">
                  {tr(NOTICE_STRINGS.dataCollected, locale)}
                </div>
                <ul className="mt-1 space-y-1">
                  {p.categories.map((c) => (
                    <li key={c.id} className="flex items-start gap-2 text-xs">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                      <span>{tr(c.label, locale)}</span>
                    </li>
                  ))}
                </ul>

                {p.essential ? (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    {tr(NOTICE_STRINGS.essential, locale)}
                  </p>
                ) : (
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      {decided
                        ? on
                          ? tr(NOTICE_STRINGS.granted, locale)
                          : tr(NOTICE_STRINGS.withdrawn, locale)
                        : tr(NOTICE_STRINGS.withdrawn, locale)}
                    </span>
                    <button
                      type="button"
                      disabled={busy === p.id}
                      onClick={() => void toggle(p.id, !on)}
                      className={
                        on
                          ? "rounded-2xl border border-border px-4 py-2 text-xs font-semibold disabled:opacity-50"
                          : "rounded-2xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                      }
                    >
                      {on
                        ? tr(NOTICE_STRINGS.withdraw, locale)
                        : tr(NOTICE_STRINGS.give, locale)}
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {/* Terms acceptance is a SEPARATE action — never bundled with consent. */}
        <p className="mt-4 px-1 text-[11px] text-muted-foreground">
          {tr(NOTICE_STRINGS.terms, locale)}{" "}
          <Link to="/terms" className="text-primary hover:underline">
            /terms
          </Link>
        </p>

        {/* (a) withdraw — the buttons above; (b) rights; (c) complain. */}
        <div className="mt-6 space-y-2 rounded-2xl border border-border bg-card p-4 text-sm">
          <Link
            to="/app/privacy/data-rights"
            className="block text-primary hover:underline"
          >
            {tr(NOTICE_STRINGS.rights, locale)}
          </Link>
          <Link
            to="/app/privacy/grievance"
            className="block text-primary hover:underline"
          >
            {tr(NOTICE_STRINGS.grievance, locale)}: {GRIEVANCE_OFFICER.name}
          </Link>
          <a
            href={`mailto:${GRIEVANCE_OFFICER.email}`}
            className="block text-primary hover:underline"
          >
            {GRIEVANCE_OFFICER.email}
          </a>
          <a
            href={`tel:${GRIEVANCE_OFFICER.phone}`}
            className="block text-primary hover:underline"
          >
            {GRIEVANCE_OFFICER.phoneDisplay}
          </a>
          <a
            href={DATA_PROTECTION_BOARD.url}
            target="_blank"
            rel="noreferrer"
            className="block text-primary hover:underline"
          >
            {tr(NOTICE_STRINGS.complain, locale)} — {DATA_PROTECTION_BOARD.name}
          </a>
        </div>

        {/* Tamper-evident history */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {tr(NOTICE_STRINGS.history, locale)}
            </div>
            {chain && (
              <div
                className={`flex items-center gap-1 text-[11px] ${
                  chain.ok ? "text-primary" : "text-destructive"
                }`}
              >
                {chain.ok ? (
                  <ShieldCheck className="h-3.5 w-3.5" />
                ) : (
                  <ShieldAlert className="h-3.5 w-3.5" />
                )}
                {chain.ok
                  ? tr(NOTICE_STRINGS.chainOk, locale)
                  : tr(NOTICE_STRINGS.chainBad, locale)}
              </div>
            )}
          </div>
          <ul className="mt-2 space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="rounded-2xl border border-border bg-card px-4 py-3 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{r.purpose_id}</span>
                  <span
                    className={
                      r.consent_state === "granted" ? "text-primary" : "text-muted-foreground"
                    }
                  >
                    {r.consent_state}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()} · v{r.notice_version} ·{" "}
                  {r.notice_locale} · {r.jurisdiction}
                </div>
                <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                  {r.record_hash.slice(0, 24)}…
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
