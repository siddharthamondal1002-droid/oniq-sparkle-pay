#!/usr/bin/env bash
# Owner directive 2026-09-11, "fix both" — the mutations for the two ways this
# change could silently stop holding.
#
# L*  the reply label. `translateGeminiResponseToAnthropic` reported a constant
#     for eleven days and nothing went red, because the function had NO TEST AT
#     ALL. These are the shapes that would restore that.
# B*  the tap's two wall-clock bounds, which were one constant until today.
#
# RESTORES FROM A COPY, NEVER FROM GIT — `git checkout -- <file>` reverts to
# HEAD, which on an uncommitted tree deletes the WORK rather than the mutation.
# See scripts/oqca-budget-mutate.sh, whose first version did exactly that.
#
# THE BASELINE MUST BE GREEN BEFORE ANY VERDICT COUNTS.
set -uo pipefail
cd "$(dirname "$0")/.."

LLM=supabase/functions/_shared/llm.ts
OBSERVE=supabase/functions/oqca-observe/index.ts
SUITE="src/oqca src/lib/__tests__/geminiReplyModel.test.ts"
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
    if npx vitest run $SUITE >/dev/null 2>&1; then
      echo "  $label  GREEN  <- HOLE"
    else
      echo "  $label  RED"
    fi
  else
    echo "  $label  NOTAPPLIED  <- stale anchor, not a verdict"
  fi
  cp "$keep" "$file"
}

echo "baseline:"
if npx vitest run $SUITE >/dev/null 2>&1; then
  echo "  GREEN"
else
  echo "  RED  <- fix the baseline first; no verdict below counts"
  exit 1
fi

echo "mutations:"

apply "L1 the constant label comes back      " "$LLM" "
old='''    role: \"assistant\",
    model,'''
assert s.count(old)==1
s=s.replace(old,'''    role: \"assistant\",
    model: \`gemini-fallback/\${GEMINI_FALLBACK_MODEL}\`,''',1)
"

apply "L2 the parameter is ignored           " "$LLM" "
old='''    role: \"assistant\",
    model,'''
assert s.count(old)==1
s=s.replace(old,'''    role: \"assistant\",
    model: TEXT_DIRECT_STANDARD.id,''',1)
"

apply "L3 the call site hands the default    " "$LLM" "
old='translateGeminiResponseToAnthropic(parsed, geminiModel)'
assert s.count(old)==1
s=s.replace(old,'translateGeminiResponseToAnthropic(parsed, GEMINI_FALLBACK_MODEL)',1)
"

apply "B1 the two bounds collapse into one   " "$OBSERVE" "
old='        maxWallMs: MAX_TAP_MS,'
assert s.count(old)==1
s=s.replace(old,'        maxWallMs: MAX_RUN_MS,',1)
"

apply "B2 the run bound sits beside a run    " "$OBSERVE" "
old='const MAX_RUN_MS = 40_000;'
assert s.count(old)==1
s=s.replace(old,'const MAX_RUN_MS = 20_000;',1)
"

apply "B3 the tap bound refuses episode three" "$OBSERVE" "
old='const MAX_TAP_MS = 50_000;'
assert s.count(old)==1
s=s.replace(old,'const MAX_TAP_MS = 20_000;',1)
"

apply "B4 the two bounds are wired swapped   " "$OBSERVE" "
old='  maxExecutionTimeMs: MAX_RUN_MS,'
assert s.count(old)==1
s=s.replace(old,'  maxExecutionTimeMs: MAX_TAP_MS,',1)
"

echo "done."
