import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/app.ai.tsx"),
  "utf8",
);

describe("Ting request lock", () => {
  it("guards ask() with an in-flight ref", () => {
    expect(SRC).toMatch(/const askInFlight = useRef\(false\)/);
    expect(SRC).toMatch(/if \(notConfigured \|\| askInFlight\.current\) return;/);
    expect(SRC).toMatch(/askInFlight\.current = true;/);
    expect(SRC).toMatch(/askInFlight\.current = false;/);
  });

  it("does not roll messages back to a stale closure when Ting is unconfigured", () => {
    expect(SRC).toContain("setNotConfigured(true);");
    expect(SRC).not.toContain("setMessages(messages);");
  });
});
