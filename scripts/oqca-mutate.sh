#!/usr/bin/env bash
# OQCA — prove the benchmark's honesty controls by MUTATION. Every claim this
# subsystem makes is a claim about a NUMBER, so the only thing worth guarding is
# whether a test would notice the number changing. Each block breaks one control
# the way a careless edit would, runs the tests in front of it, expects RED, and
# restores the file. GREEN means the control can be removed without a test
# noticing. NOTAPPLIED means the anchor went stale and NOTHING was mutated,
# which is not a verdict (health-mutate-guards.sh learned that 2026-09-09 and
# health-mutate-describe.sh learned it again 2026-09-10).
#
#   scripts/oqca-mutate.sh
#
# The mutations that matter most are the ones that would make OQCA look BETTER
# than it is: a fixture that no longer isolates the phase (M1), a suite whose
# divergence is no longer confined to one row (M2), and the drain defect the
# spec's own operator carries (M5). A benchmark that cannot be caught flattering
# its subject is not a benchmark.
#
# Read-only for the repo: every file is restored from a copy.
set -u
MUT_FAIL=0
LOG="$(mktemp)"
BAK="$(mktemp)"
cd "$(dirname "$0")/.."
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

# A KERNEL MUTATION MUST REACH THE TREE THE TESTS READ, and six escapes are how
# that was found. `src/oqca/` is mirrored into `supabase/functions/_shared/oqca/`
# and the v1.2 tests import the MIRROR, because that is the instance `shadow.ts`
# uses. So a mutation applied only to `src/` changed nothing the assertions could
# see, and every one of them reported GREEN — the mutation script flattering the
# tests exactly as a bad benchmark flatters its subject.
#
# `restore` puts both trees back, for the same reason.
mirror() { node scripts/oqca-mirror.mjs >/dev/null 2>&1; }
restore() { cp "$BAK" "$1"; mirror; }

echo "baseline (must be green before any verdict counts): exit $(run src/oqca)"

# M1: the "fact absent" half of the pair quietly grows a phase of its own. The
# two tasks then differ in more than one variable and the comparison stops being
# controlled — while both still pass their own truth labels, so nothing else
# would notice.
F=src/oqca/tasks.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/tasks.ts'; s=open(p).read()
old='      { likelihoods: [0.5, 0.5, 0.2], phases: [0, 0, 0], interfere: [0, 1, 0.9] },'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      { likelihoods: [0.5, 0.5, 0.2], phases: [0, 0, Math.PI], interfere: [0, 1, 0.9] },')
open(p,'w').write(s)
PY
mirror
report "M1 the control half of the pair grows a phase" "$(run src/oqca/__tests__/benchmark.test.ts)"
restore $F

# M2: a reweight-only control task is given an interference, so OQCA can win a
# row it has no business winning. This is the "built to flatter it" failure the
# whole suite exists to be able to fail.
cp $F "$BAK"
mutate <<'PY'
p='src/oqca/tasks.ts'; s=open(p).read()
old='    steps: [{ likelihoods: [0.8, 0.1, 0.1] }],'
assert s.count(old)==1
s=s.replace(old,'    steps: [{ likelihoods: [0.8, 0.1, 0.1], phases: [0, Math.PI, 0], interfere: [1, 0, 0.9] }],')
open(p,'w').write(s)
PY
mirror
report "M2 a control task is given an interference" "$(run src/oqca/__tests__/benchmark.test.ts)"
restore $F

# M3: `phase` starts changing probabilities directly — the one thing it must
# never do. Its whole purpose is to be invisible to a measurement until an
# interference reads it, and a gate that moved mass by itself would make every
# "the phase carried a fact" claim in this subsystem meaningless.
F=src/oqca/gates.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/gates.ts'; s=open(p).read()
old='  const rot = c(Math.cos(theta), Math.sin(theta));'
assert s.count(old)==1
s=s.replace(old,'  const rot = c(Math.cos(theta) * 1.5, Math.sin(theta));')
open(p,'w').write(s)
PY
mirror
report "M3 phase moves probability by itself" "$(run src/oqca)"
restore $F

# M4: `reweight` stops being Bayes — sqrt dropped, so amplitudes take the raw
# likelihood and the probabilities update by its SQUARE. Every reweight-only
# control silently diverges, which is the bridge the whole comparison rests on.
cp $F "$BAK"
mutate <<'PY'
p='src/oqca/gates.ts'; s=open(p).read()
old='    state.amplitudes.map((a, i) => cScale(a, Math.sqrt(likelihoods[i]))),'
assert s.count(old)==1
s=s.replace(old,'    state.amplitudes.map((a, i) => cScale(a, likelihoods[i])),')
open(p,'w').write(s)
PY
mirror
report "M4 reweight is no longer Bayes" "$(run src/oqca)"
restore $F

# M5: the spec's own operator, restored. v1.1 builds the pair rotation from
# its ANGLE, so there is no normalising factor left to delete -- the drain
# defect can now only be reintroduced by putting the spec's raw non-unitary
# M = [[1,s],[-s,1]] back and letting the global renormalize in
# fromAmplitudes do the draining. That is what this mutation does, and it is
# a stronger test than v1.0's: it proves the defect is caught even when
# written out in full rather than produced by dropping a factor.
F=src/oqca/gates.ts; cp $F "$BAK"
mutate <<'MUT'
p='src/oqca/gates.ts'; s=open(p).read()
old='  const u = rotation(-angleFromStrength(strength));'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  const u = [c(1), c(strength), c(-strength), c(1)] as const;')
old2='''  const [x, y] = applyPair(u, state.amplitudes[i], state.amplitudes[j]);'''
assert s.count(old2)==1
s=s.replace(old2,'''  const [x, y] = applyPair(u as never, state.amplitudes[i], state.amplitudes[j]);''')
open(p,'w').write(s)
MUT
report "M5 interfere drains untouched hypotheses (the spec's raw operator)" "$(run src/oqca)"
restore $F

# M6: `measure` starts sampling by default instead of taking the maximum, so
# every benchmark row becomes a coin flip and the suite's score stops being a
# function of the model at all.
F=src/oqca/measure.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/measure.ts'; s=open(p).read()
old='policy: MeasurementPolicy = { kind: "maximum" },'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'policy: MeasurementPolicy = { kind: "sample", seed: 1 },')
open(p,'w').write(s)
PY
mirror
report "M6 measurement samples instead of taking the maximum" "$(run src/oqca)"
restore $F

# M7: the summary sentence lies -- it always reports an OQCA win, whatever
# the scores were. This is the one output a reader takes at face value
# instead of reading the rows, so a shape-only assertion (/TIE|OQCA \d/),
# which is what this test had first, would pass it without a murmur.
F=src/oqca/benchmark.ts; cp $F "$BAK"
mutate <<'MUT'
p='src/oqca/benchmark.ts'; s=open(p).read()
old='  const summary ='
assert s.count(old)==1
s=s.replace(old,'  const summary = `OQCA ${results.length} vs Bayes 0 of ${results.length}`;\n  const unusedSummary =')
open(p,'w').write(s)
MUT
report "M7 the summary sentence always claims an OQCA win" "$(run src/oqca/__tests__/benchmark.test.ts)"
restore $F

# ---------------------------------------------------------------------------
# v1.1 mutations. The seven above attack the v1.0 kernel; these eight attack the
# properties v1.1 added. The same rule applies throughout: a mutation that would
# make OQCA look BETTER than it is (M8, M12, M14) is worth more than one that
# merely breaks something.
# ---------------------------------------------------------------------------

# M8: the orientation flip. `phasesFavouring` is exported precisely so a fixture
# cannot guess which amplitude must carry the half-turn -- the first draft of
# the generator DID guess, got it backwards, and the whole suite returned 0%
# where chance is 50%. Flipping it here is that defect, restored.
F=src/oqca/cognitive.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/cognitive.ts'; s=open(p).read()
old='  const flip = favouredIndex === a;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  const flip = favouredIndex === b;')
open(p,'w').write(s)
PY
mirror
report "M8 phasesFavouring points the half-turn at the wrong hypothesis" "$(run src/oqca)"
restore $F

# M9: EVIDENCE stops being Bayes -- the sqrt dropped, so amplitudes take the raw
# likelihood and probabilities update by its SQUARE. This is the v1.1 gate the
# benchmark arms actually call (M4 mutates the v1.0 `reweight`), and it is the
# bridge every "must tie" family rests on.
cp $F "$BAK"
mutate <<'PY'
p='src/oqca/cognitive.ts'; s=open(p).read()
old='    const k = Math.sqrt(likelihoods[i]);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    const k = likelihoods[i];')
open(p,'w').write(s)
PY
mirror
report "M9 EVIDENCE is no longer Bayes" "$(run src/oqca)"
restore $F

# M10: a category-C operation quietly starts answering. ENTANGLE is not
# physically represented here and the honest behaviour is to refuse BY NAME;
# returning silently would let a caller believe two hypotheses had been
# entangled when nothing happened. Brief section 3: "Do not blur these
# categories."
cp $F "$BAK"
mutate <<'PY'
p='src/oqca/cognitive.ts'; s=open(p).read()
old='  refuseIfUnrepresented("ENTANGLE");'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  if (Number("1") < 0) refuseIfUnrepresented("ENTANGLE");')
open(p,'w').write(s)
PY
mirror
report "M10 a category-C operation stops refusing" "$(run src/oqca)"
restore $F

# M11: the loop may take external actions by default. Brief section 13 requires
# explicit bounds and section 18 requires "no autonomous external actions" -- a
# non-zero default is how a research loop becomes an agent nobody authorised.
F=src/oqca/loop/megaLoop.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/megaLoop.ts'; s=open(p).read()
old='  maxToolCalls: 0,'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  maxToolCalls: 25,')
open(p,'w').write(s)
PY
mirror
report "M11 the loop may take external actions by default" "$(run src/oqca)"
restore $F

# M12: an adversarial control is dropped from a manifest. The three
# expected-to-fail controls ARE the honest ceiling on this family's result, so
# deleting one is how a suite quietly stops being able to falsify itself -- and
# it is a data edit no typecheck can see.
F=src/oqca/benchmarks/contextuality/phase-tie-break.json; cp $F "$BAK"
mutate <<'PY'
import json
p='src/oqca/benchmarks/contextuality/phase-tie-break.json'; d=json.load(open(p))
assert 'bayes_with_equivalent_information' in d['controls']
d['controls']=[c for c in d['controls'] if c!='bayes_with_equivalent_information']
json.dump(d, open(p,'w'), indent=2)
PY
report "M12 the central falsification control is dropped from the manifest" "$(run src/oqca/__tests__/benchmarkSuite.test.ts)"
restore $F

# M13: the manifest's baseline list is emptied. Brief section 14 requires a
# matched classical control for EVERY experiment; an empty list is how a
# treatment ends up reported with nothing to compare it against.
cp $F "$BAK"
mutate <<'PY'
import json
p='src/oqca/benchmarks/contextuality/phase-tie-break.json'; d=json.load(open(p))
d['baselines']=[]
json.dump(d, open(p,'w'), indent=2)
PY
report "M13 a manifest declares no baseline at all" "$(run src/oqca/__tests__/benchmarkSuite.test.ts)"
restore $F

# M14: the drift metric is stubbed to a constant zero. It reads 0.0000 on every
# arm of every real run, so a constant zero is indistinguishable from the right
# answer unless something drives it -- which is why the suite mis-declares a
# pair to make it move.
F=src/oqca/bench/arms.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/bench/arms.ts'; s=open(p).read()
old='  if (!trial.interferingPair) return 0;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  return 0;\n  if (!trial.interferingPair) return 0;')
open(p,'w').write(s)
PY
mirror
report "M14 untouched_drift always returns zero" "$(run src/oqca/__tests__/benchmarkSuite.test.ts)"
restore $F

# M15: a real network call is added to a kernel file. Brief section 18: "no
# network side effects". This mutates the SOURCE rather than the guard -- a
# mutation that edits the assertion it is testing can only ever print RED, which
# is the tautology M7's first draft was and why it had to be rewritten.
F=src/oqca/backends/qpu.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/backends/qpu.ts'; s=open(p).read()
s=s+'\nexport async function ping(u: string) {\n  return await fetch(u);\n}\n'
open(p,'w').write(s)
PY
mirror
report "M15 a kernel file opens a network call" "$(run src/oqca/__tests__/security.test.ts)"
restore $F

# ---------------------------------------------------------------------------
# Mega Quantum Loop mutations. These attack the gates that stand between a
# model-driven loop and the owner's money or a production write, so a GREEN
# here is not a missing test — it is a hole in a system that can spend and act.
# ---------------------------------------------------------------------------

# M16: EVALUATE stops refusing an irreversible step with no rollback. Section 18
# asks "Is the action reversible? What happens if it fails?" -- this is the one
# gate that stands between IMAGINE naming a destructive action and ACT running it.
F=src/oqca/loop/cognitiveLoop.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/cognitiveLoop.ts'; s=open(p).read()
old='          if (irreversible.length > 0 && !plan.rollback) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'          if (false && irreversible.length > 0 && !plan.rollback) {')
open(p,'w').write(s)
PY
mirror
report "M16 EVALUATE lets an irreversible step through with no rollback" "$(run src/oqca/__tests__/cognitiveLoop.test.ts)"
restore $F

# M17: the model gate goes away, so a station spends with no budget check. The
# health gateway's rule is that a receipt written after the provider ran cannot
# refuse anything; the same is true of a bound checked after the call.
cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/cognitiveLoop.ts'; s=open(p).read()
import re
m = re.search(r'    const b = wouldBreach\(\n(?:.*\n)*?    \);\n', s)
assert m, 'stale anchor'
old = m.group(0)
s=s.replace(old,'    const b = null as ReturnType<typeof wouldBreach>;')
open(p,'w').write(s)
PY
mirror
report "M17 the model gate no longer checks the budget" "$(run src/oqca/__tests__/cognitiveLoop.test.ts)"
restore $F

# M18: OBSERVE trusts the tool's own `output` instead of the environment's
# `observed`. Section 20: "Never assume the action succeeded... The environment
# is the authority." A record-only router returns ok:true, so this mutation
# turns every unperformed action into a success.
cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/cognitiveLoop.ts'; s=open(p).read()
import re
m = re.search(r'\n(\s*)const matched =\n(?:.*\n)*?.*test\(result\.observed\);\n', s)
assert m, 'stale anchor'
s = s[:m.start()] + '\n' + m.group(1) + 'const matched = result.ok;\n' + s[m.end():]
open(p,'w').write(s)
PY
mirror
report "M18 OBSERVE trusts the tool instead of the environment" "$(run src/oqca/__tests__/cognitiveLoop.test.ts)"
restore $F

# M19: IMAGINE builds its futures from the MODEL'S TEXT rather than from the
# world model's action list, so a model can name an action nobody offered it --
# and PLAN will then select it and ACT will call the router with it.
cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/cognitiveLoop.ts'; s=open(p).read()
old='          const futures: ImaginedFuture[] = actions.map((action, i) => {\n            const said = lines.find((l) => l.includes(action)) ?? "";'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'          const futures: ImaginedFuture[] = (lines.length ? lines : actions).map((said, i) => {\n            const action = said.split("|")[0]?.trim() || actions[0];')
open(p,'w').write(s)
PY
mirror
report "M19 IMAGINE invents actions the world model never offered" "$(run src/oqca/__tests__/cognitiveLoop.test.ts)"
restore $F

# M20: the default tool budget comes off zero, so an unconfigured loop can act
# on the world. This is the single number that decides whether a caller who
# forgot to set a budget gets a loop that thinks or a loop that writes.
F=src/oqca/loop/seams.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/seams.ts'; s=open(p).read()
old='  maxToolCalls: 0,\n  maxTokens: 0,\n  maxCostUsd: 0,'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  maxToolCalls: 25,\n  maxTokens: 100000,\n  maxCostUsd: 5,')
open(p,'w').write(s)
PY
mirror
report "M20 the unconfigured loop may spend and act" "$(run src/oqca/__tests__/cognitiveLoop.test.ts)"
restore $F

# M21: a real network call inside the loop directory. The whole arrangement --
# seams with refusing defaults, real implementations outside the kernel -- exists
# so that this stays impossible while the loop drives a real model.
F=src/oqca/loop/loopState.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/loopState.ts'; s=open(p).read()
s=s+'\nexport async function leak(u: string) {\n  return await fetch(u);\n}\n'
open(p,'w').write(s)
PY
mirror
report "M21 a loop file opens a network call" "$(run src/oqca/__tests__/security.test.ts)"
restore $F

# ====================================================================
# v1.2 — the first reachable ONIQ cognitive job. Brief section 20.
#
# EVERY MUTATION BELOW OPENS A HOLE SOMEBODY COULD ACTUALLY MAKE, and each
# edits the SOURCE rather than the assertion that guards it: a mutation that
# rewrites its own test can only ever print RED, which is what M7's first draft
# was and why it had to be deleted.
#
# Nine of these touch the RUNTIME tree, which the kernel's own suite never
# loads. That is the point: the adapters are where money is spent and
# production is written, and until v1.2 there was nothing there to mutate.
# ====================================================================

RT=supabase/functions/_shared/oqcaRuntime

# M22: the mirror drifts. The loop runs in Deno from a second copy of itself,
# and a copy that is allowed to differ is not a copy -- the edge deploy would
# quietly run different code from the one the tests exercise.
F=$RT/loop/seams.ts
F=supabase/functions/_shared/oqca/loop/seams.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqca/loop/seams.ts'; s=open(p).read()
s=s.replace('maxToolCalls: 0,','maxToolCalls: 9,',1)
open(p,'w').write(s)
PY
report "M22 the edge mirror drifts from src/oqca" "$(run src/oqca/__tests__/mirror.test.ts)"
restore $F

# M23: shadow mode stops refusing production writes. Section 8's entire promise
# is "without changing the user's result"; this is the single line that keeps it.
F=$RT/toolRouter.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/toolRouter.ts'; s=open(p).read()
old='      if (ctx.mode === "shadow" && spec.touchesProduction) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      if (false && ctx.mode === "shadow" && spec.touchesProduction) {')
open(p,'w').write(s)
PY
report "M23 shadow mode performs production writes" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

# M24: the router stops checking that a call's declared properties match the
# registry, so an under-declared write walks straight past the shadow gate.
F=$RT/toolRouter.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/toolRouter.ts'; s=open(p).read()
import re
m = re.search(r'      if \(\n        call\.reversible(?:.|\n)*?      \) \{\n', s)
assert m, 'stale anchor'
s = s[:m.start()] + '      if (false) {\n' + s[m.end():]
open(p,'w').write(s)
PY
report "M24 a call may under-declare that it touches production" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

# M25: the existing authorization boundary is skipped. Section 9: "OQCA
# selecting an action is not authorization for it." Without this the loop's
# opinion becomes the only check on a production dispatch.
F=$RT/toolRouter.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/toolRouter.ts'; s=open(p).read()
old='      const denied = await spec.authorize(call);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      const denied: string | null = null;\n      void spec.authorize;')
open(p,'w').write(s)
PY
report "M25 the existing authorization boundary is skipped" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

# M26: an unregistered tool prices at zero instead of refusing, so an action
# nobody registered passes the cost gate and is refused one step later under a
# different name. A gate that reports the wrong bound sends whoever reads the
# log to raise the wrong number.
F=$RT/toolRouter.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/toolRouter.ts'; s=open(p).read()
old='      if (!spec) return null;\n      return spec.estimate(call);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      if (!spec) return { tokens: 0, costUsd: 0 };\n      return spec.estimate(call);')
open(p,'w').write(s)
PY
report "M26 an unknown tool is priced as free" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

# M27: the observation is the tool's own claim. Section 10's authority is the
# environment; a `perform` that echoes its own output would make station 17
# confirm every action it took.
F=$RT/dispatchJob.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/dispatchJob.ts'; s=open(p).read()
old='          ? { ok: true, output: `dispatched ${id}`, observed, costUsd: 0 }'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'          ? { ok: true, output: `dispatched ${id}`, observed: `dispatched ${id}`, costUsd: 0 }')
open(p,'w').write(s)
PY
report "M27 the observation echoes the tool instead of the row" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

# M28: an unpriced model is treated as free. Section 21, in its own words:
# "Never: unknown -> 0. Never allow: unknown cost -> execute."
F=$RT/pricing.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/pricing.ts'; s=open(p).read()
old='  if (!isPriced(model)) return null;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  if (!isPriced(model)) return 0;')
open(p,'w').write(s)
PY
report "M28 an unpriced model costs zero instead of refusing" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

# M29: a fallback answerer with no published rate settles at ZERO rather than at
# the estimate. `financialLedger` makes the same choice for the same reason -- a
# null means unknown, and unknown is never free.
F=$RT/engine.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/engine.ts'; s=open(p).read()
old='      const costUsd = measured ?? quote.costUsd;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      const costUsd = measured ?? 0;')
open(p,'w').write(s)
PY
report "M29 an unpriced answerer is billed as free" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

# M30: memory reports the records it did NOT persist as persisted. The gap is
# the finding; a `consolidate` returning a count would make every later reader
# believe ONIQ remembers something it does not.
F=$RT/memory.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/memory.ts'; s=open(p).read()
old='      ctx.record({ attempted: records.length, persisted: 0, reason: PERSISTENCE_GAP });\n      return 0;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      ctx.record({ attempted: records.length, persisted: records.length, reason: PERSISTENCE_GAP });\n      return records.length;')
open(p,'w').write(s)
PY
report "M30 memory claims to persist what it dropped" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

# M31: the verifier calls a stamped-but-still-queued job VERIFIED, which is the
# station reporting the tool's own action back to itself.
F=$RT/dispatchJob.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/dispatchJob.ts'; s=open(p).read()
old='        verdict: "partially_verified",'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'        verdict: "verified",')
open(p,'w').write(s)
PY
report "M31 a dispatch stamp is read as a runner claim" "$(run src/oqca/__tests__/runtime.test.ts src/oqca/__tests__/shadowRun.test.ts)"
restore $F

# M32: the flag fails OPEN, so a typo in a secret turns a scheduled dispatcher
# into a cognitive one.
F=$RT/flag.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/flag.ts'; s=open(p).read()
old='  if (v === "assisted") return "assisted";\n  return "off";'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  if (v === "assisted") return "assisted";\n  return "shadow";')
open(p,'w').write(s)
PY
report "M32 an unrecognised flag value runs the loop" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

# M33: the hook reports `handled` from the loop's DECISION rather than from what
# the environment says happened -- so a refused dispatch skips the production
# path and no film goes out at all.
F=$RT/storyDispatchHook.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/storyDispatchHook.ts'; s=open(p).read()
old='      handled: cfg.mode === "assisted" && (performed !== undefined || held),'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      handled: cfg.mode === "assisted" || performed !== undefined || held,')
open(p,'w').write(s)
PY
report "M33 shadow mode can report handled" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

# M34: replay grows a seam. Section 19: "Replay must not make network calls,
# model calls, or execute tools." The guarantee is that there is nowhere to pass
# one, so adding a parameter is the whole of the breach.
F=$RT/shadow.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/shadow.ts'; s=open(p).read()
old='export function replayChain(chain: readonly LoopState[]): readonly ReplayProblem[] {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'export function replayChain(\n  chain: readonly LoopState[],\n  engine?: unknown,\n): readonly ReplayProblem[] {\n  void engine;')
open(p,'w').write(s)
PY
report "M34 replay accepts an engine" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

# M35: a second file names `callText`. Section 4 connects ONE model boundary;
# a second import is how a second provider arrives without anyone deciding to
# add one.
F=$RT/episode.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/episode.ts'; s=open(p).read()
s='import { callText } from "../llm.ts";\nvoid callText;\n'+s
open(p,'w').write(s)
PY
report "M35 a second file reaches the model boundary" "$(run src/oqca/__tests__/runtimeWiring.test.ts)"
restore $F

# M36: the kernel imports an adapter, which is the whole boundary collapsing --
# `security.test.ts` would then be asserting purity over a tree with a fetch one
# import away.
F=supabase/functions/_shared/oqca/loop/loopState.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqca/loop/loopState.ts'; s=open(p).read()
s='import { DISPATCH_COST } from "../../oqcaRuntime/dispatchJob.ts";\nvoid DISPATCH_COST;\n'+s
open(p,'w').write(s)
PY
report "M36 the kernel imports a runtime adapter" "$(run src/oqca/__tests__/runtimeWiring.test.ts)"
restore $F

# M37: the caller stops gating on the flag, so the loop runs on every scheduled
# tick whether or not anyone turned it on.
F=supabase/functions/story-dispatch/index.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/story-dispatch/index.ts'; s=open(p).read()
old='    if (oqcaMode === "assisted") {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    if (oqcaMode !== "never") {')
open(p,'w').write(s)
PY
report "M37 the caller runs the loop with the flag off" "$(run src/oqca/__tests__/runtimeWiring.test.ts)"
restore $F

# M38: shadow moves ABOVE the dispatch, so a loop that throws or hangs now sits
# between a user's film and the runner that renders it.
F=supabase/functions/story-dispatch/index.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/story-dispatch/index.ts'; s=open(p).read()
import re
m = re.search(r'\n    // SHADOW RUNS AFTER(?:.|\n)*?\n    \}\n', s)
assert m, 'stale anchor'
block = m.group(0)
s = s[:m.start()] + '\n' + s[m.end():]
anchor = '    const jobId = rows[0].id;'
assert s.count(anchor)==1
s = s.replace(anchor, block.strip('\n') + '\n\n' + anchor)
open(p,'w').write(s)
PY
report "M38 shadow mode runs before the dispatch" "$(run src/oqca/__tests__/runtimeWiring.test.ts)"
restore $F

# ====================================================================
# v1.2b — the five defects a REAL job surfaced. Every one of these
# shipped green: tests passed, tsc passed, no station refused, and the
# loop was silently wrong. `scripts/oqca-shadow-run.ts` is what found
# them, and these are what stop them coming back.
# ====================================================================

# M39: IMAGINE scores the action's own NAME again. Every ONIQ story job id is
# hex, so the digit scan reads the "1" in `8f2c1a` as risk 1.0 and every
# dispatch prices out at zero — the loop then holds forever on a queue it
# understood perfectly.
F=src/oqca/loop/cognitiveLoop.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/cognitiveLoop.ts'; s=open(p).read()
old='            const scored = said.slice(said.indexOf(action) + action.length);\n            const nums = scored.match('
assert s.count(old)==1, s.count(old)
s=s.replace(old,'            const nums = said.match(')
open(p,'w').write(s)
PY
mirror
report "M39 IMAGINE scores the action's own name" "$(run src/oqca/__tests__/shadowRun.test.ts)"
restore $F

# M40: the evidence gate reads only the positional field again, so a caller
# supplying the keyed map typechecks, runs, and is told "no evidence this
# iteration" — four times, with nothing red.
F=src/oqca/loop/cognitiveLoop.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/cognitiveLoop.ts'; s=open(p).read()
old='          if (ev?.likelihoods || ev?.likelihoodsByHypothesis) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'          if (ev?.likelihoods) {')
open(p,'w').write(s)
PY
mirror
report "M40 the keyed evidence map is silently ignored" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

# M41: a keyed map missing a basis element is PADDED rather than refused.
# Section 11 forbids exactly this by name.
F=src/oqca/loop/cognitiveLoop.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/cognitiveLoop.ts'; s=open(p).read()
old='              ? quantum.basis.map((label) => byLabel[label])'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'              ? quantum.basis.map((label) => byLabel[label] ?? 1)')
open(p,'w').write(s)
PY
mirror
report "M41 a missing likelihood is padded instead of refused" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

# M42: VERIFY goes back to asking the MODEL about its own claims instead of
# calling the injected verifier. A model marking its own homework.
F=src/oqca/loop/cognitiveLoop.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/cognitiveLoop.ts'; s=open(p).read()
old='          const verification = await verifier({'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'          await ask(station, "SUPPORTED or UNVERIFIED?", 16);\n          const verification = await verifier({')
open(p,'w').write(s)
PY
mirror
report "M42 VERIFY asks the model about its own claims" "$(run src/oqca/__tests__/runtimeWiring.test.ts)"
restore $F

# M43: a transition bypasses the chain, so a replay of the recorded chain is a
# replay of a DIFFERENT run -- silently, because both still typecheck.
F=src/oqca/loop/cognitiveLoop.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/cognitiveLoop.ts'; s=open(p).read()
old='          state = step({ percepts: [...state.percepts, ...percepts], spent });'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'          state = advance(state, { percepts: [...state.percepts, ...percepts], spent });')
open(p,'w').write(s)
PY
mirror
report "M43 a transition skips the replay chain" "$(run src/oqca/__tests__/runtimeWiring.test.ts)"
restore $F

# M44: a paying tool runs without the ledger. Section 5's whole sentence.
F=$RT/toolRouter.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/toolRouter.ts'; s=open(p).read()
old='      const pays = quote !== null && quote.costUsd > 0;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      const pays = false;')
open(p,'w').write(s)
PY
report "M44 a paying tool bypasses the spend ledger" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

# M45: the episode stops crossing the memory adapter, so the persistence gap
# becomes invisible again instead of being a measured 0.
F=$RT/shadow.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/shadow.ts'; s=open(p).read()
import re
m = re.search(r'  const persistedEpisodes = await memory\.consolidate\(\[(?:.|\n)*?\n  \]\);\n', s)
assert m, 'stale anchor'
s = s[:m.start()] + '  const persistedEpisodes = 0;\n' + s[m.end():]
open(p,'w').write(s)
PY
report "M45 the episode never reaches the memory adapter" "$(run src/oqca/__tests__/runtimeWiring.test.ts)"
restore $F

# M46: a decision is reported on a TIE. v1.1 measured that the label at margin
# 0 is a fact about basis ORDER, not about the evidence.
F=$RT/shadow.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/shadow.ts'; s=open(p).read()
old='  const oqcaDecision = foldedEvidence && oqcaMargin > 0 ? (ranked[0]?.label ?? null) : null;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  const oqcaDecision = foldedEvidence ? (ranked[0]?.label ?? null) : null;')
open(p,'w').write(s)
PY
report "M46 a tie is reported as a decision" "$(run src/oqca/__tests__/shadowRun.test.ts)"
restore $F

# M47: a bound stops being read as `blocked`, so a refusal reads as a failure
# and an operator goes looking for a bug instead of raising a number.
F=$RT/episode.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/episode.ts'; s=open(p).read()
old='  if (BLOCKING.has(run.terminated)) return "blocked";'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  if (false) return "blocked";')
open(p,'w').write(s)
PY
report "M47 a bound is reported as a failure, not as blocked" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

# M48: the verdict leaves the hashed state, so a replay that reached a
# DIFFERENT conclusion from the same observations would still verify.
F=src/oqca/loop/loopState.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/loopState.ts'; s=open(p).read()
old='    verification: s.verification,\n'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'')
open(p,'w').write(s)
PY
mirror
report "M48 the verdict is not part of the state id" "$(run src/oqca/__tests__/runtime.test.ts)"
restore $F

echo "done"
