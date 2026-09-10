#!/usr/bin/env bash
# ONIQ Health — prove the DICOM controls by MUTATION (owner directive
# 2026-09-10, "B and C"; this is B). Each block breaks one control the way a
# careless edit would, runs the tests that stand in front of it, expects RED,
# and restores the file. GREEN means the control can be removed without a test
# noticing. NOTAPPLIED means the anchor went stale and NOTHING was mutated,
# which is not a verdict (health-mutate-guards.sh learned that on 2026-09-09,
# and health-mutate-describe.sh learned it again on 2026-09-10).
#
#   scripts/health-mutate-dicom.sh
#
# Read-only for the repo: every file is restored from a copy. Never run it
# beside the other three mutation scripts — all four edit the same tree.
set -u
MUT_FAIL=0
LOG="$(mktemp)"
BAK="$(mktemp)"
cd "$(dirname "$0")/.."
T=src/health/__tests__
run() { timeout 300 npx vitest run "$@" >"$LOG" 2>&1; echo $?; }
report() { local name=$1 code=$2; if [ "${MUT_FAIL:-0}" = "1" ]; then echo "NOTAPPLIED $name <- the mutation did not apply (stale anchor?); NOT a verdict"; MUT_FAIL=0; elif [ "$code" != "0" ]; then echo "RED   $name (exit $code) <- caught"; else echo "GREEN $name <- ESCAPED"; fi; }
mutate() { python3 - "$@" || MUT_FAIL=1; }

echo "baseline (the whole health suite must be green before any verdict counts): exit $(run src/health)"

# B1: a DICOM becomes text-readable — the scan goes to the AI to be transcribed,
# carrying the burned-in patient name and accession number dicom.ts refuses to
# parse. This is the single most expensive escape in the feature.
F=src/health/domain.ts; cp $F "$BAK"
mutate <<'PY'
p='src/health/domain.ts'; s=open(p).read()
old='''export const TEXT_READABLE_MIMES = [
  "application/pdf",'''
assert s.count(old)==1
s=s.replace(old,'''export const TEXT_READABLE_MIMES = [
  "application/dicom",
  "application/pdf",''')
open(p,'w').write(s)
PY
report "B1 DICOM added to TEXT_READABLE_MIMES" "$(run $T/scanPreview.test.ts $T/dicom.test.ts)"
cp "$BAK" $F

# B2: the sniff reads the start of the file first, so every DICOM whose
# preamble holds a JPEG/PDF header is classified as that instead.
cp $F "$BAK"
mutate <<'PY'
p='src/health/domain.ts'; s=open(p).read()
old='''  if (
    head.length >= 132 &&
    head[128] === 0x44 &&
    head[129] === 0x49 &&
    head[130] === 0x43 &&
    head[131] === 0x4d
  ) {
    return "application/dicom";
  }
'''
assert s.count(old)==1
tail='''  if (
    head.length >= 132 &&
    head[128] === 0x44 &&
    head[129] === 0x49 &&
    head[130] === 0x43 &&
    head[131] === 0x4d
  ) {
    return "application/dicom";
  }
  return null;
}'''
s=s.replace(old,'')
assert s.count('  return null;\n}')>=1
s=s.replace('''  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return "image/png";
  }''','''  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return "image/png";
  }
  if (
    head.length >= 132 &&
    head[128] === 0x44 &&
    head[129] === 0x49 &&
    head[130] === 0x43 &&
    head[131] === 0x4d
  ) {
    return "application/dicom";
  }''',1)
open(p,'w').write(s)
PY
report "B2 DICOM magic checked AFTER the start-of-file magics" "$(run $T/scanPreview.test.ts $T/dicom.test.ts)"
cp "$BAK" $F

# B3: the head is shortened below the magic's offset, so no file ever sniffs
# as DICOM and every scan is refused as an unrecognised type.
cp $F "$BAK"
mutate <<'PY'
p='src/health/domain.ts'; s=open(p).read()
old='export const MIME_HEAD_BYTES = 132;'
assert s.count(old)==1
s=s.replace(old,'export const MIME_HEAD_BYTES = 12;')
open(p,'w').write(s)
PY
report "B3 MIME_HEAD_BYTES shortened past the magic at 128" "$(run $T/scanPreview.test.ts)"
cp "$BAK" $F

# B4: the viewer loses its door — a stored scan has no way to be looked at.
F=src/routes/_authenticated/app.health.records.tsx; cp $F "$BAK"
mutate <<'PY'
p='src/routes/_authenticated/app.health.records.tsx'; s=open(p).read()
old='                  <HealthScanPreview documentId={d.id} />'
assert s.count(old)==1
s=s.replace(old,'                  null')
open(p,'w').write(s)
PY
report "B4 the scan viewer removed from the document row" "$(run $T/scanPreview.test.ts)"
cp "$BAK" $F

# B5: Analyse is offered on a scan — a button whose only outcome is a refusal,
# and the first step towards sending a radiograph to a text pipeline.
cp $F "$BAK"
mutate <<'PY'
p='src/routes/_authenticated/app.health.records.tsx'; s=open(p).read()
old='                    {isTextReadableMime(d.mime) ? ('
assert s.count(old)==1
s=s.replace(old,'                    {true ? (')
open(p,'w').write(s)
PY
report "B5 Analyse ungated (offered on a DICOM)" "$(run $T/scanPreview.test.ts)"
cp "$BAK" $F

# B6: the viewer starts claiming to be an AI surface. False in the other
# direction — nothing here is generated — and it trains people to ignore the
# label where it does mean something.
F=src/health/ScanPreview.tsx; cp $F "$BAK"
mutate <<'PY'
p='src/health/ScanPreview.tsx'; s=open(p).read()
old='          <p className="mt-2 text-sm font-medium">{preview.study.summary}</p>'
assert s.count(old)==1
s=s.replace(old,'          <p className="mt-2 text-sm font-medium">{preview.study.summary}</p>\n          <p>{HEALTH_AI_LABEL}</p>')
open(p,'w').write(s)
PY
report "B6 the viewer labelled AI-assisted" "$(run $T/scanPreview.test.ts)"
cp "$BAK" $F

# B7: the honest line goes — "ONIQ opened my X-ray" then reads as ONIQ having
# checked it.
cp $F "$BAK"
mutate <<'PY'
p='src/health/ScanPreview.tsx'; s=open(p).read()
old='data-testid="health-scan-not-read"'
assert s.count(old)==1
s=s.replace(old,'data-testid="health-scan-footnote"')
open(p,'w').write(s)
PY
report "B7 the 'nobody has checked it' line removed" "$(run $T/scanPreview.test.ts)"
cp "$BAK" $F

# B8: the refusal stops naming the format — "cannot open this scan" with
# nothing after it, which is what gets the same file uploaded five times.
cp $F "$BAK"
mutate <<'PY'
p='src/health/ScanPreview.tsx'; s=open(p).read()
old='      const detail = res.format;'
assert s.count(old)==1
s=s.replace(old,'      const detail = null;')
open(p,'w').write(s)
PY
report "B8 the transfer syntax name dropped from the refusal" "$(run $T/scanPreview.test.ts)"
cp "$BAK" $F

# B9: healthApi stops carrying `format` back, so the diagnostic above is dead
# however carefully the screen reads it.
F=src/health/api.ts; cp $F "$BAK"
mutate <<'PY'
p='src/health/api.ts'; s=open(p).read()
old='      format: str(body.format),\n'
assert s.count(old)==1
s=s.replace(old,'')
old2='      format: str(d.format),\n'
assert s.count(old2)==1
s=s.replace(old2,'')
open(p,'w').write(s)
PY
report "B9 healthApi drops the format field from a refusal" "$(run $T/scanPreview.test.ts)"
cp "$BAK" $F

# B10: the preview's ownership filter goes. The service-role client bypasses
# RLS, so this one line is the whole authorization.
F=supabase/functions/health-api/index.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/health-api/index.ts'; s=open(p).read()
i=s.index('async function actDocumentsPreview')
j=s.index('\nasync function', i+10)
body=s[i:j]
old='    .eq("user_id", ctx.userId)\n'
assert body.count(old)==1
s=s[:i]+body.replace(old,'')+s[j:]
open(p,'w').write(s)
PY
report "B10 documents.preview loses its ownership filter" "$(run $T/scanPreview.test.ts)"
cp "$BAK" $F

# B11: the preview stops being DICOM-only and hands any stored file to the
# renderer.
cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/health-api/index.ts'; s=open(p).read()
old='  if (row.mime !== "application/dicom") {'
assert s.count(old)==1
s=s.replace(old,'  if (false) {')
open(p,'w').write(s)
PY
report "B11 documents.preview accepts any mime" "$(run $T/scanPreview.test.ts)"
cp "$BAK" $F

# B12: confirm stops titling a scan from its header, so the list is a column of
# IM-0001-0001.dcm.
cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/health-api/index.ts'; s=open(p).read()
old='        const summary = describeDicomHeader(parsed.header).slice(0, MAX_TITLE_CHARS);'
assert s.count(old)==1
s=s.replace(old,'        const summary = "";')
open(p,'w').write(s)
PY
report "B12 the header title dropped at documents.confirm" "$(run $T/scanPreview.test.ts)"
cp "$BAK" $F

# B13: the summary stops bounding what the FILE wrote — a megabyte
# StudyDescription becomes the document's title and the image's alt text.
F=supabase/functions/_shared/health/dicom.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/dicom.ts'; s=open(p).read()
old='''function summaryField(raw: string): string {'''
assert s.count(old)==1
s=s.replace(old,'''function summaryField(raw: string): string {
  return raw;''')
open(p,'w').write(s)
PY
report "B13 header strings no longer bounded or flattened" "$(run $T/dicom.test.ts)"
cp "$BAK" $F

# B14: a transfer syntax ONIQ cannot decode is accepted anyway, so the renderer
# reads compressed bytes as raw pixels and shows noise as somebody's X-ray.
cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/dicom.ts'; s=open(p).read()
old='''  if (!known) {
    const name = KNOWN_UNSUPPORTED[transferSyntax] ?? transferSyntax;
    return { ok: false, reason: "unsupported_transfer_syntax", detail: name };
  }
'''
assert s.count(old)==1
s=s.replace(old,'''  if (!known) {
    return { ok: true } as never;
  }
''')
open(p,'w').write(s)
PY
report "B14 an unsupported transfer syntax is not refused" "$(run $T/dicom.test.ts)"
cp "$BAK" $F

# B15: a patient identifier joins READ_TAGS. The whole reason a DICOM never
# reaches the AI is that ONIQ does not read these; reading one here would put
# it in the header, the summary, the title and the alt text at once.
cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/dicom.ts'; s=open(p).read()
old='  modality: "0008,0060",'
assert s.count(old)==1
s=s.replace(old,'  patientName: "0010,0010",\n  modality: "0008,0060",')
open(p,'w').write(s)
PY
report "B15 a patient identifier added to READ_TAGS" "$(run $T/dicom.test.ts)"
cp "$BAK" $F

# B16: a module under ai/ starts importing the DICOM reader. The next natural
# line hands the rendered pixels to the provider, which is C — a different
# provider, a different flag and a medical-device question for counsel.
F=supabase/functions/_shared/health/ai/contract.ts; cp $F "$BAK"
mutate <<'PYB16'
p='supabase/functions/_shared/health/ai/contract.ts'; s=open(p).read()
i=s.index('\nimport ')
s=s[:i]+'\nimport { parseDicom } from "../dicom.ts";\nvoid parseDicom;'+s[i:]
open(p,'w').write(s)
PYB16
report "B16 an ai/ module imports the DICOM reader" "$(run $T/scanPreview.test.ts)"
cp "$BAK" $F

# B17: a seventh AI task that reads a scan image — C arriving without its flag.
F=src/health/ai/types.ts; cp $F "$BAK"
mutate <<'PYB17'
p='src/health/ai/types.ts'; s=open(p).read()
old='export const AI_TASKS = ['
assert s.count(old)==1
s=s.replace(old,'export const AI_TASKS = [\n  "read_scan_image",')
open(p,'w').write(s)
PYB17
report "B17 an AI task that reads a scan image" "$(run $T/scanPreview.test.ts)"
cp "$BAK" $F

echo "done."
