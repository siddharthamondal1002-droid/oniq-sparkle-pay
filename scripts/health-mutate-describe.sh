#!/usr/bin/env bash
# ONIQ Health — prove the "show it, don't store it" controls by MUTATION
# (owner directive 2026-09-10). Each block breaks one control the way a
# careless edit would, runs the tests that stand in front of it, expects RED,
# and restores the file. GREEN means the control can be removed without a test
# noticing. NOTAPPLIED means the anchor went stale and NOTHING was mutated,
# which is not a verdict (health-mutate-guards.sh learned that on 2026-09-09).
#
#   scripts/health-mutate-describe.sh
#
# Read-only for the repo: every file is restored from a copy. Never run it
# beside health-mutate-guards.sh or health-mutate-enforcement.sh — all three
# edit the same tree.
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

# D1: grounding removed — a description may state any number it likes.
F=supabase/functions/_shared/health/ai/contract.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/contract.ts'; s=open(p).read()
old='''        const printed = documentNumbers(documentText);
        for (const n of [...extractNumbers(norm), ...extractNumberWords(norm)]) {
          if (!printed.has(n)) return refuse("ungrounded_number");
        }
'''
assert s.count(old)==1
s=s.replace(old,'')
open(p,'w').write(s)
PY
report "D1 document_fact grounding removed" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

# D2: the alias spaces mix — a document_fact may cite a record.
cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/contract.ts'; s=open(p).read()
old='      if (!(wantsDocument ? DOC_ALIAS : ALIAS).test(ref))'
assert s.count(old)==1
s=s.replace(old,'      if (!(DOC_ALIAS.test(ref) || ALIAS.test(ref)))')
open(p,'w').write(s)
PY
report "D2 alias spaces mixed (either alias for any class)" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

# D3: the gateway stops handing the document's text to the contract.
F=supabase/functions/_shared/health/ai/gateway.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/gateway.ts'; s=open(p).read()
old='        context.documents[0]?.text ?? "",\n'
assert s.count(old)==1
s=s.replace(old,'')
open(p,'w').write(s)
PY
report "D3 documentText no longer reaches validateAiResponse" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

# D4: the task no longer loads a document at all.
cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/gateway.ts'; s=open(p).read()
old=' || task === "describe_document"'
assert s.count(old)==1
s=s.replace(old,'')
open(p,'w').write(s)
PY
report "D4 describe_document dropped from needsDocument" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

# D5: the audit names the account instead of the document it read.
cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/gateway.ts'; s=open(p).read()
old='      const describedId = task === "describe_document" ? (document?.id ?? null) : null;'
assert s.count(old)==1
s=s.replace(old,'      const describedId: string | null = null;')
open(p,'w').write(s)
PY
report "D5 the described document is not audited" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

# D6: the context builder forgets the task — no document reaches the provider.
F=supabase/functions/_shared/health/ai/context.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/context.ts'; s=open(p).read()
old='    case "describe_document": {\n'
assert s.count(old)==1
s=s.replace(old,'    case "__never_describe_document": {\n')
open(p,'w').write(s)
PY
report "D6 describe_document dropped from buildMinimumContext" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

# D7: an injected document is described instead of refused.
cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/context.ts'; s=open(p).read()
old='        if (task === "describe_document") return { ok: false, reason: "document_rejected" };\n'
assert s.count(old)==1
s=s.replace(old,'')
open(p,'w').write(s)
PY
report "D7 injected document text is described anyway" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

# D8: the cap the task needs to run at all disappears from the migration.
F=supabase/migrations/20260910120000_oniq_health_describe_document_cap.sql; cp $F "$BAK"
mutate <<'PY'
p='supabase/migrations/20260910120000_oniq_health_describe_document_cap.sql'; s=open(p).read()
old=', "describe_document": 10}'
assert s.count(old)==1
s=s.replace(old,'}')
open(p,'w').write(s)
PY
report "D8 describe_document has no cap (caps_unset for everyone)" "$(run $T/ai/describeDocument.test.ts $T/productionCheck.test.ts)"
cp "$BAK" $F

# D9: the receipt's task check is not widened — every request would violate it.
cp $F "$BAK"
mutate <<'PY'
p='supabase/migrations/20260910120000_oniq_health_describe_document_cap.sql'; s=open(p).read()
old=",'describe_document'))"
assert s.count(old)==1
s=s.replace(old,"))")
open(p,'w').write(s)
PY
report "D9 the receipt task check stays closed to five tasks" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

# D10: the update overwrites a cap the owner has already set.
cp $F "$BAK"
mutate <<'PY'
p='supabase/migrations/20260910120000_oniq_health_describe_document_cap.sql'; s=open(p).read()
old="\n   and not (ai_daily_caps ? 'describe_document')"
assert s.count(old)==1
s=s.replace(old,"")
open(p,'w').write(s)
PY
report "D10 the cap update is no longer guarded" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

# D11: the door disappears from the timeline's upload result.
F=src/health/AddReport.tsx; cp $F "$BAK"
mutate <<'PY'
p='src/health/AddReport.tsx'; s=open(p).read()
old='          {nothingFiled ? <HealthReportDescription documentId={nothingFiled} auto /> : null}\n'
assert s.count(old)==1
s=s.replace(old,'')
open(p,'w').write(s)
PY
report "D11 no door on the note that says nothing was filed" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

# D12: the door disappears from every document row.
F=src/routes/_authenticated/app.health.records.tsx; cp $F "$BAK"
mutate <<'PY'
p='src/routes/_authenticated/app.health.records.tsx'; s=open(p).read()
old='                <HealthReportDescription documentId={d.id} auto={nothingFiled === d.id} />\n'
assert s.count(old)==1
s=s.replace(old,'')
open(p,'w').write(s)
PY
report "D12 no door on a stored document" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

# D13: the screen stops saying nothing was stored.
F=src/health/ReportDescription.tsx; cp $F "$BAK"
mutate <<'PY'
p='src/health/ReportDescription.tsx'; s=open(p).read()
old='"health.records.describe.not_stored"'
assert s.count(old)==1
s=s.replace(old,'"health.records.describe.stored_note"')
open(p,'w').write(s)
PY
report "D13 the 'nothing was stored' line is renamed away" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

# D14: the AI-assisted label leaves an AI surface (owner directive B12).
cp $F "$BAK"
mutate <<'PY'
p='src/health/ReportDescription.tsx'; s=open(p).read()
old='          <p className="mt-1 text-[11px] text-muted-foreground">\n            \U0001F916 {t("health.ai.label", HEALTH_AI_LABEL)}\n          </p>\n'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'')
open(p,'w').write(s)
PY
report "D14 the AI-assisted label removed" "$(run $T/ai/describeDocument.test.ts $T/ai/surfaces.test.ts src/data/__tests__/playCompliance.test.ts)"
cp "$BAK" $F

# D15: the deployed function has no HTTP status for the new refusal reason.
# `Record<AiRefusalReason, number>` catches this ONLY under `deno check`, which
# is hand-run and NOT a CI step - this is the mutation that escaped on
# 2026-09-10 until wiring.test.ts stopped sampling three keys.
F=supabase/functions/health-ai/index.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/health-ai/index.ts'; s=open(p).read()
old='  document_rejected: 422,\n'
assert s.count(old)==1
s=s.replace(old,'')
open(p,'w').write(s)
PY
report "D15 no HTTP status for document_rejected" "$(run $T/ai/wiring.test.ts)"
cp "$BAK" $F

# D16-D19: the AUTOMATIC read (owner directive 2026-09-10). The spend shape is
# the risk - `auto` unguarded on the records screen fires one PAID read per
# document the moment the Documents tab mounts, and a render-time call bills
# again on every re-render.
F=src/routes/_authenticated/app.health.records.tsx; cp $F "$BAK"
mutate <<'PY'
p='src/routes/_authenticated/app.health.records.tsx'; s=open(p).read()
old='auto={nothingFiled === d.id}'
assert s.count(old)==1
s=s.replace(old,'auto')
open(p,'w').write(s)
PY
report "D16 every document row reads itself on mount (unguarded auto)" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

cp $F "$BAK"
mutate <<'PY'
p='src/routes/_authenticated/app.health.records.tsx'; s=open(p).read()
old='setNothingFiled(r.ok && r.count === 0 ? d.id : null)'
assert s.count(old)==1
s=s.replace(old,'setNothingFiled(d.id)')
open(p,'w').write(s)
PY
report "D17 Analyse describes even when it DID file readings" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

F=src/health/AddReport.tsx; cp $F "$BAK"
mutate <<'PY'
p='src/health/AddReport.tsx'; s=open(p).read()
old='documentId={nothingFiled} auto'
assert s.count(old)==1
s=s.replace(old,'documentId={nothingFiled}')
open(p,'w').write(s)
PY
report "D18 the upload path stops reading itself" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

F=src/health/ReportDescription.tsx; cp $F "$BAK"
mutate <<'PY'
p='src/health/ReportDescription.tsx'; s=open(p).read()
old='    if (describedRef.current === documentId) return;\n    describedRef.current = documentId;\n'
assert s.count(old)==1
s=s.replace(old,'')
open(p,'w').write(s)
PY
report "D19 the once-per-document ref removed (StrictMode bills twice)" "$(run $T/ai/describeDocument.test.ts)"
cp "$BAK" $F

echo "done."
