/**
 * The price in the database and the price on the screen must be the same price.
 *
 * There are necessarily two copies. The UI reads PRICE_TIERS from the bundle so
 * it can render a chart without a round trip; the CHARGE is computed in
 * `create_story_purchase` from `story_price_tiers`, because the client is never
 * allowed to name an amount. Two copies of a number is the setup for the worst
 * class of pricing bug: the screen says ₹99, the card is debited ₹49, and
 * nothing anywhere is technically broken.
 *
 * WHAT THIS TEST COVERS AND WHAT IT DOES NOT. It parses the seed INSERT in the
 * migration, so it pins the two together as shipped. It cannot see a price
 * changed later by an UPDATE against the live table — nothing in CI can. So the
 * rule that goes with it: a price change is TWO edits, the constant here and a
 * migration, and this test is what fails if you only do one of them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRICE_TIERS } from "@/lib/storyPricing";

const MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20260810120000_story_purchases.sql",
);

type SeededTier = { seconds: number; label: string; pricePaise: number };

/**
 * Pull the seeded rows out of the migration.
 *
 * Deliberately strict: it locates the one INSERT into story_price_tiers and
 * reads its VALUES tuples. If the migration is restructured so this no longer
 * matches, the test fails loudly rather than silently verifying nothing — a
 * parser that quietly returns an empty list would make this file a decoration.
 */
function seededTiers(): SeededTier[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const insert = /insert into public\.story_price_tiers[^;]*?values([\s\S]*?);/i.exec(sql);
  if (!insert) throw new Error("could not find the story_price_tiers seed INSERT");

  const rows = [...insert[1].matchAll(/\(\s*(\d+)\s*,\s*'([^']*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g)];
  if (rows.length === 0) throw new Error("story_price_tiers seed parsed to zero rows");

  return rows.map((m) => ({
    seconds: Number(m[1]),
    label: m[2],
    pricePaise: Number(m[3]),
  }));
}

describe("the chart in the database matches the chart in the bundle", () => {
  it("seeds exactly the tiers the app displays", () => {
    expect(seededTiers()).toEqual(
      PRICE_TIERS.map((t) => ({
        seconds: t.seconds,
        label: t.label,
        pricePaise: t.pricePaise,
      })),
    );
  });

  it("parses something, so the comparison above is not vacuous", () => {
    // The failure mode this exists for: a regex that stops matching returns []
    // and [] === [] passes if PRICE_TIERS were ever emptied too. Pin the count.
    expect(seededTiers().length).toBe(PRICE_TIERS.length);
    expect(seededTiers().length).toBeGreaterThanOrEqual(4);
  });
});
