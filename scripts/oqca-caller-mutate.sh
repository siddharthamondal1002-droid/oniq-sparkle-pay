#!/usr/bin/env bash
# OQCA'S CALLER IN THE APP, PROVEN BY MUTATION.
#
# Owner, 2026-09-11: "Everything else — the substrate, the autonomy runtime, the
# self-improvement loop — has no caller in the app at all add it." Those three
# now run from `oqca-observe`, over ONIQ's own production readings, against a
# durable store that outlives the tap. Every control below is one a careless
# edit could remove; each block breaks one, runs the tests in front of it,
# expects RED, and restores the file.
#
# GREEN means the control can be deleted without a test noticing. NOTAPPLIED
# means the anchor went stale and NOTHING was mutated, which is not a verdict —
# this repo has needed that distinction six times.
#
#   scripts/oqca-caller-mutate.sh
#
# Read-only for the repo: every file is restored from a copy.
set -u
MUT_FAIL=0
LOG="$(mktemp)"
BAK="$(mktemp)"
cd "$(dirname "$0")/.."
T=src/oqca/__tests__/appCaller.test.ts
DOORS=src/lib/__tests__/adminDoors.test.ts
NEST=src/lib/__tests__/routeNesting.test.ts
run() { timeout 600 npx vitest run "$@" >"$LOG" 2>&1; echo $?; }
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
restore() { cp "$BAK" "$1"; }

echo "baseline (must be green before any verdict counts): exit $(run "$T" "$DOORS" "$NEST")"

SINK=supabase/functions/_shared/oqcaRuntime/pgSink.ts
EV=supabase/functions/_shared/oqcaRuntime/productionEvidence.ts
FN=supabase/functions/oqca-observe/index.ts
PROFILE=src/routes/_authenticated/app.profile.tsx

# ---------------------------------------------------------------- the sink

# C1: a failed read answers "nothing stored yet". This is the whole reason the
# file throws: an unreachable store becomes indistinguishable from a fresh
# morning, and ONIQ starts from zero with nothing anywhere saying so.
cp $SINK "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/pgSink.ts'; s=open(p).read()
old='      if (!got.ok) throw new OqcaStateUnavailable(key, got.reason);'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,'      if (!got.ok) return null;'))
PY
report "C1 a failed read answers empty" "$(run "$T")"; restore $SINK

# C2: the write always confirms. `makeSinkDurableStore` reports what the sink
# returned, so a lying sink makes every episode claim a persistence it never got.
cp $SINK "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/pgSink.ts'; s=open(p).read()
old='      return wrote.ok;'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,'      return true;'))
PY
report "C2 the write always confirms" "$(run "$T")"; restore $SINK

# ------------------------------------------------------------- the evidence

# C3: a reading the host could not take becomes a healthy zero. That is §3's
# named failure — "ONIQ looked and it is fine" replacing "nobody looked".
cp $EV "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/productionEvidence.ts'; s=open(p).read()
old='  if (snapshot.dispatch !== null) {\n    const d = snapshot.dispatch;'
assert s.count(old)==1, s.count(old)
new=('  {\n    const d = snapshot.dispatch ?? {\n      consecutiveFailures: 0,\n'
     '      lastOkAt: null,\n      lastError: null,\n    };')
open(p,'w').write(s.replace(old,new))
PY
report "C3 an absent dispatch reading reads as healthy" "$(run "$T")"; restore $EV

# C4: an UNKNOWN severity becomes 0. A renderer nobody could time reads as the
# fastest one ONIQ has ever seen.
cp $EV "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/productionEvidence.ts'; s=open(p).read()
old='      w.sinceLastReadyMinutes === null\n        ? null\n'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,'      w.sinceLastReadyMinutes === null\n        ? 0\n'))
PY
report "C4 an untimed renderer reads as zero" "$(run "$T")"; restore $EV

# C5: the dispatch concern stops naming the capability acting on it would need.
# It then looks unconstrained and the planner ranks it as free work ONIQ can do.
cp $EV "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/productionEvidence.ts'; s=open(p).read()
old='          requires: ["UPDATE_CONFIGURATION"],\n        },\n        at,\n      ),\n    );\n  }\n\n  if (snapshot.queue !== null) {'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,old.replace('["UPDATE_CONFIGURATION"]','[]',1)))
PY
report "C5 the dispatch concern needs nothing" "$(run "$T")"; restore $EV

# C6: the abandoned clock goes. A film past the six-hour TTL — never rendered,
# never failed, never refunded — reads as merely late.
cp $EV "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/productionEvidence.ts'; s=open(p).read()
old='        : oldest >= QUEUE_ABANDONED_MINUTES\n          ? 1\n'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,'        : oldest >= QUEUE_ABANDONED_MINUTES\n          ? 0.5\n'))
PY
report "C6 an abandoned film is merely late" "$(run "$T")"; restore $EV

# C7: the corpus line drops the concept id. Every line is still true and still
# located, and retrieval matches NOTHING — so the loop learns nothing, quietly.
cp $EV "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/productionEvidence.ts'; s=open(p).read()
old='    line: `${item.kind}:${item.subject} — ${item.detail}`,'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,'    line: item.detail,'))
PY
report "C7 the corpus drops the concept id" "$(run "$T")"; restore $EV

# C8: a health-domain table is named outside the health module. The seal is a
# privacy boundary and does not get a hole cut in it for a dashboard.
cp $EV "$BAK"
mutate <<'PY'
p='supabase/functions/_shared/oqcaRuntime/productionEvidence.ts'; s=open(p).read()
old='          locator: "client_error_reports over 24h, read by oqca-observe",'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,'          locator: "health_ai_requests over 24h, read by oqca-observe",'))
PY
report "C8 a health table is named outside health" "$(run "$T")"; restore $EV

# ------------------------------------------------------------- the function

# C9: the admin gate goes. Any signed-in caller runs ONIQ's cognition over
# production readings.
cp $FN "$BAK"
mutate <<'PY'
p='supabase/functions/oqca-observe/index.ts'; s=open(p).read()
old='  if (isAdmin !== true) return json(403, { error: "Admins only" });\n'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,''))
PY
report "C9 the admin gate is removed" "$(run "$T")"; restore $FN

# C10: the tap is given a token budget. A tap that spends is a spend decision,
# and a spend decision is the owner's under CLAUDE.md's first rule.
cp $FN "$BAK"
mutate <<'PY'
p='supabase/functions/oqca-observe/index.ts'; s=open(p).read()
old='        executor,\n      }),'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,'        executor,\n        budgets: { ...DEFAULT_BUDGETS, maxTokens: 4096 },\n      }),'))
PY
report "C10 the tap is given a token budget" "$(run "$T")"; restore $FN

# C11: back to one episode per tap. Measured, that never reaches an
# observation-driven objective: the tap blocks on the substrate's own permanent
# runner-availability gap, learns nothing and persists nothing, every time.
cp $FN "$BAK"
mutate <<'PY'
p='supabase/functions/oqca-observe/index.ts'; s=open(p).read()
old='const EPISODES_PER_TAP = 3;'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,'const EPISODES_PER_TAP = 1;'))
PY
report "C11 one episode per tap" "$(run "$T")"; restore $FN

# C12: an unreachable durable store answers 200. The tap then reports a clean
# run that silently began from zero — exactly what C1 exists to prevent, from
# the other end.
cp $FN "$BAK"
mutate <<'PY'
p='supabase/functions/oqca-observe/index.ts'; s=open(p).read()
old='    if (e instanceof OqcaStateUnavailable) {\n      return json(503, { error: e.message, key: e.key });\n    }\n'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,''))
PY
report "C12 an unreachable store answers 200" "$(run "$T")"; restore $FN

# C13: the executor permits everything. Six of the nine registered capabilities
# are `authorized: false`, and a host that says yes to all of them is the one
# door nobody watches.
cp $FN "$BAK"
mutate <<'PY'
p='supabase/functions/oqca-observe/index.ts'; s=open(p).read()
old='    : { ok: false, reason: `${req.id} is authorized but oqca-observe does not execute it` };'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,'    : { ok: true, value: 0, unit: "records", detail: "permitted" };'))
PY
report "C13 the executor permits everything" "$(run "$T")"; restore $FN

# ------------------------------------------------------------------ the door

# C14: the only inbound link goes. The screen then exists, works, is tested and
# cannot be reached by anyone who has not typed the URL — which this repo has
# shipped three times (upiDoors, /app/creations, "nowhere to upload").
cp $PROFILE "$BAK"
mutate <<'PY'
p='src/routes/_authenticated/app.profile.tsx'; s=open(p).read()
old='              <Link to="/app/admin/oqca" className={linkClass}>\n                OQCA\n              </Link>\n'
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,''))
PY
report "C14 the admin door is removed" "$(run "$DOORS")"; restore $PROFILE

# C15: the route loses its nesting opt-out. `app.admin.oqca.tsx` is a CHILD of
# the Moderation inbox, which renders no <Outlet />, so the screen never mounts
# — measured 2026-09-07 on three admin tools that had never once rendered.
SRC=src/routes/_authenticated/app.admin_.oqca.tsx
NESTED=src/routes/_authenticated/app.admin.oqca.tsx
if [ -f "$SRC" ]; then mv "$SRC" "$NESTED"; else MUT_FAIL=1; fi
report "C15 the route nests under the inbox" "$(run "$NEST")"
[ -f "$NESTED" ] && mv "$NESTED" "$SRC"

echo
echo "done. GREEN anywhere above is a control no test defends."
