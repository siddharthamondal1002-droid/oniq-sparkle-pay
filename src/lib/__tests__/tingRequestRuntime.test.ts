import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Execute the actual route's ask handler with only its UI/network dependencies
// replaced. No provider traffic and no source-pattern substitute for execution.
const source = readFileSync("src/routes/_authenticated/app.ai.tsx", "utf8");
const ast = ts.createSourceFile(
  "route.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let handler = "";
function find(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "ask") handler = node.getText(ast);
  ts.forEachChild(node, find);
}
find(ast);
const js = ts.transpileModule(handler, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function setup(verdict = "normal") {
  const invoke = vi.fn();
  const askInFlight = { current: false };
  const env = {
    askInFlight,
    notConfigured: false,
    attachment: null,
    messages: [],
    webSearch: false,
    setMessages: vi.fn(),
    setInput: vi.fn(),
    setAttachment: vi.fn(),
    setLoading: vi.fn(),
    setNotConfigured: vi.fn(),
    guardTingPrompt: () => verdict,
    CRISIS_RESPONSE: "support",
    supabase: { functions: { invoke } },
    toast: { error: vi.fn() },
  };
  // The language import's existing fallback handles unavailable browser context.
  const ask = new Function(...Object.keys(env), `${js}; return ask;`)(...Object.values(env)) as (
    text: string,
  ) => Promise<void>;
  return { ask, invoke, env };
}
describe("Ting request lock", () => {
  it("two same-tick sends make one paid invocation and preserve the first turn", async () => {
    const { ask, invoke, env } = setup();
    let finish!: (value: unknown) => void;
    invoke.mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const first = ask("first");
    await ask("duplicate");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(env.setInput).toHaveBeenCalledTimes(1);
    finish({ data: { reply: "answer" } });
    await first;
    invoke.mockResolvedValue({ data: { reply: "next" } });
    await ask("next turn");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("a failure releases the lock for an explicit retry", async () => {
    const { ask, invoke, env } = setup();
    invoke.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ data: { reply: "ok" } });
    await ask("question");
    expect(env.toast.error).toHaveBeenCalledTimes(1);
    await ask("retry");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(env.askInFlight.current).toBe(false);
  });
  it("crisis routing stays local and releases the lock", async () => {
    const { ask, invoke, env } = setup("crisis");
    await ask("help");
    expect(invoke).not.toHaveBeenCalled();
    expect(env.askInFlight.current).toBe(false);
    expect(env.setMessages).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ crisis: true })]),
    );
  });
});
