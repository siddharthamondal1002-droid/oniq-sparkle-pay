/**
 * The restaurants list must project only the columns the card renders.
 *
 * THE PAYLOAD THIS PINS
 *
 * app.food.index loaded the open-restaurants catalog with `select("*")`. That
 * pulled the unbounded `description` and `address` text (plus review_count /
 * created_at) on every food-page load, none of which the list card renders —
 * dead payload that grows with the restaurant catalogue. The row count is
 * intentionally unbounded (a catalogue shows every open restaurant), so the fix
 * is column projection, NOT a limit that would hide restaurants.
 *
 * Asserted against source: a later edit reverting to select("*") would silently
 * restore the over-fetch while every runtime test still passed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/app.food.index.tsx"),
  "utf8",
);

// Isolate the restaurants query.
const q = src.slice(src.indexOf('.from("restaurants")'), src.indexOf('.eq("is_open"'));

describe("food index restaurants projection", () => {
  it("does not select('*') on the restaurants catalogue", () => {
    expect(q).not.toContain('select("*")');
  });

  it("selects exactly the columns the card renders", () => {
    for (const col of [
      "id",
      "name",
      "cuisine_type",
      "image_url",
      "rating",
      "delivery_time_mins",
      "delivery_fee",
    ]) {
      expect(q).toContain(col);
    }
  });

  it("does not over-fetch the unused heavy columns", () => {
    // description/address are unbounded text the list never shows.
    expect(q).not.toMatch(/select\([^)]*description/);
    expect(q).not.toMatch(/select\([^)]*address/);
  });
});
