#!/usr/bin/env bash
# Mutation run for the still checkpoint classifier and the still spend gate.
#
# A guard that has never been mutated has never been tested. Every mutation
# below opens exactly the hole its label names, and must turn the suite RED.
#
# The runner owns its own undo: it copies files aside and copies them back.
# `git checkout --` reverts to a COMMIT, and on 2026-09-11 that deleted the
# uncommitted work it was meant to protect.
set -uo pipefail
cd "$(dirname "$0")/.."

IMG=supabase/functions/_shared/oniqImage.ts
MOT=supabase/functions/_shared/inHouseMotion.ts
STL=supabase/functions/story-still/index.ts
TESTS="src/lib/__tests__/stillCheckpointRetry.test.ts src/lib/__tests__/stillSpendAccounting.test.ts src/lib/__tests__/oniqImage.test.ts src/lib/__tests__/storyStillReference.test.ts"

TMP=$(mktemp -d)
save() { for f in "$@"; do mkdir -p "$TMP/$(dirname "$f")"; cp "$f" "$TMP/$f"; done; }
restore() { for f in "$@"; do cp "$TMP/$f" "$f"; done; }
save "$IMG" "$MOT" "$STL"
trap 'restore "$IMG" "$MOT" "$STL"; rm -rf "$TMP"' EXIT

run() { npx vitest run $TESTS >/dev/null 2>&1; }

echo "baseline"
if run; then echo "  GREEN — ok to read verdicts"; else echo "  BASELINE IS RED — stop"; exit 1; fi

verdict() { # label file
  if [ -z "${2:-}" ]; then echo "  script bug: no file"; return; fi
  if cmp -s "$2" "$TMP/$2"; then echo "  $1: NOTAPPLIED (stale anchor)"; return; fi
  if run; then echo "  $1: GREEN <- ESCAPED"; else echo "  $1: RED"; fi
}

# S1 — the checkpoint patterns removed: the 2026-09-09 behaviour, three GPU
# submissions to be refused three times.
python3 - "$IMG" <<'PY'
import sys,re
p=sys.argv[1]; s=open(p).read()
s=s.replace("  /checkpoint[-_ ]?inconsistent/i,\n","").replace("  /\\bPermissionError\\b/,\n","").replace("  /\\[Errno 13\\]/,\n","")
open(p,'w').write(s)
PY
verdict "S1 checkpoint patterns removed" "$IMG"; restore "$IMG"

# S2 — the refusal code moved into the transient allowlist.
python3 - "$IMG" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace('  "ThrottlingException",\n]);','  "ThrottlingException",\n  "checkpoint-inconsistent",\n]);',1)
open(p,'w').write(s)
PY
verdict "S2 refusal code made transient" "$IMG"; restore "$IMG"

# S3 — a settlement that fabricates a zero charge.
python3 - "$MOT" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("    ...(actualUsd === undefined ? {} : { actualUsd }),","    actualUsd: actualUsd ?? 0,")
open(p,'w').write(s)
PY
verdict "S3 settlement fabricates \$0" "$MOT"; restore "$MOT"

# S4 — the reservation over the per-request cap: every cold draw refused.
python3 - "$MOT" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("export const IN_HOUSE_STILL_RESERVE_GPU_SECONDS = 120;","export const IN_HOUSE_STILL_RESERVE_GPU_SECONDS = 9_000_000;")
open(p,'w').write(s)
PY
verdict "S4 reservation above the cap" "$MOT"; restore "$MOT"

# S5 — one requestId per call: the attempt ladder stops bounding anything.
python3 - "$MOT" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("    requestId: `still:${stillId}`,","    requestId: `still:${crypto.randomUUID()}`,")
open(p,'w').write(s)
PY
verdict "S5 requestId no longer idempotent" "$MOT"; restore "$MOT"

# S6 — reserve AFTER dispatch: a film that cannot be paid for wakes the card.
python3 - "$STL" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("          const admission = await admitProviderSpend(rpc, spend);","          const admission = { ok: true, reason: \"ok\" as const };\n          void admitProviderSpend;")
open(p,'w').write(s)
PY
verdict "S6 admission bypassed" "$STL"; restore "$STL"

# S7 — a terminal failure RELEASED instead of settled: the expensive failures
# reported as free.
python3 - "$STL" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
i=s.index('            stillSettlementFor("FAILED", null, {\n              engineJobId,')
j=s.index('          );', i)
s=s[:i-len('          await settleProviderSpend(\n            rpc,\n            spend.requestId,\n')]+ '          await releaseProviderSpend(rpc, spend.requestId);\n' + s[j+len('          );\n'):]
open(p,'w').write(s)
PY
verdict "S7 failed poll releases" "$STL"; restore "$STL"

# S8 — the bounded path metered by nobody.
python3 - "$STL" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace('        stillSettlementFor("ACCEPTED", still.gpuSeconds, {','        stillSettlementFor("FAILED", still.gpuSeconds, {')
open(p,'w').write(s)
PY
verdict "S8 bounded path settles wrong outcome" "$STL"; restore "$STL"

echo "done"
