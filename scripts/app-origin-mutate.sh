#!/usr/bin/env bash
# Mutation check for the www host switch (2026-09-12).
#
# THE UNDO IS A FILE COPY, NEVER `git checkout --`: git's undo is relative to a
# COMMIT and a mutation is relative to the file it found, so on 2026-09-11 a
# runner in this repo "restored" uncommitted work by deleting it.
#
# Mutations use `python3 - <<'PYX'` (literal heredoc) rather than `python3 -c`
# with nested quotes: an escaping slip there silently matches nothing, and a
# mutation that did not apply is not a verdict.
set -uo pipefail
cd "$(dirname "$0")/.."
SAVE="$(mktemp -d)"; trap 'restore; rm -rf "$SAVE"' EXIT
FILES=(capacitor.config.json android/app/src/main/AndroidManifest.xml
       src/config/appOrigin.ts src/lib/qr/oniqProfileQr.ts
       supabase/functions/_shared/storyActorAssets.ts)
save()    { for f in "${FILES[@]}"; do mkdir -p "$SAVE/$(dirname "$f")"; cp "$f" "$SAVE/$f"; done; }
restore() { for f in "${FILES[@]}"; do [ -f "$SAVE/$f" ] && cp "$SAVE/$f" "$f"; done; }
T="src/lib/__tests__/appOrigin.test.ts src/lib/__tests__/storyActorAssets.test.ts src/lib/__tests__/securityHeaders.test.ts src/lib/qr/__tests__/oniqProfileQr.test.ts"
green() { npx vitest run --reporter=dot $T >/dev/null 2>&1; }
changed() { local f="$1"; if cmp -s "$f" "$SAVE/$f"; then echo "  NOTAPPLIED — stale anchor, NOT a verdict"; return 1; fi; }
verdict() { local f="$1" l="$2"; changed "$f" || return; if green; then echo "  GREEN  <- ESCAPED: $l"; else echo "  RED    $l"; fi; }

echo "== baseline =="
green && echo "  baseline GREEN" || { echo "  BASELINE RED — stop, no verdict below counts"; exit 1; }
save

echo "== M1: the shell points back at the dead apex =="
python3 - <<'PYX'
import pathlib
p=pathlib.Path('capacitor.config.json')
p.write_text(p.read_text().replace('https://www.oniqhub.com','https://oniqhub.com'))
PYX
verdict capacitor.config.json "capacitor server.url reverted to the apex"; restore

echo "== M2: the www App Links are dropped =="
python3 - <<'PYX'
import pathlib, re
p=pathlib.Path('android/app/src/main/AndroidManifest.xml'); s=p.read_text()
s=re.sub(r'\s*<data android:scheme="https" android:host="www\.oniqhub\.com" android:pathPrefix="[^"]*" />','',s)
p.write_text(s)
PYX
verdict android/app/src/main/AndroidManifest.xml "manifest lost every www deep link"; restore

echo "== M3: host check becomes a suffix test =="
python3 - <<'PYX'
import pathlib
p=pathlib.Path('src/config/appOrigin.ts'); s=p.read_text()
s=s.replace('return APP_HOSTS.includes(hostname.toLowerCase());',
            'return hostname.toLowerCase().endsWith("oniqhub.com");')
p.write_text(s)
PYX
verdict src/config/appOrigin.ts "isAppHost accepts evil-oniqhub.com"; restore

echo "== M4: BOTH port layers removed =="
# Deliberately a TWO-PART mutation, and the reason is a real result rather than
# a convenience. Removing the explicit port line alone ESCAPES: the prefix check
# runs first and a port breaks the "https://<host>/q/" prefix, so the parsed
# port check is unreachable for that input. Defence in depth caught the first
# mutation — the same shape as the E5 escape recorded in CLAUDE.md — so to open
# the hole the mutation must also take the layer that actually blocks it, by
# loosening the prefix to a host-only test (a plausible refactor).
python3 - <<'PYX'
import pathlib
p=pathlib.Path('src/lib/qr/oniqProfileQr.ts'); s=p.read_text()
s=s.replace('  if (url.port !== "") return null;\n','')
s=s.replace('s.toLowerCase().startsWith(`https://${h}${PROFILE_QR_PATH}`.toLowerCase()),',
            's.toLowerCase().startsWith(`https://${h}`.toLowerCase()),')
p.write_text(s)
PYX
verdict src/lib/qr/oniqProfileQr.ts "a QR on a nonstandard port is accepted"; restore

echo "== M5: the import-free asset origin drifts from the config =="
python3 - <<'PYX'
import pathlib
p=pathlib.Path('supabase/functions/_shared/storyActorAssets.ts'); s=p.read_text()
s=s.replace('export const ONIQ_ASSET_ORIGIN = "https://www.oniqhub.com";',
            'export const ONIQ_ASSET_ORIGIN = "https://oniqhub.com";')
p.write_text(s)
PYX
verdict supabase/functions/_shared/storyActorAssets.ts "the mirror drifts and portraits 404"; restore

echo "== done =="
