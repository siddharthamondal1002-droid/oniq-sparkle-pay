// scripts/health-pdf-text-probe.ts — prove the PDF text reader on Deno (Phase 3b).
//
//   deno run --node-modules-dir=none --allow-read --allow-net --allow-env \
//     scripts/health-pdf-text-probe.ts [file.pdf]
//
// `--node-modules-dir=none` because the repo has a package.json, which makes
// Deno look for the package in node_modules (Lovable's, not ours) and stop;
// with it off, Deno fetches the pinned package into its own cache once.
//
// Runs the REAL reader (supabase/functions/_shared/health/ai/pdfText.ts, the
// one module in the health tree that names a third-party package) over a PDF
// generated here with a known text layer, or over the file you name, and
// prints what came back. --allow-net is for Deno's first fetch of the pinned
// npm package; the reader itself is handed bytes and opens no socket. It runs
// no gateway, no provider and no database: the seam is proven live by
// docs/health/07's smoke test, this proves the reader.
import { pdfText } from "../supabase/functions/_shared/health/ai/pdfText.ts";
import { usableText } from "../supabase/functions/_shared/health/ai/textSource.ts";

/** A minimal, valid one-page PDF with a real text layer and a correct xref. */
export function samplePdf(lines: string[]): Uint8Array {
  const content =
    "BT /F1 12 Tf 72 720 Td 16 TL " + lines.map((l) => `(${l}) Tj T*`).join(" ") + " ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

if (import.meta.main) {
  const file = Deno.args[0];
  const bytes = file
    ? await Deno.readFile(file)
    : samplePdf([
        "HbA1c 5.4 %  (01 Sep 2026)",
        "Haemoglobin 13.2 g/dL",
        "Fasting glucose 92 mg/dL",
        "Report: Sample Diagnostics",
      ]);
  const size = bytes.byteLength; // read BEFORE: PDF.js detaches the buffer it is handed
  const started = Date.now();
  const r = await pdfText(bytes);
  console.log(
    JSON.stringify(
      {
        bytes: size,
        pages: r.pages,
        truncated: r.truncated,
        usable: usableText(r.text),
        chars: r.text.length,
        ms: Date.now() - started,
        text: r.text,
      },
      null,
      2,
    ),
  );
  if (!usableText(r.text)) Deno.exit(1);
}
