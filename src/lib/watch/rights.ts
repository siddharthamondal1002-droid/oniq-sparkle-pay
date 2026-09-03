/**
 * Rights metadata for Internet Archive items — read, classified, never assumed.
 *
 * Owner mission, 2026-09-03: distinguish public domain, Creative Commons /
 * openly licensed, other explicitly permitted reuse, and rights unclear. An
 * item hosted on the Archive is not thereby free to reuse, and a film is not
 * public domain because it is old. The classification below only ever moves
 * an item OUT of "unknown" on the strength of the source's own licence or
 * rights fields; nothing else counts.
 *
 * For watching, "unknown" changes nothing — the Archive's own player serves
 * it as it serves everything. For any ONIQ creation or reuse workflow, only
 * `reuse: true` items may be offered, and the label says why.
 */
export type RightsClass = "public_domain" | "creative_commons" | "permitted" | "unknown";

export type Rights = {
  class: RightsClass;
  /** The licence URL the source published, verbatim, when it published one. */
  licenseUrl: string | null;
  /** Which field the classification came from. */
  source: string | null;
  /** True only when the source's own metadata supports reuse. */
  reuse: boolean;
  /** Short, honest label for the card. */
  label: string;
  checkedAt: string;
};

export const RIGHTS_LABEL: Record<RightsClass, string> = {
  public_domain: "Public domain",
  creative_commons: "Creative Commons",
  permitted: "Reuse permitted by source",
  unknown: "Rights unclear",
};

export type ArchiveRightsInput = {
  licenseurl?: string | string[] | null;
  rights?: string | string[] | null;
  /** archive.org's own field name is possible-copyright-status. */
  possibleCopyrightStatus?: string | string[] | null;
};

function first(v: string | string[] | null | undefined): string {
  if (Array.isArray(v)) return String(v[0] ?? "").trim();
  return String(v ?? "").trim();
}

/** Classify from the Archive's metadata fields. Conservative by construction. */
export function classifyArchiveRights(meta: ArchiveRightsInput, now: Date = new Date()): Rights {
  const checkedAt = now.toISOString();
  const license = first(meta.licenseurl).toLowerCase();
  const rightsText = `${first(meta.rights)} ${first(meta.possibleCopyrightStatus)}`.toLowerCase();

  if (license) {
    if (/creativecommons\.org\/publicdomain\/(zero|mark)/.test(license)) {
      return {
        class: "public_domain",
        licenseUrl: first(meta.licenseurl),
        source: "licenseurl",
        reuse: true,
        label: RIGHTS_LABEL.public_domain,
        checkedAt,
      };
    }
    if (/creativecommons\.org\/licenses\//.test(license)) {
      // Any CC licence permits watching and sharing; NC/ND terms limit what a
      // creation workflow may do with it, so the label carries the terms.
      const terms = license.match(/licenses\/([a-z-]+)\//)?.[1] ?? "";
      return {
        class: "creative_commons",
        licenseUrl: first(meta.licenseurl),
        source: "licenseurl",
        reuse: true,
        label: terms ? `Creative Commons ${terms.toUpperCase()}` : RIGHTS_LABEL.creative_commons,
        checkedAt,
      };
    }
  }
  if (/\bpublic domain\b|\bnot[_ ]in[_ ]copyright\b/.test(rightsText)) {
    return {
      class: "public_domain",
      licenseUrl: first(meta.licenseurl) || null,
      source: meta.possibleCopyrightStatus ? "possible-copyright-status" : "rights",
      reuse: true,
      label: RIGHTS_LABEL.public_domain,
      checkedAt,
    };
  }
  if (/\b(free to (re)?use|reuse permitted|no known restrictions)\b/.test(rightsText)) {
    return {
      class: "permitted",
      licenseUrl: first(meta.licenseurl) || null,
      source: "rights",
      reuse: true,
      label: RIGHTS_LABEL.permitted,
      checkedAt,
    };
  }
  return {
    class: "unknown",
    licenseUrl: first(meta.licenseurl) || null,
    source: null,
    reuse: false,
    label: RIGHTS_LABEL.unknown,
    checkedAt,
  };
}

/** Read a stored rights blob defensively; anything malformed reads as unknown. */
export function rightsFromStored(value: unknown): Rights | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<Rights>;
  const cls: RightsClass =
    v.class === "public_domain" ||
    v.class === "creative_commons" ||
    v.class === "permitted" ||
    v.class === "unknown"
      ? v.class
      : "unknown";
  return {
    class: cls,
    licenseUrl: typeof v.licenseUrl === "string" ? v.licenseUrl : null,
    source: typeof v.source === "string" ? v.source : null,
    reuse: cls !== "unknown" && v.reuse === true,
    label: typeof v.label === "string" && v.label ? v.label : RIGHTS_LABEL[cls],
    checkedAt: typeof v.checkedAt === "string" ? v.checkedAt : "",
  };
}

/** What the card says under the label, so nobody reads "hosted" as "owned". */
export function rightsNote(r: Rights | null): string {
  if (!r) return "Rights not checked yet. Hosting on the Archive does not establish permission.";
  switch (r.class) {
    case "public_domain":
      return "Marked public domain by its source record.";
    case "creative_commons":
      return "Openly licensed by its source record; the licence's terms apply.";
    case "permitted":
      return "The source record permits reuse.";
    default:
      return "Watch it here; do not assume it may be reused.";
  }
}
