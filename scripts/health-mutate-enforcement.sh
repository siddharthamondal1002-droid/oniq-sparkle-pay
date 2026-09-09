#!/usr/bin/env bash
# ONIQ Health — prove the ENFORCEMENT by MUTATION (Phase 4, owner directive
# 2026-09-09 §16). Each block below breaks one control the way a careless
# edit would, runs the tests that are supposed to stand in front of that
# control, expects RED, and restores the file. A GREEN line means a control
# can be removed without a test noticing — the finding this script exists to
# produce. NOTAPPLIED means the anchor went stale and nothing was mutated,
# which is NOT a verdict (scripts/health-mutate-guards.sh learned that on
# 2026-09-09).
#
#   scripts/health-mutate-enforcement.sh
#
# Read-only for the repo: every file is restored from a copy. Never run it
# beside health-mutate-guards.sh — both edit the same tree.
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

# E1: consent bypass — checkConsent allows every category.
F=supabase/functions/_shared/health/ai/policy.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/policy.ts'; s=open(p).read()
old='''  const ids = new Set<string>();
  for (const category of categories) {'''
assert s.count(old)==1
s=s.replace(old, '''  const ids = new Set<string>();
  if (categories.length >= 0) return { allowed: true, purpose: AI_PURPOSE, consentIds: [] };
  for (const category of categories) {''')
open(p,'w').write(s)
PY
report "E1 consent bypass (checkConsent always allows)" "$(run $T/ai/gateway.test.ts $T/ai/redteamAuthz.test.ts $T/ai/policy.test.ts)"
cp "$BAK" $F

# E2: caps bypass — the gateway ignores a refused reservation.
F=supabase/functions/_shared/health/ai/gateway.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/gateway.ts'; s=open(p).read()
old='''    if (!reserved.ok) return refusedWith(reserved.reason, undefined, manifest);
    receiptId = reserved.id;'''
assert s.count(old)==1
s=s.replace(old, '''    receiptId = reserved.ok ? reserved.id : "receipt-forced";''')
open(p,'w').write(s)
PY
report "E2 caps bypass (a refused reservation is ignored)" "$(run $T/ai/gateway.test.ts $T/ai/reserve.test.ts $T/ai/hierarchy.test.ts)"
cp "$BAK" $F

# E3: kill switch — flagsFromRow no longer forces the AI flags off.
F=supabase/functions/_shared/health/flags.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/flags.ts'; s=open(p).read()
old='''  if (aiKillSwitchFromRow(row)) {
    out["health.ai.enabled"] = false;
    out["health.provider_sharing.enabled"] = false;
  }'''
assert s.count(old)==1
s=s.replace(old, '''  void aiKillSwitchFromRow(row);''')
open(p,'w').write(s)
PY
report "E3 kill switch not enforced by flagsFromRow" "$(run $T/flags.test.ts $T/ai/hierarchy.test.ts)"
cp "$BAK" $F

# E4: change the user id — the deployed Store loads a record without the ownership filter.
F=supabase/functions/health-ai/index.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/health-ai/index.ts'; s=open(p).read()
old='''        .select(RECORD_COLUMNS)
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();'''
assert s.count(old)==1
s=s.replace(old, '''        .select(RECORD_COLUMNS)
        .eq("id", id)
        .maybeSingle();''')
open(p,'w').write(s)
PY
report "E4 ownership filter dropped from loadRecord (health-ai)" "$(run $T/ai/wiring.test.ts $T/ai/redteamAuthz.test.ts)"
cp "$BAK" $F

# E5: provider validation removed — providerFor trusts any id.
F=supabase/functions/_shared/health/ai/provider.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/provider.ts'; s=open(p).read()
old='''  if (!isProviderId(id)) throw new Error("provider_not_allowed");
  const provider = PROVIDER_REGISTRY[id]();'''
assert s.count(old)==1
s=s.replace(old, '''  const provider = (PROVIDER_REGISTRY[id as ProviderId] ?? PROVIDER_REGISTRY.vertex)();''')
# BOTH guards, or the second one catches the first's removal and the verdict
# says "caught" about a hole that was never opened (measured 2026-09-09).
guard='''  if (provider.id !== id || provider.recipient !== RECIPIENT_FOR_PROVIDER[id]) {
    throw new Error("provider_not_allowed");
  }'''
assert s.count(guard)==1
s=s.replace(guard, '''  void RECIPIENT_FOR_PROVIDER;''')
open(p,'w').write(s)
PY
report "E5 provider validation removed (unknown id resolves to vertex)" "$(run $T/anthropicRetired.test.ts $T/ai/isolation.test.ts $T/ai/redteamAuthz.test.ts)"
cp "$BAK" $F

# E6: the audit write removed from every refusal.
F=supabase/functions/_shared/health/ai/gateway.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/gateway.ts'; s=open(p).read()
old='''    await audit({
      action: "ai.refused",
      objectType: "account",
      outcome: "refused",
      detail: {
        task: String(req.task),'''
assert s.count(old)==1
s=s.replace(old, '''    if (Math.random() > 2) await audit({
      action: "ai.refused",
      objectType: "account",
      outcome: "refused",
      detail: {
        task: String(req.task),''')
open(p,'w').write(s)
PY
report "E6 audit write removed from refusals" "$(run $T/ai/gateway.test.ts $T/ai/hierarchy.test.ts $T/ai/redteamSpend.test.ts)"
cp "$BAK" $F

# E7: storage authz weakened — a signed read URL for any document id.
F=supabase/functions/health-api/index.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/health-api/index.ts'; s=open(p).read()
old='''    .select("id, storage_path, kind")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .in("status", ["stored", "processing", "ready"])
    .maybeSingle();'''
assert s.count(old)==1
s=s.replace(old, '''    .select("id, storage_path, kind")
    .eq("id", id)
    .in("status", ["stored", "processing", "ready"])
    .maybeSingle();''')
open(p,'w').write(s)
PY
report "E7 storage authz weakened (documents.url without the owner filter)" "$(run $T/wiring.test.ts $T/ai/redteamAuthz.test.ts)"
cp "$BAK" $F

# E8: the chain numbers rows OUTSIDE the lock again (the 2026-09-09 race).
F=supabase/migrations/20260909130000_oniq_health_audit_seq_under_lock.sql; cp $F "$BAK"
mutate <<'PY'
p='supabase/migrations/20260909130000_oniq_health_audit_seq_under_lock.sql'; s=open(p).read()
old='''  perform pg_advisory_xact_lock(7700000000000020);
  select seq, record_hash into last_seq, p from public.health_audit order by seq desc limit 1;
  new.seq := coalesce(last_seq, 0) + 1;'''
assert s.count(old)==1
s=s.replace(old, '''  select seq into last_seq from public.health_audit order by seq desc limit 1;
  new.seq := coalesce(last_seq, 0) + 1;
  perform pg_advisory_xact_lock(7700000000000020);
  select record_hash into p from public.health_audit order by seq desc limit 1;''')
open(p,'w').write(s)
PY
report "E8 audit chain ordering altered (seq assigned before the lock)" "$(run $T/auditChainSeqUnderLock.test.ts)"
cp "$BAK" $F

# E9: minimum-necessary filtering bypassed — a summary carries every note.
F=supabase/functions/_shared/health/ai/context.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/context.ts'; s=open(p).read()
old='''  summarize_timeline: [...RECORD_BASE],'''
assert s.count(old)==1
s=s.replace(old, '''  summarize_timeline: [...RECORD_BASE, "valueText"],''')
old2='''      isTarget ? fields : fields.filter((f) => f !== "valueText"),'''
assert s.count(old2)==1
s=s.replace(old2, '''      fields,''')
open(p,'w').write(s)
PY
report "E9 minimum-necessary bypassed (notes travel on every row of a summary)" "$(run $T/ai/minimumNecessary.test.ts $T/ai/context.test.ts)"
cp "$BAK" $F

# E10: safety validation disabled — the contract accepts everything.
F=supabase/functions/_shared/health/ai/contract.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/contract.ts'; s=open(p).read()
old='''): ContractVerdict {
  if (!raw || typeof raw !== "object") return refuse("not_an_object");
  const r = raw as Partial<AiResponse>;'''
assert s.count(old)==1
s=s.replace(old, '''): ContractVerdict {
  if (raw !== null) return { ok: true };
  const r = raw as Partial<AiResponse>;''')
open(p,'w').write(s)
PY
report "E10 safety validation disabled (validateAiResponse accepts everything)" "$(run $T/ai/contract.test.ts $T/ai/redteamInjection.test.ts $T/ai/gateway.test.ts)"
cp "$BAK" $F

# E11: the reservation loses its lock (count-then-insert, racy again).
F=supabase/migrations/20260909150000_oniq_health_phase4_hardening.sql; cp $F "$BAK"
mutate <<'PY'
p='supabase/migrations/20260909150000_oniq_health_phase4_hardening.sql'; s=open(p).read()
old='''  perform pg_advisory_xact_lock(7700000000000030);
'''
assert s.count(old)==1
s=s.replace(old, '')
open(p,'w').write(s)
PY
report "E11 reservation without its lock (SQL)" "$(run $T/ai/reserve.test.ts $T/productionCheck.test.ts)"
cp "$BAK" $F

# E12: grounding removed — a model's values are stored as returned. With no
# confirm step in front of the timeline this is the most dangerous escape here.
F=supabase/functions/_shared/health/ai/gateway.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/gateway.ts'; s=open(p).read()
old='''    const candidates = grounded.kept;'''
assert s.count(old)==1
s=s.replace(old, '''    const candidates = verdict.value.candidates;''')
open(p,'w').write(s)
PY
report "E12 page grounding removed (values stored as the provider returned them)" "$(run $T/ai/grounding.test.ts $T/ai/documentRedteam.test.ts)"
cp "$BAK" $F

# E13: an UNSAFE retry — a timeout is retried, so a served-and-billed call can run twice.
F=supabase/functions/_shared/health/ai/vertex.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/vertex.ts'; s=open(p).read()
old='''    let res = await this.send(url, headers, body, timeoutMs);
    for (let attempt = 2; attempt <= VERTEX_MAX_ATTEMPTS; attempt++) {'''
assert s.count(old)==1
s=s.replace(old, '''    let res: VertexHttpResult;
    try {
      res = await this.send(url, headers, body, timeoutMs);
    } catch {
      res = await this.send(url, headers, body, timeoutMs);
    }
    for (let attempt = 2; attempt <= VERTEX_MAX_ATTEMPTS; attempt++) {''')
open(p,'w').write(s)
PY
report "E13 unsafe retry (a timeout is sent again)" "$(run $T/ai/vertexRetry.test.ts)"
cp "$BAK" $F

# E14: the append-only trigger removed from the migration.
F=supabase/migrations/20260909150000_oniq_health_phase4_hardening.sql; cp $F "$BAK"
mutate <<'PY'
p='supabase/migrations/20260909150000_oniq_health_phase4_hardening.sql'; s=open(p).read()
old='''create trigger health_audit_immutable_before_change
  before update or delete on public.health_audit
  for each row execute function public.health_audit_immutable();'''
assert s.count(old)==1
s=s.replace(old, '''-- (trigger removed)''')
open(p,'w').write(s)
PY
report "E14 append-only audit trigger removed (SQL)" "$(run $T/auditImmutable.test.ts)"
cp "$BAK" $F

# E15: the language guard removed from the gateway.
F=supabase/functions/_shared/health/ai/gateway.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/gateway.ts'; s=open(p).read()
old='''  if (!(AI_LANGUAGES as readonly string[]).includes(language)) {
    return refusedWith("question_rejected", { field: "language" });
  }'''
assert s.count(old)==1
s=s.replace(old, '')
open(p,'w').write(s)
PY
report "E15 language guard removed (an out-of-list language reaches the provider)" "$(run $T/ai/redteamInjection.test.ts)"
cp "$BAK" $F

# E16: the injection detector no longer runs the Hindi and Bengali lists on every language.
F=supabase/functions/_shared/health/ai/scrub.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/health/ai/scrub.ts'; s=open(p).read()
old='''const EVERY: readonly InjectionGroup[] = [...EN, ...nfkc(SCRIPTS), ...nfkc(HI), ...nfkc(BN)];'''
assert s.count(old)==1
s=s.replace(old, '''const EVERY: readonly InjectionGroup[] = [...EN, ...nfkc(SCRIPTS)];''')
open(p,'w').write(s)
PY
report "E16 Hindi/Bengali injection lists no longer run under an English request" "$(run $T/ai/documentRedteam.test.ts)"
cp "$BAK" $F

# E17: extracted values go back to waiting as candidates — the one-action flow
# silently stops working and a person sees nothing in their timeline.
F=supabase/functions/health-ai/index.ts; cp $F "$BAK"
mutate <<'PY'
p = 'supabase/functions/health-ai/index.ts'
s = open(p).read()
old = '        status: "active",'
assert s.count(old) == 1
s = s.replace(old, '        status: "candidate",')
open(p, 'w').write(s)
PY
report "E17 extracted values no longer reach the timeline (status back to candidate)" "$(run $T/ai/wiring.test.ts)"
cp "$BAK" $F

echo "restored: $(git status --short supabase src scripts | wc -l | tr -d ' ') files differ from HEAD (should equal the count before this script ran)"
rm -f "$LOG" "$BAK"
