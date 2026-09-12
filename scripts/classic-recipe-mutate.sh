#!/usr/bin/env bash
# Mutation check for the classic-film recipe guard (2026-09-12).
# Undo is a FILE COPY, never `git checkout --`: git's undo is relative to a
# COMMIT and a mutation is relative to the file it found.
set -uo pipefail
cd "$(dirname "$0")/.."
SAVE="$(mktemp -d)"; trap 'restore; rm -rf "$SAVE"' EXIT
FILES=(supabase/functions/_shared/stillRoute.ts remotion/scripts/story-worker.mjs
       src/lib/motionRuntime.ts .claude/skills/oniq-video/SKILL.md
       .claude/skills/oniq-video/references/classic-film-recipe.md)
save()    { for f in "${FILES[@]}"; do mkdir -p "$SAVE/$(dirname "$f")"; cp "$f" "$SAVE/$f"; done; }
restore() { for f in "${FILES[@]}"; do [ -f "$SAVE/$f" ] && cp "$SAVE/$f" "$f"; done; }
T="src/lib/__tests__/classicFilmRecipe.test.ts"
green() { npx vitest run --reporter=dot $T >/dev/null 2>&1; }
changed() { local f="$1"; if cmp -s "$f" "$SAVE/$f"; then echo "  NOTAPPLIED — stale anchor, NOT a verdict"; return 1; fi; }
verdict() { local f="$1" l="$2"; changed "$f" || return; if green; then echo "  GREEN  <- ESCAPED: $l"; else echo "  RED    $l"; fi; }
# the inverse: this mutation MUST leave the suite green
inverse() { local f="$1" l="$2"; changed "$f" || return; if green; then echo "  GREEN  (correct) $l"; else echo "  RED    <- WRONG: $l"; fi; }

echo "== baseline =="
green && echo "  baseline GREEN" || { echo "  BASELINE RED — stop"; exit 1; }
save

echo "== M1: the still provider default flips to the GPU =="
python3 - <<'PYX'
import pathlib
p=pathlib.Path('supabase/functions/_shared/stillRoute.ts'); s=p.read_text()
s=s.replace('export const DEFAULT_STILL_PROVIDER: StillProvider = "gateway";',
            'export const DEFAULT_STILL_PROVIDER: StillProvider = "in_house";')
p.write_text(s)
PYX
verdict supabase/functions/_shared/stillRoute.ts "recipe still claims gateway stills"; restore

echo "== M2: the worker stops emitting the line the recipe says to grep =="
python3 - <<'PYX'
import pathlib
p=pathlib.Path('remotion/scripts/story-worker.mjs'); s=p.read_text()
s=s.replace("MOTION_STAGE=off MOTION_PROVIDER=none MOTION_ENGINE=none",
            "MOTION_STAGE=disabled")
p.write_text(s)
PYX
verdict remotion/scripts/story-worker.mjs "the verification grep no longer matches"; restore

echo "== M3: the fallback reason is reworded =="
python3 - <<'PYX'
import pathlib
p=pathlib.Path('src/lib/motionRuntime.ts'); s=p.read_text()
s=s.replace("no motion provider enabled (owner-gated)","motion is switched off")
p.write_text(s)
PYX
verdict src/lib/motionRuntime.ts "the 9-fallback proof no longer matches"; restore

echo "== M4: the skill stops pointing at the recipe =="
python3 - <<'PYX'
import pathlib
p=pathlib.Path('.claude/skills/oniq-video/SKILL.md'); s=p.read_text()
s=s.replace("references/classic-film-recipe.md","references/making-an-episode.md")
p.write_text(s)
PYX
verdict .claude/skills/oniq-video/SKILL.md "the recipe is unreachable from the skill"; restore

echo "== M5 (INVERSE): the recipe is reflowed — must stay GREEN =="
python3 - <<'PYX'
import pathlib, re
p=pathlib.Path('.claude/skills/oniq-video/references/classic-film-recipe.md'); s=p.read_text()
# rewrap the prose hard at 45 columns: same words, different layout
out=[]
for line in s.split("\n"):
    if line.startswith(("    ","#","|","`")) or not line.strip(): out.append(line); continue
    words=line.split(); cur=""
    for w in words:
        if len(cur)+len(w)+1>45: out.append(cur); cur=w
        else: cur=(cur+" "+w).strip()
    if cur: out.append(cur)
p.write_text("\n".join(out))
PYX
inverse .claude/skills/oniq-video/references/classic-film-recipe.md "a reflowed document still passes"; restore

echo "== done =="
