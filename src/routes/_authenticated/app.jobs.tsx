import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BadgeCheck,
  Briefcase,
  Check,
  FileText,
  Flag,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { CvPaper } from "@/components/cv/CvPaper";
import { SectionOrderList } from "@/components/cv/SectionOrderList";
import {
  CV_SECTION_ORDER_DEFAULT,
  CV_SECTION_LABEL,
  type CvSectionKey,
} from "@/lib/cvSections";
import { SkillChips } from "@/components/cv/SkillChips";
import { supabase } from "@/integrations/supabase/client";
import { CvPdfPreviewDialog } from "@/components/cv/CvPdfPreviewDialog";
import { COUNTRIES, useCountry } from "@/lib/country";
import { useT } from "@/lib/i18n/LanguageProvider";
import { tileName } from "@/lib/i18n/tileLabel";
import type { Country } from "@/data/appRegistry";
import { getAgeGateStatus, setMyDateOfBirth } from "@/lib/ageGate";
import {
  ATS_HONESTY_LINE,
  ATS_RULES,
  IN_PSU_CATEGORIES,
  STAR_STEPS,
  countryPromptContract,
  cvRulesFor,
  promptedFields,
  type CvSensitiveField,
} from "@/data/cvRules";
import {
  ATTESTATION_STATEMENT,
  applyCountryRules,
  declaredFactsBlock,
  emptyDeclared,
  screenInstruction,
  validateGenerated,
  validateIssuer,
  validateQualification,
  validateSkills,
  validateYear,
  yearsOfExperience,
  type CvDeclared,
  type CvGenerated,
  type ValidationFlag,
} from "@/lib/cvValidation";

export const Route = createFileRoute("/_authenticated/app/jobs")({
  head: () => ({
    meta: [
      { title: "CV Builder — ONIQ Jobs" },
      {
        name: "description",
        content:
          "Write your own CV to the conventions of India, the US, UK, UAE, Canada, Australia or Singapore. Nothing is invented — only what you enter.",
      },
      { property: "og:title", content: "CV Builder — ONIQ Jobs" },
      {
        property: "og:description",
        content:
          "Country-correct CV guidance and an assistant that only ever uses the facts you entered.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JobsScreen,
});

const FIELD_LABEL: Record<CvSensitiveField, string> = {
  photo: "Photo",
  dobAge: "Date of birth",
  maritalReligion: "Marital status",
  nationality: "Nationality / pass status",
  workStatus: "Visa or work status",
  nationalId: "National ID",
  salary: "Salary (current / expected)",
  noticePeriod: "Notice period",
};

function JobsScreen() {
  const [country] = useCountry();
  const { lang } = useT();
  // "Résumé" in the US, "CV" elsewhere, "सीवी" in Hindi — one resolution rule.
  const cvWord = tileName(lang, "cv", (country as Country) ?? undefined);
  const [target, setTarget] = useState<Country>((country as Country) ?? "IN");
  const rules = useMemo(() => cvRulesFor(target), [target]);

  const { data: gate, refetch } = useQuery({
    queryKey: ["age-gate-status"],
    queryFn: getAgeGateStatus,
    staleTime: 60_000,
  });

  const { data: isAdult, refetch: refetchAdult } = useQuery({
    queryKey: ["is-adult-18"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return false;
      const { data, error } = await supabase.rpc(
        "is_adult_18" as never,
        {
          _uid: auth.user.id,
        } as never,
      );
      if (error) return false;
      return data === true;
    },
    staleTime: 60_000,
  });

  return (
    <div className="min-h-dvh bg-[#0E0F13] pb-24 text-white">
      <header className="flex items-center gap-3 px-4 pt-5">
        <Link to="/app" className="rounded-full bg-white/5 p-2" aria-label="Back">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-white/40">
            your {cvWord}, your facts
          </p>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Briefcase className="size-5 text-[#00D4B8]" /> {cvWord} Builder
          </h1>
        </div>
      </header>

      <div className="px-4 pt-3">
        <Link
          to="/app/jobs-apps"
          className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#16181E] px-4 py-3 text-sm"
        >
          <span>Browse real job & gig apps</span>
          <span className="text-[#00D4B8]">Open</span>
        </Link>
      </div>

      {isAdult === false ? (
        <AgeGateCard
          hasDob={gate?.has_dob ?? true}
          onSaved={async () => {
            await refetch();
            await refetchAdult();
          }}
        />
      ) : (
        <CvWorkbench
          target={target}
          setTarget={setTarget}
          rulesKey={rules.country}
          cvWord={cvWord}
        />
      )}
    </div>
  );
}

/** 18+ everywhere. Fails closed on a missing DOB — with a way out. */
function AgeGateCard({ hasDob, onSaved }: { hasDob: boolean; onSaved: () => void }) {
  const [dob, setDob] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="mx-4 mt-6 rounded-2xl border border-white/10 bg-[#16181E] p-4">
      <h2 className="text-base font-semibold">The CV tools are for 18 and over</h2>
      <p className="mt-2 text-sm leading-relaxed text-white/60">
        Job tools process career data and push opportunities, so we hold them to 18 everywhere — not
        to the lower digital-consent age some countries use.
      </p>
      {hasDob ? (
        <p className="mt-3 text-sm text-white/50">
          Your account is under 18. Nothing here is available yet.
        </p>
      ) : (
        <div className="mt-4">
          <p className="text-sm text-white/60">
            We do not have your date of birth on file, so access is closed. Add it once — it cannot
            be changed afterwards.
          </p>
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={!dob || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await setMyDateOfBirth(dob);
                toast.success("Date of birth saved");
                onSaved();
              } catch (e) {
                toast.error((e as Error)?.message ?? "Could not save that");
              } finally {
                setBusy(false);
              }
            }}
            className="mt-3 w-full rounded-xl bg-[#00D4B8] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save date of birth"}
          </button>
        </div>
      )}
    </div>
  );
}

type TabKey = "basics" | "education" | "work" | "skills" | "rules";

function CvWorkbench({
  target,
  setTarget,
  cvWord,
}: {
  target: Country;
  setTarget: (c: Country) => void;
  rulesKey: Country;
  cvWord: string;
}) {
  const rules = cvRulesFor(target);
  const [tab, setTab] = useState<TabKey>("basics");
  const [declared, setDeclared] = useState<CvDeclared>(() => ({
    ...emptyDeclared(),
    credentials: [{ name: "", issuer: "", year: "" }],
    roles: [{ employer: "", title: "", start: "", end: "", bullets: [] }],
  }));
  const [instruction, setInstruction] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState<CvGenerated | null>(null);
  const [refusals, setRefusals] = useState<string[]>([]);
  const [flags, setFlags] = useState<ValidationFlag[]>([]);
  const [attested, setAttested] = useState(false);
  const [cvId, setCvId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // Drag-to-reorder section sequence; drives both the preview and the PDF.
  const [sectionOrder, setSectionOrder] = useState<CvSectionKey[]>([...CV_SECTION_ORDER_DEFAULT]);

  useEffect(() => {
    setGenerated(null);
    setFlags([]);
    setAttested(false);
  }, [target]);

  const years = yearsOfExperience(declared.roles);
  const prompted = promptedFields(target);
  // Work with whatever the user gave us: blank rows are dropped, never demanded.
  const clean = useMemo(() => cleanDeclared(declared), [declared]);
  const hasAnything =
    Boolean(clean.fullName || clean.headline || clean.summary) ||
    clean.roles.length > 0 ||
    clean.credentials.length > 0 ||
    clean.skills.length > 0;

  // Inline validation: blank is never an error, a filled-but-unusable field is.
  const credErrors = useMemo(() => {
    const seen = new Map<string, number>();
    return declared.credentials.map((c, i) => {
      const key = [c.name, c.issuer, c.year].map((x) => x.trim().toLowerCase()).join("|");
      let dup: string | null = null;
      if (c.name.trim()) {
        const first = seen.get(key);
        if (first !== undefined) dup = `Same as qualification ${first + 1} — edit or remove it.`;
        else seen.set(key, i);
      }
      return {
        name: validateQualification(c.name) ?? dup,
        issuer: validateIssuer(c.issuer),
        year: validateYear(c.year),
      };
    });
  }, [declared.credentials]);
  const skillsError = useMemo(() => validateSkills(declared.skills), [declared.skills]);
  const educationInvalid = credErrors.some((e) => e.name || e.issuer || e.year);
  const firstError =
    credErrors.flatMap((e) => [e.name, e.issuer, e.year]).find(Boolean) ?? skillsError ?? null;
  const hasErrors = Boolean(firstError);

  async function generate() {
    if (hasErrors) {
      toast.error(firstError ?? "Fix the highlighted fields first.");
      return;
    }
    if (!hasAnything) {
      toast.error("Add at least one thing — a name, a skill, a course or a role.");
      return;
    }
    const screen = screenInstruction(instruction, clean);
    if (!screen.allowed) {
      toast.error(screen.reason);
      setRefusals([screen.reason]);
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("cv-generate", {
        body: {
          declaredFacts: declaredFactsBlock(clean, target),
          countryContract: countryPromptContract(target),
          instruction:
            (instruction.trim() ? instruction.trim() + "\n\n" : "") +
            "Work with whatever facts are present. Skip any section the user left empty instead of asking for more.",
        },
      });
      if (error) throw error;
      if (data?.error === "age_restricted") {
        toast.error(data.message ?? "The CV tools are for 18 and over.");
        return;
      }
      if (!data?.cv) {
        toast.error("The assistant is unavailable right now.");
        return;
      }
      const cleaned = applyCountryRules(data.cv as CvGenerated, target);
      const report = validateGenerated(cleaned, declared, target);
      setGenerated(cleaned);
      setRefusals(data.refusals ?? []);
      setFlags(report.flags);
      setAttested(false);
      if (!report.ok) toast.warning("Some details need checking before you export.");
    } catch (e) {
      toast.error((e as Error)?.message ?? "Could not generate");
    } finally {
      setBusy(false);
    }
  }

  async function saveAndAttest() {
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data: doc, error } = await sb
        .from("cv_documents")
        .insert({
          user_id: auth.user.id,
          title: declared.fullName ? `${declared.fullName} — CV` : "My CV",
          target_country: target,
          content: { declared, generated },
        })
        .select("id")
        .single();
      if (error) throw error;
      setCvId(doc.id);
      const { error: aErr } = await sb.from("cv_attestations").insert({
        user_id: auth.user.id,
        cv_id: doc.id,
        statement: ATTESTATION_STATEMENT,
      });
      if (aErr) throw aErr;
      toast.success("Saved. Export as DOCX and check it once more before you send it.");
    } catch (e) {
      toast.error((e as Error)?.message ?? "Could not save");
    }
  }

  async function reportOutput() {
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("reports").insert({
        reporter_id: auth.user.id,
        target_type: "cv_ai_output",
        target_id: cvId ?? "unsaved",
        reason: "bad_ai_output",
        details: JSON.stringify({ target, flags }).slice(0, 2000),
      });
      toast.success("Reported. Thank you — we read these.");
    } catch {
      toast.error("Could not send that report");
    }
  }

  const tabs: { key: TabKey; label: string; done: boolean }[] = [
    { key: "basics", label: "About you", done: Boolean(clean.fullName || clean.headline) },
    {
      key: "education",
      label: educationInvalid ? "Qualifications ⚠" : "Qualifications",
      done: clean.credentials.length > 0 && !educationInvalid,
    },
    { key: "work", label: "Work", done: clean.roles.length > 0 },
    {
      key: "skills",
      label: skillsError ? "Skills ⚠" : "Skills",
      done: clean.skills.length > 0 && !skillsError,
    },
    { key: "rules", label: `${target} rules`, done: true },
  ];

  return (
    <div className="space-y-4 px-4 pt-5">
      {/* Country */}
      <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
        <h2 className="text-sm font-semibold">Where are you applying?</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {COUNTRIES.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => setTarget(c.code as Country)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                target === c.code ? "bg-[#00D4B8] text-black" : "bg-white/5 text-white/70"
              }`}
            >
              {c.flag} {c.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-white/50">
          Fill in whatever you have. Every tab is optional — we write the CV from what you give us.
        </p>
      </section>

      {/* Tabs */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium ${
              tab === t.key ? "bg-[#00D4B8] text-black" : "bg-white/5 text-white/70"
            }`}
          >
            {t.label}
            {t.done && <Check className={`size-3.5 ${tab === t.key ? "" : "text-[#00D4B8]"}`} />}
          </button>
        ))}
      </div>

      {tab === "basics" && (
        <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
          <h2 className="text-sm font-semibold">About you</h2>
          <div className="mt-3 grid gap-2">
            <Field
              label="Full name"
              value={declared.fullName}
              onChange={(v) => setDeclared({ ...declared, fullName: v })}
            />
            <Field
              label="Headline (optional)"
              placeholder="e.g. Final-year B.Com student"
              value={declared.headline}
              onChange={(v) => setDeclared({ ...declared, headline: v })}
            />
            <Field
              label="Email"
              value={declared.email}
              onChange={(v) => setDeclared({ ...declared, email: v })}
            />
            <Field
              label="Phone"
              value={declared.phone}
              onChange={(v) => setDeclared({ ...declared, phone: v })}
            />
            <Field
              label="Location"
              value={declared.location}
              onChange={(v) => setDeclared({ ...declared, location: v })}
            />
            <Field
              label="Summary in your own words (optional)"
              value={declared.summary}
              onChange={(v) => setDeclared({ ...declared, summary: v })}
            />
          </div>

          {prompted.length > 0 && (
            <div className="mt-4 border-t border-white/5 pt-3">
              <h3 className="text-xs font-semibold text-white/70">
                Usually expected on a {target} CV
              </h3>
              <div className="mt-2 grid gap-2">
                {prompted.map((f) => (
                  <div key={f}>
                    <Field
                      label={`${FIELD_LABEL[f]} (optional)`}
                      value={declared.personal[f] ?? ""}
                      onChange={(v) =>
                        setDeclared({ ...declared, personal: { ...declared.personal, [f]: v } })
                      }
                    />
                    <p className="px-1 pb-1 text-[11px] leading-relaxed text-white/40">
                      {rules[f].note}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {tab === "education" && (
        <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
          <h2 className="text-sm font-semibold">Qualifications</h2>
          <p className="mt-1 text-xs text-white/50">
            Degree, diploma, board exam or certificate — add whatever you actually hold.
          </p>
          {declared.credentials.length === 0 && (
            <p className="mt-3 text-xs text-white/40">
              Nothing added yet. That's fine — you can skip this.
            </p>
          )}
          {declared.credentials.map((c, i) => (
            <div key={i} className="mt-3 rounded-xl border border-white/5 bg-black/20 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                  Qualification {i + 1}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => moveCredential(declared, setDeclared, i, -1)}
                    className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-white/60 disabled:opacity-30"
                  >
                    <ArrowUp className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={i === declared.credentials.length - 1}
                    onClick={() => moveCredential(declared, setDeclared, i, 1)}
                    className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-white/60 disabled:opacity-30"
                  >
                    <ArrowDown className="size-3" />
                  </button>
                </div>
              </div>
              <Field
                label="Qualification"
                placeholder="e.g. Class 12, B.Sc Physics, AWS Cloud Practitioner"
                value={c.name}
                error={credErrors[i]?.name ?? null}
                onChange={(v) => patchCredential(declared, setDeclared, i, { name: v })}
              />
              <Field
                label="Board / university / issuer"
                placeholder="e.g. CBSE, Delhi University, Amazon"
                value={c.issuer}
                error={credErrors[i]?.issuer ?? null}
                onChange={(v) => patchCredential(declared, setDeclared, i, { issuer: v })}
              />
              <Field
                label="Year"
                placeholder="e.g. 2024 or 2020-2024"
                value={c.year}
                error={credErrors[i]?.year ?? null}
                onChange={(v) => patchCredential(declared, setDeclared, i, { year: v })}
              />
              <button
                type="button"
                onClick={() =>
                  setDeclared({
                    ...declared,
                    credentials: declared.credentials.filter((_, j) => j !== i),
                  })
                }
                className="mt-2 rounded-full bg-white/5 px-3 py-1 text-[11px] text-white/60"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setDeclared({
                ...declared,
                credentials: [...declared.credentials, { name: "", issuer: "", year: "" }],
              })
            }
            className="mt-3 flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs"
          >
            <Plus className="size-3.5" />{" "}
            {declared.credentials.length === 0
              ? "Add a qualification"
              : "Add another qualification"}
          </button>
          {clean.credentials.length > 0 && (
            <p className="mt-2 text-[11px] text-white/40">
              {clean.credentials.length} qualification
              {clean.credentials.length === 1 ? "" : "s"} will appear on your {cvWord}.
            </p>
          )}
        </section>
      )}

      {tab === "work" && (
        <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Work history</h2>
            {years !== null && (
              <span className="text-xs text-white/40">≈ {years} yr from your dates</span>
            )}
          </div>
          <p className="mt-1 text-xs text-white/50">
            No experience yet? Leave this empty — we'll write a fresher CV from your qualifications
            and skills.
          </p>
          {declared.roles.map((r, i) => (
            <div key={i} className="mt-3 rounded-xl border border-white/5 bg-black/20 p-3">
              <Field
                label="Employer"
                value={r.employer}
                onChange={(v) => patchRole(declared, setDeclared, i, { employer: v })}
              />
              <Field
                label="Title"
                value={r.title}
                onChange={(v) => patchRole(declared, setDeclared, i, { title: v })}
              />
              <div className="grid grid-cols-2 gap-2">
                <Field
                  label="Start (YYYY-MM)"
                  value={r.start}
                  onChange={(v) => patchRole(declared, setDeclared, i, { start: v })}
                />
                <Field
                  label="End (blank = present)"
                  value={r.end}
                  onChange={(v) => patchRole(declared, setDeclared, i, { end: v })}
                />
              </div>
              <Field
                label="What you did (one per line)"
                value={r.bullets.join("\n")}
                onChange={(v) =>
                  patchRole(declared, setDeclared, i, { bullets: v.split("\n").filter(Boolean) })
                }
              />
              <button
                type="button"
                onClick={() =>
                  setDeclared({ ...declared, roles: declared.roles.filter((_, j) => j !== i) })
                }
                className="mt-2 rounded-full bg-white/5 px-3 py-1 text-[11px] text-white/60"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setDeclared({
                ...declared,
                roles: [
                  ...declared.roles,
                  { employer: "", title: "", start: "", end: "", bullets: [] },
                ],
              })
            }
            className="mt-3 flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs"
          >
            <Plus className="size-3.5" /> Add a role
          </button>
        </section>
      )}

      {tab === "skills" && (
        <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
          <h2 className="text-sm font-semibold">Skills</h2>
          <Field
            label="Comma separated"
            placeholder="e.g. Excel, Tally, spoken English"
            error={skillsError}
            value={declared.skills.join(", ")}
            onChange={(v) =>
              setDeclared({
                ...declared,
                skills: v
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
          {declared.skills.length > 0 && (
            <>
              <p className="mt-3 text-[11px] text-white/40">
                Drag a chip (or focus it and press ← / →) to set priority order — the first ones
                land first on your {cvWord}.
              </p>
              <SkillChips
                skills={declared.skills}
                onChange={(skills) => setDeclared({ ...declared, skills })}
              />
            </>
          )}
        </section>
      )}

      {tab === "rules" && (
        <>
          <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
            <h2 className="text-sm font-semibold">Local conventions</h2>
            <p className="mt-2 text-xs leading-relaxed text-white/50">{rules.length.note}</p>
            <p className="mt-2 text-xs leading-relaxed text-white/50">{rules.referencesNote}</p>
            {rules.context.map((c) => (
              <p key={c} className="mt-2 text-xs leading-relaxed text-amber-200/80">
                {c}
              </p>
            ))}
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
            <h2 className="text-sm font-semibold">What we leave off, and why</h2>
            <ul className="mt-2 space-y-2 text-xs leading-relaxed text-white/55">
              {(
                ["photo", "dobAge", "maritalReligion", "nationalId", "salary"] as CvSensitiveField[]
              )
                .filter(
                  (f) =>
                    rules[f].stance === "never" ||
                    rules[f].stance === "avoid" ||
                    rules[f].stance === "discouraged",
                )
                .map((f) => (
                  <li key={f}>
                    <span className="text-white/80">{FIELD_LABEL[f]}:</span> {rules[f].note}
                  </li>
                ))}
            </ul>
          </section>

          {rules.specials.includes("au_public_sector_star") && (
            <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
              <h2 className="text-sm font-semibold">
                Australian public sector: selection criteria
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-white/55">
                Government roles usually want separate written responses. Answer each criterion in
                STAR order:
              </p>
              <ul className="mt-2 space-y-1 text-xs text-white/55">
                {STAR_STEPS.map((s) => (
                  <li key={s.key}>
                    <span className="text-white/80">{s.label}</span> — {s.hint}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {rules.specials.includes("in_psu_category") && (
            <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
              <h2 className="text-sm font-semibold">PSU and government forms</h2>
              <p className="mt-2 text-xs leading-relaxed text-white/55">
                These forms require a category declaration — {IN_PSU_CATEGORIES.join(", ")} — and
                often a father's name. That belongs on the prescribed form, not on a private-sector
                CV.
              </p>
            </section>
          )}

          <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
            <h2 className="text-sm font-semibold">How it will be formatted</h2>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-white/55">
              {ATS_RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-white/40">{ATS_HONESTY_LINE}</p>
          </section>
        </>
      )}

      {/* Section order — drag to decide what a recruiter reads first */}
      <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
        <h2 className="text-sm font-semibold">Section order</h2>
        <p className="mt-1 text-xs leading-relaxed text-white/50">
          Drag a section (or focus it and press ↑ / ↓) to set the order on your {cvWord}. Empty
          sections are never printed.
        </p>
        <SectionOrderList
          order={sectionOrder}
          onChange={setSectionOrder}
          emptyKeys={(
            [
              ["summary", Boolean(clean.summary || generated?.summary)],
              ["experience", clean.roles.length > 0 || Boolean(generated?.roles?.length)],
              [
                "qualifications",
                clean.credentials.length > 0 || Boolean(generated?.credentials?.length),
              ],
              ["skills", clean.skills.length > 0 || Boolean(generated?.skills?.length)],
            ] as [CvSectionKey, boolean][]
          )
            .filter(([, filled]) => !filled)
            .map(([key]) => key)}
        />
        {sectionOrder[0] && (
          <p className="mt-2 text-[11px] text-white/40">
            {CV_SECTION_LABEL[sectionOrder[0]]} appears first.
          </p>
        )}
      </section>

      {/* Live preview — reflects what you type, before any AI is involved */}
      <CvLivePreview declared={clean} cvWord={cvWord} order={sectionOrder} />

      {/* Assistant — always visible, works with whatever is filled in */}
      <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-[#00D4B8]" /> Write my {cvWord}
          </h2>
          <button
            type="button"
            onClick={() => setAiEnabled((v) => !v)}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
              aiEnabled ? "bg-[#00D4B8] text-black" : "bg-white/10 text-white/60"
            }`}
          >
            {aiEnabled ? "On" : "Off"}
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-white/50">
          It writes from whatever you've filled in and skips the rest. It can only rewrite your own
          facts — it cannot add an employer, title, date or qualification you haven't given it.
        </p>
        {aiEnabled && (
          <>
            <Field
              label="Anything specific? (optional)"
              value={instruction}
              onChange={setInstruction}
              placeholder="e.g. make my bullets more concrete"
            />
            <button
              type="button"
              disabled={busy || !hasAnything || hasErrors}
              onClick={generate}
              className="mt-2 w-full rounded-xl bg-[#00D4B8] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
            >
              {busy ? "Writing…" : `Generate my ${cvWord}`}
            </button>
            {hasErrors ? (
              <p className="mt-2 text-[11px] text-rose-300">{firstError}</p>
            ) : (
              !hasAnything && (
                <p className="mt-2 text-[11px] text-white/40">
                  Add a name, a skill, a qualification or a role and this turns on.
                </p>
              )
            )}
          </>
        )}
      </section>

      {refusals.length > 0 && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-100">
          {refusals.map((r) => (
            <p key={r} className="flex items-start gap-2">
              <X className="mt-0.5 size-3.5 shrink-0" /> {r}
            </p>
          ))}
        </section>
      )}

      {generated && (
        <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-[#00D4B8]">
            <Sparkles className="size-3.5" /> AI-generated — check every line before you send it
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm text-white/80">{generated.summary}</p>
          {generated.roles.map((r, i) => (
            <div key={i} className="mt-3 border-t border-white/5 pt-3">
              <p className="text-sm font-medium">
                {r.title} — {r.employer}
              </p>
              <p className="text-[11px] text-white/40">
                {r.start} – {r.end || "present"}
              </p>
              <ul className="mt-1 list-disc pl-4 text-xs text-white/60">
                {r.bullets.map((b, j) => (
                  <li key={j}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
          {generated.credentials.length > 0 && (
            <div className="mt-3 border-t border-white/5 pt-3">
              <p className="text-xs font-semibold text-white/70">Qualifications</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-white/60">
                {generated.credentials.map((c, i) => (
                  <li key={i}>
                    {c.name}
                    {c.issuer ? `, ${c.issuer}` : ""}
                    {c.year ? `, ${c.year}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {generated.skills.length > 0 && (
            <p className="mt-3 border-t border-white/5 pt-3 text-xs text-white/60">
              {generated.skills.join(" · ")}
            </p>
          )}

          {flags.length > 0 && (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
              <p className="flex items-center gap-2 text-xs font-semibold text-red-200">
                <AlertTriangle className="size-4" /> Check these before exporting
              </p>
              <ul className="mt-2 space-y-1 text-xs text-red-100/80">
                {flags.map((f, i) => (
                  <li key={i}>{f.message}</li>
                ))}
              </ul>
            </div>
          )}

          <label className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-white/70">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              className="mt-0.5"
            />
            {ATTESTATION_STATEMENT}
          </label>
          <button
            type="button"
            disabled={!attested}
            onClick={saveAndAttest}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#00D4B8] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            <BadgeCheck className="size-4" /> Save and confirm accuracy
          </button>
          <button
            type="button"
            onClick={() => setPreviewing(true)}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white"
          >
            <FileText className="size-4" /> Preview PDF
          </button>
          <p className="mt-1 text-center text-[11px] text-white/40">
            Check the layout, then download or share from the preview.
          </p>
          {previewing && (
            <CvPdfPreviewDialog
              declared={cleanDeclared(declared)}
              cv={generated}
              order={sectionOrder}
              onClose={() => setPreviewing(false)}
            />
          )}
          <button
            type="button"
            onClick={reportOutput}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-xs text-white/70"
          >
            <Flag className="size-3.5" /> Report bad output
          </button>
          <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-white/35">
            <FileText className="mt-0.5 size-3.5 shrink-0" />
            Export as DOCX unless the posting asks for something else.
          </p>
        </section>
      )}
    </div>
  );
}

/** Drops blank rows so a half-filled form still generates cleanly. */
function cleanDeclared(d: CvDeclared): CvDeclared {
  const t = (s: string) => (s ?? "").trim();
  return {
    ...d,
    fullName: t(d.fullName),
    headline: t(d.headline),
    email: t(d.email),
    phone: t(d.phone),
    location: t(d.location),
    summary: t(d.summary),
    roles: d.roles
      .filter((r) => t(r.employer) || t(r.title) || r.bullets.some((b) => t(b)))
      .map((r) => ({
        employer: t(r.employer),
        title: t(r.title),
        start: t(r.start),
        end: t(r.end),
        bullets: r.bullets.map(t).filter(Boolean),
      })),
    credentials: d.credentials
      .filter((c) => t(c.name) || t(c.issuer))
      .map((c) => ({ name: t(c.name), issuer: t(c.issuer), year: t(c.year) })),
    skills: d.skills.map(t).filter(Boolean),
  };
}

function patchCredential(
  declared: CvDeclared,
  set: (d: CvDeclared) => void,
  index: number,
  patch: Partial<CvDeclared["credentials"][number]>,
) {
  const credentials = declared.credentials.map((c, i) => (i === index ? { ...c, ...patch } : c));
  set({ ...declared, credentials });
}

/** Reorder a qualification row by one position; the CV keeps this order. */
function moveCredential(
  declared: CvDeclared,
  set: (d: CvDeclared) => void,
  index: number,
  delta: number,
) {
  const target = index + delta;
  if (target < 0 || target >= declared.credentials.length) return;
  const credentials = [...declared.credentials];
  const [row] = credentials.splice(index, 1);
  credentials.splice(target, 0, row);
  set({ ...declared, credentials });
}

function patchRole(
  declared: CvDeclared,
  set: (d: CvDeclared) => void,
  index: number,
  patch: Partial<CvDeclared["roles"][number]>,
) {
  const roles = declared.roles.map((r, i) => (i === index ? { ...r, ...patch } : r));
  set({ ...declared, roles });
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-white/40">{label}</span>
      <textarea
        rows={value.includes("\n") ? 3 : 1}
        value={value}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full resize-y rounded-xl border bg-black/30 px-3 py-2 text-sm outline-none ${
          error
            ? "border-rose-400/70 focus:border-rose-400"
            : "border-white/10 focus:border-[#00D4B8]/60"
        }`}
      />
      {error && <span className="mt-1 block text-[11px] text-rose-300">{error}</span>}
    </label>
  );
}

/**
 * Live, un-AI'd preview of the CV as it is typed. Purely presentational: it
 * reads the cleaned declared facts, so blank rows never appear.
 */
function CvLivePreview({
  declared,
  cvWord,
  order,
}: {
  declared: CvDeclared;
  cvWord: string;
  order?: readonly CvSectionKey[];
}) {
  const contact = [declared.email, declared.phone, declared.location].filter(Boolean);
  const empty =
    !declared.fullName &&
    !declared.headline &&
    !declared.summary &&
    contact.length === 0 &&
    declared.credentials.every((c) => !c.name.trim() && !c.issuer.trim() && !c.year.trim()) &&
    declared.roles.length === 0 &&
    declared.skills.length === 0;

  return (
    <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="size-4 text-[#00D4B8]" /> Live preview
        </h2>
        <span className="text-[11px] text-white/40">updates as you type</span>
      </div>

      {empty ? (
        <p className="mt-3 text-xs leading-relaxed text-white/40">
          Your {cvWord} appears here as you fill in the tabs — qualification, board, year, skills
          and the rest.
        </p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-white">
          <CvPaper
            order={order}
            declared={declared}
            cv={{
              summary: declared.summary,
              roles: declared.roles.map((r) => ({
                employer: r.employer,
                title: r.title,
                start: r.start,
                end: r.end,
                bullets: r.bullets,
              })),
              credentials: declared.credentials
                .filter((c) => c.name.trim() || c.issuer.trim() || c.year.trim())
                .map((c) => ({
                  name: c.name.trim(),
                  issuer: c.issuer.trim(),
                  year: c.year.trim(),
                })),
              skills: declared.skills,
            }}
          />
        </div>
      )}
    </section>
  );
}
