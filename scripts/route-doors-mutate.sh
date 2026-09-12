#!/usr/bin/env bash
# Does the door guard catch the failures it was built for? Every block must be RED.
#
# H1 and H2 REPRODUCE REAL HISTORY rather than inventing a hole: H1 is the exact
# September state of /app/creations (forward links gone, the back= returns left
# in place) and H2 is the health tab whose template literal defeated a grep.
#
# THE RUNNER OWNS ITS OWN UNDO — git's undo is relative to a commit and these
# edits are relative to the file; an earlier script in this repo used
# `git checkout --` and deleted the work it was testing.
set -uo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d); SUITE="src/lib/__tests__/routeDoors.test.ts"

CREATE=src/routes/_authenticated/app.create.tsx
APPSHELL=src/routes/_authenticated/app.tsx
HEALTH=src/routes/_authenticated/app.health.tsx
GUARD=src/lib/__tests__/routeDoors.test.ts
GRAPH=src/test/doorGraph.ts

save()    { for f in "$@"; do mkdir -p "$TMP/$(dirname "$f")"; cp "$f" "$TMP/$f"; done; }
restore() { for f in "$@"; do cp "$TMP/$f" "$f"; done; }

# A MUTATION THAT DID NOT APPLY IS NOT A VERDICT. Without this, a stale anchor
# leaves the file untouched, the suite passes, and the run prints GREEN/ESCAPED
# for a hole that was never opened — which is exactly what H6 did on the first
# run of this script.
changed() {
  [ $# -gt 0 ] || { echo "  (verdict called with no file to compare — script bug)" >&2; return 1; }
  for f in "$@"; do cmp -s "$f" "$TMP/$f" || return 0; done; return 1;
}
verdict() { # $1 label, rest: files the mutation should have altered
  local label="$1"; shift
  if ! changed "$@"; then echo "  $label  NOTAPPLIED  <- stale anchor, not a verdict"; return; fi
  if npx vitest run "$SUITE" >/dev/null 2>&1; then echo "  $label  GREEN  <- ESCAPED"; else echo "  $label  RED"; fi
}

if npx vitest run "$SUITE" >/dev/null 2>&1; then
  echo "baseline: GREEN — verdicts below are meaningful"
else
  echo "baseline: RED — fix the suite first, nothing below counts"; exit 1
fi

# H1 — the real September state of /app/creations.
save "$CREATE" "$APPSHELL"
python3 - <<'PY'
import io
for p, old, new in [
  ("src/routes/_authenticated/app.create.tsx", 'to="/app/creations"', 'to="/app"'),
  ("src/routes/_authenticated/app.tsx", 'to: "/app/creations",', 'to: "/app",'),
]:
    s = io.open(p, encoding="utf-8").read()
    io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
PY
verdict "H1 /app/creations: only back= links remain (Sept 2026)" "$CREATE" "$APPSHELL"
restore "$CREATE" "$APPSHELL"

# H2 — the health tab that a literal grep could not see.
save "$HEALTH"
python3 -c "
import io; p='src/routes/_authenticated/app.health.tsx'
s=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8').write(s.replace('to: \`\${HEALTH_ROUTE}/records\`,','to: HEALTH_ROUTE,',1))"
verdict "H2 health records: template-literal tab removed     " "$HEALTH"
restore "$HEALTH"

# H3 — teach the extractor that a RETURN is a door. This is the real hole: the
# first version of this block deleted a `(?<!back=)` lookbehind that turned out
# to be VACUOUS — `back="/x"` contains no `to=` substring, so it never fired and
# removing it opened nothing. The mutation escaped and said so.
save "$GRAPH"
python3 - <<'PYEOF'
import io, re
p = "src/test/doorGraph.ts"
lines = io.open(p, encoding="utf-8").read().split("\n")
out = []
for line in lines:
    out.append(line)
    if "matchAll" in line and "to=" in line and "push(m[1])" in line:
        out.append(line.replace("to=", "back="))
io.open(p, "w", encoding="utf-8").write("\n".join(out))
PYEOF
verdict "H3 a back= return counted as a door               " "$GRAPH"
restore "$GRAPH"

# H4 — the constant resolver dropped, so template links vanish.
save "$GRAPH"
python3 -c "
import io; p='src/test/doorGraph.ts'
s=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8').write(s.replace('    const base = constants[m[1]];','    const base = undefined as string | undefined;',1))"
verdict "H4 route constants no longer resolved             " "$GRAPH"
restore "$GRAPH"

# H5 — the ratchet loosened so the exception list may grow.
save "$GUARD"
python3 -c "
import io; p='src/lib/__tests__/routeDoors.test.ts'
s=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8').write(s.replace('const MAX_DOORLESS = 2;','const MAX_DOORLESS = 99;',1).replace(
  '\"/app/jobs-apps\":','\"/app/newly-orphaned\": \"x\",\n  \"/app/jobs-apps\":',1))"
verdict "H5 doorless list allowed to grow                  " "$GUARD"
restore "$GUARD"

# H6 — an exception defended with a shrug.
save "$GUARD"
python3 -c "
import io,re; p='src/lib/__tests__/routeDoors.test.ts'
s=io.open(p,encoding='utf-8').read()
s=re.sub(r'\"/app/diag\":[\s\S]*?,\n  \"/app/jobs-apps\"', '\"/app/diag\": \"later\",\n  \"/app/jobs-apps\"', s, count=1)
io.open(p,'w',encoding='utf-8').write(s)"
verdict "H6 an exception given a non-reason                 " "$GUARD"
restore "$GUARD"

# H7 — the extractor silently finds nothing at all.
save "$GRAPH"
python3 -c "
import io; p='src/test/doorGraph.ts'
s=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8').write(s.replace('  return doors;','  return [];',1))"
verdict "H7 extractor returns an empty graph               " "$GRAPH"
restore "$GRAPH"

rm -rf "$TMP"
