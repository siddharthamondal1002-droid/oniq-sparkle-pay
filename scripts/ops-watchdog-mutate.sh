#!/usr/bin/env bash
# Mutation run for the ONIQ watchdog. Every block must print RED.
#
# THE RUNNER OWNS ITS OWN UNDO. `git checkout --` reverts to HEAD, and these
# changes are uncommitted — a previous script in this repo used it and DELETED
# the work it was testing. Copy to a temp dir and copy back.
set -uo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
SUITE="src/lib/__tests__/opsWatchdog.test.ts"

MIG=supabase/migrations/20260912060000_oniq_ops_watchdog.sql
FN=supabase/functions/ops-alert/index.ts

save() { for f in "$@"; do mkdir -p "$TMP/$(dirname "$f")"; cp "$f" "$TMP/$f"; done; }
restore() { for f in "$@"; do cp "$TMP/$f" "$f"; done; }

verdict() { # $1 = label
  if npx vitest run "$SUITE" >/dev/null 2>&1; then echo "  $1  GREEN  <- ESCAPED"; else echo "  $1  RED"; fi
}

mutate() { # $1 label, $2 file, $3 python-expr-applied-to-s
  save "$2"
  python3 - "$2" <<PY
import io,sys
p=sys.argv[1]; s=io.open(p,encoding="utf-8").read()
before=s
$3
if s==before:
    print("  $1  NOTAPPLIED  <- anchor is stale, this is not a verdict"); sys.exit(9)
io.open(p,"w",encoding="utf-8").write(s)
PY
  if [ $? -eq 9 ]; then restore "$2"; return; fi
  verdict "$1"
  restore "$2"
}

# A VERDICT TAKEN AGAINST A FAILING BASELINE IS NOT A VERDICT. Checked first,
# and printed in its own words rather than through verdict(), whose "ESCAPED"
# wording is meaningless here and would read as a failure on a healthy tree.
if npx vitest run "$SUITE" >/dev/null 2>&1; then
  echo "baseline: GREEN — verdicts below are meaningful"
else
  echo "baseline: RED — FIX THE SUITE FIRST, nothing below counts"; exit 1
fi

mutate "W1 detector counts error reports" "$MIG" \
  's=s.replace("from public.story_dispatch_health h where h.id;","from public.story_dispatch_health h where h.id;\n  perform count(*) from public.client_error_reports;",1)'
mutate "W2 dispatch threshold 3 -> 50   " "$MIG" \
  's=s.replace("k_dispatch_fails constant integer  := 3;","k_dispatch_fails constant integer  := 50;",1)'
mutate "W3 stall window breaks half-TTL " "$MIG" \
  "s=s.replace(\"interval '3 hours'\",\"interval '5 hours'\",1)"
mutate "W4 dedup index removed          " "$MIG" \
  's=s.replace("create unique index if not exists ops_alerts_one_open_per_signal","create index if not exists ops_alerts_one_open_per_signal",1)'
mutate "W5 advisory lock removed        " "$MIG" \
  "s=s.replace(\"perform pg_advisory_xact_lock(hashtext('ops_watch_tick'));\",\"\",1)"
mutate "W6 detector writes a story job  " "$MIG" \
  's=s.replace("  select count(*) into v_open from public.ops_alerts where resolved_at is null;","  update public.story_jobs set status = %s where false;\\n  select count(*) into v_open from public.ops_alerts where resolved_at is null;" % chr(39)+"x"+chr(39),1)'
mutate "W7 notified marked before send  " "$FN" \
  's=s.replace("  if (sent > 0) {","  await admin.from(\"ops_alerts\").update({ notified_at: new Date().toISOString() }).eq(\"id\", 0);\n  if (sent > 0) {",1)'
mutate "W8 token leaked into failures   " "$FN" \
  's=s.replace("      else failures.push(`http ${res.status}`);","      else failures.push(`http ${res.status} token=${token}`);",1)'
mutate "W9 web subscriptions sent to FCM" "$FN" \
  's=s.replace("    .neq(\"platform\", \"web\");","    ;",1)'
mutate "W10 admin gate removed          " "$FN" \
  's=s.replace("    if (isAdmin !== true) return json({ error: \"forbidden\" }, 403);","",1)'

rm -rf "$TMP"
