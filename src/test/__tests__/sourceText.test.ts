/**
 * The use-versus-mention primitive, tested.
 *
 * Everything else in the guard suite trusts this to decide what counts as
 * code. An untested filter sitting under four guards is a single point of
 * silent failure: if it over-strips, every guard above it passes on an empty
 * string and reports green while the codebase does whatever it likes.
 *
 * So both directions are asserted throughout — the mention is dropped AND the
 * use survives.
 */
import { describe, expect, it } from "vitest";
import {
  blankComments,
  codeOnly,
  executableText,
  stripComments,
  stripSqlComments,
} from "@/test/sourceText";

describe("stripComments keeps strings, because an import path is one", () => {
  it("keeps an import specifier intact", () => {
    // The distinction that forced stripComments to exist. Blank the string and
    // a guard against importing a specific module passes unconditionally —
    // which is worse than no guard, since it reports green.
    const src = [
      "// this module does not import parseUpiUri",
      `import { parseUpiUri } from "@/routes/_authenticated/app.scan";`,
    ].join("\n");
    const out = stripComments(src);
    expect(out).toContain(`from "@/routes/_authenticated/app.scan"`);
    expect(out.match(/parseUpiUri/g)).toHaveLength(1);
  });

  it("still removes the comment that merely names it", () => {
    expect(stripComments("// does not import parseUpiUri")).toBe("");
    expect(stripComments("/* does not import parseUpiUri */")).toBe("");
  });

  it("does not treat a // inside a string as a comment", () => {
    const src = `const u = "https://oniqhub.com/u/x"; // a note`;
    const out = stripComments(src);
    expect(out).toContain("https://oniqhub.com/u/x");
    expect(out).not.toContain("a note");
  });

  it("does not treat a /* inside a string as a comment", () => {
    // Length-preserving masking is what makes this work: the delimiter search
    // runs on the mask, and the slice index still addresses the real line.
    const src = `const glob = "src/**/*.ts"; const after = 1;`;
    const out = stripComments(src);
    expect(out).toContain(`"src/**/*.ts"`);
    expect(out).toContain("const after = 1;");
  });

  it("handles two block comments on one line", () => {
    // Content, not exact spacing — a comment is replaced by whitespace so
    // tokens on either side cannot be glued together, and how much whitespace
    // results is not something any guard should depend on.
    const out = stripComments("/*a*/ keep1 /*b*/ keep2");
    expect(out).not.toMatch(/\ba\b|\bb\b/);
    expect(out.split(/\s+/).filter(Boolean)).toEqual(["keep1", "keep2"]);
  });
});

describe("executableText keeps code and drops prose", () => {
  it("drops a single-line comment but keeps the code before it", () => {
    expect(executableText(`const x = 1; // readAsDataURL is banned`)).toBe("const x = 1; ");
    expect(executableText(`// readAsDataURL is banned`)).toBe("");
  });

  it("drops a multi-line block comment entirely", () => {
    const src = [
      "/**",
      " * This module deliberately does NOT import parseUpiUri.",
      " * Calling readAsDataURL here would kill the process.",
      " */",
      "export const ok = true;",
    ].join("\n");
    const out = executableText(src);
    expect(out).not.toContain("parseUpiUri");
    expect(out).not.toContain("readAsDataURL");
    expect(out).toContain("export const ok = true;");
  });

  it("does not let a block comment swallow the rest of the file", () => {
    // The failure that would matter most: a stray unterminated-looking header
    // silently blanking every guard below it.
    const src = ["/* a note */ const a = 1;", "const b = 2;"].join("\n");
    const out = executableText(src);
    expect(out).toContain("const a = 1;");
    expect(out).toContain("const b = 2;");
    expect(out).not.toContain("a note");
  });

  it("keeps code that follows a block comment closing mid-line", () => {
    expect(executableText("/* off */ readAsDataURL(f);")).toContain("readAsDataURL");
  });

  it("is not fooled by a URL's double slash inside a string", () => {
    // Strip strings before comments and this works; do it the other way round
    // and everything after "https:" vanishes, taking real code with it.
    const src = `const u = "https://oniqhub.com/u/x"; readAsDataURL(f);`;
    expect(executableText(src)).toContain("readAsDataURL");
  });

  it("drops string contents, since a quoted word is named not asserted", () => {
    const src = `const banned = ["guaranteed", "endorsed"];`;
    const out = executableText(src);
    expect(out).not.toContain("guaranteed");
    expect(out).not.toContain("endorsed");
    expect(out).toContain("const banned");
  });

  it("handles all three quote styles", () => {
    expect(executableText(`a('guaranteed')`)).not.toContain("guaranteed");
    expect(executableText("a(`guaranteed`)")).not.toContain("guaranteed");
    expect(executableText(`a("guaranteed")`)).not.toContain("guaranteed");
  });

  it("survives an escaped quote inside a string", () => {
    const src = `const s = "she said \\"guaranteed\\" once"; useIt();`;
    const out = executableText(src);
    expect(out).not.toContain("guaranteed");
    expect(out).toContain("useIt();");
  });

  it("keeps a real call that shares a name with a banned mention", () => {
    // The whole point. Same identifier, two different lines, opposite verdicts.
    const src = [`// never call readAsDataURL`, `reader.readAsDataURL(file);`].join("\n");
    const out = executableText(src);
    expect(out).toContain("reader.readAsDataURL(file);");
    expect(out.match(/readAsDataURL/g)).toHaveLength(1);
  });
});

describe("blankComments keeps line numbers so a grep hit can be judged", () => {
  it("returns one entry per source line", () => {
    const src = ["a", "// b", "c"].join("\n");
    expect(blankComments(src)).toHaveLength(3);
  });

  it("blanks the MIDDLE line of a multi-line comment", () => {
    // The case codeOnly cannot handle: this line carries no comment marker at
    // all, so seen alone it is indistinguishable from code. It is why the
    // refresh-rate guard flagged a JSX comment in the diag screen.
    const src = [
      "const a = 1;",
      "{/* The budget is derived, not assumed.",
      "    On a 90 or 120 Hz panel a janky scroll scores perfectly.",
      "*/}",
      "const b = 2;",
    ].join("\n");
    const lines = blankComments(src);
    expect(lines[2].trim(), "prose line survived").toBe("");
    expect(lines[0]).toContain("const a = 1;");
    expect(lines[4]).toContain("const b = 2;");
  });

  it("leaves a real claim on a code line intact", () => {
    // The fix is only safe if a genuine claim still shows up.
    const src = ["<h1>Device check at 120 Hz</h1>"].join("\n");
    expect(blankComments(src)[0]).toContain("120 Hz");
  });

  it("keeps code that shares a line with a comment", () => {
    const lines = blankComments("const x = 1; // 120 Hz");
    expect(lines[0]).toContain("const x = 1;");
    expect(lines[0]).not.toContain("120");
  });

  it("does not shift numbering when a comment-only line appears", () => {
    const src = ["// one", "// two", "target();"].join("\n");
    expect(blankComments(src)[2]).toContain("target();");
  });
});

describe("stripSqlComments, for the migration guards", () => {
  it("drops a -- comment but keeps the statement", () => {
    const sql = ["-- keying by text hash would be wrong", "create table t (a int);"].join("\n");
    const out = stripSqlComments(sql);
    expect(out).not.toContain("hash");
    expect(out).toContain("create table t (a int);");
  });

  it("drops a multi-line block comment", () => {
    const sql = ["/*", " * do not use md5 here", " */", "select 1;"].join("\n");
    const out = stripSqlComments(sql);
    expect(out).not.toContain("md5");
    expect(out).toContain("select 1;");
  });

  it("keeps single-quoted literals, which carry the meaning in SQL", () => {
    // A CHECK constraint, a policy expression and a search_path all live
    // inside quotes. Blanking them would hide exactly what a guard reads.
    const sql = `check (target_lang ~ '^[A-Za-z]{2,3}$');`;
    expect(stripSqlComments(sql)).toContain("'^[A-Za-z]{2,3}$'");
  });

  it("is not fooled by -- inside a quoted literal", () => {
    const sql = `insert into t values ('a--b'); select 2;`;
    const out = stripSqlComments(sql);
    expect(out).toContain("'a--b'");
    expect(out).toContain("select 2;");
  });

  it("still reports a genuine use of a banned word", () => {
    // Stripping is only safe if the real statement still trips the guard.
    expect(stripSqlComments("create index on t (md5(x));")).toContain("md5");
  });
});

describe("codeOnly handles a context-free grep line", () => {
  it("strips the path:line: prefix", () => {
    expect(codeOnly("src/a.ts:12:const x = 1;")).toBe("const x = 1;");
  });

  it("returns empty for the middle line of a block comment", () => {
    // A grep line arrives with no surrounding context, so the block tracking
    // in executableText cannot see the opening `/*` on an earlier line. The
    // leading `*` is the only evidence there is.
    expect(codeOnly("src/a.ts:3: * this mentions parseUpiUri")).toBe("");
    expect(codeOnly("src/a.ts:3://  mentions parseUpiUri")).toBe("");
    expect(codeOnly("src/a.ts:3:/* mentions parseUpiUri */")).toBe("");
  });

  it("still reports a genuine use", () => {
    expect(codeOnly("src/a.ts:9:  reader.readAsDataURL(f);")).toContain("readAsDataURL");
  });

  it("does not treat a multiplication as a comment", () => {
    // A line beginning with `*` is prose; one merely containing it is not.
    expect(codeOnly("src/a.ts:4:const n = w * h;")).toContain("w * h");
  });
});
