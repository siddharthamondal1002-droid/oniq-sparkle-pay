import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  ExternalLink,
  GraduationCap,
  Info,
  ScrollText,
  ShieldQuestion,
} from "lucide-react";
import {
  OniqCanvas,
  OniqCard,
  OniqChip,
  OniqEmpty,
  OniqHeader,
  OniqSectionHeader,
  OniqStoryRail,
} from "@/components/oniq";
import { openInApp } from "@/lib/miniapps";
import { COUNTRIES, useCountry } from "@/lib/country";
import { COUNTRY_ROUTE, ROUTE_EXPLAINERS } from "@/data/admissionRoutes";
import {
  INSTITUTIONS_DISCLAIMER,
  SOURCE_ATTRIBUTION,
  institutionsFor,
  type Institution,
} from "@/data/institutions";
import { calendarFor, type CalendarKind } from "@/data/admissionsCalendar";
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
import { ELIGIBILITY_DISCLAIMER, checkEligibility, type EligibilityInput } from "@/lib/eligibility";

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

/** What kind of moment a calendar row is — drawn as the stop's eyebrow on the timeline. */
const KIND_LABEL: Record<CalendarKind, string> = {
  application: "Application",
  exam: "Exam",
  offer_round: "Offer round",
  intake: "Intake",
};

function UniversityScreen() {
  const [country, setCountry] = useCountry();
  const [tab, setTab] = useState<Tab>("route");

  const route = COUNTRY_ROUTE[country];
  const explainer = ROUTE_EXPLAINERS[route];
  const institutions = useMemo(() => institutionsFor(country), [country]);
  const events = useMemo(() => calendarFor(country), [country]);
  const policies = useMemo(() => policiesFor(country), [country]);
  const countryName = COUNTRIES.find((c) => c.code === country)?.label ?? country;

  return (
    <OniqCanvas world="campus" className="pb-24">
      <OniqHeader
        eyebrow="Campus"
        title="University 🎓"
        subtitle="admissions, deadlines & policy — dated, never ranked"
        back="/app"
      >
        {/* Country selector — writes the global home country via setCountry. */}
        <OniqStoryRail role="radiogroup" ariaLabel="Country">
          {COUNTRIES.map((c) => (
            <OniqChip
              key={c.code}
              role="radio"
              active={c.code === country}
              onClick={() => setCountry(c.code)}
              ariaLabel={c.label}
            >
              <span aria-hidden="true">{c.flag}</span> {c.code}
            </OniqChip>
          ))}
        </OniqStoryRail>

        {/* Tabs */}
        <OniqStoryRail className="mt-2" role="tablist" ariaLabel="Sections">
          {TABS.map((t) => (
            <OniqChip key={t.id} role="tab" active={t.id === tab} onClick={() => setTab(t.id)}>
              {t.label}
            </OniqChip>
          ))}
        </OniqStoryRail>
      </OniqHeader>

      {tab === "route" && (
        <section className="mt-5 space-y-4 px-5">
          <OniqCard variant="hero" padding="lg" className="rise">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
              <GraduationCap className="h-4 w-4" aria-hidden="true" /> Admission route ·{" "}
              {countryName}
            </div>
            <h2 className="mt-1 font-display text-[24px] leading-tight">{explainer.label}</h2>
          </OniqCard>
          <Journey
            stops={[
              {
                key: "how",
                eyebrow: "Step 1",
                title: "How it works",
                body: (
                  <OniqCard padding="md">
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {explainer.howItWorks}
                    </p>
                  </OniqCard>
                ),
              },
              {
                key: "docs",
                eyebrow: "Step 2",
                title: "Documents that usually matter",
                body: (
                  <OniqCard padding="md">
                    <ul className="space-y-1.5">
                      {explainer.documents.map((d) => (
                        <li key={d} className="flex gap-2 text-sm text-muted-foreground">
                          <span aria-hidden="true" className="text-world">
                            •
                          </span>
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  </OniqCard>
                ),
              },
              {
                key: "official",
                eyebrow: "Step 3",
                title: "Where the rules live",
                body: (
                  <OfficialLinkRow url={explainer.officialUrl} label={explainer.officialLabel} />
                ),
              },
            ]}
          />
        </section>
      )}

      {tab === "institutions" && (
        <section className="mt-5 space-y-3 px-5">
          <Note>{INSTITUTIONS_DISCLAIMER}</Note>
          {institutions.map((i, idx) => (
            <InstitutionCard key={i.id} institution={i} index={idx} />
          ))}
        </section>
      )}

      {tab === "calendar" && (
        <section className="mt-5 space-y-4 px-5">
          <Note>
            Dates move year to year. Where ONIQ has not verified this year&apos;s exact date, the
            entry says &quot;typically&quot; rather than inventing one.
          </Note>
          <OniqSectionHeader
            className="px-0"
            eyebrow={`${events.length} moments`}
            title={`The year in ${countryName}`}
          />
          <Journey
            stops={events.map((e) => ({
              key: e.id,
              eyebrow: KIND_LABEL[e.kind],
              title: e.title,
              body: (
                <OniqCard padding="md">
                  <div className="flex items-start gap-2">
                    <CalendarDays
                      className="mt-0.5 h-4 w-4 shrink-0 text-world"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{e.window}</p>
                      {e.exactDate ? (
                        <p className="mt-1 text-[12px] font-semibold text-world">
                          Verified date: {e.exactDate}
                        </p>
                      ) : null}
                      {e.notes ? (
                        <p className="mt-1 text-[12px] text-muted-foreground">{e.notes}</p>
                      ) : null}
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Last verified {e.lastVerified}
                      </p>
                      <SourceButton url={e.sourceUrl} />
                    </div>
                  </div>
                </OniqCard>
              ),
            }))}
          />
        </section>
      )}

      {tab === "policy" && (
        <section className="mt-5 space-y-4 px-5">
          <Note>
            Every row shows the date ONIQ last verified it. A visa rule without a verification date
            is not worth acting on.
          </Note>
          {policies.length === 0 ? (
            <OniqEmpty
              emoji="📜"
              title="No verified policy changes tracked for this country yet."
            />
          ) : (
            <Journey
              stops={policies.map((p) => ({
                key: p.id,
                eyebrow: POLICY_STATUS_LABEL[p.status],
                eyebrowTone: p.status === "in_force" ? "solid" : "soft",
                title: p.title,
                body: (
                  <OniqCard padding="md">
                    <div className="flex items-start gap-2">
                      <ScrollText
                        className="mt-0.5 h-4 w-4 shrink-0 text-world"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="text-sm leading-relaxed text-muted-foreground">{p.summary}</p>
                        <p className="mt-2 text-[12px] font-medium text-foreground">
                          Effective: {p.effectiveDate}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Last verified {p.lastVerified}
                        </p>
                        <SourceButton url={p.sourceUrl} />
                      </div>
                    </div>
                  </OniqCard>
                ),
              }))}
            />
          )}
        </section>
      )}

      {tab === "english" && <EnglishTests destination={country} />}

      {tab === "practice" && <PracticeSets destination={country} />}

      {tab === "check" && <QuickCheck destination={country} />}
    </OniqCanvas>
  );
}

/**
 * A vertical journey: one line in the world's pair, a stop per item. Used for
 * the admission route, the deadlines calendar and the policy watch, so the
 * three read as one timeline rather than three lists.
 */
function Journey({
  stops,
}: {
  stops: {
    key: string;
    eyebrow: string;
    /** solid = filled with the world's pair (e.g. a rule already in force). */
    eyebrowTone?: "solid" | "soft";
    title: string;
    body: ReactNode;
  }[];
}) {
  return (
    <ol className="relative ms-2 border-s-2 border-world ps-6">
      {stops.map((s, i) => (
        <li key={s.key} className={`relative pb-6 last:pb-0 rise rise-${Math.min(i + 1, 5)}`}>
          <span
            aria-hidden="true"
            className="absolute -start-[29px] top-1 h-3.5 w-3.5 rounded-full bg-world world-glow"
          />
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${
              s.eyebrowTone === "solid" ? "bg-world text-white" : "bg-world-soft text-world"
            }`}
          >
            {s.eyebrow}
          </span>
          <h3 className="mt-1.5 font-display text-[15px] leading-tight text-foreground">
            {s.title}
          </h3>
          <div className="mt-2">{s.body}</div>
        </li>
      ))}
    </ol>
  );
}

function SourceButton({ url }: { url: string }) {
  return (
    <button
      type="button"
      onClick={() => void openInApp(url)}
      className="press mt-2 inline-flex items-center gap-1 rounded-full bg-world-soft px-3 py-1.5 text-[12px] font-semibold text-world"
    >
      Official source <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </button>
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
    <section className="mt-5 space-y-3 px-5">
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
    <OniqCard padding="md" className={open ? "border-world" : undefined}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 text-start"
      >
        <div className="min-w-0">
          <h2 className="font-display text-[15px] leading-tight text-foreground">{set.title}</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {set.test} · {set.section} · {set.questions.length} questions · {set.minutes} min
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold ${
            open ? "bg-world-soft text-world" : "bg-world text-white"
          }`}
        >
          {open ? "Close" : "Start"}
        </span>
      </button>

      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{set.skill}</p>

      {open && (
        <div className="mt-4 space-y-4">
          {set.questions.map((q, qi) => {
            const picked = revealed[q.id];
            const answered = picked !== undefined;
            return (
              <div key={q.id} className="rounded-2xl bg-surface-2 p-3">
                <p className="text-sm font-medium leading-relaxed text-foreground">
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
                          className={`press w-full rounded-xl border px-3 py-2 text-start text-sm transition-colors ${
                            !answered
                              ? "border-border bg-card text-foreground"
                              : isAnswer
                                ? "border-success bg-success/15 text-foreground"
                                : isPicked
                                  ? "border-destructive/50 bg-destructive/10 text-foreground"
                                  : "border-border bg-card text-foreground opacity-60"
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
                  <p className="mt-2 rounded-xl bg-card p-2 text-[12px] leading-relaxed text-muted-foreground">
                    {q.explanation}
                  </p>
                )}
              </div>
            );
          })}

          <OfficialLinkRow url={set.officialUrl} label="Register and check the current format" />

          <p className="text-[11px] text-muted-foreground">
            Written by ONIQ, checked on {set.verifiedOn}. {set.test} is owned by {set.owner}. ONIQ
            does not score this set and it does not predict a result — the official page is the
            authority on format.
          </p>
        </div>
      )}
    </OniqCard>
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
    <section className="mt-5 space-y-3 px-5">
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
    <OniqCard padding="md" className={open ? "border-world" : undefined}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 text-start"
      >
        <div className="min-w-0">
          {/* Text only. No logo, no imitation of any owner's lettering. */}
          <h2 className="font-display text-[15px] leading-tight text-foreground">{test.name}</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">{test.totalMinutes}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold ${
            open ? "bg-world-soft text-world" : "bg-world text-white"
          }`}
        >
          {open ? "Close" : "Open"}
        </span>
      </button>

      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{test.acceptedFor}</p>

      {open && (
        <div className="mt-4 space-y-4">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-world">
              Scoring
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-foreground">{test.scoring}</p>
          </div>

          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-world">
              Structure
            </h3>
            <ul className="mt-2 space-y-2">
              {test.sections.map((sec) => (
                <li key={sec.name} className="rounded-2xl bg-surface-2 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{sec.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {[sec.minutes ? `${sec.minutes} min` : null, sec.questions]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    {sec.what}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-world">
              Notes
            </h3>
            <ul className="mt-2 list-disc space-y-1.5 ps-4 text-sm leading-relaxed text-muted-foreground">
              {test.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-world">
              Practice prompts
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {PRACTICE_DISCLAIMER}
            </p>
            <ul className="mt-2 space-y-2">
              {test.practice.map((p) => (
                <li key={p.id} className="rounded-2xl border border-world bg-world-soft p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-semibold text-world">{p.section}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {p.minutes} min
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-foreground">{p.prompt}</p>
                  <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">What a strong answer does:</span>{" "}
                    {p.lookFor}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <OfficialLinkRow url={test.officialUrl} label={`Register and check the current format`} />

          <p className="text-[11px] text-muted-foreground">
            Structure above checked on {test.verifiedOn}. Owned by {test.owner}. Formats change —
            the official page is the authority, not this screen.
          </p>
        </div>
      )}
    </OniqCard>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-world bg-world-soft p-3">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-world" aria-hidden="true" />
      <p className="text-[12px] leading-relaxed text-foreground/80">{children}</p>
    </div>
  );
}

function OfficialLinkRow({ url, label }: { url: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => void openInApp(url)}
      className="press flex w-full items-center justify-between gap-3 rounded-2xl oniq-surface p-4 text-start"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">opens outside ONIQ</span>
      </span>
      <ExternalLink className="h-4 w-4 shrink-0 text-world" aria-hidden="true" />
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

function InstitutionCard({ institution, index }: { institution: Institution; index: number }) {
  const attribution = SOURCE_ATTRIBUTION[institution.source];
  return (
    <OniqCard padding="md" className={`rise rise-${Math.min(index + 1, 5)}`}>
      <h3 className="font-display text-[15px] leading-tight text-foreground">{institution.name}</h3>
      {institution.city ? (
        <p className="mt-1 text-[12px] text-muted-foreground">{institution.city}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {signalChips(institution).map((c) => (
          <span
            key={c}
            className="rounded-full bg-world-soft px-2 py-0.5 text-[11px] font-medium text-world"
          >
            {c}
          </span>
        ))}
      </div>
      {institution.notes ? (
        <p className="mt-2 text-[12px] text-muted-foreground">{institution.notes}</p>
      ) : null}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Source: {attribution ?? institution.source}
      </p>
      <button
        type="button"
        onClick={() => void openInApp(institution.websiteUrl)}
        className="press mt-2 inline-flex items-center gap-1 rounded-full bg-world-soft px-3 py-1.5 text-[12px] font-semibold text-world"
      >
        Official website <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </button>
    </OniqCard>
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
    <section className="mt-5 space-y-3 px-5">
      <Note>{ELIGIBILITY_DISCLAIMER}</Note>

      <OniqCard padding="lg" className="rise">
        <h3 className="font-display text-[15px] leading-tight text-foreground">
          Where you are right now
        </h3>
        <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup">
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

        <h3 className="mt-4 font-display text-[15px] leading-tight text-foreground">
          Have you completed the assessment this route expects?
        </h3>
        <YesNo value={hasRouteAssessment} onChange={setHasRouteAssessment} />

        <h3 className="mt-4 font-display text-[15px] leading-tight text-foreground">
          Will you need a student visa?
        </h3>
        <YesNo value={needsStudentVisa} onChange={setNeedsStudentVisa} />

        <h3 className="mt-4 font-display text-[15px] leading-tight text-foreground">
          Do you have English language evidence?
        </h3>
        <YesNo value={hasLanguageEvidence} onChange={setHasLanguageEvidence} />

        <button
          type="button"
          onClick={() => setShown(true)}
          className="press mt-5 w-full rounded-full bg-world py-3 text-sm font-semibold text-white world-glow"
        >
          Show orientation
        </button>
      </OniqCard>

      {shown ? (
        <OniqCard variant="tinted" padding="lg" className="rise rise-1">
          <div className="flex items-start gap-2">
            <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-world" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">{result.headline}</p>
          </div>

          {result.considerations.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {result.considerations.map((c) => (
                <li key={c} className="flex gap-2 text-sm text-muted-foreground">
                  <span aria-hidden="true" className="text-world">
                    •
                  </span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {result.missingInputs.length > 0 ? (
            <div className="mt-3">
              <p className="text-[12px] font-semibold text-foreground">
                Not enough information to comment on:
              </p>
              <ul className="mt-1 space-y-1">
                {result.missingInputs.map((m) => (
                  <li key={m} className="text-[12px] text-muted-foreground">
                    • {m}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.policies.map((p) => (
            <p key={p.id} className="mt-3 text-[12px] text-muted-foreground">
              <span className="font-medium text-foreground">{p.title}</span> —{" "}
              {POLICY_STATUS_LABEL[p.status]}, effective {p.effectiveDate}. Last verified{" "}
              {p.lastVerified}.
            </p>
          ))}

          <p className="mt-3 text-[11px] text-muted-foreground">{result.disclaimer}</p>
          <div className="mt-3">
            <OfficialLinkRow url={result.officialUrl} label={result.officialLabel} />
          </div>
        </OniqCard>
      ) : null}
    </section>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <OniqChip role="radio" active={active} onClick={onClick}>
      {label}
    </OniqChip>
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
    <div className="mt-2 flex gap-1.5" role="radiogroup">
      <Chip active={value === true} onClick={() => onChange(true)} label="Yes" />
      <Chip active={value === false} onClick={() => onChange(false)} label="No" />
    </div>
  );
}
