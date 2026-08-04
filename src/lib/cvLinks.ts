// Turns declared contact details into real, clickable targets for the PDF and
// the on-screen paper preview. Pure string work — no network, no validation
// beyond "can this plausibly be a link", so a half-typed field never breaks
// the export; it just prints as plain text.

export type CvContactKind = "email" | "phone" | "website" | "text";

export type CvContactPart = {
  kind: CvContactKind;
  /** What is printed on the page. */
  text: string;
  /** Where a tap/click goes; undefined means "print as plain text". */
  href?: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** mailto: target, or undefined when the value isn't an address. */
export function emailHref(raw?: string): string | undefined {
  const v = (raw ?? "").trim();
  return EMAIL.test(v) ? `mailto:${v}` : undefined;
}

/** tel: target. Dial strings keep a leading + and digits only. */
export function phoneHref(raw?: string): string | undefined {
  const v = (raw ?? "").trim();
  if (!v) return undefined;
  const plus = v.startsWith("+");
  const digits = v.replace(/\D/g, "");
  if (digits.length < 6) return undefined;
  return `tel:${plus ? "+" : ""}${digits}`;
}

/** https:// target for a website, accepting bare domains like "site.com". */
export function websiteHref(raw?: string): string | undefined {
  const v = (raw ?? "").trim();
  if (!v || /\s/.test(v)) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return `https://${v}`;
  return undefined;
}

/** The header contact line, split into printable + linkable parts. */
export function contactParts(d: {
  email?: string;
  phone?: string;
  website?: string;
  location?: string;
}): CvContactPart[] {
  const parts: CvContactPart[] = [];
  const push = (kind: CvContactKind, value?: string, href?: string) => {
    const text = (value ?? "").trim();
    if (text) parts.push(href ? { kind, text, href } : { kind, text });
  };
  push("email", d.email, emailHref(d.email));
  push("phone", d.phone, phoneHref(d.phone));
  push("website", d.website, websiteHref(d.website));
  push("text", d.location);
  return parts;
}

/** Separator printed between contact parts, shared by the PDF and preview. */
export const CONTACT_SEP = "  ·  ";
