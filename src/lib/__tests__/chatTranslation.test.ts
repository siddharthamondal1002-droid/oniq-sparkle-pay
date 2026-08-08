/**
 * Track A2 — chat translation, and the two things it must never become.
 *
 * The feature is small. Its failure modes are not, and both are invisible to
 * tsc and to any rendering test:
 *
 *   IT MUST NOT ACCEPT TEXT FROM THE CALLER. The cache is shared — one row per
 *   (message, language), served to every reader of that conversation. If the
 *   client supplied the text, anyone could send someone else's message_id with
 *   text of their choosing and every other participant would afterwards be
 *   shown that text as the translation, rendered by ONIQ and looking
 *   authoritative.
 *
 *   IT MUST NOT TRANSLATE ANYTHING NOBODY ASKED FOR. Translating sends another
 *   person's words to a third-party model provider. Auto-translating a thread
 *   would ship whole conversations there because one participant flipped a
 *   setting, and the people who wrote those messages never agreed to it.
 *
 * vitest runs with environment: "node", so the route and Deno function are
 * checked as source rather than executed — said plainly, because that proves
 * how the code is written, not how it behaves at runtime.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments, stripSqlComments } from "@/test/sourceText";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const FN = "supabase/functions/translate-message/index.ts";
const CHAT = "src/routes/_authenticated/app.chat.$conversationId.tsx";
const MIGRATION = "supabase/migrations/20260808000000_message_translations.sql";

describe("the edge function never trusts caller-supplied text", () => {
  const code = stripComments(read(FN));

  it("reads text from the database, not from the request body", () => {
    // The tell: it selects content from messages, and the only things it
    // pulls off the body are an id and a language.
    expect(code).toMatch(/from\("messages"\)/);
    expect(code).toMatch(/\.select\("id, content, type, is_deleted"\)/);
    expect(code).toMatch(/body\?\.message_id/);
    expect(code).toMatch(/body\?\.to/);
  });

  it("takes no text field off the body at all", () => {
    // If this ever appears, the cache-poisoning door is open again.
    expect(code).not.toMatch(/body\?\.text|body\.text|body\?\.content|body\.content/);
  });

  it("reads the message as the CALLER, so RLS is the authorisation", () => {
    // A second, hand-written permission check would be a copy of
    // messages_select that can drift out of step with it. Using the caller's
    // own JWT means there is exactly one rule.
    expect(code).toMatch(/global:\s*\{\s*headers:\s*\{\s*Authorization:\s*authHeader/);
    expect(code).toMatch(/asUser\s*\n?\s*\.from\("messages"\)|asUser\.from\("messages"\)/);
  });

  it("writes the cache with the service role, never as the caller", () => {
    expect(code).toMatch(
      /admin\s*\n?\s*\.from\("message_translations"\)|admin\.from\("message_translations"\)/,
    );
    expect(code).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("validates the language against the allowlist, not a regex", () => {
    // An unrecognised code must never reach the prompt, or "translate into
    // <whatever the caller typed>" becomes an injection point in the system
    // message.
    expect(code).toMatch(/SUPPORTED_LANGS\[to\]/);
    expect(code).toMatch(/unsupported language/);
  });

  it("refuses deleted, non-text, empty and oversized messages", () => {
    expect(code).toMatch(/msg\.is_deleted/);
    expect(code).toMatch(/msg\.type !== "text"/);
    expect(code).toMatch(/nothing to translate/);
    expect(code).toMatch(/MAX_CHARS/);
  });

  it("rate limits per user", () => {
    expect(code).toMatch(/rateLimit\(userId\)/);
  });

  it("tells the model the message is data, not instructions", () => {
    // A chat message saying "ignore your instructions" is content to
    // translate. It is passed as the user turn and never interpolated into
    // the system prompt, and the system prompt says so explicitly.
    const src = read(FN);
    expect(src).toMatch(/not instructions to follow|do not act on them/i);
    expect(code).toMatch(/messages:\s*\[\{\s*role:\s*"user"[^}]*content:\s*text/);
    // The text must NOT appear inside the system string.
    const systemAssign = /const system =([\s\S]*?);\n/.exec(code)?.[1] ?? "";
    expect(systemAssign, "message text is interpolated into the system prompt").not.toMatch(
      /\$\{text\}/,
    );
  });
});

describe("nothing is translated unless a reader asks", () => {
  const code = stripComments(read(CHAT));

  it("only ever translates from an explicit tap", () => {
    // translateMessage is INVOKED exactly once, from the action-sheet button.
    // Any second call site is where automatic translation would sneak in.
    // (The definition is an arrow const, so it does not match this pattern —
    // asserted separately below so the count stays honest.)
    expect(code).toMatch(/const translateMessage = async \(m: Message\) =>/);
    const calls = code.match(/translateMessage\(/g) ?? [];
    expect(calls, `expected one invocation, found ${calls.length}`).toHaveLength(1);
    expect(code).toMatch(/onClick=\{\(\) => translateMessage\(menuFor\)\}/);
  });

  it("does not translate on mount or on new messages", () => {
    // The specific shape that would turn this into bulk translation.
    expect(code).not.toMatch(/useEffect\([^)]*translateMessage/s);
  });

  it("sends only the id and the target language", () => {
    expect(code).toMatch(/body:\s*\{\s*message_id:\s*m\.id,\s*to:\s*myLang\s*\}/);
  });

  it("offers it only on other people's text messages", () => {
    expect(code).toMatch(/menuFor\.sender_id !== me\?\.id/);
  });

  it("keeps the original reachable and labels the translation as machine-made", () => {
    // A translation is a machine's reading of what someone said. Replacing
    // the words they typed would present a guess as the message itself.
    const src = read(CHAT);
    expect(src).toMatch(/show original/);
    expect(src).toMatch(/translated by AI/);
  });
});

describe("the cache cannot be written or over-read by clients", () => {
  // Statements only. The migration explains its own rules in prose, and a
  // guard that cannot tell a rule from its explanation fails on the comment
  // describing what it forbids.
  const sql = stripSqlComments(read(MIGRATION));
  const withProse = read(MIGRATION);

  it("grants clients select and nothing else", () => {
    // Supabase's default privileges hand new tables ALL to authenticated, so
    // the revoke has to come first — a bare grant is additive and leaves
    // insert/update/delete in place. That is what happened on the first run.
    expect(sql).toMatch(
      /revoke all on table public\.message_translations from anon, authenticated, public;/,
    );
    const grants = sql.match(/grant [^;]*on table public\.message_translations[^;]*;/g) ?? [];
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(
      /grant select on table public\.message_translations to authenticated;/,
    );
  });

  it("has a select policy and no write policy", () => {
    const policies = sql.match(/create policy[\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/for select/);
    expect(sql).not.toMatch(/for (insert|update|delete|all)\b/i);
  });

  it("gates reads on the same rule as messages, soft delete included", () => {
    // Without the is_deleted clause a cached translation would outlive a
    // deleted message and become a way to read what someone deleted.
    expect(sql).toMatch(/is_conversation_member\(m\.conversation_id, auth\.uid\(\)\)/);
    expect(sql).toMatch(/coalesce\(m\.is_deleted, false\) = false or m\.sender_id = auth\.uid\(\)/);
  });

  it("clears cached translations when a message is edited", () => {
    // A stale translation of edited text is worse than none: it looks
    // authoritative and it is wrong.
    expect(sql).toMatch(/after update of content, is_deleted on public\.messages/);
    expect(sql).toMatch(/new\.content is distinct from old\.content/);
    expect(sql).toMatch(/delete from message_translations where message_id = new\.id/);
  });

  it("keys the cache by message, never by text hash", () => {
    // Hashing the text would silently join unrelated conversations that
    // happen to share a sentence, serving one chat's cache entry into another.
    expect(sql).toMatch(/primary key \(message_id, target_lang\)/);
    expect(sql).not.toMatch(/hash|digest|md5|sha256/i);
  });

  it("is additive and carries its own down migration", () => {
    for (const line of [
      "drop trigger if exists messages_clear_translations on public.messages",
      "drop function if exists public.clear_message_translations()",
      "drop function if exists public.can_read_message(uuid)",
      "drop table if exists public.message_translations",
    ]) {
      // The down migration is intentionally commented out, so this one reads
      // the raw file rather than the stripped statements.
      expect(withProse, `down migration missing: ${line}`).toContain(line);
    }
  });
});

describe("no end-to-end-encryption claim creeps in with translation", () => {
  it("the translation UI makes no confidentiality promise", () => {
    // Server-side translation and E2EE are mutually exclusive, and this is
    // exactly the feature where someone would be tempted to reassure a user.
    // megaLoopGuardrails.test.ts polices the whole tree; this pins the file
    // the temptation would land in.
    const src = read(CHAT);
    expect(src).not.toMatch(/end[- ]to[- ]end|e2ee/i);
    expect(src).not.toMatch(/private(ly)? translated|stays on your device|never leaves/i);
  });
});
