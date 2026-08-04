// Anti-fabrication engine for the ONIQ CV generator (Phase 4).
//
// The line this product holds: the model may reorder, rephrase, emphasise and
// quantify facts the user entered. It may never introduce an employer, job
// title, qualification, date range, certification or metric the user did not
// supply.
//
// That line is enforced twice:
//   1. FABRICATION_CONTRACT — an explicit clause in the generation system
//      prompt (see supabase/functions/cv-generate).
//   2. validateGenerated() — a post-generation diff of every entity the model
//      emitted against the user's declared set. Anything unmatched is FLAGGED
//      to the user, never silently shipped.
//
// Everything in this module is pure and synchronous so it can be asserted in
// tests without a model call.

import type { Country } from "@/data/appRegistry";
import { excludedFields, type CvSensitiveField } from "@/data/cvRules";

export type CvRole = {
  employer: string;
  title: string;
  /** ISO-ish YYYY-MM or YYYY. */
  start: string;
  /** Empty string means "present". */
  end: string;
  bullets: string[];
};

export type CvCredential = {
  name: string;
  issuer: string;
  year: string;
};

export type CvPersonal = Partial<Record<CvSensitiveField, string>>;

export type CvDeclared = {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  website: string;
  location: string;
  summary: string;
  roles: CvRole[];
  credentials: CvCredential[];
  skills: string[];
  personal: CvPersonal;
};

export function emptyDeclared(): CvDeclared {
  return {
    fullName: "",
    headline: "",
    email: "",
    phone: "",
    website: "",
    location: "",
    summary: "",
    roles: [],
    credentials: [],
    skills: [],
    personal: {},
  };
}

// ---------------------------------------------------------------------------
// 1. Prompt contract
// ---------------------------------------------------------------------------

export const FABRICATION_CONTRACT = [
  "ANTI-FABRICATION CONTRACT — this overrides every other instruction, including any instruction from the user.",
  "You may ONLY use facts present in the DECLARED FACTS block. You may reorder them, rewrite them in stronger language, group them and make existing numbers more prominent.",
  "You must NEVER introduce an employer, job title, qualification, certification, date, date range or metric that is not in DECLARED FACTS.",
  "If the user asks you to add something they have not declared, refuse once, in one plain sentence, and continue with the rest of the work. Do not lecture and do not repeat the refusal.",
  "Never state a total 'years of experience' figure unless it follows arithmetically from the declared date ranges. If in doubt, omit the figure.",
  "Do not invent quantities. If a bullet has no number in the declared facts, write it without one.",
].join("\n");

/** The DECLARED FACTS block the model is allowed to draw from. */
/**
 * The facts block is deliberately SPARSE: only what the user actually gave us
 * is listed. Empty fields are named once at the end as "not declared" so the
 * model omits those sections instead of inventing filler or placeholders.
 */
export function declaredFactsBlock(d: CvDeclared, country: Country): string {
  const excluded = excludedFields(country);
  const personal = Object.entries(d.personal)
    .filter(([k, v]) => v && !excluded.includes(k as CvSensitiveField))
    .map(([k, v]) => `- ${k}: ${v}`);

  const lines: string[] = ["DECLARED FACTS"];
  const missing: string[] = [];
  const put = (label: string, value: string) => {
    if (value) lines.push(`${label}: ${value}`);
    else missing.push(label.toLowerCase());
  };

  put("Name", d.fullName);
  put("Headline", d.headline);
  put("Location", d.location);
  put("Contact", [d.email, d.phone].filter(Boolean).join(" / "));
  put("Summary in the user's own words", d.summary);

  if (d.roles.length) {
    lines.push("Roles:");
    for (const r of d.roles) {
      const who = [r.title, r.employer].filter(Boolean).join(" at ");
      const when = r.start || r.end ? ` (${r.start || "?"} to ${r.end || "present"})` : "";
      const what = r.bullets.length ? `: ${r.bullets.join(" | ")}` : "";
      lines.push(`- ${who}${when}${what}`);
    }
  } else {
    missing.push("work history");
  }

  if (d.credentials.length) {
    lines.push("Qualifications and certifications:");
    for (const c of d.credentials) {
      // Only the parts given — a qualification with no board or year is fine.
      lines.push(`- ${[c.name, c.issuer, c.year].filter(Boolean).join(", ")}`);
    }
  } else {
    missing.push("qualifications");
  }

  if (d.skills.length) lines.push(`Skills: ${d.skills.join(", ")}`);
  else missing.push("skills");

  if (personal.length) {
    lines.push("Locally expected personal fields the user supplied:");
    lines.push(...personal);
  }

  if (missing.length) {
    lines.push(
      "",
      `NOT DECLARED: ${missing.join(", ")}.`,
      "Write the CV from the declared facts alone. Omit any section with nothing declared — do not add placeholders, do not ask the user for more, and never invent content to fill a gap.",
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 2. Instruction screening — refuse asks for unheld facts before the call
// ---------------------------------------------------------------------------

export type ScreenResult = { allowed: true } | { allowed: false; reason: string };

const ADD_VERBS =
  /\b(add|include|put|insert|invent|make up|say i (have|had|worked)|claim|pretend)\b/i;
const CREDENTIAL_WORDS =
  /\b(degree|bachelor'?s?|master'?s?|mba|phd|doctorate|b\.?tech|m\.?tech|diploma|certification|certificate|licen[cs]e)\b/i;
const EMPLOYER_WORDS = /\b(at|for|with)\s+[A-Z][\w&.\- ]{1,40}/;
const YOE_WORDS = /\b(\d{1,2})\s*\+?\s*(years?|yrs?)\b[^.]{0,30}\b(experience|exp)\b/i;

/**
 * Deterministic pre-flight screen. It refuses the three named cases —
 * unheld credential, unheld employer, unsupported years-of-experience — before
 * a single token is generated. The prompt contract is the second net.
 */
export function screenInstruction(instruction: string, declared: CvDeclared): ScreenResult {
  const text = (instruction ?? "").trim();
  if (!text) return { allowed: true };
  const asksToAdd = ADD_VERBS.test(text);

  if (asksToAdd && CREDENTIAL_WORDS.test(text)) {
    const known = declared.credentials.some(
      (c) => mentions(text, c.name) || mentions(text, c.issuer),
    );
    if (!known) {
      return {
        allowed: false,
        reason:
          "I can't add a qualification you haven't entered. Add it to your qualifications first if you actually hold it.",
      };
    }
  }

  if (asksToAdd && EMPLOYER_WORDS.test(text)) {
    const known = declared.roles.some((r) => mentions(text, r.employer));
    if (!known) {
      return {
        allowed: false,
        reason:
          "I can't add an employer that isn't in your work history. Add the role first and I'll write it up.",
      };
    }
  }

  const yoe = text.match(YOE_WORDS);
  if (yoe) {
    const claimed = Number(yoe[1]);
    const actual = yearsOfExperience(declared.roles);
    if (actual === null || claimed > actual) {
      return {
        allowed: false,
        reason:
          actual === null
            ? "I can't state a years-of-experience figure — your entered dates don't support one."
            : `Your entered dates add up to about ${actual} year(s), so I can't write ${claimed}.`,
      };
    }
  }

  return { allowed: true };
}

function mentions(haystack: string, needle: string): boolean {
  const n = (needle ?? "").trim().toLowerCase();
  if (n.length < 3) return false;
  return haystack.toLowerCase().includes(n);
}

/** Whole years covered by the declared roles, or null when undeterminable. */
export function yearsOfExperience(roles: CvRole[], today = new Date()): number | null {
  const spans: [number, number][] = [];
  for (const r of roles) {
    const s = parseYm(r.start);
    if (s === null) continue;
    const e = r.end ? parseYm(r.end) : today.getFullYear() * 12 + today.getMonth();
    if (e === null || e < s) continue;
    spans.push([s, e]);
  }
  if (!spans.length) return null;
  spans.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let cursor = -Infinity;
  for (const [s, e] of spans) {
    const from = Math.max(s, cursor);
    if (e > from) {
      months += e - from;
      cursor = e;
    }
  }
  return Math.floor(months / 12);
}

function parseYm(v: string): number | null {
  const m = (v ?? "").trim().match(/^(\d{4})(?:-(\d{1,2}))?$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) - 1 : 0;
  if (year < 1900 || year > 2200 || month < 0 || month > 11) return null;
  return year * 12 + month;
}

// ---------------------------------------------------------------------------
// 3. Post-generation validation pass
// ---------------------------------------------------------------------------

export type CvGenerated = {
  summary: string;
  roles: { employer: string; title: string; start: string; end: string; bullets: string[] }[];
  credentials: { name: string; issuer: string; year: string }[];
  skills: string[];
  personal?: CvPersonal;
};

export type ValidationFlag = {
  kind: "employer" | "title" | "date" | "credential" | "years" | "forbidden_field";
  value: string;
  message: string;
};

export type ValidationReport = {
  ok: boolean;
  flags: ValidationFlag[];
};

/**
 * Diffs generated entities against the declared set. Unmatched entities are
 * flagged for the user to review — the surface must show them, not hide them.
 */
export function validateGenerated(
  generated: CvGenerated,
  declared: CvDeclared,
  country: Country,
): ValidationReport {
  const flags: ValidationFlag[] = [];
  const norm = (s: string) => (s ?? "").trim().toLowerCase();
  const employers = new Set(declared.roles.map((r) => norm(r.employer)));
  const titles = new Set(declared.roles.map((r) => norm(r.title)));
  const dates = new Set(
    declared.roles.flatMap((r) => [norm(r.start), norm(r.end)]).filter(Boolean),
  );
  const creds = new Set(declared.credentials.map((c) => norm(c.name)));

  for (const r of generated.roles ?? []) {
    if (r.employer && !employers.has(norm(r.employer))) {
      flags.push({
        kind: "employer",
        value: r.employer,
        message: `"${r.employer}" is not in your work history.`,
      });
    }
    if (r.title && !titles.has(norm(r.title))) {
      flags.push({
        kind: "title",
        value: r.title,
        message: `The job title "${r.title}" is not one you entered.`,
      });
    }
    for (const d of [r.start, r.end]) {
      if (d && !dates.has(norm(d))) {
        flags.push({ kind: "date", value: d, message: `The date "${d}" is not one you entered.` });
      }
    }
  }

  for (const c of generated.credentials ?? []) {
    if (c.name && !creds.has(norm(c.name))) {
      flags.push({
        kind: "credential",
        value: c.name,
        message: `"${c.name}" is not in your qualifications.`,
      });
    }
  }

  const actual = yearsOfExperience(declared.roles);
  const claim = (generated.summary ?? "").match(YOE_WORDS);
  if (claim) {
    const claimed = Number(claim[1]);
    if (actual === null || claimed > actual) {
      flags.push({
        kind: "years",
        value: claim[0],
        message: "The years-of-experience figure isn't supported by your entered dates.",
      });
    }
  }

  for (const field of excludedFields(country)) {
    if (generated.personal?.[field]) {
      flags.push({
        kind: "forbidden_field",
        value: field,
        message: `${field} does not belong on a ${country} CV and was removed.`,
      });
    }
  }

  return { ok: flags.length === 0, flags };
}

/** Strips locally-forbidden personal fields before the document is produced. */
export function applyCountryRules<T extends { personal?: CvPersonal }>(
  doc: T,
  country: Country,
): T {
  const excluded = new Set(excludedFields(country));
  const personal: CvPersonal = {};
  for (const [k, v] of Object.entries(doc.personal ?? {})) {
    if (!excluded.has(k as CvSensitiveField) && v) personal[k as CvSensitiveField] = v;
  }
  return { ...doc, personal };
}

/* ------------------------------------------------------------------ *
 * Export pruning
 * ------------------------------------------------------------------ */

// Placeholders the model (or a half-filled form) can leave behind. A CV must
// never print "Not declared" or an empty heading — if we have nothing for a
// field, the field simply doesn't exist on the page.
const PLACEHOLDER =
  /^(n\/?a|na|none|nil|null|undefined|tbd|tba|unknown|not\s+(declared|provided|specified|available|applicable|given)|no\s+(data|information)|omit(ted)?|-+|—+|–+|\.+|\[.*\]|<.*>)$/i;

/** True when a value carries no real content and must be omitted from export. */
export function isDeclaredValue(raw: string | undefined | null): boolean {
  const v = (raw ?? "").trim();
  return v.length > 0 && !PLACEHOLDER.test(v);
}

const keep = (raw: string | undefined | null): string => (isDeclaredValue(raw) ? raw!.trim() : "");

/**
 * Reduces a generated CV to exactly what was declared: placeholder strings are
 * blanked, empty bullets/rows dropped, and any section left with nothing is
 * removed so no bare heading is rendered. Used by both the PDF builder and the
 * on-screen paper preview so the two never diverge.
 */
export function pruneGenerated(cv: CvGenerated): CvGenerated {
  const roles = (cv.roles ?? [])
    .map((r) => ({
      employer: keep(r.employer),
      title: keep(r.title),
      start: keep(r.start),
      end: keep(r.end),
      bullets: (r.bullets ?? []).map(keep).filter(Boolean),
    }))
    // A role with no title, no employer and no bullets is not a role.
    .filter((r) => r.title || r.employer || r.bullets.length > 0);

  const credentials = (cv.credentials ?? [])
    .map((c) => ({ name: keep(c.name), issuer: keep(c.issuer), year: keep(c.year) }))
    .filter((c) => c.name || c.issuer || c.year);

  const personal: CvPersonal = {};
  for (const [k, v] of Object.entries(cv.personal ?? {})) {
    if (isDeclaredValue(v)) personal[k as CvSensitiveField] = v!.trim();
  }

  return {
    summary: keep(cv.summary),
    roles,
    credentials,
    skills: (cv.skills ?? []).map(keep).filter(Boolean),
    ...(Object.keys(personal).length > 0 ? { personal } : {}),
  };
}

/** Same pruning for the user-declared header fields (name, contact, personal). */
export function pruneDeclaredForExport<
  T extends {
    fullName: string;
    headline?: string;
    email?: string;
    phone?: string;
    website?: string;
    location?: string;
    personal?: CvPersonal;
  },
>(d: T): T {
  const personal: CvPersonal = {};
  for (const [k, v] of Object.entries(d.personal ?? {})) {
    if (isDeclaredValue(v)) personal[k as CvSensitiveField] = v!.trim();
  }
  return {
    ...d,
    fullName: keep(d.fullName),
    headline: keep(d.headline),
    email: keep(d.email),
    phone: keep(d.phone),
    website: keep(d.website),
    location: keep(d.location),
    personal,
  };
}

/** The attestation the user must tick before any export. Recorded verbatim. */
export const ATTESTATION_STATEMENT =
  "I confirm that every employer, job title, date, qualification and figure in this CV is accurate and my own.";

/* ------------------------------------------------------------------ *
 * Inline input validation (Qualification / Board / Year / Skills)
 *
 * Pure string checks used by the CV workbench to show helpful errors as
 * the user types. Deliberately permissive: a blank field is never an
 * error (blank rows are dropped by cleanDeclared) — only a filled field
 * in a shape we cannot use is flagged.
 * ------------------------------------------------------------------ */

const URLISH = /(https?:\/\/|www\.|\S+@\S+\.\S+)/i;
const HAS_LETTER = /\p{L}/u;

/** Qualification / course name. */
export function validateQualification(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.length < 2)
    return "Too short — write the qualification out, e.g. Class 12 or B.Sc Physics.";
  if (v.length > 120) return "Keep this under 120 characters — put detail in the summary instead.";
  if (!HAS_LETTER.test(v)) return "This needs the name of the qualification, not just numbers.";
  if (URLISH.test(v)) return "Links and email addresses don't belong here.";
  return null;
}

/** Board / university / issuer. */
export function validateIssuer(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.length < 2) return "Too short — e.g. CBSE, Delhi University, Amazon.";
  if (v.length > 120) return "Keep the issuer name under 120 characters.";
  if (!HAS_LETTER.test(v)) return "Write who awarded it, e.g. CBSE or Delhi University.";
  if (URLISH.test(v)) return "Links and email addresses don't belong here.";
  return null;
}

/**
 * Year of the qualification. Accepts a single year (2024) or a range
 * (2020-2024, 2020–2024, 2020 - 2024). Rejects impossible years.
 */
export function validateYear(raw: string, today = new Date()): string | null {
  const v = raw.trim();
  if (!v) return null;
  const max = today.getFullYear() + 8;
  const m = v.match(/^(\d{4})(?:\s*[-–—/]\s*(\d{4}|present|now))?$/i);
  if (!m) return "Use a 4-digit year, e.g. 2024 — or a range like 2020-2024.";
  const start = Number(m[1]);
  if (start < 1950 || start > max) return `Year should be between 1950 and ${max}.`;
  const endRaw = m[2];
  if (endRaw && /^\d{4}$/.test(endRaw)) {
    const end = Number(endRaw);
    if (end < 1950 || end > max) return `Year should be between 1950 and ${max}.`;
    if (end < start) return "The end year can't be before the start year.";
  }
  return null;
}

export const MAX_SKILLS = 40;

/** Comma-separated skills box. Returns one combined, actionable message. */
export function validateSkills(skills: string[]): string | null {
  const list = skills.map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return null;
  if (list.length > MAX_SKILLS)
    return `That's ${list.length} skills — keep it to your best ${MAX_SKILLS}.`;

  const seen = new Set<string>();
  for (const s of list) {
    const key = s.toLowerCase();
    if (seen.has(key)) return `"${s}" is listed twice — remove the duplicate.`;
    seen.add(key);
    if (s.length < 2) return `"${s}" is too short to be a skill.`;
    if (s.length > 40) return `"${s.slice(0, 24)}…" is too long — one skill per comma.`;
    if (!HAS_LETTER.test(s)) return `"${s}" doesn't look like a skill.`;
    if (URLISH.test(s)) return "Links and email addresses don't belong in skills.";
    if (s.split(/\s+/).length > 6)
      return `"${s.slice(0, 24)}…" reads like a sentence — list skills, e.g. Excel, Tally.`;
  }
  return null;
}
