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


# ==================================================================== #
# v1.3 AND THE FAILURE-RECOVERY BRIEF.
#
# The subject here is the REFUSALS. A recovery layer is only as good as what it
# declines to do, so every mutation below opens one hole the briefs name as a
# "never" — and the two that matter most are the ones that would make the loop
# look SAFER than it is: a safety violation reaching the retry ladder (M49) and
# a planning failure being retried (M52).
# ==================================================================== #

# M49: the safety check stops running FIRST, so a SECURITY fault mislabelled
# TRANSIENT reaches the retry ladder. Recovery section 22: "Recovery cannot
# override safety."
F=src/oqca/recovery/decide.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/recovery/decide.ts'; s=open(p).read()
old='  if (isSafetyViolation(failure.code)) {\n    return stop(`safety: ${failure.code}`, "safety_stop");\n  }\n'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'')
open(p,'w').write(s)
PY
mirror
report "M49 a safety violation reaches the retry ladder" "$(run src/oqca/__tests__/recovery.test.ts)"
restore $F

# M50: section 8 goes away — an operation whose effect is UNCERTAIN is replayed
# onto a non-idempotent write. "Never assume a timeout means the operation did
# not happen."
F=src/oqca/recovery/decide.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/recovery/decide.ts'; s=open(p).read()
old='  if (failure.effectUncertain && !safeToReplay(failure.idempotency)) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  if (false && failure.effectUncertain && !safeToReplay(failure.idempotency)) {')
open(p,'w').write(s)
PY
mirror
report "M50 an uncertain effect is replayed onto a non-idempotent write" "$(run src/oqca/__tests__/recovery.test.ts)"
restore $F

# M51: UNKNOWN defaults to a retry, which section 24 forbids in as many words.
F=src/oqca/recovery/decide.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/recovery/decide.ts'; s=open(p).read()
old='      return tryEscalate(ctx, "unclassified failure; not repeating an unknown action", "failure");'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      return tryRetry(failure, ctx, false, () => stop("unknown", "failure"));')
open(p,'w').write(s)
PY
mirror
report "M51 an unclassified failure defaults to a retry" "$(run src/oqca/__tests__/recovery.test.ts)"
restore $F

# M52: a PLANNING failure is retried. Section 25: "Never use repeated retries to
# conceal a planning failure."
F=src/oqca/recovery/decide.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/recovery/decide.ts'; s=open(p).read()
old='      return tryReplan(failure, ctx, "the plan itself was wrong");'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      return tryRetry(failure, ctx, false, () => tryReplan(failure, ctx, "the plan itself was wrong"));')
open(p,'w').write(s)
PY
mirror
report "M52 a planning failure is retried" "$(run src/oqca/__tests__/recovery.test.ts)"
restore $F

# M53: the backoff stops being bounded by the run's own execution-time budget, so
# a run can end asleep. Section 6: "Never sleep indefinitely."
F=src/oqca/recovery/retry.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/recovery/retry.ts'; s=open(p).read()
old='  if (delayMs > ctx.remainingRunMs) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  if (false) {')
open(p,'w').write(s)
PY
mirror
report "M53 a backoff may outlast the whole run" "$(run src/oqca/__tests__/recovery.test.ts)"
restore $F

# M54: a never-retry code becomes retryable when a caller says so, so section 4
# would depend on every call site remembering it.
F=src/oqca/recovery/failure.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/recovery/failure.ts'; s=open(p).read()
old='    retryable: never ? false : (draft.retryable ?? false),'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    retryable: draft.retryable ?? false,')
open(p,'w').write(s)
PY
mirror
report "M54 a never-retry code is retryable if the caller says so" "$(run src/oqca/__tests__/recovery.test.ts)"
restore $F

# M55: redaction leaves the constructor, so a credential can enter a HASHED,
# PERSISTED failure record.
F=src/oqca/recovery/failure.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/recovery/failure.ts'; s=open(p).read()
old='    message: redactMessage(draft.message),'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    message: draft.message,')
open(p,'w').write(s)
PY
mirror
report "M55 a credential reaches the failure record" "$(run src/oqca/__tests__/recovery.test.ts)"
restore $F

# M56: UNKNOWN idempotency is treated as safe to replay. Section 7's fourth member
# exists precisely so that it is not.
F=src/oqca/recovery/failure.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/recovery/failure.ts'; s=open(p).read()
old='  return idempotency === "READ" || idempotency === "IDEMPOTENT_WRITE";'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  return idempotency !== "NON_IDEMPOTENT_WRITE";')
open(p,'w').write(s)
PY
mirror
report "M56 an undeclared tool is treated as safe to replay" "$(run src/oqca/__tests__/recovery.test.ts)"
restore $F

# M59: `isTerminal` goes back to testing for `running`, so the day a second
# non-terminal status exists the loop stops on it silently.
F=src/oqca/loop/loopState.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/loopState.ts'; s=open(p).read()
old='  return TERMINAL_STATUSES.includes(status);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  return status !== "running";')
open(p,'w').write(s)
PY
mirror
report "M59 isTerminal stops reading the terminal list" "$(run src/oqca/__tests__/v13Wiring.test.ts)"
restore $F

# M60: the research adapter answers "no findings" instead of refusing. Section 12:
# an empty finding set is a fabricated NEGATIVE result.
F=supabase/functions/_shared/oqcaRuntime/research.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/research.ts'; s=open(p).read()
old='      return { ok: false, reason: RESEARCH_GAP };'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      return { ok: true, findings: [] };')
open(p,'w').write(s)
PY
report "M60 research fabricates an empty negative result" "$(run src/oqca/__tests__/v13Wiring.test.ts)"
restore $F

# M61: persistence reports the chain length rather than what the adapter actually
# stored, so a store that forgets reads as one that works.
F=src/oqca/loop/cognitiveLoop.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/cognitiveLoop.ts'; s=open(p).read()
old='      if (await run.persistence.persist(chain[persistedUpTo])) stored++;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      await run.persistence.persist(chain[persistedUpTo]);\n      stored++;')
open(p,'w').write(s)
PY
mirror
report "M61 persistence counts the chain, not the adapter's answer" "$(run src/oqca/__tests__/v13Wiring.test.ts)"
restore $F

# M63: the failure record leaves the hashed state, so a run that failed twice and
# then worked replays as one that never failed. Sections 20 and 31.
F=src/oqca/loop/loopState.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/loopState.ts'; s=open(p).read()
old='    failures: s.failures,\n'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'')
open(p,'w').write(s)
PY
mirror
# RETARGETED. This first pointed at `shadowRun.test.ts`, which asserts the
# failures ARRAY is populated — and the array survives the mutation untouched;
# only the HASH changes. It reported GREEN on a genuine hole. The assertion
# that moves is "two states differing only in `failures` have different ids".
report "M63 failures are not part of the state id" "$(run src/oqca/__tests__/v13Wiring.test.ts)"
restore $F

# M64: a shadow-refused action is NOT withdrawn, so the "replan" re-selects the
# action that just failed — a retry wearing level 5, which section 25 forbids.
F=src/oqca/loop/cognitiveLoop.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/cognitiveLoop.ts'; s=open(p).read()
old='          const open = state.futures.filter((f) => !blockedActions.has(f.action));'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'          const open = state.futures;')
open(p,'w').write(s)
PY
mirror
report "M64 a replan re-selects the action that just failed" "$(run src/oqca/__tests__/shadowRun.test.ts)"
restore $F

# M57: the world-state provenance becomes optional, so a station can add
# something it INFERRED without saying so. v1.3 section 30's invariant.
F=src/oqca/loop/loopState.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/loop/loopState.ts'; s=open(p).read()
old='  readonly provenance: Provenance;'
assert s.count(old)==2, s.count(old)
s=s.replace(old,'  readonly provenance?: Provenance;')
open(p,'w').write(s)
PY
mirror
report "M57 provenance becomes optional" "$(run src/oqca/__tests__/v13Wiring.test.ts)"
restore $F

# M58: a wall clock enters the hashed state through the percept, so every replay
# of the same run produces a different id. v1.3 section 3.
F=src/oqca/loop/loopState.ts; cp $F "$BAK"
mutate <<'PY'
import re
p='src/oqca/loop/loopState.ts'; s=open(p).read()
m = re.search(r'    percepts: s\.percepts\.map\(\(p\) => \((?:.|\n)*?\}\)\),\n', s)
assert m, 'stale anchor'
s = s[:m.start()] + '    percepts: s.percepts,\n' + s[m.end():]
open(p,'w').write(s)
PY
mirror
report "M58 a percept timestamp enters the state id" "$(run src/oqca/__tests__/v13Wiring.test.ts)"
restore $F

# M62: `controlled_autonomy` becomes reachable from the environment, ahead of
# the authorization the recovery brief's closing sentence requires.
F=supabase/functions/_shared/oqcaRuntime/flag.ts; cp $F "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/flag.ts'; s=open(p).read()
old='export type OqcaMode = "off" | "shadow" | "assisted";'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'export type OqcaMode = "off" | "shadow" | "assisted" | "controlled_autonomy";')
old2='  if (v === "assisted") return "assisted";'
assert s.count(old2)==1, s.count(old2)
s=s.replace(old2, old2 + chr(10) + '  if (v === "controlled_autonomy") return "controlled_autonomy";')
open(p,'w').write(s)
PY
report "M62 controlled_autonomy becomes settable from the environment" "$(run src/oqca/__tests__/v13Wiring.test.ts)"
restore $F

# ─────────────────────────────────────────────────────────────────────────────
# QUANTUM KNOWLEDGE SUBSTRATE + OKS (quantum brief §7/§16/§20/§21/§23/§26; the
# upgradation spec's §7/§8/§10/§21). Every mutation below opens a hole a
# careless edit really could open, and most of them restore a defect that was
# genuinely present until a test asked the right question. The quantum tree is
# NOT mirrored — nothing in the runtime imports it — so `mirror` is a no-op for
# these and `restore` still calls it harmlessly.
# ─────────────────────────────────────────────────────────────────────────────

# M65: the promotion threshold goes back above what any single item can reach.
# `w/(w+1)` caps one perfect source at 0.5, so 0.6 refuses everything — which
# is the state the quantum ingestion was found in: 113/113 CANDIDATE at 0.500.
F=src/oqca/knowledge/substrate/promotion.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/knowledge/substrate/promotion.ts'; s=open(p).read()
old='  minConfidence: 0.45,'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  minConfidence: 0.6,')
open(p,'w').write(s)
PY
report "M65 minConfidence rises above what one first-hand item can reach" "$(run src/oqca/__tests__/oksSubstrate.test.ts src/oqca/__tests__/quantumKnowledge.test.ts)"
restore $F

# M66: recalled evidence stops being worthless, so a confident memory of a good
# source promotes a claim nobody ever read. §21's load-bearing number.
F=src/oqca/knowledge/substrate/evidence.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/knowledge/substrate/evidence.ts'; s=open(p).read()
old='  recalled: 0,'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  recalled: 0.8,')
open(p,'w').write(s)
PY
report "M66 recalled evidence gains weight" "$(run src/oqca/__tests__/oksSubstrate.test.ts)"
restore $F

# M67: a model's own extraction becomes sufficient alone — §21's "Do not let an
# LLM alone decide factual truth", removed.
F=src/oqca/knowledge/substrate/promotion.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/knowledge/substrate/promotion.ts'; s=open(p).read()
old='  allowModelOnlyEvidence: false,'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  allowModelOnlyEvidence: true,')
open(p,'w').write(s)
PY
report "M67 a model alone may decide factual truth" "$(run src/oqca/__tests__/oksSubstrate.test.ts)"
restore $F

# M68: the store overwrites the retired row with its replacement — the defect
# that held for every supersession until a test asked for the history back.
F=src/oqca/knowledge/substrate/store.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/knowledge/substrate/store.ts'; s=open(p).read()
old='          m.set(historyKey(older.id, older.version), {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'          m.set(older.id, {')
open(p,'w').write(s)
PY
report "M68 a supersession erases the row it replaced" "$(run src/oqca/__tests__/oksSubstrate.test.ts)"
restore $F

# M69: rollbackIntegrity goes back to comparing a prefix against another replay
# instead of against the journal, so a store that ignores its journal scores a
# perfect 1. Measured: it did.
F=src/oqca/knowledge/substrate/metrics.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/knowledge/substrate/metrics.ts'; s=open(p).read()
old='    const expected = new Set(journal.slice(0, i).map((op) => op.record.id));'
assert s.count(old)==1, s.count(old)
i=s.index(old); j=s.index('    if (reproducible && matches)', i)
s = s[:i] + '    const matches = i === n || a.length <= store.replayTo(n).length;\n' + s[j:]
open(p,'w').write(s)
PY
report "M69 rollback integrity stops reading the journal" "$(run src/oqca/__tests__/oksSubstrate.test.ts)"
restore $F

# M70: the ground-truth metrics report 0 instead of null, so a dashboard shows
# fabricated numbers as if they were measured.
F=src/oqca/knowledge/substrate/metrics.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/knowledge/substrate/metrics.ts'; s=open(p).read()
# The anchor is scoped to `knowledgePrecision`: the bare line appears TWICE
# (resolutionAccuracy has the same shape), so the unscoped version matched two
# and asserted its way to NOTAPPLIED. The script said so rather than printing a
# verdict, which is the whole reason that branch exists.
i=s.index('export function knowledgePrecision')
j=s.index('export function knowledgeRecall')
old='  if (scored.length === 0) return null;'
assert s[i:j].count(old)==1, s[i:j].count(old)
s=s[:i]+s[i:j].replace(old,'  if (scored.length === 0) return 0;')+s[j:]
open(p,'w').write(s)
PY
report "M70 an unmeasured metric reports 0 instead of unknown" "$(run src/oqca/__tests__/oksSubstrate.test.ts)"
restore $F

# M71: an escalated conflict is scored as a WRONG answer, which pushes the
# resolver towards guessing — exactly backwards.
F=src/oqca/knowledge/substrate/metrics.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/knowledge/substrate/metrics.ts'; s=open(p).read()
old='  const decided = scored.filter((l) => !byId.get(l.conflictId)?.escalated);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  const decided = scored;')
open(p,'w').write(s)
PY
report "M71 a refusal to guess is scored as a wrong answer" "$(run src/oqca/__tests__/oksSubstrate.test.ts)"
restore $F

# M72: the metric re-derives staleness beside decay.ts instead of delegating.
F=src/oqca/knowledge/substrate/metrics.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/knowledge/substrate/metrics.ts'; s=open(p).read()
old='  return decayStalenessRate(store.all(), nowMs);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  const active = store.all().filter((r) => r.status === "VERIFIED");\n  if (active.length === 0) return 0;\n  return active.filter((r) => freshness(r, nowMs).stale).length / active.length;')
# THE MUTATION MUST COMPILE, or it goes RED on a missing import rather than on
# the assertion it exists to test — caught red for the wrong reason is not a
# verdict either.
s=s.replace('import { stalenessRate as decayStalenessRate } from "./decay.ts";','import { freshness, stalenessRate as decayStalenessRate } from "./decay.ts";')
open(p,'w').write(s)
PY
report "M72 staleness is re-derived beside the policy" "$(run src/oqca/__tests__/oksSubstrate.test.ts src/oqca/__tests__/oksLoopIntegration.test.ts)"
restore $F

# M73: a divergence stops carrying refuting evidence, so §23's "never silently
# normalize" collapses into one side winning.
F=src/oqca/quantum/knowledge.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/quantum/knowledge.ts'; s=open(p).read()
old='conventionEvidence(p, `${d.topic}: ${d.theirConvention}`, at, false),'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'conventionEvidence(p, `${d.topic}: ${d.theirConvention}`, at, true),')
open(p,'w').write(s)
PY
report "M73 a library disagreement is silently normalised" "$(run src/oqca/__tests__/quantumKnowledge.test.ts src/oqca/__tests__/oksLoopIntegration.test.ts)"
restore $F

# M74: §7's benchmark requirement is dropped, so an advantage can be asserted
# with nothing behind it.
F=src/oqca/quantum/knowledge.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/quantum/knowledge.ts'; s=open(p).read()
old='  if (!benchmark.trim()) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  if (benchmark === "\\u0000never") {')
open(p,'w').write(s)
PY
report "M74 an advantage may be claimed with no benchmark" "$(run src/oqca/__tests__/quantumKnowledge.test.ts)"
restore $F

# M75: the ingestion stops recording WHEN a fact was verified, so every record
# is born stale and the decay metric reads 1.0000 forever — indistinguishable
# from a metric that computes nothing.
F=src/oqca/quantum/knowledge.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/quantum/knowledge.ts'; s=open(p).read()
old='    validity: { validFrom: null, validUntil: null, lastVerifiedAt: verifiedAt },'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    validity: { validFrom: null, validUntil: null, lastVerifiedAt: null },')
open(p,'w').write(s)
PY
report "M75 the ingestion forgets when it verified anything" "$(run src/oqca/__tests__/oksLoopIntegration.test.ts)"
restore $F

# M76: the ingestion starts writing the PROSE in as belief — ~200 rows that can
# never be promoted, and the temptation to relabel recall so that they can.
F=src/oqca/quantum/knowledge.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/quantum/knowledge.ts'; s=open(p).read()
old='    ...advantageFacts(at),'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    ...advantageFacts(at),\n    ...CONCEPT_PROSE.map((cc) =>\n      record(cc.id, "hasDefinition", cc.definition, [QUANTUM_DOMAIN], [computedEvidence("prose", cc.id, at)], "stable", EMPTY_PROVENANCE, at),\n    ),')
s=s.replace('import { DOMAINS, DIVERGENCES } from "./domains.ts";','import { DOMAINS, DIVERGENCES } from "./domains.ts";\nimport { CONCEPTS as CONCEPT_PROSE } from "./concepts.ts";')
open(p,'w').write(s)
PY
report "M76 the prose is ingested as belief" "$(run src/oqca/__tests__/quantumKnowledge.test.ts)"
restore $F

# M77: the fairness gate stops reporting a denied baseline, so §16's refusal
# disappears and an unfair comparison reads as a clean win.
F=src/oqca/quantum/experiments.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/quantum/experiments.ts'; s=open(p).read()
old='    if (e.quantumInformation[k] && !b.informationGiven[k]) denied.push(k);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    void k;')
open(p,'w').write(s)
PY
report "M77 a baseline denied information is reported as fair" "$(run src/oqca/__tests__/quantumMethod.test.ts)"
restore $F

# M78: the growth test goes back to `last > first`, which reads a saturating
# curve as growth and reported both DJ experiments as disagreeing with their
# own numbers.
F=src/oqca/quantum/experiments.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/quantum/experiments.ts'; s=open(p).read()
old='  const grows = tail.every((v, k) => k === 0 || v > tail[k - 1]);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  const grows = costs[costs.length - 1] > costs[0];')
open(p,'w').write(s)
PY
report "M78 a saturating classical cost is read as growth" "$(run src/oqca/__tests__/quantumMethod.test.ts)"
restore $F

# M79: discovery reads "a fair experiment mentions this algorithm" as support
# again, so Deutsch and Deutsch-Jozsa are recommended off the back of the
# experiment that refutes them. The real defect, restored.
F=src/oqca/quantum/discovery.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/quantum/discovery.ts'; s=open(p).read()
old='        e.establishes === "advantage" &&\n'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'')
open(p,'w').write(s)
PY
report "M79 a no-advantage experiment is read as support" "$(run src/oqca/__tests__/quantumMethod.test.ts)"
restore $F

# M80: the simulator keys its counts by the whole quantum register again, so an
# unmeasured ancilla appears in every answer. Every amplitude stays right and
# every comparison goes wrong.
F=src/oqca/quantum/backends/statevector.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/quantum/backends/statevector.ts'; s=open(p).read()
old='      if (measured.length === 0) return yes(sampleCounts(probs, shots, seed, circuit.qubits));'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      if (measured.length >= 0) return yes(sampleCounts(probs, shots, seed, circuit.qubits));')
open(p,'w').write(s)
PY
report "M80 counts are keyed by the quantum register, not the declared one" "$(run src/oqca/__tests__/quantumKernel.test.ts src/oqca/__tests__/quantumMethod.test.ts)"
restore $F

# M81: the §21 policy defaults open a QPU and a budget. Nothing else in the tree
# would notice, because no vendor is configured — which is exactly why the
# DEFAULT has to be guarded rather than the call site.
F=src/oqca/quantum/policy.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/quantum/policy.ts'; s=open(p).read()
old='  remoteQuantumExecution: false,'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  remoteQuantumExecution: true,')
old2='  maxQuantumCostUsd: 0,'
assert s.count(old2)==1, s.count(old2)
s=s.replace(old2,'  maxQuantumCostUsd: 10,')
open(p,'w').write(s)
PY
report "M81 remote quantum execution and a cost budget are on by default" "$(run src/oqca/__tests__/quantumKernel.test.ts)"
restore $F

# M82: a domain claims an implementation it does not have. The capability
# record must go FALSE rather than the claim standing.
F=src/oqca/quantum/domains.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/quantum/domains.ts'; s=open(p).read()
old='    id: "qec",'
assert s.count(old)==1, s.count(old)
i=s.index(old); j=s.index('    implementedHere: [],', i)
s = s[:j] + '    implementedHere: ["decodeSurfaceCode"],' + s[j+len('    implementedHere: [],'):]
open(p,'w').write(s)
PY
report "M82 a domain claims an implementation that does not exist" "$(run src/oqca/__tests__/quantumKnowledge.test.ts)"
restore $F

# M83: a domain declares itself finished by emptying its gap list — §27's
# outstanding column, deleted.
F=src/oqca/quantum/domains.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/quantum/domains.ts'; s=open(p).read()
old='    notImplemented: [\n      "no optimiser, no training loop, no autodiff'
assert s.count(old)==1, s.count(old)
i=s.index(old); j=s.index('    ],', i)
s = s[:i] + '    notImplemented: [\n' + s[j:]
open(p,'w').write(s)
PY
report "M83 a domain declares itself complete" "$(run src/oqca/__tests__/quantumKnowledge.test.ts)"
restore $F

# M84: the URL-ban exemption widens from the two locator files to the whole
# tree. The compensating check must fire.
F=src/oqca/__tests__/security.test.ts; cp $F "$BAK"
mutate <<'PY'
p='src/oqca/__tests__/security.test.ts'; s=open(p).read()
old='const URL_DATA_REL = ["quantum/sources.ts", "quantum/knowledge.ts"];'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'const URL_DATA_REL = ["quantum/sources.ts", "quantum/knowledge.ts", "quantum/policy.ts"];')
open(p,'w').write(s)
PY
report "M84 the URL exemption widens to a file that carries no URL" "$(run src/oqca/__tests__/security.test.ts)"
restore $F

# ══════════════════════════════════════════════════════════════════════════
# v1.4-R — REACHABLE KNOWLEDGE. Items A through H.
#
# THE MUTATIONS THAT MATTER MOST HERE ARE THE ONES THAT WOULD MAKE THE CHAIN
# LOOK REACHED WHEN IT IS NOT (M85, M96) OR LET A BELIEF AUTHORIZE SOMETHING
# (M97, M98). Everything else in this block is a guard on how a claim came to
# be believed.
#
# `restore` re-mirrors, so a runtime mutation is put back on both sides too.
# ══════════════════════════════════════════════════════════════════════════

RK=src/oqca/__tests__/reachableKnowledge.test.ts
SUB=supabase/functions/_shared/oqcaRuntime/substrate.ts
SHA=supabase/functions/_shared/oqcaRuntime/shadow.ts
DJ=supabase/functions/_shared/oqcaRuntime/dispatchJob.ts

# M85: the mirror goes back to a hand-written entrypoint list. The substrate and
# the quantum domain stop being mirrored, and the shipped runtime imports files
# that are not there — which is item A's whole point.
F=scripts/oqca-mirror.mjs; cp $F "$BAK"
mutate <<'PY2'
p='scripts/oqca-mirror.mjs'; s=open(p).read()
old='  walk(dir);\n  return [...roots].sort();'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  walk(dir);\n  void roots;\n  return [join(SRC_ROOT, "loop", "cognitiveLoop.ts")];')
open(p,'w').write(s)
PY2
report "M85 the mirror entrypoints become a hand-written list" "$(run src/oqca/__tests__/mirror.test.ts)"
cp "$BAK" $F; mirror

# M86: the experimental rung is given more weight than `fetched`, silently
# rewriting the promotion table the threshold was measured from.
F=src/oqca/knowledge/substrate/evidence.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/knowledge/substrate/evidence.ts'; s=open(p).read()
old='  experimentally_verified: 1,\n  fetched: 1,'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  experimentally_verified: 1.5,\n  fetched: 1,')
open(p,'w').write(s)
PY2
mirror
report "M86 the experimental rung is weighted above 1" "$(run $RK)"
restore $F

# M87: the control check is removed from the convention experiment. A backend
# that answers the same bitstring whichever qubit moved now "confirms" an
# ordering it cannot discriminate.
F=src/oqca/quantum/conventions.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/quantum/conventions.ts'; s=open(p).read()
old='  if (observed === controlObserved) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  if (false && observed === controlObserved) {')
open(p,'w').write(s)
PY2
mirror
report "M87 the experiment's control check is removed" "$(run $RK)"
restore $F

# M88: an unrecognised outcome is adopted as a NEW convention instead of being
# refused. This is the one that turns an experiment into a story.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/quantum/conventions.ts'; s=open(p).read()
old='  if (matched.length !== 1) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  if (false && matched.length !== 1) {')
open(p,'w').write(s)
PY2
mirror
report "M88 an unpredicted outcome becomes a new convention" "$(run $RK)"
restore $F

# M89: a VOID experiment is recorded anyway — a fabricated negative result,
# which v1.3 section 12 forbids by name.
F=src/oqca/quantum/knowledge.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/quantum/knowledge.ts'; s=open(p).read()
old='    if (outcome.convention === null) continue;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    const outcome2 = { ...outcome, convention: outcome.convention ?? "big_endian" };\n    void outcome2;')
s=s.replace('        outcome.convention,','        outcome.convention ?? "big_endian",')
open(p,'w').write(s)
PY2
mirror
report "M89 a void experiment is recorded anyway" "$(run $RK)"
restore $F

# M90: `measured_precedence` is removed, so additive weight decides — and two
# stale release notes out-vote a reading of the running module.
F=src/oqca/knowledge/substrate/conflict.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/knowledge/substrate/conflict.ts'; s=open(p).read()
old='  const measured = competing.filter(hasMeasuredSupport);\n  if (measured.length === 1) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  const measured = competing.filter(hasMeasuredSupport);\n  if (false && measured.length === 1) {')
open(p,'w').write(s)
PY2
mirror
report "M90 a measurement stops outranking documents about the same system" "$(run $RK)"
restore $F

# M91: `divergent_by_design` is checked AFTER the precedence rules, so an
# experiment on ONIQ's own backend can delete a convention that is correct on
# both sides — section 23's silent normalisation, arriving through the new door.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/knowledge/substrate/conflict.ts'; s=open(p).read()
old='  if (kind === "divergent_by_design") {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  if (false && kind === "divergent_by_design") {')
open(p,'w').write(s)
PY2
mirror
report "M91 divergent_by_design loses its precedence" "$(run $RK)"
restore $F

# M92: the projection goes back to writing the RECORD's aggregate onto every
# evidence item — the defect wiring the substrate to the gap detector found.
F=src/oqca/knowledge/substrate/project.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/knowledge/substrate/project.ts'; s=open(p).read()
old='          evidenceWeight(e, sources.get(e.sourceId) ?? null),'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'          r.confidence,')
open(p,'w').write(s)
PY2
mirror
report "M92 every evidence item gets the record's aggregate confidence" "$(run $RK)"
restore $F

# M93: a paraphrase is relabelled as a first-hand reading, which is exactly the
# pseudo-provenance the directness type exists to prevent.
F=$SUB; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/substrate.ts'; s=open(p).read()
old='    directness: "spec_cited",\n    extraction: "human_authored",'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    directness: "fetched",\n    extraction: "computed",')
open(p,'w').write(s)
PY2
report "M93 a paraphrase is relabelled a first-hand reading" "$(run $RK)"
restore $F

# M94: `believedBackoff` believes a record the promotion policy refused.
F=$SHA; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/shadow.ts'; s=open(p).read()
old='    .find((r) => r.predicate === "windowMs" && r.status === "VERIFIED");'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    .find((r) => r.predicate === "windowMs");')
open(p,'w').write(s)
PY2
report "M94 a refused record becomes a belief" "$(run $RK)"
restore $F

# M95: the fallback to the enforced constant is removed, so a malformed record
# yields NaN and the loop reasons about a world with no rule in it.
cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/shadow.ts'; s=open(p).read()
old='  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DISPATCH_BACKOFF_MS;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  return v as number;')
open(p,'w').write(s)
PY2
report "M95 believedBackoff loses its fail-safe fallback" "$(run $RK)"
restore $F

# M96: the KnowledgeState stops being supplied to the loop. IDENTIFY_GAPS goes
# back to refusing every run — the state item B exists to end, and the one that
# would read as "nothing changed" rather than as a break.
cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/shadow.ts'; s=open(p).read()
old='    knowledge: substrate.state,'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'')
open(p,'w').write(s)
PY2
report "M96 the loop is no longer handed a KnowledgeState" "$(run $RK src/oqca/__tests__/shadowRun.test.ts)"
restore $F

# M97: the AUTHORIZATION site is given the belief. A wrong belief can now open a
# door the enforced rule keeps shut, which is the one thing the split exists to
# make impossible.
F=$DJ; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/dispatchJob.ts'; s=open(p).read()
old='        if (!isDispatchable(fresh, now)) return `job ${id} is inside its dispatch backoff`;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'        if (!isDispatchable(fresh, now, 0)) return `job ${id} is inside its dispatch backoff`;')
open(p,'w').write(s)
PY2
report "M97 the authorization check takes a belief" "$(run $RK)"
restore $F

# M98: the tool REGISTRY is gated on a belief, so a belief can conjure a tool
# for a job the real rule refuses.
cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/dispatchJob.ts'; s=open(p).read()
old='    .filter((j) => isDispatchable(j, env.nowMs()))'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    .filter((j) => isDispatchable(j, env.nowMs(), 0))')
open(p,'w').write(s)
PY2
report "M98 the tool registry is gated on a belief" "$(run $RK)"
restore $F

# M99: the eligibility probe stops straddling the boundary, so it measures the
# sign of a subtraction rather than the window.
F=$SUB; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/substrate.ts'; s=open(p).read()
old='  const justInside = rule(row(nowMs - windowMs + 60_000), nowMs, windowMs);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  const justInside = false;')
s=s.replace('    ok: justOutside === true && justInside === false && neverDispatched === true,',
            '    ok: justOutside === true && neverDispatched === true,')
open(p,'w').write(s)
PY2
report "M99 the eligibility probe stops checking the far side" "$(run $RK)"
restore $F

# M100: a real `fetch` lands in the runtime substrate. The read-only, zero-spend
# claim is the whole of item B, and it must not survive this.
cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/substrate.ts'; s=open(p).read()
old='export function substrateGap(): string {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'export async function phoneHome(u: string) {\n  return await fetch(u);\n}\n\nexport function substrateGap(): string {')
open(p,'w').write(s)
PY2
report "M100 a real fetch lands in the runtime substrate" "$(run $RK)"
restore $F

# M101: `dependentsOf` stops reading history, so a retired record's dependents
# become invisible — exactly when an upgrade needs to find them.
F=src/oqca/knowledge/substrate/store.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/knowledge/substrate/store.ts'; s=open(p).read()
old='  return [...store.all(), ...store.history()]'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  return [...store.all()]')
open(p,'w').write(s)
PY2
mirror
report "M101 dependentsOf stops reading history" "$(run src/oqca/__tests__/oksSubstrate.test.ts $RK)"
restore $F

# M102: a labelled metric returns 0 instead of null. Item H's whole instruction
# — "do not manufacture a benchmark label set just to turn null into 0" — and
# the distinction is the scientifically important one.
F=src/oqca/knowledge/substrate/metrics.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/knowledge/substrate/metrics.ts'; s=open(p).read()
old='  if (scored.length === 0) return null;'
assert s.count(old)>=1, s.count(old)
s=s.replace(old,'  if (scored.length === 0) return 0;',1)
open(p,'w').write(s)
PY2
mirror
report "M102 a labelled metric reports 0 instead of null" "$(run $RK src/oqca/__tests__/oksSubstrate.test.ts)"
restore $F

# ---------------------------------------------------------------- #
# v1.5 — THE AUTONOMOUS RUNTIME. A loop that generates its own goals and keeps
# going without anybody asking is only as safe as the things that stop it, so
# every mutation below removes one STOP rather than one feature.
# ---------------------------------------------------------------- #
AU=src/oqca/__tests__/autonomy.test.ts

# M103: the generator can mint a `user_request`. THE safety property of
# objective.ts — a loop attributing its own goal to somebody who never asked.
F=src/oqca/autonomy/objective.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/objective.ts'; s=open(p).read()
old='      source: "maintenance",'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      source: "user_request",')
open(p,'w').write(s)
PY2
mirror
report "M103 the generator mints a user_request" "$(run $AU)"
restore $F

# M104: the id commits to importance, which drifts with the evidence — so an
# unresolved gap mints a NEW objective every cycle and the backlog bound is the
# only thing left between the runtime and unbounded growth.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/objective.ts'; s=open(p).read()
old='    concepts: [...goal.requires].map((r) => r.conceptId).sort(),'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    concepts: [...goal.requires].map((r) => r.conceptId + ":" + r.importance).sort(),')
open(p,'w').write(s)
PY2
mirror
report "M104 the objective id commits to importance" "$(run $AU)"
restore $F

# M105: a regenerated objective overwrites the in-flight one, resurrecting a
# blocked objective as fresh every cycle and losing the attempt count.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/objective.ts'; s=open(p).read()
old='    byId.set(g.id, prior ? { ...prior, priority: g.priority } : g);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    byId.set(g.id, g);')
open(p,'w').write(s)
PY2
mirror
report "M105 a regenerated objective overwrites the in-flight one" "$(run $AU)"
restore $F

# M106: the same-requirement-set check goes. That is the regress in its purest
# form, and the content-derived id HIDES it: the child dedupes onto its parent.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/objective.ts'; s=open(p).read()
old='concepts.every((c, i) => c === parentConcepts[i])'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'false')
open(p,'w').write(s)
PY2
mirror
report "M106 a follow-up may be its own parent" "$(run $AU)"
restore $F

# M107: the depth bound goes, so a chain naming a new concept each time never
# terminates.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/objective.ts'; s=open(p).read()
old='  if (objective.depth >= MAX_FOLLOW_UP_DEPTH) return null;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'')
open(p,'w').write(s)
PY2
mirror
report "M107 the follow-up chain loses its depth bound" "$(run $AU)"
restore $F

# M108: the runtime's own chores can outscore a waiting person.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/objective.ts'; s=open(p).read()
old='    return aUser - bUser || b.priority - a.priority || a.id.localeCompare(b.id);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    return b.priority - a.priority || a.id.localeCompare(b.id);')
open(p,'w').write(s)
PY2
mirror
report "M108 a user request stops outranking the runtime's chores" "$(run $AU)"
restore $F

# M109: a blocked or done objective becomes selectable — the shape of a runtime
# that spins on one objective and calls it work.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/objective.ts'; s=open(p).read()
old='  const pending = backlog.filter((o) => o.status === "pending");'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  const pending = backlog.filter((o) => o.status !== "active");')
open(p,'w').write(s)
PY2
mirror
report "M109 a blocked objective becomes selectable again" "$(run $AU)"
restore $F

# M110: the brief's "freshness" taken LITERALLY. A stale claim then scores near
# zero and is never looked at again — the silent inversion this factor's
# orientation exists to prevent.
F=src/oqca/autonomy/select.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/select.ts'; s=open(p).read()
old='  return clampModifier(f.ageMs / f.intervalMs);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  return clampModifier(1 - f.ageMs / f.intervalMs);')
open(p,'w').write(s)
PY2
mirror
report "M110 staleness is read as literal freshness" "$(run $AU)"
restore $F

# M111: the modifier floor goes to zero, so one context factor annihilates four
# real measurements about the gap itself.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/select.ts'; s=open(p).read()
old='export const MODIFIER_FLOOR = 0.05;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'export const MODIFIER_FLOOR = 0;')
open(p,'w').write(s)
PY2
mirror
report "M111 a context factor may veto the other five" "$(run $AU)"
restore $F

# M112: relevance stops being graph distance and becomes a constant, which is
# the "invent a measure calibrated against nothing" failure.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/select.ts'; s=open(p).read()
old='  if (seeds.includes(conceptId)) return 1;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  if (seeds.includes(conceptId)) return 1;\n  return 0.5;')
open(p,'w').write(s)
PY2
mirror
report "M112 relevance stops being graph distance" "$(run $AU)"
restore $F

# M113: the runtime STOPS on the first blocked objective. The owner's sentence
# inverted: blocked on one objective becomes cognitively dead.
F=src/oqca/autonomy/runtime.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='      consecutiveBlocked += 1;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      consecutiveBlocked += 1;\n      stop = "stalled";\n      stopDetail = "an objective blocked";')
open(p,'w').write(s)
PY2
mirror
report "M113 the runtime dies on the first blocked objective" "$(run $AU)"
restore $F

# M114: the episode bound reads the LIFETIME counter, so a restored runtime is
# dead on arrival. Invisible to a single-process test — this is the defect the
# two-process script found.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='    if (ranHere >= bounds.maxEpisodes) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    if (snapshot.episode >= bounds.maxEpisodes) {')
open(p,'w').write(s)
PY2
mirror
report "M114 the episode bound reads the lifetime counter" "$(run $AU)"
restore $F

# M115: an all-blocked backlog reports `idle` — a system announcing it has
# nothing left to learn while it is stuck.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='      const stuck = backlog.filter((o) => o.status === "blocked");'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      const stuck: typeof backlog = [];')
open(p,'w').write(s)
PY2
mirror
report "M115 a stalled runtime reports idle" "$(run $AU)"
restore $F

# M116: trimming drops what carries history, so the runtime forgets what it
# already tried and re-queues it forever.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='  const keep = backlog.filter((o) => o.status !== "pending");'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  const keep: typeof backlog = [];')
open(p,'w').write(s)
PY2
mirror
report "M116 trimming drops objectives that carry history" "$(run $AU)"
restore $F

# M117: reawakening ignores the attempt bound, so a blocker that clears
# repeatedly revives the same objective forever.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='    if (!child) return o;\n    if (o.attempts >= MAX_ATTEMPTS) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    if (!child) return o;\n    if (o.attempts >= Number.MAX_SAFE_INTEGER) {')
open(p,'w').write(s)
PY2
mirror
report "M117 reawakening ignores the attempt bound" "$(run $AU)"
restore $F

# M118: the episode reports what was ALREADY known as `learned`. A metric that
# reads as progress and is really a restatement of the starting position.
F=supabase/functions/_shared/oqcaRuntime/autonomous.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/autonomous.ts'; s=open(p).read()
old='        settled,\n        learned: [],'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'        settled,\n        learned: settled,')
open(p,'w').write(s)
PY2
report "M118 the episode reports already-known facts as learned" "$(run $AU)"
restore $F

# M119: maintenance stops being scoped to what the current goals depend on, so
# a hundred re-verification objectives arrive on the first cycle and the backlog
# bound silently decides what ONIQ cares about.
cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/autonomous.ts'; s=open(p).read()
old='    if (!wanted.has(r.subject)) continue;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'')
open(p,'w').write(s)
PY2
report "M119 maintenance stops being scoped to the current goals" "$(run $AU)"
restore $F

# M120: the world OFFERS the research action ONIQ does not have, so the loop
# plans it, calls a router with no such tool, and a missing capability reads as
# a broken integration.
cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/autonomous.ts'; s=open(p).read()
old='      unavailableActions: basis.map((c) => `research ${c}`),'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      availableActions: basis.map((c) => `research ${c}`),')
open(p,'w').write(s)
PY2
report "M120 the world offers a research action ONIQ does not have" "$(run $AU)"
restore $F

# ================================================================== #
# v1.6 — COGNITIVE AUTONOMY != RESOURCE AVAILABILITY.
#
# Every one of these puts back a version of the same defect: a resource being
# unavailable ending the thinking. The ones that matter most are M121 and M122,
# because they are what the code actually did before this version and each is a
# one-line edit an unwary refactor would make.
# ================================================================== #
CA=src/oqca/__tests__/capabilityAware.test.ts
LOOPF=src/oqca/loop/cognitiveLoop.ts
CAPF=src/oqca/loop/capability.ts

# M121: the terminal fires on the FIRST capability refusal instead of on the
# last iteration — the run-level `starvedBy` behaviour, restored. Every station
# after the first refusal stops running, which is the exact defect v1.6 removes.
F=$LOOPF; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/loop/cognitiveLoop.ts'; s=open(p).read()
old='            unavailable(capabilityList(capabilities)).length > 0 &&\n            spent.iterations + 1 >= budgets.maxIterations'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'            unavailable(capabilityList(capabilities)).length > 0')
open(p,'w').write(s)
PY2
mirror
report "M121 a capability refusal ends the run on the first iteration" "$(run $CA src/oqca/__tests__/cognitiveLoop.test.ts)"
restore $F

# M122: EVALUATE goes back to ending the RUN on an unaffordable plan. Self-
# evaluation stopping self-evaluation, which is what it used to do.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/loop/cognitiveLoop.ts'; s=open(p).read()
old='            state = step({ selectedPlan: null, spent });\n            const availability = availabilityForBound(wouldSpend);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'            state = step({ selectedPlan: null, spent });\n            if (wouldSpend) break outer;\n            const availability = availabilityForBound(wouldSpend);')
open(p,'w').write(s)
PY2
mirror
report "M122 EVALUATE ends the run on an unaffordable plan" "$(run $CA)"
restore $F

# M123: a budget ONIQ set for itself starts speaking for a provider's decision
# about who ONIQ is. Raising a number would then read as an authorization fix.
F=$CAPF; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/loop/capability.ts'; s=open(p).read()
old='    case "max_tokens":\n    case "max_cost":'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    case "max_tokens":\n      return "unauthorized";\n    case "max_cost":')
open(p,'w').write(s)
PY2
mirror
report "M123 a spend bound reports itself as a permission refusal" "$(run $CA)"
restore $F

# M124: a RUN bound is filed as a capability, so "this run has no time left"
# reads as something somebody could go and grant.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/loop/capability.ts'; s=open(p).read()
old='    case "max_iterations":\n    case "max_state_transitions":\n    case "max_execution_time":\n      return null;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    case "max_iterations":\n    case "max_state_transitions":\n    case "max_execution_time":\n      return "insufficient_allowance";')
open(p,'w').write(s)
PY2
mirror
report "M124 a run bound is filed as a capability state" "$(run $CA)"
restore $F

# M125: the ledger keeps the FIRST refusal across cycles as well as within a
# run. The rule is correct inside one run and makes recovery UNREACHABLE across
# them — a credential that came back could never be observed.
F=src/oqca/autonomy/runtime.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='  for (const c of observed) out.set(c.capability, c);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  for (const c of observed) { const prior = out.get(c.capability); if (prior && !isExecutable(prior.availability)) continue; out.set(c.capability, c); }')
open(p,'w').write(s)
PY2
mirror
report "M125 a refusal is kept forever, so a capability can never come back" "$(run $CA)"
restore $F

# M126: reconsideration on an UNOBSERVED capability. Silence read as
# availability spins every blocked objective back to pending every cycle.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='      return now !== undefined && isExecutable(now.availability);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      return now === undefined || isExecutable(now.availability);')
open(p,'w').write(s)
PY2
mirror
report "M126 an unobserved capability counts as available" "$(run $CA)"
restore $F

# M127: reconsideration ignores the attempt bound, so a flapping resource
# revives the same objective for ever.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='    if (!back) return o;\n    if (o.attempts >= MAX_ATTEMPTS) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    if (!back) return o;\n    if (o.attempts >= Number.MAX_SAFE_INTEGER) {')
open(p,'w').write(s)
PY2
mirror
report "M127 reconsideration ignores the attempt bound" "$(run $CA)"
restore $F

# M128: reconsideration removed outright — the backlog is preserved and never
# looked at again, which is a graveyard with good bookkeeping.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='    let backlog = reconsider(snapshot.backlog, capabilities);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    let backlog = snapshot.backlog;')
old2='    backlog = reconsider(backlog, capabilities);'
assert s.count(old2)==1, s.count(old2)
s=s.replace(old2,'')
open(p,'w').write(s)
PY2
mirror
report "M128 a capability-blocked objective is never reconsidered" "$(run $CA)"
restore $F

# M129: the dependency is counted and not PRESERVED, so nothing survives to be
# reconsidered and the snapshot cannot answer what the objective is waiting on.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='        blockedCapabilities: refused,'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'        blockedCapabilities: [],')
open(p,'w').write(s)
PY2
mirror
report "M129 the blocked objective forgets what it is waiting on" "$(run $CA)"
restore $F

# M130: `capability_blocked` collapsed into `stalled` at selection. A missing
# credential is then reported as ONIQ having run out of ideas.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='        stop = "capability_blocked";\n        stopDetail =\n          `nothing is pending: ${stuck.length} objective(s) are waiting on a capability — `'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'        stop = "stalled";\n        stopDetail =\n          `nothing is pending: ${stuck.length} objective(s) are waiting on a capability — `')
open(p,'w').write(s)
PY2
mirror
report "M130 a resource block is reported as a cognitive stall" "$(run $CA)"
restore $F

# M131: the same collapse at the consecutive-block guard.
cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='    if (consecutiveCapabilityBlocked >= bounds.maxConsecutiveBlocked) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    if (false) {')
open(p,'w').write(s)
PY2
mirror
report "M131 a run of resource blocks is reported as a stall" "$(run $CA)"
restore $F

# M132: v1.6 quietly buys itself a budget so the tests stop exercising the zero
# case. Requirements 8 and 9: autonomy being enabled may not start a bill.
F=src/oqca/loop/seams.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/loop/seams.ts'; s=open(p).read()
old='  maxCostUsd: 0,'
assert s.count(old)>=1, s.count(old)
s=s.replace(old,'  maxCostUsd: 0.5,',1)
open(p,'w').write(s)
PY2
mirror
report "M132 the shipped default grows a cost ceiling" "$(run $CA)"
restore $F

# M133: the episode reports only the REFUSALS. Every other test still passes —
# the refusal rows are identical — and requirement 8 becomes unreachable,
# because a capability that came back is never observed working.
F=supabase/functions/_shared/oqcaRuntime/autonomous.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/autonomous.ts'; s=open(p).read()
old='    const capabilities = run.capabilities;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    const capabilities = unavailable(run.capabilities);')
open(p,'w').write(s)
PY2
report "M133 the episode reports only its refusals, never a working capability" "$(run $CA)"
restore $F

# M134: the RUNTIME filters the episode's report down to the refusals. Same
# hole as M133, one layer up, and it would survive M133 being fixed.
F=src/oqca/autonomy/runtime.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='    capabilities = observeCapabilities(capabilities, outcome.capabilities);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    capabilities = observeCapabilities(capabilities, unavailable(outcome.capabilities));')
open(p,'w').write(s)
PY2
mirror
report "M134 the runtime drops the episode's working capabilities" "$(run $CA)"
restore $F


# ---------------------------------------------------------------------------
# v1.7 — the owner directive of 2026-09-11, §23's own list. Each of these is a
# way the self-improvement loop could look autonomous while being a fixture, or
# could claim a result it did not measure.
# ---------------------------------------------------------------------------
SI=src/oqca/__tests__/selfImprovement.test.ts
SL=src/oqca/__tests__/selfImproveLifecycle.test.ts

# M135: OBJECTIVE GENERATION becomes a fixed list — the one thing §5 forbids by
# name, and the shape the HARD RULE exists to catch. Every concern collapses
# onto one goal id, so the decision stops being a fact about what ONIQ saw.
F=src/oqca/autonomy/improve.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/improve.ts'; s=open(p).read()
old='  const id = `improve:${concernId(o)}`;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  const id = "improve:fixed-objective";')
open(p,'w').write(s)
PY2
mirror
report "M135 objective generation collapses to a fixed list" "$(run $SI $SL)"
restore $F

# M136: PRIORITIZATION stops reading the observation — every factor becomes a
# constant, so the ranking is a fact about this function rather than about ONIQ.
F=src/oqca/autonomy/improve.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/improve.ts'; s=open(p).read()
old='export function uncertaintyOf(o: Observation): number {'
assert s.count(old)==1, s.count(old)
s=s.replace(old, old+'\n  return 0.5;')
open(p,'w').write(s)
PY2
mirror
report "M136 the uncertainty factor stops reading the observation" "$(run $SI)"
restore $F

# M137: the DEPENDENCY factor goes back to the fraction that is zero for an
# isolated subject. This is the live defect the first four-process run exposed:
# six multiplied factors, one zero, every score 0.000000 and an alphabetical
# ranking that still looks ordered and reproducible.
F=src/oqca/autonomy/improve.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/improve.ts'; s=open(p).read()
old='  return 1 + others / total;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  return others / total;')
open(p,'w').write(s)
PY2
mirror
report "M137 the dependency factor can zero the whole score again" "$(run $SI)"
restore $F

# M138: the PLANNING modifier becomes a veto. A capability ONIQ cannot use now
# would then DELETE the objective rather than defer it, and v1.6's whole
# correction — a resource shortfall is not cognitive death — is undone one
# layer up.
F=src/oqca/autonomy/improve.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/improve.ts'; s=open(p).read()
old='function floor(x: number): number {\n  return Math.min(1, Math.max(MODIFIER_FLOOR, x));\n}'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'function floor(x: number): number {\n  return Math.min(1, x);\n}')
open(p,'w').write(s)
PY2
mirror
report "M138 the planning modifier becomes a veto" "$(run $SI)"
restore $F

# M139: KNOWLEDGE-GAP DETECTION treats a stale record as known, so research is
# skipped for exactly the claim where acting on the stored answer is worst.
F=src/oqca/autonomy/improve.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/improve.ts'; s=open(p).read()
old='  return needs.every((n) => n.verdict === "known") ? "SKIP_RESEARCH" : "RESEARCH";'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  return needs.every((n) => n.verdict === "known" || n.verdict === "stale") ? "SKIP_RESEARCH" : "RESEARCH";')
open(p,'w').write(s)
PY2
mirror
report "M139 a stale record is read as known and research is skipped" "$(run $SI)"
restore $F

# M140: KNOWLEDGE PERSISTENCE silently loses a field on the round trip. The
# record still LOOKS right and reconciles onto a different content — the
# split-brain across a restart a durable store exists to prevent.
F=src/oqca/knowledge/substrate/durable.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/knowledge/substrate/durable.ts'; s=open(p).read()
old='    contradicts: row.contradicts,'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    contradicts: [],')
open(p,'w').write(s)
PY2
mirror
report "M140 the durable round trip drops a field" "$(run $SI)"
restore $F

# M141: the durable store reads a CORRUPTED file as an empty one. A runtime
# would then start from nothing every morning with nothing anywhere saying so.
F=supabase/functions/_shared/oqcaRuntime/durableStore.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/durableStore.ts'; s=open(p).read()
old='      const reason = "the durable knowledge store could not be parsed";\n      sink.note?.(reason);\n      return { ok: false, reason };'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      return { ok: true, rows: [] };')
open(p,'w').write(s)
PY2
report "M141 a corrupted durable store reads as an empty one" "$(run $SI)"
restore $F

# M142: the store reports the count it was HANDED rather than the count the
# sink confirmed — the silent no-op this repo has a receipt for.
F=supabase/functions/_shared/oqcaRuntime/durableStore.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/durableStore.ts'; s=open(p).read()
old='      if (!wrote) return { ok: false, reason: "the durable sink did not confirm the write" };'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      void wrote;')
open(p,'w').write(s)
PY2
report "M142 a write the sink refused is reported as written" "$(run $SI)"
restore $F

# M143: KNOWLEDGE PROMOTION is bypassed — a retrieved line is written VERIFIED
# at the point of creation, which is the one property `draftRecord` exists to
# make impossible.
F=supabase/functions/_shared/oqcaRuntime/improvement.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/improvement.ts'; s=open(p).read()
old='            const decided = applyPromotion(draft, evaluatePromotion(draft, sources));'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'            const decided = { ...draft, status: "VERIFIED" as const, confidence: 1 };')
open(p,'w').write(s)
PY2
report "M143 promotion is bypassed and a draft is written VERIFIED" "$(run $SL)"
restore $F

# M144: the LEARNED-vs-SETTLED distinction collapses — re-promoting a record
# ONIQ already held counts as learning. This is the live over-claim the first
# four-process run produced: "3 learned" beside a verdict of NO_DIFFERENCE.
F=supabase/functions/_shared/oqcaRuntime/improvement.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/improvement.ts'; s=open(p).read()
old='              if (held === null || held.status !== "VERIFIED") learned.push(decided.subject);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'              learned.push(decided.subject);')
open(p,'w').write(s)
PY2
report "M144 re-promoting knowledge ONIQ already held counts as learning" "$(run $SL)"
restore $F

# M145: the BASELINE is measured AFTER the intervention, so both arms read the
# same state and every experiment answers NO_DIFFERENCE — a loop that can never
# detect its own improvement.
F=supabase/functions/_shared/oqcaRuntime/improvement.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/improvement.ts'; s=open(p).read()
old='    const baselineGaps = residualUncertainty(goal, before);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    const baselineGaps = residualUncertainty(goal, before) * 0 + 0.125;')
open(p,'w').write(s)
PY2
report "M145 the baseline is not the pre-intervention reading" "$(run $SL)"
restore $F

# M146: INCONCLUSIVE becomes success. §11's own sentence, inverted.
F=src/oqca/autonomy/experiment.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/experiment.ts'; s=open(p).read()
old='    improvementVerified: d.kind === "improvement" && improved,'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    improvementVerified: true,')
open(p,'w').write(s)
PY2
mirror
report "M146 every comparison counts as a verified improvement" "$(run $SI)"
restore $F

# M147: a capability refusal produces a MEASURED NEGATIVE rather than BLOCKED.
# Both arms are equal because nothing was intervened, so `compare` would answer
# "no difference" — a statement that the intervention was tried and did nothing.
F=supabase/functions/_shared/oqcaRuntime/improvement.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/improvement.ts'; s=open(p).read()
old='    const intervened = decision === "SKIP_RESEARCH" || retrievalRan;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    const intervened = true;')
open(p,'w').write(s)
PY2
report "M147 a refused intervention is reported as a measured negative" "$(run $SL)"
restore $F

# M148: CAPABILITY AUTHORIZATION is dropped — registration alone admits, so
# `RUN_BENCHMARK` and `UPDATE_CONFIGURATION` reach the executor.
F=supabase/functions/_shared/oqcaRuntime/selfModel.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/selfModel.ts'; s=open(p).read()
old='  if (!cap.authorized) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  if (false) {')
open(p,'w').write(s)
PY2
report "M148 registration alone admits a capability" "$(run $SI)"
restore $F

# M149: the §12 gate sinks BELOW the write it guards, so the durable store is
# written and the refusal is reported afterwards.
F=supabase/functions/_shared/oqcaRuntime/improvement.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/improvement.ts'; s=open(p).read()
old='      if (!permitted.ok) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      const rowsAnyway = promoted.map((r) => toDurable(r, { createdAt: at, updatedAt: at }));\n      await durable.save(rowsAnyway);\n      if (!permitted.ok) {')
open(p,'w').write(s)
PY2
report "M149 the capability gate sinks below the write it guards" "$(run $SL)"
restore $F

# M150: a §12 capability that would SPEND becomes authorized. Under CLAUDE.md's
# first rule that is the owner's decision, not a default.
F=supabase/functions/_shared/oqcaRuntime/selfModel.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/selfModel.ts'; s=open(p).read()
old='    describe: "ask an external provider a question; spends money per call",'
assert s.count(old)==1, s.count(old)
s=s.replace('    authorized: false,\n    describe: "ask an external provider a question; spends money per call",',
            '    authorized: true,\n    describe: "ask an external provider a question; spends money per call",')
open(p,'w').write(s)
PY2
report "M150 a spending capability is authorized by default" "$(run $SI)"
restore $F

# M151: RESEARCH fabricates. An empty corpus answers "I searched and found
# nothing" — the negative result §9 forbids inventing, arriving through the one
# door nobody watches.
F=supabase/functions/_shared/oqcaRuntime/research.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/research.ts'; s=open(p).read()
old='      return { ok: false, reason: "the local evidence corpus is empty: nothing was searched" };'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      return { ok: true, findings: [], searched: 0 };')
open(p,'w').write(s)
PY2
report "M151 an empty corpus answers 'found nothing' instead of refusing" "$(run $SI)"
restore $F

# M152: the excerpt stops being verbatim. A reworded quotation is a fabricated
# citation with a real locator on it, which is worse than none.
F=supabase/functions/_shared/oqcaRuntime/research.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/research.ts'; s=open(p).read()
old='          excerpt: line.slice(0, MAX_LOCAL_EXCERPT),'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'          excerpt: `a document mentions ${terms.join(" ")}`,')
open(p,'w').write(s)
PY2
report "M152 the excerpt stops being verbatim" "$(run $SI)"
restore $F

# M153: the substance rule goes, so a line that is only the question's own words
# is promoted as an answer — the measured tautology from the live run.
F=supabase/functions/_shared/oqcaRuntime/research.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/research.ts'; s=open(p).read()
old='        if (substance(line, terms) < MIN_SUBSTANCE) continue;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'')
open(p,'w').write(s)
PY2
report "M153 a line that restates the question counts as a finding" "$(run $SI)"
restore $F

# M154: the OBSERVER reads a missing severity as zero, so "I looked and cannot
# tell" becomes "I looked and it is fine" — §3's own failure, in the one place
# §3 is enforced.
F=supabase/functions/_shared/oqcaRuntime/observe.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/observe.ts'; s=open(p).read()
old='  if (item.severity === null) {'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  if (false) {')
s=s.replace('    severity: item.severity,','    severity: item.severity ?? 0,')
open(p,'w').write(s)
PY2
report "M154 an unknown severity is read as healthy" "$(run $SI)"
restore $F

# M155: a refused observer produces SILENCE rather than nineteen UNOBSERVED
# rows, so "no observation" reads as "healthy" one layer down.
F=src/oqca/autonomy/observation.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/observation.ts'; s=open(p).read()
i=s.index('  const filled = kinds')
j=s.index('\n', s.index('unobserved(k, k, why));', i))
s=s[:i]+'  const filled: Observation[] = [];\n  void why;\n  void kinds;'+s[j:]
open(p,'w').write(s)
PY2
mirror
report "M155 an unmentioned kind is absent instead of UNOBSERVED" "$(run $SI $SL)"
restore $F

# M156: an UNREGISTERED capability name is carried through, so a concern
# declares a need no registry knows and the planner ranks it as free.
F=supabase/functions/_shared/oqcaRuntime/observe.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/observe.ts'; s=open(p).read()
old='  return requires.filter((r) => isRegistered(r));'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'  return requires;')
open(p,'w').write(s)
PY2
report "M156 an unregistered capability name is carried into the plan" "$(run $SI)"
restore $F

# M157: CHECKPOINT PERSISTENCE loses the new fields, so a restored runtime has
# no baselines and every first reading looks like a win.
F=src/oqca/autonomy/runtime.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='      baselines: [...baselines.entries()].map(([k, v]) => [k, v] as const),\n      failureLog,\n      experiments,\n      stop: null,'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      baselines: [],\n      failureLog: [],\n      experiments: [],\n      stop: null,')
open(p,'w').write(s)
PY2
mirror
report "M157 the snapshot drops the baselines and the experiment ledger" "$(run $SL)"
restore $F

# M158: CROSS-PROCESS RESTORATION is dropped — the durable rows are loaded and
# never put into the tick's store, so every process starts from nothing while
# the file grows.
F=supabase/functions/_shared/oqcaRuntime/improvement.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/improvement.ts'; s=open(p).read()
old='    for (const r of hydrated.records) build.store.put(r);'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'    void hydrated;')
open(p,'w').write(s)
PY2
report "M158 durable knowledge is loaded and never used" "$(run $SL)"
restore $F

# M159: the SNAPSHOT VERSION is not bumped, so a v1 checkpoint is read as a v2
# one and its missing fields arrive as `undefined`.
F=src/oqca/autonomy/runtime.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='export const SNAPSHOT_VERSION = 2;'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'export const SNAPSHOT_VERSION = 1;')
open(p,'w').write(s)
PY2
mirror
report "M159 the snapshot version is not bumped for the new fields" "$(run $SL)"
restore $F

# M160: OBJECTIVE CONTINUATION breaks — the observer's findings never reach the
# backlog, so ONIQ observes itself and does nothing about it.
F=src/oqca/autonomy/runtime.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/runtime.ts'; s=open(p).read()
old='      improvements: concerns.map((c) => ({'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      improvements: [].map((c: never) => ({')
open(p,'w').write(s)
PY2
mirror
report "M160 observed concerns never become objectives" "$(run $SL)"
restore $F

# M161: the loop is handed a REFUSING research adapter while the episode
# retrieves, so one run reports research as both available and unavailable and
# every experiment comes back BLOCKED. The live defect, restored.
F=supabase/functions/_shared/oqcaRuntime/improvement.ts; cp $F "$BAK"
mutate <<'PY2'
p='supabase/functions/_shared/oqcaRuntime/improvement.ts'; s=open(p).read()
old='      research: deps.research?.adapter,'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      research: undefined,')
open(p,'w').write(s)
PY2
report "M161 the 23 stations get a refusing adapter the episode is not using" "$(run $SL)"
restore $F

# M162: SELF-EVALUATION answers `no` where it measured nothing. "ONIQ checked
# and did not improve" is a claim; `unestablished` is the truth, and it is the
# answer that generates the next objective rather than the wrong one.
F=src/oqca/autonomy/selfEval.ts; cp $F "$BAK"
mutate <<'PY2'
p='src/oqca/autonomy/selfEval.ts'; s=open(p).read()
old='      x === null\n        ? "unestablished"\n        : x.improvementVerified'
assert s.count(old)==1, s.count(old)
s=s.replace(old,'      x === null\n        ? "no"\n        : x.improvementVerified')
open(p,'w').write(s)
PY2
mirror
report "M162 a cycle that measured nothing answers 'no' rather than unestablished" "$(run $SI)"
restore $F

echo "done"
