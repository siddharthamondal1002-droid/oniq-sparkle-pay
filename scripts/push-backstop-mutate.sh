#!/usr/bin/env bash
# Every block must be RED. The runner owns its own undo, and a mutation that did
# not apply is announced rather than given a verdict.
set -uo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d); SUITE="src/lib/__tests__/messagePushBackstop.test.ts"
MIG=supabase/migrations/20260912070000_message_push_backstop.sql
FN=supabase/functions/send-push/index.ts

save()    { for f in "$@"; do mkdir -p "$TMP/$(dirname "$f")"; cp "$f" "$TMP/$f"; done; }
restore() { for f in "$@"; do cp "$TMP/$f" "$f"; done; }
changed() {
  [ $# -gt 0 ] || { echo "  (no file to compare — script bug)" >&2; return 1; }
  for f in "$@"; do cmp -s "$f" "$TMP/$f" || return 0; done; return 1
}
verdict() {
  local label="$1"; shift
  if ! changed "$@"; then echo "  $label  NOTAPPLIED  <- stale anchor, not a verdict"; return; fi
  if npx vitest run "$SUITE" >/dev/null 2>&1; then echo "  $label  GREEN  <- ESCAPED"; else echo "  $label  RED"; fi
}
sed_once() { python3 -c "
import io,sys
p,old,new=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8').write(s.replace(old,new,1))" "$@"; }

if npx vitest run "$SUITE" >/dev/null 2>&1; then
  echo "baseline: GREEN — verdicts below are meaningful"
else echo "baseline: RED — fix the suite first"; exit 1; fi

save "$MIG"; sed_once "$MIG" "   where r.rn = 1" "   where r.rn > 0"
verdict "P1 every missed message becomes its own push " "$MIG"; restore "$MIG"

save "$MIG"; sed_once "$MIG" "and m.is_ai = false" "and true"
verdict "P2 AI replies start waking the backstop      " "$MIG"; restore "$MIG"

save "$MIG"; sed_once "$MIG" "k_grace   constant integer := 60;" "k_grace   constant integer := 0;"
verdict "P3 grace period removed                      " "$MIG"; restore "$MIG"

save "$MIG"; sed_once "$MIG" "   limit max_conversations" "   limit 100000"
verdict "P4 one run no longer bounded                 " "$MIG"; restore "$MIG"

# The storm guard: post first, stamp after.
save "$MIG"
python3 - <<'PYEOF'
import io, re
p = "supabase/migrations/20260912070000_message_push_backstop.sql"
s = io.open(p, encoding="utf-8").read()
stamp = re.search(r"    insert into public\.message_push_state[\s\S]*?attempts \+ 1;\n", s)
post  = re.search(r"    perform net\.http_post\([\s\S]*?r\.sender_id\)\);\n", s)
if stamp and post and stamp.end() <= post.start():
    s = s[:stamp.start()] + post.group(0) + stamp.group(0) + s[post.end():]
    io.open(p, "w", encoding="utf-8").write(s)
PYEOF
verdict "P5 stamp moved after the post (storm guard)  " "$MIG"; restore "$MIG"

save "$MIG"
python3 - <<'PYEOF'
import io, re
p = "supabase/migrations/20260912070000_message_push_backstop.sql"
s = io.open(p, encoding="utf-8").read()
s = re.sub(r"insert into public\.message_push_state \(conversation_id, last_attempted_at, attempts\)\nselect c\.id, now\(\), 0 from public\.conversations c\non conflict \(conversation_id\) do nothing;\n", "", s, count=1)
io.open(p, "w", encoding="utf-8").write(s)
PYEOF
verdict "P6 seed removed: first sweep floods history  " "$MIG"; restore "$MIG"

save "$FN"; sed_once "$FN" '/^[0-9a-f-]{36}$/i.test(claimed)' 'true'
verdict "P7 server may name any sender it likes       " "$FN"; restore "$FN"

save "$FN"; sed_once "$FN" "  if (!fromServer) {" "  if (false) {"
verdict "P8 a real session stops being authenticated  " "$FN"; restore "$FN"

save "$FN"; sed_once "$FN" "const { data: senderMember } = fromServer" "const { data: senderMember } = true"
verdict "P9 membership skipped for everyone           " "$FN"; restore "$FN"

rm -rf "$TMP"
