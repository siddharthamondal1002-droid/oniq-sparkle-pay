// Tiny, dependency-free CSV/TSV reader used by the CV qualification importer.
//
// Handles the things people actually paste out of Excel / Google Sheets:
// quoted fields, embedded commas and newlines, doubled quotes ("" -> "),
// CRLF line endings and tab-separated clipboard data.

/** Guess the delimiter from the first non-empty line. */
export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const counts: Array<[string, number]> = [
    [",", (line.match(/,/g) ?? []).length],
    ["\t", (line.match(/\t/g) ?? []).length],
    [";", (line.match(/;/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** Parse delimited text into a rectangular-ish array of rows. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === d) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);

  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c.length > 0));
}

export type CsvColumnKey = "name" | "issuer" | "year" | "ignore";

const HEADER_HINTS: Record<Exclude<CsvColumnKey, "ignore">, RegExp> = {
  name: /(qualification|degree|course|certificate|programme|program|exam|class|title)/i,
  issuer: /(board|university|college|school|issuer|institute|institution|awarded|provider|organisation|organization)/i,
  year: /(year|date|period|from|to|passing|completed)/i,
};

/** True when the first row reads like a header rather than data. */
export function looksLikeHeader(row: string[]): boolean {
  if (row.length === 0) return false;
  const hits = row.filter((c) =>
    Object.values(HEADER_HINTS).some((re) => re.test(c)),
  ).length;
  const hasYearValue = row.some((c) => /^\s*(19|20)\d{2}\b/.test(c));
  return hits >= 1 && !hasYearValue;
}

/**
 * Best-effort column mapping. Uses header names when present, otherwise falls
 * back to shape: a 4-digit year column is the year, first text column is the
 * qualification, second is the issuer.
 */
export function guessMapping(rows: string[][], hasHeader: boolean): CsvColumnKey[] {
  const width = Math.max(...rows.map((r) => r.length), 0);
  const mapping: CsvColumnKey[] = Array.from({ length: width }, () => "ignore");
  const taken = new Set<CsvColumnKey>();

  if (hasHeader && rows[0]) {
    rows[0].forEach((h, i) => {
      for (const key of ["year", "issuer", "name"] as const) {
        if (!taken.has(key) && HEADER_HINTS[key].test(h)) {
          mapping[i] = key;
          taken.add(key);
          return;
        }
      }
    });
  }

  const body = hasHeader ? rows.slice(1) : rows;
  for (let c = 0; c < width; c++) {
    if (mapping[c] !== "ignore") continue;
    const values = body.map((r) => r[c] ?? "").filter(Boolean);
    if (values.length === 0) continue;
    const yearish = values.every((v) => /^(19|20)\d{2}([\s\-–—/]+((19|20)\d{2}|present|current))?$/i.test(v));
    if (yearish && !taken.has("year")) {
      mapping[c] = "year";
      taken.add("year");
    }
  }
  for (let c = 0; c < width; c++) {
    if (mapping[c] !== "ignore") continue;
    const values = body.map((r) => r[c] ?? "").filter(Boolean);
    if (values.length === 0) continue;
    if (!taken.has("name")) {
      mapping[c] = "name";
      taken.add("name");
    } else if (!taken.has("issuer")) {
      mapping[c] = "issuer";
      taken.add("issuer");
    }
  }
  return mapping;
}

export type ImportedCredential = { name: string; issuer: string; year: string };

/** Apply a column mapping to the data rows. */
export function rowsToCredentials(
  rows: string[][],
  mapping: CsvColumnKey[],
  hasHeader: boolean,
): ImportedCredential[] {
  const body = hasHeader ? rows.slice(1) : rows;
  return body
    .map((r) => {
      const pick = (key: CsvColumnKey) => {
        const i = mapping.indexOf(key);
        return i >= 0 ? (r[i] ?? "").trim() : "";
      };
      return { name: pick("name"), issuer: pick("issuer"), year: pick("year") };
    })
    .filter((c) => c.name || c.issuer || c.year);
}
