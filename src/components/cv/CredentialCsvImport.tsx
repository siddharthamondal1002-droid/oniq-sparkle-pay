import { useMemo, useRef, useState } from "react";
import { FileUp, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { formatBytes } from "@/config/mediaStorage";
import {
  guessMapping,
  looksLikeHeader,
  parseDelimited,
  rowsToCredentials,
  type CsvColumnKey,
  type ImportedCredential,
} from "@/lib/csvParse";
import {
  MAX_ISSUER_LEN,
  MAX_QUALIFICATION_LEN,
  MAX_YEAR_LEN,
  normalizeIssuer,
  normalizeQualification,
  normalizeYear,
} from "@/lib/cvValidation";

/** See onFile. 2 MB is ~20,000 rows: past any real CV, below anything harmful. */
const MAX_CSV_BYTES = 2 * 1024 * 1024;

const SAMPLE = `Qualification,Board,Year
Class 10,CBSE,2018
Class 12 (Science),CBSE,2020
B.Sc Physics,Delhi University,2020-2023`;

const COLUMN_LABELS: Record<CsvColumnKey, string> = {
  name: "Qualification",
  issuer: "Board / issuer",
  year: "Year",
  ignore: "Skip",
};

function tidy(c: ImportedCredential): ImportedCredential {
  return {
    name: normalizeQualification(c.name).slice(0, MAX_QUALIFICATION_LEN),
    issuer: normalizeIssuer(c.issuer).slice(0, MAX_ISSUER_LEN),
    year: normalizeYear(c.year).slice(0, MAX_YEAR_LEN),
  };
}

export default function CredentialCsvImport({
  existingCount,
  onImport,
  onClose,
}: {
  existingCount: number;
  onImport: (rows: ImportedCredential[], mode: "append" | "replace") => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<CsvColumnKey[] | null>(null);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => (text.trim() ? parseDelimited(text) : []), [text]);
  const width = useMemo(() => Math.max(0, ...rows.map((r) => r.length)), [rows]);
  const autoHeader = useMemo(() => (rows[0] ? looksLikeHeader(rows[0]) : false), [rows]);
  const effectiveMapping = useMemo(
    () => mapping ?? guessMapping(rows, hasHeader),
    [mapping, rows, hasHeader],
  );
  const parsed = useMemo(
    () => rowsToCredentials(rows, effectiveMapping, hasHeader).map(tidy),
    [rows, effectiveMapping, hasHeader],
  );

  function loadText(next: string) {
    setText(next);
    setMapping(null);
    const r = next.trim() ? parseDelimited(next) : [];
    setHasHeader(r[0] ? looksLikeHeader(r[0]) : false);
  }

  /**
   * A CSV of qualifications is a few kilobytes. This cap is not about the
   * honest case.
   *
   * file.text() materialises the WHOLE file as a JavaScript string, and in a
   * Capacitor WebView on a mid-range phone a large one takes the process down
   * with no dialog and no error — the app simply vanishes. Nothing stops
   * someone picking a 2 GB video here by accident, and this was the only
   * genuinely unbounded whole-file read left in the app.
   *
   * 2 MB is roughly 20,000 qualification rows: far past any real CV and far
   * below anything that could hurt.
   */
  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      toast.error(`That file is ${formatBytes(file.size)} — CSV imports are capped at 2 MB`);
      return;
    }
    setFileName(file.name);
    loadText(await file.text());
  }

  function setColumn(index: number, key: CsvColumnKey) {
    const next = Array.from({ length: width }, (_, i) => effectiveMapping[i] ?? "ignore");
    if (key !== "ignore") {
      for (let i = 0; i < next.length; i++) if (next[i] === key) next[i] = "ignore";
    }
    next[index] = key;
    setMapping(next);
  }

  return (
    <div className="mt-3 rounded-xl border border-[#00D4B8]/30 bg-black/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold">
            <FileUp className="size-3.5 text-[#00D4B8]" /> Import qualifications
          </h3>
          <p className="mt-1 text-[11px] text-white/50">
            Paste rows from a spreadsheet, or upload a .csv — one qualification per line.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close import"
          onClick={onClose}
          className="rounded-full bg-white/5 p-1 text-white/50"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => loadText(e.target.value)}
        rows={5}
        spellCheck={false}
        placeholder={SAMPLE}
        aria-label="Paste CSV rows"
        className="mt-3 w-full rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[11px] text-white/90 outline-none placeholder:text-white/25 focus:border-[#00D4B8]/50"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-[11px]"
        >
          <Upload className="size-3.5" /> Upload CSV
        </button>
        <button
          type="button"
          onClick={() => {
            setFileName(null);
            loadText(SAMPLE);
          }}
          className="rounded-full bg-white/5 px-3 py-1.5 text-[11px] text-white/60"
        >
          Use example
        </button>
        {fileName && <span className="text-[11px] text-white/40">{fileName}</span>}
      </div>

      {rows.length > 0 && (
        <>
          <label className="mt-3 flex items-center gap-2 text-[11px] text-white/60">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => {
                setHasHeader(e.target.checked);
                setMapping(null);
              }}
              className="accent-[#00D4B8]"
            />
            First row is a header
            {autoHeader && hasHeader ? " (detected)" : ""}
          </label>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-left text-[11px]">
              <thead>
                <tr>
                  {Array.from({ length: width }, (_, c) => (
                    <th key={c} className="p-1 align-top">
                      <select
                        aria-label={`Column ${c + 1} maps to`}
                        value={effectiveMapping[c] ?? "ignore"}
                        onChange={(e) => setColumn(c, e.target.value as CsvColumnKey)}
                        className="w-full rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white/80 outline-none"
                      >
                        {(Object.keys(COLUMN_LABELS) as CsvColumnKey[]).map((k) => (
                          <option key={k} value={k}>
                            {COLUMN_LABELS[k]}
                          </option>
                        ))}
                      </select>
                      {hasHeader && rows[0]?.[c] && (
                        <span className="mt-1 block truncate text-white/35">{rows[0][c]}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(hasHeader ? rows.slice(1) : rows).slice(0, 4).map((r, i) => (
                  <tr key={i} className="border-t border-white/5">
                    {Array.from({ length: width }, (_, c) => (
                      <td key={c} className="max-w-[160px] truncate p-1 text-white/60">
                        {r[c] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-[11px] text-white/50">
            {parsed.length} row{parsed.length === 1 ? "" : "s"} ready to import
            {parsed.length > 4 ? " (showing first 4)" : ""}.
          </p>

          {existingCount > 0 && (
            <div className="mt-2 flex gap-2">
              {(["append", "replace"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-full px-3 py-1.5 text-[11px] ${
                    mode === m ? "bg-[#00D4B8] text-black" : "bg-white/5 text-white/60"
                  }`}
                >
                  {m === "append" ? "Add to existing" : "Replace existing"}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            disabled={parsed.length === 0}
            onClick={() => onImport(parsed, existingCount > 0 ? mode : "replace")}
            className="mt-3 w-full rounded-full bg-[#00D4B8] px-4 py-2 text-xs font-semibold text-black disabled:opacity-40"
          >
            Import {parsed.length || ""} qualification{parsed.length === 1 ? "" : "s"}
          </button>
        </>
      )}
    </div>
  );
}
