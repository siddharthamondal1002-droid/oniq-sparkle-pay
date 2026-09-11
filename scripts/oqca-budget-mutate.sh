#!/usr/bin/env bash
# Owner directive 2026-09-11, "increase the budget to 100$" — the mutations for
# the six ways that ceiling could silently stop binding.
#
# IT RESTORES FROM A COPY, NEVER FROM GIT, AND THE FIRST VERSION DID NOT.
# `git checkout -- <file>` reverts to HEAD, so on a working tree whose changes
# are not yet committed it does not undo the MUTATION — it deletes the WORK.
# That is what happened on this script's first run: two blocks reported a
# correct RED, and the restore after each wiped `engine.ts` and
# `oqca-observe/index.ts` back to HEAD, after which every later anchor was
# missing and the script reported four NOTAPPLIED. The four NOTAPPLIEDs are the
# only reason it was noticed at all.
#
# CLAUDE.md already records the neighbouring failure — "killing a mutation run
# leaves the tree mutated ... after one is interrupted, diff the tree before
# trusting it". This is the other half: a mutation runner must own its own
# undo, because git's undo is relative to a commit and a mutation is relative
# to the file it found.
#
# THE BASELINE MUST BE GREEN BEFORE ANY VERDICT COUNTS. A mutation reporting RED
# under a red baseline has reported nothing (v1.7, six escapes on one run).
#
# Each block prints RED (caught), GREEN (a hole) or NOTAPPLIED (a stale anchor,
# announced rather than passed off as a verdict).
set -uo pipefail
cd "$(dirname "$0")/.."

ENGINE=supabase/functions/_shared/oqcaRuntime/engine.ts
OBSERVE=supabase/functions/oqca-observe/index.ts
SUITE="src/oqca"
SAVE=$(mktemp -d)
trap 'rm -rf "$SAVE"' EXIT

apply() { # $1 label, $2 file, $3 python body operating on `s`
  local label="$1" file="$2" body="$3"
  local keep="$SAVE/$(echo "$file" | tr / _)"
  cp "$file" "$keep"
  if python3 -c "
import io
p='$file'
s=io.open(p,encoding='utf-8').read()
$body
io.open(p,'w',encoding='utf-8').write(s)
" 2>/dev/null; then
    node scripts/oqca-mirror.mjs >/dev/null 2>&1
    if npx vitest run $SUITE >/dev/null 2>&1; then
      echo "  $label  GREEN  <- HOLE"
    else
      echo "  $label  RED"
    fi
  else
    echo "  $label  NOTAPPLIED  <- stale anchor, not a verdict"
  fi
  cp "$keep" "$file"
  node scripts/oqca-mirror.mjs >/dev/null 2>&1
}

echo "baseline:"
if npx vitest run $SUITE >/dev/null 2>&1; then
  echo "  GREEN"
else
  echo "  RED — STOP, no verdict below counts"; exit 1
fi

echo "mutations:"

# B1 — the engine stops consulting the ledger at all.
apply "B1 engine bypasses the ledger" "$ENGINE" '
a = "const guarded = await withProviderSpendGuard("
assert s.count(a) == 1
s = s.replace(a, "const guarded = { admitted: true as const, value: { reply: await attempt(req, quote, stateId, started) }, reservedUsd: 0, actualUsd: null, attempt: 1 }; const _dead = false && await withProviderSpendGuard(")
'

# B2 — a missing ledger becomes a bypass instead of a refusal. This is exactly
#      what an "if (ctx.rpc)" refactor would introduce, and it looks harmless.
apply "B2 null rpc spends unguarded" "$ENGINE" '
a = "ctx.rpc ?? null,"
assert s.count(a) == 1
s = s.replace(a, "ctx.rpc ?? (async () => ({ data: { ok: true, attempt: 1 }, error: null })),")
'

# B3 — admitted under the wrong capability, so it is bounded by a ceiling meant
#      for something else and TEXT's day never fills.
apply "B3 wrong capability" "$ENGINE" '
a = chr(34) + "TEXT" + chr(34) + ","
assert s.count("capability: " + a) == 1
s = s.replace("capability: " + a, "capability: " + chr(34) + "OTHER" + chr(34) + ",")
'

# B4 — the owner's TOTAL written into the PER-RUN bound. Reads as $100; means
#      $100 per run, three runs a tap, unbounded taps.
apply "B4 owner total in the per-run bound" "$OBSERVE" '
a = "maxCostUsd: 0.05,"
assert s.count(a) == 1
s = s.replace(a, "maxCostUsd: 100,")
'

# B5 — the tool budget goes non-zero: a permission nobody asked for.
apply "B5 tool budget raised" "$OBSERVE" '
a = "maxToolCalls: 0,"
assert s.count(a) == 1
s = s.replace(a, "maxToolCalls: 8,")
'

# B6 — a job id "helpfully" added back. Refuses call ELEVEN of twenty with
#      job-attempts-exhausted, and the loop reports a quiet model.
apply "B6 job id reintroduced" "$OBSERVE" '
a = "rpc: serviceRoleRpc(),"
assert s.count(a) == 1
s = s.replace(a, "rpc: serviceRoleRpc(),\n            jobId: " + chr(34) + "tap" + chr(34) + ",")
'

echo "done."
