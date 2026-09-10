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
report "M1 the control half of the pair grows a phase" "$(run src/oqca/__tests__/benchmark.test.ts)"
cp "$BAK" $F

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
report "M2 a control task is given an interference" "$(run src/oqca/__tests__/benchmark.test.ts)"
cp "$BAK" $F

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
report "M3 phase moves probability by itself" "$(run src/oqca)"
cp "$BAK" $F

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
report "M4 reweight is no longer Bayes" "$(run src/oqca)"
cp "$BAK" $F

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
cp "$BAK" $F

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
report "M6 measurement samples instead of taking the maximum" "$(run src/oqca)"
cp "$BAK" $F

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
cp "$BAK" $F

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
report "M8 phasesFavouring points the half-turn at the wrong hypothesis" "$(run src/oqca)"
cp "$BAK" $F

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
report "M9 EVIDENCE is no longer Bayes" "$(run src/oqca)"
cp "$BAK" $F

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
report "M10 a category-C operation stops refusing" "$(run src/oqca)"
cp "$BAK" $F

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
report "M11 the loop may take external actions by default" "$(run src/oqca)"
cp "$BAK" $F

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
cp "$BAK" $F

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
cp "$BAK" $F

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
report "M14 untouched_drift always returns zero" "$(run src/oqca/__tests__/benchmarkSuite.test.ts)"
cp "$BAK" $F

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
report "M15 a kernel file opens a network call" "$(run src/oqca/__tests__/security.test.ts)"
cp "$BAK" $F

echo "done"
