#!/usr/bin/env bash
# Mutation run for Ting's provider ladder.
#
# A guard that has never been mutated has never been tested. Each block below
# opens exactly one hole the ladder's tests claim to close, and expects RED.
#
# IT OWNS ITS OWN UNDO. `git checkout --` reverts to a COMMIT, and on
# 2026-09-11 that deleted uncommitted work a mutation runner was meant to
# protect. Files are copied aside and copied back.
#
# NOTAPPLIED is printed rather than a verdict when an anchor goes stale: a
# mutation that did not apply is not a verdict.
set -uo pipefail
cd "$(dirname "$0")/.."

TESTS="src/lib/__tests__/tingProviders.test.ts src/lib/__tests__/tingProviderLadder.test.ts src/lib/__tests__/searchSpendCoverage.test.ts"
FN=supabase/functions/ting/index.ts
PURE=supabase/functions/_shared/tingProviders.ts
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

stash() { cp "$1" "$TMP/$(basename "$1").orig"; }
restore() { cp "$TMP/$(basename "$1").orig" "$1"; }
changed() { ! cmp -s "$1" "$TMP/$(basename "$1").orig"; }

run() { npx vitest run $TESTS >/dev/null 2>&1; }

verdict() {
  local label="$1" file="$2"
  if ! changed "$file"; then
    echo "$label  NOTAPPLIED — stale anchor, no verdict"
    return
  fi
  if run; then echo "$label  GREEN <- ESCAPED"; else echo "$label  RED"; fi
}

echo "baseline"
if ! run; then echo "BASELINE IS RED — stop"; exit 1; fi
echo "baseline GREEN"

# M1 — the ladder is reordered: Gemini before OpenAI.
stash "$FN"
perl -0pi -e 's/\[legOpenAi, legGemini, legClaude\]/[legGemini, legOpenAi, legClaude]/' "$FN"
verdict "M1 ladder reordered            " "$FN"; restore "$FN"

# M2 — a ledger refusal falls through and buys a call on the next provider.
stash "$FN"
perl -0pi -e 's/(refused = r\.reason;\s*\n\s*)break;/$1continue;/' "$FN"
verdict "M2 refusal no longer stops     " "$FN"; restore "$FN"

# M3 — the sourceless Gemini leg starts reserving for grounding.
stash "$FN"
perl -0pi -e 's/maxSearches: 0 \}/maxSearches: 3 }/' "$FN"
verdict "M3 Gemini leg reserves searches" "$FN"; restore "$FN"

# M4 — the OpenAI leg stops being reserved for at all.
stash "$FN"
perl -0pi -e 's/capability: "TEXT"/capability: "SEARCH"/' "$FN"
verdict "M4 OpenAI leg mis-capability   " "$FN"; restore "$FN"

# M5 — the raised answer allowance is reverted.
stash "$FN"
perl -0pi -e 's/TING_MAX_TOKENS = 2048/TING_MAX_TOKENS = 1024/' "$FN"
verdict "M5 allowance back to 1024      " "$FN"; restore "$FN"

# M6 — a 200 carrying no text is reported as an answer instead of advancing.
stash "$FN"
perl -0pi -e 's/r\.ok && answer\.reply \? \("ACCEPTED"/r.ok ? ("ACCEPTED"/' "$FN"
verdict "M6 empty 200 settles ACCEPTED  " "$FN"; restore "$FN"

# M7 — a provider key reaches a log line.
stash "$FN"
perl -0pi -e 's/(const model = tingOpenAiModel\(env\);)/$1\n      console.info("key", openAiKey);/' "$FN"
verdict "M7 key logged                  " "$FN"; restore "$FN"

# M8 — any annotation becomes a source, so a fabricated one is rendered.
stash "$PURE"
perl -0pi -e 's/if \(ann\.type === "url_citation"\) collect\(ann\.url\);/collect(ann.url);/' "$PURE"
verdict "M8 unverified citation accepted" "$PURE"; restore "$PURE"

# M9 — the model override stops being honoured.
stash "$PURE"
perl -0pi -e 's/  return id;/  return TING_DEFAULT_OPENAI_MODEL;/' "$PURE"
verdict "M9 TING_OPENAI_MODEL ignored   " "$PURE"; restore "$PURE"

# M10 — assistant turns are rebuilt with input_text, which the API rejects.
stash "$PURE"
perl -0pi -e 's/\{ type: "output_text", text: textOf\(m\.content\) \} as const\)/{ type: "input_text", text: textOf(m.content) } as const)/' "$PURE"
verdict "M10 assistant part mistyped    " "$PURE"; restore "$PURE"

echo "restored:"
git status --porcelain "$FN" "$PURE"
