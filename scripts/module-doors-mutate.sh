#!/usr/bin/env bash
# Mutation run for the module-reachability guard (#4).
#
# THE RUNNER OWNS ITS OWN UNDO. `git checkout -- <file>` reverts to HEAD, and
# on 2026-09-11 that DELETED the uncommitted work it was meant to protect: a
# mutation is relative to the file it found, not to a commit. So every file is
# copied aside before it is touched and copied back afterwards.
#
# M1 REPRODUCES REAL HISTORY rather than inventing a hole: it restores the
# 2026-09-06 state of `voiceReplication.ts`, complete and unit-tested with no
# importer, which CLAUDE.md records as the canonical instance. If the guard
# does not go red there it is not worth having.
set -uo pipefail
cd "$(dirname "$0")/.."

GUARD="src/lib/__tests__/moduleDoors.test.ts"
GRAPH="src/test/moduleGraph.ts"
VC="supabase/functions/voice-clone/index.ts"
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

run() { npx vitest run "$GUARD" >/dev/null 2>&1; }

verdict() {
  if run; then echo "   GREEN  <- ESCAPED, the guard did not notice"; else echo "   RED    ok"; fi
}

echo "baseline (must be green before any verdict counts)"
if run; then echo "   baseline is green"; else echo "   BASELINE IS RED — stop, no verdict below means anything"; exit 1; fi

echo
echo "M1  voiceReplication loses its only importer (the real 2026-09-06 state)"
save "$VC"
python3 - <<'PY'
import pathlib
p = pathlib.Path("supabase/functions/voice-clone/index.ts"); s = p.read_text()
p.write_text(s.replace('} from "../_shared/voiceReplication.ts";', '} from "../_shared/vertexError.ts";', 1))
PY
changed "$VC" && verdict; restore "$VC"

echo
echo "M2  tests become entrypoints (the guard agrees with itself and sees nothing)"
save "$GRAPH"
python3 - <<'PY'
import pathlib
p = pathlib.Path("src/test/moduleGraph.ts"); s = p.read_text()
p.write_text(s.replace("""export function isTestModule(f: string): boolean {
  return /(^|\\/)__tests__\\//.test(f) || /\\.test\\.tsx?$/.test(f);""",
"""export function isTestModule(f: string): boolean {
  if (f) return false;
  return /(^|\\/)__tests__\\//.test(f) || /\\.test\\.tsx?$/.test(f);""", 1))
PY
changed "$GRAPH" && verdict; restore "$GRAPH"

echo
echo "M3  a still-orphaned module is dropped from the frozen list"
save "$GUARD"
python3 - <<'PY'
import pathlib
# The anchor was `storyIr.ts` for an afternoon and `motionValidate.ts` before
# that. BOTH stopped being orphans — one by the compositor tree joining the
# walk, one by being WIRED — and each time the script said NOTAPPLIED rather
# than printing a verdict. Anchor a mutation on the most stuck entry you have.
# The original note follows.
# The anchor was `motionValidate.ts` until 2026-09-12, when the compositor tree
# was added to the walk and that module turned out to have a caller all along.
# A mutation anchored on a module that stops being an orphan goes NOTAPPLIED,
# which is the script saying so rather than printing a verdict.
p = pathlib.Path("src/lib/__tests__/moduleDoors.test.ts"); s = p.read_text()
old = '  "supabase/functions/_shared/directorGraph.ts",\n'
assert s.count(old) == 1
p.write_text(s.replace(old, '', 1))
PY
changed "$GUARD" && verdict; restore "$GUARD"

echo
echo "M4  a module that DOES have a caller is added to the frozen list (ratchet)"
save "$GUARD"
python3 - <<'PY'
import pathlib
p = pathlib.Path("src/lib/__tests__/moduleDoors.test.ts"); s = p.read_text()
p.write_text(s.replace('const KNOWN_ORPHANS: readonly string[] = [\n',
                       'const KNOWN_ORPHANS: readonly string[] = [\n  "src/lib/securityHeaders.ts",\n', 1))
PY
changed "$GUARD" && verdict; restore "$GUARD"

echo
echo "M5  the mirror rule is widened to the whole src/oqca tree"
save "$GRAPH"
python3 - <<'PY'
import pathlib
p = pathlib.Path("src/test/moduleGraph.ts"); s = p.read_text()
i = s.index("  const byHash = contentKeys(graph.files);")
j = s.index("  const orphans = graph.files.filter(", i)
new = '  const mirrored = new Set(graph.files.filter((f) => f.startsWith("src/oqca/")));\n'
p.write_text(s[:i] + new + s[j:])
PY
changed "$GRAPH" && verdict; restore "$GRAPH"

echo
echo "M10 the mirror rule goes back to ONE path convention (the health blind spot)"
save "$GRAPH"
python3 - <<'PY'
import pathlib
# `src/health/consent.ts` and `retention.ts` are mirror sources exactly as the
# OQCA ones are; a rule that knows only `src/oqca/` calls them orphans. They
# are no longer on the frozen list, so this must fail as a NEW orphan.
p = pathlib.Path("src/test/moduleGraph.ts"); s = p.read_text()
i = s.index("  const byHash = contentKeys(graph.files);")
j = s.index("  const orphans = graph.files.filter(", i)
new = (
    "  const mirrored = new Set(\n"
    "    graph.files.filter(\n"
    "      (f) =>\n"
    '        f.startsWith("src/oqca/") &&\n'
    '        shipped.has("supabase/functions/_shared/oqca/" + f.slice("src/oqca/".length)),\n'
    "    ),\n"
    "  );\n"
)
p.write_text(s[:i] + new + s[j:])
PY
changed "$GRAPH" && verdict; restore "$GRAPH"

echo
echo "M6  BY_DESIGN is widened from the vendored subtree to all of src/components"
save "$GUARD"
python3 - <<'PY'
import pathlib
p = pathlib.Path("src/lib/__tests__/moduleDoors.test.ts"); s = p.read_text()
p.write_text(s.replace('const BY_DESIGN = ["src/components/ui/", "src/test/"] as const;',
                       'const BY_DESIGN = ["src/components/", "src/test/"] as const;', 1))
PY
changed "$GUARD" && verdict; restore "$GUARD"

echo
echo "M7  the resolver stops following dynamic import edges"
save "$GRAPH"
python3 - <<'PY'
import pathlib
# Located structurally: the needle carries no quote characters, because the
# first draft of this mutation died escaping them through two heredocs and
# reported NOTAPPLIED rather than a verdict.
p = pathlib.Path("src/test/moduleGraph.ts"); s = p.read_text()
i = s.index(r"import\s*\(\s*")
start = s.rindex("|(?:", 0, i)
end = s.index("|(?:", i)
p.write_text(s[:start] + s[end:])
PY
changed "$GRAPH" && verdict; restore "$GRAPH"

echo
echo
echo "M8  the compositor tree is dropped from the walk (the real 2026-09-12 hole)"
save "$GRAPH"
python3 - <<'PY'
import pathlib
p = pathlib.Path("src/test/moduleGraph.ts"); s = p.read_text()
old = 'const TREES = ["src", "supabase/functions", "scripts", "remotion/src", "remotion/scripts"];'
new = 'const TREES = ["src", "supabase/functions", "scripts"];'
assert s.count(old) == 1
p.write_text(s.replace(old, new, 1))
PY
changed "$GRAPH" && verdict; restore "$GRAPH"

echo
echo "M9  remotion is walked but .mjs is not — a tree admitted in name only"
save "$GRAPH"
python3 - <<'PY'
import pathlib
p = pathlib.Path("src/test/moduleGraph.ts"); s = p.read_text()
old = 'const EXTENSIONS = [".ts", ".tsx", ".mjs"];'
new = 'const EXTENSIONS = [".ts", ".tsx"];'
assert s.count(old) == 1
p.write_text(s.replace(old, new, 1))
PY
changed "$GRAPH" && verdict; restore "$GRAPH"

restore_all
echo "restored; confirming the tree is green again"
if run; then echo "   green"; else echo "   STILL RED — the tree did not restore, diff it before trusting it"; fi
