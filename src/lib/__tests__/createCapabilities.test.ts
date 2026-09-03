/**
 * Create shows only what ONIQ can really make. Every live capability must
 * land on a route that exists; nothing may name a provider, a model, a GPU
 * or a price. Owner mission, 2026-09-03.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CREATE_CAPABILITIES,
  LIVE_CAPABILITIES,
  SOON_CAPABILITIES,
} from "@/lib/create/capabilities";

const ROUTES = join(process.cwd(), "src/routes/_authenticated");
const routeFileFor = (to: string) =>
  join(ROUTES, `app.${to.replace(/^\/app\//, "").replace(/\//g, ".")}.tsx`);

describe("Create capabilities", () => {
  it("every live capability lands on a route that exists", () => {
    for (const c of LIVE_CAPABILITIES) {
      expect(c.to, `${c.id} has no destination`).toBeTruthy();
      expect(existsSync(routeFileFor(c.to as string)), `${c.id} → ${c.to} has no route file`).toBe(
        true,
      );
    }
  });

  it("a capability that is not live goes nowhere", () => {
    for (const c of SOON_CAPABILITIES) {
      expect(c.to, `${c.id} is 'soon' but has a destination`).toBeUndefined();
    }
    expect(SOON_CAPABILITIES.map((c) => c.id).sort()).toEqual(["image", "music", "voice"]);
  });

  it("names no provider, model, GPU or price", () => {
    const text = JSON.stringify(CREATE_CAPABILITIES).toLowerCase();
    for (const banned of [
      "gemini",
      "openai",
      "claude",
      "anthropic",
      "runway",
      "runpod",
      "veo",
      "ltx",
      "gpu",
      "₹",
      "$",
      "credits",
      "per minute",
    ]) {
      expect(text, `capabilities mention "${banned}"`).not.toContain(banned);
    }
  });

  it("covers the seven Create verbs the owner named", () => {
    const ids = CREATE_CAPABILITIES.map((c) => c.id);
    for (const id of ["image", "video", "character", "voice", "music", "document", "ai"]) {
      expect(ids).toContain(id);
    }
  });
});
