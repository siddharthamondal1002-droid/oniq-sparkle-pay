#!/usr/bin/env bash
# Focused E-003A mutation qualification. Every mutation must make its targeted
# test fail; a green mutant invalidates the integrity gate.
set -euo pipefail
cd "$(dirname "$0")/.."

TMP="$(mktemp -d)"
CURRENT=""
cleanup() {
  if [[ -n "$CURRENT" && -f "$TMP/original" ]]; then
    cp "$TMP/original" "$CURRENT"
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

baseline=(
  src/oqca/cognitive/__tests__/kernelSlice.test.ts
  src/oqca/__tests__/selfImprovement.test.ts
  src/oqca/benchmarks/e003a/__tests__/integrity.test.ts
)
npx vitest run "${baseline[@]}"

mutate_and_require_red() {
  local name="$1"
  local file="$2"
  local test_file="$3"
  local old="$4"
  local replacement="$5"

  CURRENT="$file"
  cp "$file" "$TMP/original"
  python3 - "$file" "$old" "$replacement" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
old = sys.argv[2]
replacement = sys.argv[3]
source = path.read_text()
if source.count(old) != 1:
    raise SystemExit(f"mutation anchor count is {source.count(old)}, expected 1")
path.write_text(source.replace(old, replacement))
PY

  if npx vitest run "$test_file"; then
    echo "ESCAPED $name"
    return 1
  fi
  cp "$TMP/original" "$file"
  CURRENT=""
  echo "CAUGHT $name"
}

mutate_and_require_red   M163   src/oqca/cognitive/modelAdapter.ts   src/oqca/cognitive/__tests__/kernelSlice.test.ts   $'    tools,\n  });'   $'    tools: [],\n  });'

mutate_and_require_red   M164   src/oqca/cognitive/provenance.ts   src/oqca/cognitive/__tests__/kernelSlice.test.ts   '  const independent = new Set(verifying.map(canonicalSourceIdentity));'   '  const independent = new Set(verifying.map((_, index) => String(index)));'

mutate_and_require_red   M165   src/oqca/autonomy/regressionAssessment.ts   src/oqca/__tests__/selfImprovement.test.ts   '  if (verdict === null || verdict === "INCONCLUSIVE" || verdict === "BLOCKED") {'   '  if (verdict === null || verdict === "INCONCLUSIVE") {'

mutate_and_require_red   M166   src/oqca/benchmarks/e003a/integrity.ts   src/oqca/benchmarks/e003a/__tests__/integrity.test.ts   '  if (digest !== artifact.seal.digest) throw new Error("artifact digest mismatch");'   '  if (false) throw new Error("artifact digest mismatch");'
