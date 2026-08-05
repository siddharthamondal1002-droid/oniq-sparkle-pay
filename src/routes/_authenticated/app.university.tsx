import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  GraduationCap,
  Info,
  ScrollText,
  ShieldQuestion,
} from "lucide-react";
import { openInApp } from "@/lib/miniapps";
import { COUNTRIES, useCountry } from "@/lib/country";
import { COUNTRY_ROUTE, ROUTE_EXPLAINERS } from "@/data/admissionRoutes";
import {
  INSTITUTIONS_DISCLAIMER,
  SOURCE_ATTRIBUTION,
  institutionsFor,
  type Institution,
} from "@/data/institutions";
import { calendarFor } from "@/data/admissionsCalendar";
import {
  PRACTICE_DISCLAIMER,
  TEST_DISCLAIMER,
  testsForDestination,
  type EnglishTest,
} from "@/data/englishTests";
import {
  PRACTICE_SET_DISCLAIMER,
  practiceSetsFor,
  type PracticeSet,
} from "@/data/admissionPractice";
import { POLICY_STATUS_LABEL, policiesFor } from "@/data/policyWatch";
import {
  ELIGIBILITY_DISCLAIMER,
  checkEligibility,
  type EligibilityInput,
} from "@/lib/eligibility";

export const Route = createFileRoute("/_authenticated/app/university")({
  head: () => ({
    meta: [
      { title: "University & Admissions — ONIQ" },
      {
        name: "description",
        content:
          "How admissions actually work in seven countries: route explainers, a curated institution list, deadlines and a dated policy watch. No rankings.",
      },
      { property: "og:title", content: "University & Admissions — ONIQ" },
      {
        property: "og:description",
        content:
          "Route explainers, curated institutions, admission deadlines and a dated study-abroad policy watch.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniversityScreen,
});

type Tab = "route" | "institutions" | "english" | "practice" | "calendar" | "policy" | "check";

const TABS: { id: Tab; label: string }[] = [
  { id: "route", label: "How it works" },
  { id: "institutions", label: "Institutions" },
  { id: "english", label: "English tests" },
  { id: "practice", label: "Practice sets" },
  { id: "calendar", label: "Deadlines" },
  { id: "policy", label: "Policy watch" },
  { id: "check", label: "Quick check" },
];

function UniversityScreen() {
  const [country, setCountry] = useCountry();
  const [tab, setTab] = useState<Tab>("route");

  const route = COUNTRY_ROUTE[country];
  const explainer = ROUTE_EXPLAINERS[route];
  const institutions = useMemo(() => institutionsFor(country), [country]);
  const events = useMemo(() => calendarFor(country), [country]);
  const policies = useMemo(() => policiesFor(country), [country]);

  return (
    <div className="px-5 pt-12 pb-24">
      <div className="flex items-center gap-3">
        <Link
          to="/app"
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold">University 🎓</h1>
          <p className="text-xs text-muted-foreground">
            admissions, deadlines &amp; policy — dated, never ranked
          </p>
        </div>
      </div>

      {/* Country selector */}
      <div className="no-scrollbar mt-4 flex gap-1.5 overflow-x-auto">
        {COUNTRIES.map((c) => (
          <button
            key={c.code}
            type="button"
            onClick={() => setCountry(c.code)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
              c.code === country
                ? "border-primary bg-primary/15 text-primary"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            {c.flag} {c.code}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
              t.id === tab ? "bg-foreground text-background" : "bg-card text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "route" && (
        <section className="mt-5 space-y-3">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">{explainer.label}</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {explainer.howItWorks}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">Documents that usually matter</h3>
            <ul className="mt-2 space-y-1.5">
              {explainer.documents.map((d) => (
                <li key={d} className="text-sm text-muted-foreground">
                  • {d}
                </li>
              ))}
            </ul>
          </div>
          <OfficialLinkRow url={explainer.officialUrl} label={explainer.officialLabel} />
        </section>
      )}

      {tab === "institutions" && (
        <section className="mt-5 space-y-3">
          <Note>{INSTITUTIONS_DISCLAIMER}</Note>
          {institutions.map((i) => (
            <InstitutionCard key={i.id} institution={i} />
          ))}
        </section>
      )}

      {tab === "calendar" && (
        <section className="mt-5 space-y-3">
          <Note>
            Dates move year to year. Where ONIQ has not verified this year&apos;s exact date, the
            entry says &quot;typically&quot; rather than inventing one.
          </Note>
          {events.map((e) => (
            <div key={e.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start gap-2">
                <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{e.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{e.window}</p>
                  {e.notes ? (
                    <p className="mt-1 text-xs text-muted-foreground">{e.notes}</p>
                  ) : null}
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Last verified {e.lastVerified}
                  </p>
                  <button
                    type="button"
                    onClick={() => void openInApp(e.sourceUrl)}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary"
                  >
                    Official source <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === "policy" && (
        <section className="mt-5 space-y-3">
          <Note>
            Every row shows the date ONIQ last verified it. A visa rule without a verification date
            is not worth acting on.
          </Note>
          {policies.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No verified policy changes tracked for this country yet.
            </p>
          ) : null}
          {policies.map((p) => (
            <div key={p.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start gap-2">
                <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{p.title}</h3>
                  <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {POLICY_STATUS_LABEL[p.status]}
                  </span>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Effective: {p.effectiveDate}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Last verified {p.lastVerified}</p>
                  <button
                    type="button"
                    onClick={() => void openInApp(p.sourceUrl)}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary"
                  >
                    Official source <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === "english" && <EnglishTests destination={country} />}

      {tab === "practice" && <PracticeSets destination={country} />}

      {tab === "check" && <QuickCheck destination={country} />}
    </div>
  );
}

/**
 * Admission-test practice sets. Read src/data/admissionPractice.ts before
 * touching the content — the legal boundary that makes this shippable is
 * written out at the top of it, and it is the file somebody will be editing
 * when they are tempted to paste in "a few real questions".
 */
function PracticeSets({ destination }: { destination: string }) {
  const sets = useMemo(() => practiceSetsFor(destination), [destination]);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section className="mt-5 space-y-3">
      <Note>{PRACTICE_SET_DISCLAIMER}</Note>
      {sets.map((set) => (
        <PracticeSetCard
          key={set.id}
          set={set}
          open={openId === set.id}
          onToggle={() => setOpenId(openId === set.id ? null : set.id)}
        />
      ))}
    </section>
  );
}

function PracticeSetCard({
  set,
  open,
  onToggle,
}: {
  set: PracticeSet;
  open: boolean;
  onToggle: () => void;
}) {
  // Answers are revealed per question, not scored. ONIQ deliberately produces
  // no total: a score here would look like a prediction, and predicting a
  // result off four self-written questions would be dishonest.
  const [revealed, setRevealed] = useState<Record<string, number>>({});

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 text-start"
      >
        <div className="min-w-0">
          <h2 className="font-semibold">{set.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {set.test} · {set.section} · {set.questions.length} questions · {set.minutes} min
          </p>
        </div>
        <span className="shrink-0 text-xs text-primary">{open ? "Close" : "Start"}</span>
      </button>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{set.skill}</p>

      {open && (
        <div className="mt-4 space-y-4">
          {set.questions.map((q, qi) => {
            const picked = revealed[q.id];
            const answered = picked !== undefined;
            return (
              <div key={q.id} className="rounded-xl border border-border bg-muted/30 p-3">
                <p className="text-sm font-medium leading-relaxed">
                  {qi + 1}. {q.question}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {q.options.map((opt, oi) => {
                    const isAnswer = oi === q.answer;
                    const isPicked = picked === oi;
                    return (
                      <li key={opt}>
                        <button
                          type="button"
                          disabled={answered}
                          onClick={() => setRevealed((r) => ({ ...r, [q.id]: oi }))}
                          className={`w-full rounded-lg border px-3 py-2 text-start text-sm transition-colors ${
                            !answered
                              ? "border-border bg-card"
                              : isAnswer
                                ? "border-primary bg-primary/10 text-primary"
                                : isPicked
                                  ? "border-destructive/50 bg-destructive/10"
                                  : "border-border bg-card opacity-60"
                          }`}
                        >
                          {opt}
                          {answered && isAnswer ? " ✓" : ""}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {answered && (
                  <p className="mt-2 rounded-lg bg-background/60 p-2 text-xs leading-relaxed text-muted-foreground">
                    {q.explanation}
                  </p>
                )}
              </div>
            );
          })}

          <OfficialLinkRow url={set.officialUrl} label="Register and check the current format" />

          <p className="text-[11px] text-muted-foreground/70">
            Written by ONIQ, checked on {set.verifiedOn}. {set.test} is owned by {set.owner}. ONIQ
            does not score this set and it does not predict a result — the official page is the
            authority on format.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * English-proficiency tests: ONIQ's own study notes and ONIQ's own practice
 * prompts. Read src/data/englishTests.ts before changing anything here — the
 * legal boundary that makes this shippable is written out at the top of it.
 *
 * The short version: format facts and ONIQ-written prompts are fine, real exam
 * items and official rubrics are not, and nothing may imply endorsement or
 * predict a score. The disclaimers below are load-bearing, not decoration.
 */
function EnglishTests({ destination }: { destination: string }) {
  const tests = useMemo(() => testsForDestination(destination), [destination]);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section className="mt-5 space-y-3">
      <Note>{TEST_DISCLAIMER}</Note>

      {tests.map((t) => (
        <TestCard
          key={t.id}
          test={t}
          open={openId === t.id}
          onToggle={() => setOpenId(openId === t.id ? null : t.id)}
        />
      ))}
    </section>
  );
}

function TestCard({
  test,
  open,
  onToggle,
}: {
  test: EnglishTest;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 text-start"
      >
        <div className="min-w-0">
          {/* Text only. No logo, no imitation of any owner's lettering. */}
          <h2 className="font-semibold">{test.name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{test.totalMinutes}</p>
        </div>
        <span className="shrink-0 text-xs text-primary">{open ? "Close" : "Open"}</span>
      </button>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{test.acceptedFor}</p>

      {open && (
        <div className="mt-4 space-y-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Scoring
            </h3>
            <p className="mt-1 text-sm leading-relaxed">{test.scoring}</p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Structure
            </h3>
            <ul className="mt-2 space-y-2">
              {test.sections.map((sec) => (
                <li key={sec.name} className="rounded-xl border border-border bg-muted/30 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{sec.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {[sec.minutes ? `${sec.minutes} min` : null, sec.questions]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{sec.what}</p>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Notes
            </h3>
            <ul className="mt-2 list-disc space-y-1.5 ps-4 text-sm leading-relaxed text-muted-foreground">
              {test.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Practice prompts
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/80">
              {PRACTICE_DISCLAIMER}
            </p>
            <ul className="mt-2 space-y-2">
              {test.practice.map((p) => (
                <li key={p.id} className="rounded-xl border border-primary/25 bg-primary/5 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold text-primary">{p.section}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {p.minutes} min
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed">{p.prompt}</p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground/80">What a strong answer does:</span>{" "}
                    {p.lookFor}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <OfficialLinkRow url={test.officialUrl} label={`Register and check the current format`} />

          <p className="text-[11px] text-muted-foreground/70">
            Structure above checked on {test.verifiedOn}. Owned by {test.owner}. Formats change —
            the official page is the authority, not this screen.
          </p>
        </div>
      )}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-border bg-muted/40 p-3">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

function OfficialLinkRow({ url, label }: { url: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => void openInApp(url)}
      className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-4 text-left"
    >
      <span className="text-sm font-medium">{label}</span>
      <ExternalLink className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

function signalChips(i: Institution): string[] {
  const s = i.signals;
  const chips: string[] = [];
  if (s.publicOrPrivate) chips.push(s.publicOrPrivate === "public" ? "Public" : "Private");
  if (s.russellGroup) chips.push("Russell Group");
  if (s.groupOfEight) chips.push("Group of Eight");
  if (s.u15) chips.push("U15");
  if (s.carnegieClass) chips.push(s.carnegieClass);
  if (s.naacGrade) chips.push(`NAAC ${s.naacGrade}`);
  if (s.isBranchCampus) chips.push("Branch campus");
  return chips;
}

function InstitutionCard({ institution }: { institution: Institution }) {
  const attribution = SOURCE_ATTRIBUTION[institution.source];
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">{institution.name}</h3>
      {institution.city ? (
        <p className="text-xs text-muted-foreground">{institution.city}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {signalChips(institution).map((c) => (
          <span
            key={c}
            className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            {c}
          </span>
        ))}
      </div>
      {institution.notes ? (
        <p className="mt-2 text-xs text-muted-foreground">{institution.notes}</p>
      ) : null}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Source: {attribution ?? institution.source}
      </p>
      <button
        type="button"
        onClick={() => void openInApp(institution.websiteUrl)}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary"
      >
        Official website <ExternalLink className="h-3 w-3" />
      </button>
    </div>
  );
}

function QuickCheck({ destination }: { destination: EligibilityInput["destination"] }) {
  const [qualification, setQualification] = useState<EligibilityInput["qualification"]>();
  const [hasRouteAssessment, setHasRouteAssessment] = useState<boolean>();
  const [needsStudentVisa, setNeedsStudentVisa] = useState<boolean>();
  const [hasLanguageEvidence, setHasLanguageEvidence] = useState<boolean>();
  const [shown, setShown] = useState(false);

  const result = useMemo(
    () =>
      checkEligibility({
        destination,
        qualification,
        hasRouteAssessment,
        needsStudentVisa,
        hasLanguageEvidence,
      }),
    [destination, qualification, hasRouteAssessment, needsStudentVisa, hasLanguageEvidence],
  );

  return (
    <section className="mt-5 space-y-3">
      <Note>{ELIGIBILITY_DISCLAIMER}</Note>

      <div className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Where you are right now</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(
            [
              ["secondary_in_progress", "Still at school"],
              ["secondary_complete", "Finished school"],
              ["undergraduate", "Undergraduate"],
              ["postgraduate", "Postgraduate"],
            ] as const
          ).map(([id, label]) => (
            <Chip
              key={id}
              active={qualification === id}
              onClick={() => setQualification(id)}
              label={label}
            />
          ))}
        </div>

        <h3 className="mt-4 text-sm font-semibold">
          Have you completed the assessment this route expects?
        </h3>
        <YesNo value={hasRouteAssessment} onChange={setHasRouteAssessment} />

        <h3 className="mt-4 text-sm font-semibold">Will you need a student visa?</h3>
        <YesNo value={needsStudentVisa} onChange={setNeedsStudentVisa} />

        <h3 className="mt-4 text-sm font-semibold">Do you have English language evidence?</h3>
        <YesNo value={hasLanguageEvidence} onChange={setHasLanguageEvidence} />

        <button
          type="button"
          onClick={() => setShown(true)}
          className="mt-4 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Show orientation
        </button>
      </div>

      {shown ? (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-start gap-2">
            <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm font-medium">{result.headline}</p>
          </div>

          {result.considerations.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {result.considerations.map((c) => (
                <li key={c} className="text-sm text-muted-foreground">
                  • {c}
                </li>
              ))}
            </ul>
          ) : null}

          {result.missingInputs.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-semibold">Not enough information to comment on:</p>
              <ul className="mt-1 space-y-1">
                {result.missingInputs.map((m) => (
                  <li key={m} className="text-xs text-muted-foreground">
                    • {m}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.policies.map((p) => (
            <p key={p.id} className="mt-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{p.title}</span> —{" "}
              {POLICY_STATUS_LABEL[p.status]}, effective {p.effectiveDate}. Last verified{" "}
              {p.lastVerified}.
            </p>
          ))}

          <p className="mt-3 text-[11px] text-muted-foreground">{result.disclaimer}</p>
          <div className="mt-3">
            <OfficialLinkRow url={result.officialUrl} label={result.officialLabel} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-background text-muted-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function YesNo({
  value,
  onChange,
}: {
  value: boolean | undefined;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="mt-2 flex gap-1.5">
      <Chip active={value === true} onClick={() => onChange(true)} label="Yes" />
      <Chip active={value === false} onClick={() => onChange(false)} label="No" />
    </div>
  );
}
