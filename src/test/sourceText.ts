/**
 * USE versus MENTION, as a reusable primitive.
 *
 * This exists because the same bug has now bitten three separate guards. A
 * rule against CLAIMING something, or against CALLING something, is never
 * broken by NAMING it:
 *
 *   - the banned-claims list has to contain the words it bans
 *   - the Official screen has to warn users about agents promising
 *     "guaranteed" visas
 *   - mediaStorage.ts has to record which FileReader calls are forbidden
 *   - oniqProfileQr.ts has to explain, in a comment, that it deliberately does
 *     NOT import parseUpiUri
 *
 * Every one of those is a mention. A guard that cannot tell prose from code
 * flags all four, and a guard that cries wolf is a guard somebody switches
 * off — which is strictly worse than not having written it.
 *
 * So: strip comments and string literals, then match. What is left is what the
 * program actually does.
 *
 * WHAT THIS DELIBERATELY IS NOT
 *
 * Not a parser. It is a line-oriented scanner, and it will mis-handle a string
 * literal containing an unbalanced quote, or a regex literal containing a
 * quote character. That is an accepted limit: it is used only against this
 * repo's own source in guard tests, the failure mode is over-stripping (a
 * guard that misses something) rather than under-stripping, and
 * `executableText` is itself tested below so the limit is visible rather than
 * assumed. If a guard ever depends on stripping being exact, it needs a real
 * parser, not this.
 */

const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

/**
 * Blank out the CONTENTS of every string literal, keeping the quotes and the
 * original length.
 *
 * Length-preserving on purpose. It is used as a mask: comment delimiters are
 * located in the masked copy, so a `//` inside "https://oniqhub.com" is never
 * mistaken for a comment, and the resulting indices still address the real
 * line. Blanking with a different length would make every index wrong.
 */
function maskStrings(line: string): string {
  return line.replace(STRING_LITERAL, (m) => m[0] + " ".repeat(m.length - 2) + m[m.length - 1]);
}

/**
 * Remove comments. Strings are left alone.
 *
 * This is the right reduction when the thing being searched for legitimately
 * lives in a string — an import specifier being the case that forced the
 * distinction. `import x from "@/a/b"` is code, and its path is a string.
 *
 * Block comments are tracked across lines, so a multi-line header — which is
 * how nearly every decision in this codebase is recorded — is removed in full
 * rather than only on its opening line.
 */
export function stripComments(source: string): string {
  const out: string[] = [];
  let inBlock = false;

  for (const rawLine of source.split("\n")) {
    let line = rawLine;

    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlock = false;
    }

    // Every delimiter search below runs against the mask and slices the real
    // line at the index it finds.
    let masked = maskStrings(line);

    // Block comments opening and closing on this line.
    for (;;) {
      const open = masked.indexOf("/*");
      if (open === -1) break;
      const close = masked.indexOf("*/", open + 2);
      if (close === -1) {
        inBlock = true;
        line = line.slice(0, open);
        masked = masked.slice(0, open);
        break;
      }
      line = line.slice(0, open) + " " + line.slice(close + 2);
      masked = maskStrings(line);
    }

    // Whatever trails a `//` is prose.
    const slashes = masked.indexOf("//");
    if (slashes !== -1) line = line.slice(0, slashes);

    if (line.trim()) out.push(line);
  }

  return out.join("\n");
}

/**
 * Reduce whole source text to executable text with no comments AND no string
 * contents.
 *
 * This is the reduction for a use-versus-mention guard: a word inside quotes
 * is being NAMED, and a rule against claiming or calling something is not
 * broken by naming it.
 */
export function executableText(source: string): string {
  return maskStrings(stripComments(source));
}

/**
 * Comment-free source, WITH LINE NUMBERS PRESERVED.
 *
 * `stripComments` drops comment-only lines, which renumbers everything after
 * them. That makes it useless for the one job a grep-based guard actually
 * needs: given a hit at `file:120`, was line 120 code or prose?
 *
 * This returns an array with exactly one entry per source line, comment text
 * blanked in place. Index N-1 is line N. It is the honest way to answer that
 * question, and it succeeds where `codeOnly` cannot: `codeOnly` sees one line
 * with no surrounding context, so the middle line of a block comment —
 * carrying no `/*` and no leading `*` — looks exactly like code to it.
 */
export function blankComments(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;

  for (const rawLine of source.split("\n")) {
    let line = rawLine;

    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) {
        out.push("");
        continue;
      }
      line = " ".repeat(end + 2) + line.slice(end + 2);
      inBlock = false;
    }

    let masked = maskStrings(line);

    for (;;) {
      const open = masked.indexOf("/*");
      if (open === -1) break;
      const close = masked.indexOf("*/", open + 2);
      if (close === -1) {
        inBlock = true;
        line = line.slice(0, open);
        break;
      }
      line = line.slice(0, open) + " ".repeat(close + 2 - open) + line.slice(close + 2);
      masked = maskStrings(line);
    }

    const slashes = masked.indexOf("//");
    if (slashes !== -1) line = line.slice(0, slashes);

    out.push(line);
  }

  return out;
}

/**
 * The same reduction, for SQL.
 *
 * Added because the migration guards hit the identical use-versus-mention
 * problem in a different comment syntax: a migration that explains WHY it does
 * not key a cache by text hash has to contain the word "hash", and a guard
 * asserting the word is absent then fails on the explanation of its own rule.
 *
 * Handles `-- line` and `/* block *\/`, and leaves single-quoted SQL literals
 * intact — a policy expression, a CHECK constraint and a GRANT all carry
 * meaning inside quotes, so blanking them would hide the statements a guard
 * most wants to read.
 */
export function stripSqlComments(sql: string): string {
  const out: string[] = [];
  let inBlock = false;

  for (const rawLine of sql.split("\n")) {
    let line = rawLine;

    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlock = false;
    }

    // Mask single-quoted literals so a `--` inside one is not read as a
    // comment. Length-preserving, so the indices below still line up.
    let masked = line.replace(/'(?:[^']|'')*'/g, (m) => "'" + " ".repeat(m.length - 2) + "'");

    const open = masked.indexOf("/*");
    if (open !== -1) {
      const close = masked.indexOf("*/", open + 2);
      if (close === -1) {
        inBlock = true;
        line = line.slice(0, open);
        masked = masked.slice(0, open);
      } else {
        line = line.slice(0, open) + " " + line.slice(close + 2);
        masked = line.replace(/'(?:[^']|'')*'/g, (m) => "'" + " ".repeat(m.length - 2) + "'");
      }
    }

    const dashes = masked.indexOf("--");
    if (dashes !== -1) line = line.slice(0, dashes);

    if (line.trim()) out.push(line);
  }

  return out.join("\n");
}

/**
 * The same reduction for a single line of `grep -n` output.
 *
 * Strips the `path:line:` prefix, then returns "" for a line that is nothing
 * but comment or string — which lets a caller drop it with a truthiness check.
 *
 * A grep line arrives WITHOUT its surrounding context, so the block-comment
 * tracking in `executableText` cannot help: the middle line of a JSDoc block
 * carries no `/*` of its own. A leading `*` is the only evidence available
 * that the line is prose, so it is treated as decisive here and nowhere else.
 */
export function codeOnly(grepLine: string): string {
  const code = grepLine.replace(/^[^:]*:\d+:/, "").trim();
  if (/^(\/\/|\*|\/\*)/.test(code)) return "";
  return executableText(code).trim();
}
