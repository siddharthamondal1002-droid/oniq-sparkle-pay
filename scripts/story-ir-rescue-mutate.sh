#!/usr/bin/env bash
# Mutation run for the Story IR rescue — story-plot's third rung.
#
# THE RUNNER OWNS ITS OWN UNDO. `git checkout -- <file>` reverts to a COMMIT
# and a mutation is relative to the file it found; on 2026-09-11 that deleted
# the uncommitted work it was meant to protect. Copy aside, copy back.
set -uo pipefail
cd "$(dirname "$0")/.."

RESCUE="supabase/functions/_shared/storyIrRescue.ts"
PLOT="supabase/functions/story-plot/index.ts"
DOORS="src/lib/__tests__/moduleDoors.test.ts"
SAFE="$(mktemp -d)"
trap 'restore_all' EXIT

save()    { mkdir -p "$SAFE/$(dirname "$1")"; cp "$1" "$SAFE/$1"; }
restore() { cp "$SAFE/$1" "$1"; }
restore_all() { (cd "$SAFE" && find . -type f -print0 2>/dev/null) | while IFS= read -r -d '' f; do cp "$SAFE/${f#./}" "${f#./}" 2>/dev/null; done; }

changed() {
  if [ $# -eq 0 ]; then echo "   !! script bug: changed() called with no file"; return 1; fi
  if cmp -s "$1" "$SAFE/$1"; then echo "   NOTAPPLIED — the anchor did not match; fix the mutation, not the code"; return 1; fi
  return 0
}

run() { npx vitest run src/lib/__tests__/storyIrRescue.test.ts src/lib/__tests__/moduleDoors.test.ts >/dev/null 2>&1; }
verdict() { if run; then echo "   GREEN  <- ESCAPED, the guard did not notice"; else echo "   RED    ok"; fi; }

echo "baseline (must be green before any verdict counts)"
if run; then echo "   baseline is green"; else echo "   BASELINE IS RED — stop, no verdict below means anything"; exit 1; fi

echo
echo "S1  the rung runs even when a plan already exists (a third engine on every film)"
save "$PLOT"
python3 - <<'PY'
import pathlib
p = pathlib.Path("supabase/functions/story-plot/index.ts"); s = p.read_text()
old = "if (!plan && shots <= SINGLE_CALL_MAX_SHOTS) {"
assert s.count(old) == 1
p.write_text(s.replace(old, "if (shots <= SINGLE_CALL_MAX_SHOTS) {", 1))
PY
changed "$PLOT" && verdict; restore "$PLOT"

echo
echo "S2  the model id becomes a sibling that answered 200 with an EMPTY body"
save "$RESCUE"
python3 - <<'PY'
import pathlib
p = pathlib.Path("supabase/functions/_shared/storyIrRescue.ts"); s = p.read_text()
old = 'export const GATEWAY_STORY_MODEL = "openai/gpt-5.4-mini";'
assert s.count(old) == 1
p.write_text(s.replace(old, 'export const GATEWAY_STORY_MODEL = "openai/gpt-5-mini";', 1))
PY
changed "$RESCUE" && verdict; restore "$RESCUE"

echo
echo "S3  the gateway id travels in the ANTHROPIC field (a Claude id posted to the gateway)"
save "$RESCUE"
python3 - <<'PY'
import pathlib
p = pathlib.Path("supabase/functions/_shared/storyIrRescue.ts"); s = p.read_text()
old = "gatewayModel: model,"
assert s.count(old) == 1
p.write_text(s.replace(old, "model: model,", 1))
PY
changed "$RESCUE" && verdict; restore "$RESCUE"

echo
echo "S4  the converter pads a short story instead of refusing"
save "$RESCUE"
python3 - <<'PY'
import pathlib
p = pathlib.Path("supabase/functions/_shared/storyIrRescue.ts"); s = p.read_text()
old = "  if (shots.length < want) {"
assert s.count(old) == 1
p.write_text(s.replace(old, "  if (false) {", 1))
PY
changed "$RESCUE" && verdict; restore "$RESCUE"

echo
echo "S5  an empty gateway reply is handed on instead of named"
save "$RESCUE"
python3 - <<'PY'
import pathlib
p = pathlib.Path("supabase/functions/_shared/storyIrRescue.ts"); s = p.read_text()
old = '    if (!text.trim()) throw new LocalModelUnavailable("gateway returned an empty reply");\n'
assert s.count(old) == 1
p.write_text(s.replace(old, "", 1))
PY
changed "$RESCUE" && verdict; restore "$RESCUE"

echo
echo "S6  story-plot loses the import, so storyModel is an orphan again"
save "$PLOT"
python3 - <<'PY'
import pathlib
p = pathlib.Path("supabase/functions/story-plot/index.ts"); s = p.read_text()
old = 'import { storyIrRescue } from "../_shared/storyIrRescue.ts";\n'
assert s.count(old) == 1
p.write_text(s.replace(old, "", 1))
PY
changed "$PLOT" && verdict; restore "$PLOT"

echo
restore_all
echo "restored; confirming the tree is green again"
if run; then echo "   green"; else echo "   STILL RED — the tree did not restore, diff it before trusting it"; fi
