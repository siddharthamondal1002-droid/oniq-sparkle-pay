#!/usr/bin/env bash
# Mutation run for the call-signalling identity + tally guards.
#
# THE RUNNER OWNS ITS OWN UNDO. `git checkout -- <file>` reverts to a COMMIT,
# and on 2026-09-11 that deleted the uncommitted work it was meant to protect.
# Copy aside, copy back.
#
# A mutation that did not apply is not a verdict, and a verdict taken against a
# red baseline is not a verdict either. Both are checked.
set -uo pipefail
cd "$(dirname "$0")/.."

TARGET="src/components/chat/CallOverlay.tsx"
SPEC="src/lib/__tests__/callSignalTally.test.ts"
SAFE="$(mktemp -d)"
cp "$TARGET" "$SAFE/CallOverlay.tsx"
trap 'cp "$SAFE/CallOverlay.tsx" "$TARGET"; rm -rf "$SAFE"' EXIT

run() { npx vitest run "$SPEC" >/dev/null 2>&1; }
restore() { cp "$SAFE/CallOverlay.tsx" "$TARGET"; }

declare -A DESC=(
  [M1]="helloTx counted before the channel guard (the original defect)"
  [M2]="the silent optional-call send is back"
  [M3]="an unsendable signal is no longer counted"
  [M4]="an unacknowledged send is no longer counted"
  [M5]="identity comes from the frozen prop alone again"
  [M6]="the report stops saying whether a channel existed"
  [M7]="the report stops saying whether an identity existed"
)

echo "baseline…"
if ! run; then echo "BASELINE IS RED — stop, no verdict below counts"; exit 1; fi
echo "baseline GREEN"

for id in M1 M2 M3 M4 M5 M6 M7; do
  restore
  if ! python3 scripts/call-signal-mutate.py "$id"; then
    echo "$id NOTAPPLIED — ${DESC[$id]} (stale anchor)"; continue
  fi
  if cmp -s "$TARGET" "$SAFE/CallOverlay.tsx"; then
    echo "$id NOTAPPLIED — ${DESC[$id]} (mutation wrote nothing)"; continue
  fi
  if run; then echo "$id GREEN <- ESCAPED — ${DESC[$id]}"
  else echo "$id RED — ${DESC[$id]}"; fi
done

restore
echo "done — tree restored"
