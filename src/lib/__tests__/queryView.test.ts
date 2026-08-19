import { describe, it, expect } from "vitest";
import { viewState } from "../queryView";

/**
 * The distinction the P3 fix exists to enforce: QUERY FAILURE → error,
 * VALID EMPTY → empty. Never the two confused.
 */
describe("viewState", () => {
  it("QUERY FAILURE → error, even when the (absent) data would look empty", () => {
    expect(viewState({ isLoading: false, isError: true }, true)).toBe("error");
    expect(viewState({ isLoading: false, isError: true }, false)).toBe("error");
  });

  it("VALID EMPTY RESULT → empty", () => {
    expect(viewState({ isLoading: false, isError: false }, true)).toBe("empty");
  });

  it("present data → data", () => {
    expect(viewState({ isLoading: false, isError: false }, false)).toBe("data");
  });

  it("initial load → loading", () => {
    expect(viewState({ isLoading: true, isError: false }, false)).toBe("loading");
  });

  it("a failing background refetch outranks the stale loading flag", () => {
    expect(viewState({ isLoading: true, isError: true }, false)).toBe("error");
  });
});
