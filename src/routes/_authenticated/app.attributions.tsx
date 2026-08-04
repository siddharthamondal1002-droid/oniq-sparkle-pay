import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Scale } from "lucide-react";
import {
  ATTRIBUTIONS,
  INDEPENDENCE_DISCLAIMER,
  LICENCE_FAMILIES,
  ONIQ_OWN_CONTENT,
  getAttribution,
  type Attribution,
} from "@/data/attributions";

export const Route = createFileRoute("/_authenticated/app/attributions")({
  head: () => ({
    meta: [
      { title: "Attributions & licences — ONIQ" },
      {
        name: "description",
        content:
          "The open data sources behind ONIQ's education and careers features, the licence each one carries, and the notices those licences require.",
      },
      { property: "og:title", content: "Attributions & licences — ONIQ" },
      {
        property: "og:description",
        content:
          "Every dataset ONIQ uses, its licence, and the verbatim notice that licence requires.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AttributionsPage,
});

function AttributionsPage() {
  return (
    <div className="min-h-screen bg-background pt-[max(1rem,env(safe-area-inset-top))] pb-24">
      <div className="mx-auto max-w-2xl px-5">
        <Link
          to="/app/profile"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>

        <h1 className="mt-4 font-display text-2xl font-bold">Attributions &amp; licences</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          Attribution is a licence condition, not a courtesy. Where a licence specifies the exact
          words it requires, those words are reproduced here unchanged — a missing or reworded notice
          is a breach of the licence, not a politeness lapse.
        </p>

        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-primary" />
            <div className="text-sm font-semibold">Independence</div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{INDEPENDENCE_DISCLAIMER}</p>
        </div>

        <div className="mt-3 rounded-2xl border border-border bg-card p-4">
          <div className="text-sm font-semibold">ONIQ's own content</div>
          <p className="mt-2 text-xs text-muted-foreground">{ONIQ_OWN_CONTENT}</p>
        </div>

        {LICENCE_FAMILIES.map((family) => (
          <section key={family.title} className="mt-8">
            <h2 className="font-display text-lg font-semibold">{family.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{family.blurb}</p>
            <div className="mt-3 space-y-3">
              {family.ids
                .map((id) => getAttribution(id))
                .filter((a): a is Attribution => !!a)
                .map((a) => (
                  <AttributionCard key={a.id} a={a} />
                ))}
            </div>
          </section>
        ))}

        <p className="mt-8 text-[11px] text-muted-foreground">
          {ATTRIBUTIONS.length} sources listed. If you believe a credit here is wrong or missing,
          tell us — we will correct it.
        </p>
      </div>
    </div>
  );
}

function AttributionCard({ a }: { a: Attribution }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-sm font-semibold">{a.source}</div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        <span className="uppercase tracking-wider">Used for</span> — {a.usedFor}
      </p>
      <p className="mt-1.5 text-xs text-muted-foreground">
        <span className="uppercase tracking-wider">Licence</span> —{" "}
        <a
          href={a.licenceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary hover:underline"
        >
          {a.licence}
        </a>
      </p>

      {a.requiredNotice && (
        <div className="mt-3 rounded-xl border-l-2 border-primary bg-muted/40 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Required notice — reproduced verbatim
          </div>
          <blockquote className="mt-1 font-mono text-xs leading-relaxed text-foreground">
            {a.requiredNotice}
          </blockquote>
        </div>
      )}

      {a.exclusions.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Not covered by that licence
          </div>
          <ul className="mt-1 list-disc space-y-1 ps-4 text-xs text-muted-foreground">
            {a.exclusions.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {a.notes && <p className="mt-3 text-xs text-muted-foreground">{a.notes}</p>}

      <a
        href={a.sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-3 inline-block text-xs text-primary hover:underline"
      >
        Source
      </a>
    </div>
  );
}
