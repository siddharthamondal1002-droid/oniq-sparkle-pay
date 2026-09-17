#!/usr/bin/env bash
# Mutation check for the recovery worker + its webhook door.
#
# Each mutation opens ONE hole the tests claim to close. RED is the verdict we
# want; GREEN means the assertion for that hole is decoration.
#
# THE RUNNER OWNS ITS OWN UNDO. `git checkout --` reverts to a COMMIT, and on
# 2026-09-11 that deleted uncommitted work it was meant to protect. Files are
# copied aside and copied back.
set -uo pipefail
cd "$(dirname "$0")/.."

W="supabase/functions/_shared/paymentRecoveryWorker.ts"
H="supabase/functions/razorpay-webhook/index.ts"
TESTS="src/lib/__tests__/paymentRecoveryRuntime.test.ts src/lib/__tests__/razorpayConfirmRuntime.test.ts"
TMP=$(mktemp -d)
trap 'cp "$TMP"/*.bak.ts /dev/null 2>/dev/null; rm -rf "$TMP"' EXIT

save() { cp "$1" "$TMP/$(basename "$1").bak"; }
restore() { cp "$TMP/$(basename "$1").bak" "$1"; }

run() { npx vitest run $TESTS >/dev/null 2>&1; }

verdict() { # label file
  if [ "$CHANGED" != "yes" ]; then echo "  $1 -> NOTAPPLIED (stale anchor)"; return; fi
  if run; then echo "  $1 -> GREEN  <- ESCAPED"; else echo "  $1 -> RED"; fi
}

mutate() { # file pattern replacement
  CHANGED=$(python3 - "$1" "$2" "$3" <<'PY'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
if old not in s:
    print("no"); raise SystemExit
open(p, "w").write(s.replace(old, new, 1))
print("yes")
PY
)
}

echo "baseline"
if run; then echo "  baseline GREEN"; else echo "  BASELINE IS RED — stop"; exit 1; fi

echo "M1 the recovery door accepts any bearer"
save "$H"; mutate "$H" '!presented || !(await constantTimeEquals(presented, serviceKey))' '!presented'
verdict "M1"; restore "$H"

echo "M2 the mode is matched by prefix"
save "$H"; mutate "$H" 'if (mode !== null && mode !== "recovery") return json({ error: "unknown mode" }, 400);' 'if (mode !== null && !"recovery".startsWith(mode)) return json({ error: "unknown mode" }, 400);'
  mutate "$H" 'mode === "recovery"' 'mode !== null && "recovery".startsWith(mode)'
verdict "M2"; restore "$H"

echo "M3 the worker calls the dispatching tick (fan-out)"
save "$W"; mutate "$W" '"payment_recovery_maintain"' '"payment_recovery_tick"'
verdict "M3"; restore "$W"

echo "M4 a lost lease counts as done"
save "$W"; mutate "$W" 'counts.leaseLost += 1' 'counts.done += 1'
verdict "M4"; restore "$W"

echo "M5 reconciliation resolves a refused grant"
save "$W"; mutate "$W" '_confirmed_by: "reconcile"' '_confirmed_by: "webhook"'
verdict "M5"; restore "$W"

echo "M6 the stale-failure guard is removed"
save "$W"; mutate "$W" 'mayRecordFailure(binding)' '{ ok: true } as ReturnType<typeof mayRecordFailure>'
verdict "M6"; restore "$W"

echo "done"
