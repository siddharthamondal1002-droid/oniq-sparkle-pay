import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  FileUp,
  GripVertical,
  Plus,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { CvPaper } from "@/components/cv/CvPaper";
import CredentialCsvImport from "@/components/cv/CredentialCsvImport";
import { SectionOrderList } from "@/components/cv/SectionOrderList";
import { Switch } from "@/components/ui/switch";
import {
  CV_INCLUDE_DEFAULT,
  CV_INCLUDE_KEYS,
  CV_INCLUDE_LABEL,
  CV_SECTION_ORDER_DEFAULT,
  CV_SECTION_LABEL,
  type CvInclude,
  type CvSectionKey,
} from "@/lib/cvSections";
import { CV_TEMPLATES, CV_TEMPLATE_DEFAULT, type CvTemplateId } from "@/lib/cvTemplates";

import { SkillChips } from "@/components/cv/SkillChips";
import { supabase } from "@/integrations/supabase/client";
import { AiOutputReport, AI_OUTPUT_LABEL } from "@/components/safety/AiOutputReport";
import { useCurrentRegion } from "@/lib/region";
import { LEAD_WARNING, SCAM_PATTERNS, reportingGroups } from "@/data/jobScamAlerts";
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
  MAX_ISSUER_LEN,
  MAX_QUALIFICATION_LEN,
  MAX_SKILLS,
  MAX_SKILLS_CHARS,
  MAX_YEAR_LEN,
  normalizeIssuer,
  normalizeQualification,
  normalizeSkills,
  normalizeYear,


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
  // Scam reporting shows BOTH axes when they differ: where the user is
  // standing (the channel that can act today) and the market they are applying
  // into (the jurisdiction the fake employer claims). Collapses to one group
  // when they agree. Hook stays above every early return in this component.
  const [scamRegion] = useCurrentRegion();
  const scamGroups = reportingGroups(scamRegion, target);
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
  // Layout style for the exported PDF and the live preview. Templates change
  // decoration only — pagination is identical across them.
  const [template, setTemplate] = useState<CvTemplateId>(CV_TEMPLATE_DEFAULT);
  // Per-section switches — an excluded section is printed nowhere.
  const [include, setInclude] = useState<CvInclude>({ ...CV_INCLUDE_DEFAULT });
  // Drag-to-reorder for qualification rows. Pointer events (not HTML5 DnD) so
  // touch works too; the row order is the order used by preview and PDF.
  const [dragCred, setDragCred] = useState<number | null>(null);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const dragCredIndex = useRef<number | null>(null);



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
  // Compact list of every invalid field, so nothing is hidden behind a tab.
  const issues = useMemo(() => {
    const list: { tab: TabKey; where: string; message: string }[] = [];
    credErrors.forEach((e, i) => {
      const rowLabels: [string | null, string][] = [
        [e.name, "Qualification"],
        [e.issuer, "Board / university / issuer"],
        [e.year, "Year"],
      ];
      rowLabels.forEach(([msg, label]) => {
        if (msg) list.push({ tab: "education", where: `Qualification ${i + 1} · ${label}`, message: msg });
      });
    });
    if (skillsError) list.push({ tab: "skills", where: "Skills", message: skillsError });
    return list;
  }, [credErrors, skillsError]);


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

      {/* Validation summary — every invalid field in one place, before export */}
      {issues.length > 0 && (
        <section
          role="alert"
          aria-live="polite"
          className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3"
        >
          <p className="flex items-center gap-2 text-xs font-semibold text-rose-200">
            <AlertTriangle className="size-3.5 shrink-0" />
            {issues.length} field{issues.length === 1 ? "" : "s"} need
            {issues.length === 1 ? "s" : ""} a fix before you generate
          </p>
          <ul className="mt-2 space-y-1">
            {issues.map((it, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => setTab(it.tab)}
                  className="w-full rounded-lg px-2 py-1 text-left text-[11px] leading-snug text-rose-100/90 hover:bg-white/5"
                >
                  <span className="font-medium text-rose-200">{it.where}</span>
                  <span className="text-rose-100/70"> — {it.message}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 px-2 text-[10px] text-rose-100/50">Tap any line to jump to that tab.</p>
        </section>
      )}


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
              label="Website or profile (optional)"
              placeholder="e.g. linkedin.com/in/you"
              value={declared.website}
              onChange={(v) => setDeclared({ ...declared, website: v })}
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
            <div
              key={i}
              data-cred-index={i}
              className={`mt-3 rounded-xl border bg-black/20 p-3 ${
                dragCred === i ? "border-[#00D4B8]/60 bg-[#00D4B8]/5" : "border-white/5"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50">
                  <button
                    type="button"
                    data-cred-handle={i}
                    aria-label={`Reorder qualification ${i + 1} of ${declared.credentials.length}. Drag, or use up and down arrow keys.`}
                    className="cursor-grab touch-none rounded-md p-0.5 text-white/30 outline-none ring-[#00D4B8]/60 hover:text-white/60 focus-visible:ring-2 active:cursor-grabbing"
                    onPointerDown={(e) => {
                      dragCredIndex.current = i;
                      setDragCred(i);
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      const from = dragCredIndex.current;
                      if (from === null) return;
                      const over = credIndexAtPoint(e.clientX, e.clientY);
                      if (over === null || over === from) return;
                      dragCredIndex.current = over;
                      setDragCred(over);
                      moveCredentialTo(declared, setDeclared, from, over);
                    }}
                    onPointerUp={() => {
                      dragCredIndex.current = null;
                      setDragCred(null);
                    }}
                    onPointerCancel={() => {
                      dragCredIndex.current = null;
                      setDragCred(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                      e.preventDefault();
                      const to = i + (e.key === "ArrowUp" ? -1 : 1);
                      if (to < 0 || to >= declared.credentials.length) return;
                      moveCredentialTo(declared, setDeclared, i, to);
                      requestAnimationFrame(() => {
                        document
                          .querySelector<HTMLElement>(`[data-cred-handle="${to}"]`)
                          ?.focus({ preventScroll: true });
                      });
                    }}
                  >
                    <GripVertical className="size-3.5" />
                  </button>
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
                placeholder="e.g. Class 12 (Science) · B.Sc Physics · AWS Cloud Practitioner"
                hint="Name the degree, class or certificate — no marks or grades here."
                value={c.name}
                maxLength={MAX_QUALIFICATION_LEN}
                error={credErrors[i]?.name ?? null}
                normalize={normalizeQualification}
                onChange={(v) => patchCredential(declared, setDeclared, i, { name: v })}
              />
              <Field
                label="Board / university / issuer"
                placeholder="e.g. CBSE · Maharashtra State Board · Delhi University · Amazon"
                hint="Who awarded it: school board, university, or the company behind the certificate."
                value={c.issuer}
                maxLength={MAX_ISSUER_LEN}
                error={credErrors[i]?.issuer ?? null}
                normalize={normalizeIssuer}
                onChange={(v) => patchCredential(declared, setDeclared, i, { issuer: v })}
              />

              <Field
                label="Year"
                placeholder="e.g. 2024 · 2020-2024 · 2023-present"
                hint="4-digit year, or a range like 2020-2024. Use 'present' if ongoing."
                value={c.year}
                maxLength={MAX_YEAR_LEN}
                error={credErrors[i]?.year ?? null}
                normalize={normalizeYear}
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
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setDeclared({
                  ...declared,
                  credentials: [...declared.credentials, { name: "", issuer: "", year: "" }],
                })
              }
              className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs"
            >
              <Plus className="size-3.5" />{" "}
              {declared.credentials.length === 0
                ? "Add a qualification"
                : "Add another qualification"}
            </button>
            <button
              type="button"
              onClick={() => setShowCsvImport((v) => !v)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${
                showCsvImport ? "bg-[#00D4B8]/20 text-[#00D4B8]" : "bg-white/5"
              }`}
            >
              <FileUp className="size-3.5" /> Import CSV
            </button>
          </div>
          {showCsvImport && (
            <CredentialCsvImport
              existingCount={
                declared.credentials.filter((c) => c.name.trim() || c.issuer.trim() || c.year.trim())
                  .length
              }
              onClose={() => setShowCsvImport(false)}
              onImport={(rows, mode) => {
                const kept =
                  mode === "append"
                    ? declared.credentials.filter(
                        (c) => c.name.trim() || c.issuer.trim() || c.year.trim(),
                      )
                    : [];
                setDeclared({ ...declared, credentials: [...kept, ...rows] });
                setShowCsvImport(false);
                toast.success(
                  `${rows.length} qualification${rows.length === 1 ? "" : "s"} imported ✨`,
                );
              }}
            />
          )}
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
            placeholder="e.g. Excel, Tally, spoken English, Python, customer support"
            hint="Separate each skill with a comma — short phrases work best (2-3 words)."
            error={skillsError}
            maxLength={MAX_SKILLS_CHARS}
            counter={`${declared.skills.length} / ${MAX_SKILLS} skills`}
            value={declared.skills.join(", ")}
            normalize={(v) => normalizeSkills([v]).join(", ")}
            onChange={(v) =>
              setDeclared({
                ...declared,
                skills: v
                  .split(/[,;|\n•·]/)
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
          {/*
            Job-scam alerts. ONIQ's own words, written from the official
            advisory named at the bottom of the card — the advisory itself is
            linked, never re-hosted.

            Reporting channels show BOTH axes when they differ. Current region
            comes first, because a helpline has to be the one that works from
            where the user is standing: an Indian user in Dubai needs eCrime,
            not 1930. But the market chosen above is the jurisdiction the fake
            employer is claiming, so it is shown too — and showing only the
            first one made the whole panel look frozen when the chips changed.
          */}
          <section className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-rose-200">
              <ShieldAlert className="size-4" /> Before you apply
            </h2>
            <p className="mt-2 text-sm font-semibold text-white/90">{LEAD_WARNING}</p>
            {SCAM_PATTERNS.map((pat) => (
              <div key={pat.id} className="mt-3">
                <h3 className="text-xs font-semibold text-white/80">{pat.title}</h3>
                <ol className="mt-1 list-decimal space-y-0.5 ps-4 text-xs leading-relaxed text-white/55">
                  {pat.steps.map((st) => (
                    <li key={st}>{st}</li>
                  ))}
                </ol>
                <p className="mt-1 text-xs font-medium text-rose-200/90">{pat.tell}</p>
              </div>
            ))}
            {scamGroups.length > 0 && (
              <div className="mt-4 border-t border-white/10 pt-3">
                <h3 className="text-xs font-semibold text-white/80">Report it</h3>
                {scamGroups.map((g) => {
                  const name = COUNTRIES.find((c) => c.code === g.country)?.label ?? g.country;
                  return (
                    <div key={`${g.axis}-${g.country}`} className="mt-2">
                      {/* Say which question each set of numbers answers. Without
                          this the second group looks like a duplicate. */}
                      <p className="text-[11px] text-white/45">
                        {g.axis === "region"
                          ? `Where you are — ${name}`
                          : `Where you're applying — ${name}`}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {g.channels.map((ch) => (
                          <a
                            key={ch.name}
                            href={ch.phone ? `tel:${ch.phone}` : ch.url}
                            target={ch.url ? "_blank" : undefined}
                            rel={ch.url ? "noopener noreferrer" : undefined}
                            className="rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-100"
                          >
                            {ch.name}
                            {ch.phone ? ` · ${ch.phone}` : " ↗"}
                          </a>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {scamGroups.length > 0 && (
              <p className="mt-3 text-[11px] text-white/40">
                Written from guidance published by{" "}
                {scamGroups
                  .map((g) => g.source?.authority)
                  .filter(Boolean)
                  .join(" and ")}
                .{" "}
                {scamGroups.map(
                  (g) =>
                    g.source && (
                      <a
                        key={g.country}
                        href={g.source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="me-2 underline underline-offset-2"
                      >
                        Read the {g.country} original ↗
                      </a>
                    ),
                )}
              </p>
            )}
          </section>

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
            <ul className="mt-2 list-disc space-y-1 ps-4 text-xs leading-relaxed text-white/55">
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

      {/* Include in PDF — switch whole sections on or off */}
      <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
        <h2 className="text-sm font-semibold">Include in PDF</h2>
        <p className="mt-1 text-xs leading-relaxed text-white/50">
          Switch a section off to leave it out of the preview and the exported {cvWord}.
        </p>
        <ul className="mt-3 space-y-2">
          {CV_INCLUDE_KEYS.map((key) => (
            <li
              key={key}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2.5"
            >
              <label htmlFor={`include-${key}`} className="text-sm text-white/85">
                {CV_INCLUDE_LABEL[key]}
              </label>
              <Switch
                id={`include-${key}`}
                checked={include[key]}
                onCheckedChange={(v) => setInclude((prev) => ({ ...prev, [key]: v }))}
              />
            </li>
          ))}
        </ul>
        {CV_INCLUDE_KEYS.some((k) => !include[k]) && (
          <p className="mt-2 text-[11px] text-white/40">
            Left out:{" "}
            {CV_INCLUDE_KEYS.filter((k) => !include[k])
              .map((k) => CV_INCLUDE_LABEL[k])
              .join(", ")}
            .
          </p>
        )}
      </section>

      {/* PDF template — style only; page splits stay exactly the same */}
      <section className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
        <h2 className="text-sm font-semibold">PDF template</h2>
        <p className="mt-1 text-xs leading-relaxed text-white/50">
          Pick a layout style. Spacing and page breaks are identical in every template — only the
          styling changes.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {CV_TEMPLATES.map((t) => {
            const active = t.id === template;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplate(t.id)}
                aria-pressed={active}
                className={`rounded-xl border p-3 text-left ${
                  active
                    ? "border-[#00D4B8] bg-[#00D4B8]/10"
                    : "border-white/10 bg-white/5"
                }`}
              >
                <span className="block text-xs font-semibold text-white">{t.label}</span>
                <span className="mt-1 block text-[11px] leading-relaxed text-white/45">
                  {t.description}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Live preview — reflects what you type, before any AI is involved */}
      <CvLivePreview
        declared={clean}
        cvWord={cvWord}
        order={sectionOrder}
        template={template}
        include={include}
      />


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
              <ul className="mt-1 list-disc ps-4 text-xs text-white/60">
                {r.bullets.map((b, j) => (
                  <li key={j}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
          {generated.credentials.length > 0 && (
            <div className="mt-3 border-t border-white/5 pt-3">
              <p className="text-xs font-semibold text-white/70">Qualifications</p>
              <ul className="mt-1 list-disc ps-4 text-xs text-white/60">
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
              template={template}
              include={include}

              onClose={() => setPreviewing(false)}
            />
          )}
          <p className="mt-3 text-[11px] text-white/40">{AI_OUTPUT_LABEL}</p>
          <AiOutputReport
            surface="cv_ai_output"
            targetId={cvId}
            context={{ target, flagCount: flags.length }}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-xs text-white/70 disabled:opacity-50"
          />
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
    website: t(d.website),
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
      .map((c) => ({
        name: normalizeQualification(c.name),
        issuer: normalizeIssuer(c.issuer),
        year: normalizeYear(c.year),
      })),
    skills: normalizeSkills(d.skills),

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

/** Move a qualification row to an absolute position (drag + keyboard reorder). */
function moveCredentialTo(
  declared: CvDeclared,
  set: (d: CvDeclared) => void,
  from: number,
  to: number,
) {
  if (from === to || to < 0 || to >= declared.credentials.length) return;
  const credentials = [...declared.credentials];
  const [row] = credentials.splice(from, 1);
  credentials.splice(to, 0, row);
  set({ ...declared, credentials });
}

/** Which qualification row sits under the pointer, if any. */
function credIndexAtPoint(x: number, y: number): number | null {
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-cred-index]");
  if (!row) return null;
  const i = Number(row.dataset["credIndex"]);
  return Number.isFinite(i) ? i : null;
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
  hint,
  normalize,
  maxLength,
  counter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  hint?: string;
  /** Optional tidy-up applied when the field loses focus. */
  normalize?: (v: string) => string;
  /** Hard character cap — typing stops here instead of failing validation later. */
  maxLength?: number;
  /** Extra live count shown next to the character count, e.g. "12 / 40 skills". */
  counter?: string;
}) {
  const remaining = maxLength ? maxLength - value.length : null;
  const tight = remaining !== null && remaining <= Math.max(10, Math.round(maxLength! * 0.1));
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between gap-2 text-[11px] text-white/40">
        <span>{label}</span>
        {(counter || remaining !== null) && (
          <span
            aria-live="polite"
            className={
              remaining !== null && remaining <= 0
                ? "text-rose-300"
                : tight
                  ? "text-amber-300"
                  : "text-white/35"
            }
          >
            {[counter, remaining !== null ? `${remaining} left` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </span>
      <textarea
        rows={value.includes("\n") ? 3 : 1}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        onChange={(e) =>
          onChange(maxLength ? e.target.value.slice(0, maxLength) : e.target.value)
        }
        onBlur={() => {
          if (!normalize) return;
          const next = normalize(value);
          if (next !== value) onChange(maxLength ? next.slice(0, maxLength) : next);
        }}
        className={`w-full resize-y rounded-xl border bg-black/30 px-3 py-2 text-sm outline-none ${
          error
            ? "border-rose-400/70 focus:border-rose-400"
            : "border-white/10 focus:border-[#00D4B8]/60"
        }`}
      />

      {error ? (
        <span className="mt-1 block text-[11px] text-rose-300">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-white/35">{hint}</span>
      ) : null}
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
  template,
  include,
}: {
  declared: CvDeclared;
  cvWord: string;
  order?: readonly CvSectionKey[];
  template?: CvTemplateId;
  include?: Partial<CvInclude>;
}) {

  const [showBreaks, setShowBreaks] = useState(true);
  const contact = [declared.email, declared.phone, declared.website, declared.location].filter(
    Boolean,
  );

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
        <>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[11px] text-white/40">
              Dashed lines show where the PDF splits onto the next page.
            </p>
            <button
              type="button"
              onClick={() => setShowBreaks((v) => !v)}
              aria-pressed={showBreaks}
              className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${
                showBreaks ? "bg-[#00D4B8] text-black" : "bg-white/10 text-white/70"
              }`}
            >
              Page breaks
            </button>
          </div>
          <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-white">
          <CvPaper
            order={order}
            template={template}
            include={include}
            pageBreaks={showBreaks}

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
        </>
      )}

    </section>
  );
}
