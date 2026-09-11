#!/usr/bin/env bash
# The 2026-09-11 dispatch-outage fixes, proven by MUTATION.
#
# Two defects, both found by putting a real production outage in front of code
# that was green:
#
#   D1  OQCA ranked a severity-1.0 live outage 14th of 18, because acting on it
#       needed an UNAUTHORIZED capability. "ONIQ may not fix this" was being
#       read as "this does not matter", so the outage could never be selected
#       and `capability_blocked` could never name it.
#   D2  story-sweep could not expire a queued film during a dispatch outage.
#       `dispatched_at` is stamped before the GitHub call and the row trigger
#       sets `updated_at` on every write, so the failing retry loop refreshed
#       the very clock the expiry read.
#
# Each block breaks one control the way a careless edit would, runs the tests in
# front of it, expects RED, and restores the file. GREEN means the control can
# be removed without a test noticing. NOTAPPLIED means the anchor went stale and
# NOTHING was mutated, which is not a verdict.
#
#   scripts/dispatch-fix-mutate.sh
#
# Read-only for the repo: every file is restored from a copy.
set -u
MUT_FAIL=0
LOG="$(mktemp)"
BAK="$(mktemp)"
cd "$(dirname "$0")/.."
RANK=src/oqca/__tests__/capabilityRanking.test.ts
SWEEP=src/lib/__tests__/storyLifecycle.test.ts
run() { timeout 300 npx vitest run "$@" >"$LOG" 2>&1; echo $?; }
report() {
  local name=$1 code=$2
  if [ "${MUT_FAIL:-0}" = "1" ]; then
    echo "NOTAPPLIED $name <- the mutation did not apply (stale anchor?); NOT a verdict"
    MUT_FAIL=0
  elif [ "$code" != "0" ]; then
    echo "RED   $name (exit $code) <- caught"
  else
    echo "GREEN $name <- ESCAPED"
  fi
}
mutate() { python3 - "$@" || MUT_FAIL=1; }
# The kernel is mirrored into supabase/functions/_shared/oqca; a mutation that
# reaches only src/ changes nothing some tests can see (oqca-mutate.sh, 2026-09-10).
mirror() { node scripts/oqca-mirror.mjs >/dev/null 2>&1; }
restore() { cp "$BAK" "$1"; mirror; }

echo "baseline (must be green before any verdict counts): exit $(run "$RANK" "$SWEEP")"

# ---------------------------------------------------------------- D1: ranking

# R1: the planner stops distinguishing who can clear a shortfall. Every refusal
# becomes proportional again, so a fault only a person can fix sinks to the
# floor and is never selected.
F=src/oqca/loop/capability.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/capability.ts'; s=open(p).read()
old='  return PERSON_CLEARED.includes(a);'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,'  return false;'))
PY
mirror; report "R1 needsAPerson always false" "$(run "$RANK")"; restore $F

# R2: the escalation factor drops back to the modifier floor. This is the exact
# pre-fix number, so the outage returns to 14th of 18.
F=src/oqca/autonomy/improve.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/autonomy/improve.ts'; s=open(p).read()
old='export const ESCALATION_CAPABILITY = 0.5;'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,'export const ESCALATION_CAPABILITY = MODIFIER_FLOOR;'))
PY
mirror; report "R2 escalation back to the floor" "$(run "$RANK")"; restore $F

# R3: dependencies goes back to measuring the same list capability reads, so one
# shortfall is discounted twice and silence is punished harder than a refusal.
F=src/oqca/autonomy/improve.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/autonomy/improve.ts'; s=open(p).read()
old='    dependencies: 1,'
assert s.count(old)==1, s.count(old)
new=('    dependencies: need.needs.length === 0 ? 1 : Math.max(\n'
     '      need.needs.filter((n) => byName.has(n)).length / need.needs.length,\n'
     '      MODIFIER_FLOOR,\n'
     '    ),')
open(p,'w').write(s.replace(old,new))
PY
mirror; report "R3 the double penalty returns" "$(run "$RANK")"; restore $F

# R4: the host stops reporting what its own registry already knows. An
# unauthorized kind is then unobservable by construction — nothing may attempt
# it, so nothing reports it — and the cold-start deadlock is back.
F=supabase/functions/_shared/oqcaRuntime/selfModel.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/selfModel.ts'; s=open(p).read()
old='export function registryCapabilityStates(): readonly CapabilityState[] {'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old, old+'\n  return [];'))
PY
report "R4 the registry reports nothing" "$(run "$RANK")"; cp "$BAK" $F

# R5: the host CLAIMS a resource is available from a table rather than from an
# observation — fabricating the one thing only an episode can establish.
F=supabase/functions/_shared/oqcaRuntime/selfModel.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/selfModel.ts'; s=open(p).read()
old='    if (caps.some((c) => c.authorized)) continue;'
assert s.count(old)==1, s.count(old)
new=('    if (caps.some((c) => c.authorized)) {\n'
     '      out.push({ capability: resource, availability: "available", detail: "authorized",'
     ' bound: null, station: null });\n'
     '      continue;\n'
     '    }')
open(p,'w').write(s.replace(old,new))
PY
report "R5 the table fabricates 'available'" "$(run "$RANK")"; cp "$BAK" $F

# ------------------------------------------------------------------ D2: sweep

# S1: the abandoned clause is removed. Only the updated_at clock remains, which
# the failing dispatcher refreshes — the exact pre-fix state.
F=supabase/functions/story-sweep/index.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/story-sweep/index.ts'; s=open(p).read()
old='        `and(status.eq.queued,created_at.lt.${abandonedBefore}),` +\n'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,''))
PY
report "S1 the abandoned clause deleted" "$(run "$SWEEP")"; cp "$BAK" $F

# S2: the abandoned clause reads updated_at instead of created_at — the shape
# that LOOKS like a second guard and is defeated by the same retry loop.
F=supabase/functions/story-sweep/index.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/story-sweep/index.ts'; s=open(p).read()
old='and(status.eq.queued,created_at.lt.${abandonedBefore})'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,'and(status.eq.queued,updated_at.lt.${abandonedBefore})'))
PY
report "S2 keyed on the clock the retry moves" "$(run "$SWEEP")"; cp "$BAK" $F

# S3: the abandoned window drops below the worst queue wait ever measured, so a
# genuinely busy queue starts failing films that were about to render.
F=supabase/functions/story-sweep/index.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/story-sweep/index.ts'; s=open(p).read()
old='const QUEUED_ABANDONED_TTL_MS = 6 * 60 * 60 * 1000;'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,'const QUEUED_ABANDONED_TTL_MS = 45 * 60 * 1000;'))
PY
report "S3 window below the worst real wait" "$(run "$SWEEP")"; cp "$BAK" $F

# S4: the failure message reads the dispatch stamp before the dispatcher's
# health again, so an outage tells every person a renderer took their film.
F=supabase/functions/story-sweep/index.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/story-sweep/index.ts'; s=open(p).read()
old="""        const why = dispatcherDown
          ? "we couldn't reach the renderer — your time has been returned"
          : row.dispatched_at
            ? "a renderer took this one and never finished — your time has been returned"
            : "no renderer picked this up in time — your time has been returned";"""
assert s.count(old)==1, s.count(old)
new="""        const why = row.dispatched_at
          ? "a renderer took this one and never finished — your time has been returned"
          : dispatcherDown
            ? "we couldn't reach the renderer — your time has been returned"
            : "no renderer picked this up in time — your time has been returned";"""
open(p,'w').write(s.replace(old,new))
PY
report "S4 the stamp read before the health" "$(run "$SWEEP")"; cp "$BAK" $F

mirror
echo "done. GREEN anywhere above means that control is unguarded."
