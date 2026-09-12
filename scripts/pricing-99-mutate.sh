#!/usr/bin/env bash
# Mutation check for the ₹99/min reprice (owner directive, 2026-09-12).
#
# WHAT THIS PROVES. The pricing guards already existed and were green at ₹75;
# green after a reprice says nothing on its own, because a guard that only
# pins a constant to itself passes whatever the constant is. Each mutation
# below opens a hole a real edit could open — the SQL and the TS copy drifting
# apart, a hand-set tier price, the floor stopping being checked — and the
# suite must go RED for every one.
#
# The runner owns its own undo (copy aside, copy back). `git checkout --`
# reverts to a COMMIT, and on 2026-09-11 that deleted the uncommitted work it
# was meant to protect.
set -uo pipefail
cd "$(dirname "$0")/.."

SPEC="src/lib/__tests__/storyPricingSql.test.ts src/lib/__tests__/storyCostModel.test.ts"
BACKUP="$(mktemp -d)"
trap 'rm -rf "$BACKUP"' EXIT

save() { mkdir -p "$BACKUP/$(dirname "$1")"; cp "$1" "$BACKUP/$1"; }
restore() { cp "$BACKUP/$1" "$1"; }

suite() { npx vitest run $SPEC >/dev/null 2>&1; }

verdict() {
  local label="$1" file="$2"
  if cmp -s "$file" "$BACKUP/$file"; then
    echo "$label  NOTAPPLIED  <- the anchor did not match; this is not a verdict"
    return
  fi
  if suite; then echo "$label  GREEN <- ESCAPED"; else echo "$label  RED"; fi
}

echo "baseline:"
if suite; then echo "  green"; else echo "  BASELINE IS RED — stop, no verdict below counts"; exit 1; fi

# M1 the migration reprices at the OLD rate while the TS copy says ₹99
save supabase/migrations/20260912190000_ninety_nine_a_minute.sql
sed -i 's/round(9900.0 \* seconds \/ 60)/round(7500.0 * seconds \/ 60)/' \
  supabase/migrations/20260912190000_ninety_nine_a_minute.sql
verdict "M1 migration rate back to 7500 " supabase/migrations/20260912190000_ninety_nine_a_minute.sql
restore supabase/migrations/20260912190000_ninety_nine_a_minute.sql

# M2 the published per-minute rate drifts from the migration
save src/lib/storyPricing.ts
sed -i 's/^  movie: 9900,$/  movie: 7500,/' src/lib/storyPricing.ts
verdict "M2 PER_MINUTE_PAISE.movie 7500" src/lib/storyPricing.ts
restore src/lib/storyPricing.ts

# M3 one tier hand-set off the rate — the ladder this repo refuses to have
save src/lib/storyCostModel.ts
sed -i 's/pricePaise: 29700/pricePaise: 27900/' src/lib/storyCostModel.ts
verdict "M3 the 3-minute tier hand-set " src/lib/storyCostModel.ts
restore src/lib/storyCostModel.ts

# M4 the rate drops UNDER the derived floor: the margin check must catch it
save src/lib/storyPricing.ts
sed -i 's/^  movie: 9900,$/  movie: 7100,/' src/lib/storyPricing.ts
verdict "M4 rate below the ₹72 floor   " src/lib/storyPricing.ts
restore src/lib/storyPricing.ts

# M5 the whole chart repriced consistently but not to the owner's number —
# the one mutation a pure self-agreement guard would let through
save src/lib/storyPricing.ts
save src/lib/storyCostModel.ts
save supabase/migrations/20260912190000_ninety_nine_a_minute.sql
sed -i 's/^  movie: 9900,$/  movie: 8900,/' src/lib/storyPricing.ts
sed -i 's/pricePaise: 9900/pricePaise: 8900/;s/pricePaise: 19800/pricePaise: 17800/;s/pricePaise: 29700/pricePaise: 26700/;s/pricePaise: 49500/pricePaise: 44500/' src/lib/storyCostModel.ts
sed -i 's/round(9900.0 \* seconds \/ 60)/round(8900.0 * seconds \/ 60)/' \
  supabase/migrations/20260912190000_ninety_nine_a_minute.sql
verdict "M5 consistent reprice to ₹89  " src/lib/storyPricing.ts
restore src/lib/storyPricing.ts
restore src/lib/storyCostModel.ts
restore supabase/migrations/20260912190000_ninety_nine_a_minute.sql

echo "final baseline:"
if suite; then echo "  green — tree restored"; else echo "  RED — THE TREE IS NOT RESTORED"; exit 1; fi
