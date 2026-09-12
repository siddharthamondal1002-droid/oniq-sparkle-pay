import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../../test/sourceText.ts";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const MIGRATION = "supabase/migrations/20260912070000_message_push_backstop.sql";
const SEND_PUSH = "supabase/functions/send-push/index.ts";

/** SQL comments are `--`; the TS stripper does not know them, and every one of mine quotes the code it explains. */
const stripSql = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

describe("the backstop covers the client without replacing it", () => {
  /**
   * `skipPush` IS WHY THIS IS A BACKSTOP. Sending five photos inserts five
   * rows and deliberately pushes ONCE, as "📎 5 items". A per-row trigger would
   * turn one buzz into five — a regression dressed as a fix. Coverage is
   * therefore per CONVERSATION, and more than one missed message collapses to a
   * count. Proven on production: three missed messages in one conversation
   * returned ONE row, not three.
   */
  it("collapses many missed messages in one conversation to one push", () => {
    const sql = stripSql(read(MIGRATION));
    expect(sql).toMatch(/row_number\(\)\s*over\s*\(partition by u\.conversation_id/);
    expect(sql).toMatch(/where r\.rn = 1/);
    expect(sql).toMatch(/missed > 1 then r\.missed \|\| ' new messages'/);
  });

  /**
   * STAMPED AT DISPATCH, NOT ON DELIVERY — the storm guard. `net.http_post`
   * returns a request id, not a result, so a sweep waiting for send-push to
   * stamp would fire again next tick, and the one after, for as long as the
   * conversation stayed quiet.
   */
  it("stamps the conversation before it posts, never after", () => {
    const sql = stripSql(read(MIGRATION));
    const fn = sql.slice(sql.indexOf("create or replace function public.message_push_sweep"));
    const stamp = fn.indexOf("insert into public.message_push_state");
    const post = fn.indexOf("net.http_post");
    expect(stamp).toBeGreaterThan(0);
    expect(post).toBeGreaterThan(0);
    expect(stamp).toBeLessThan(post);
  });

  /** Making Ting's replies start buzzing people is a product change nobody asked for. */
  it("never wakes for an AI reply", () => {
    const sql = stripSql(read(MIGRATION));
    expect(sql).toMatch(/and m\.is_ai = false/);
  });

  /** A message inside the grace window is the client's to announce. */
  it("gives the client a grace period before stepping in", () => {
    const sql = stripSql(read(MIGRATION));
    expect(sql).toMatch(/k_grace\s+constant integer := 60;/);
    expect(sql).toMatch(/m\.created_at < now\(\) - make_interval\(secs => grace_seconds\)/);
  });

  /** A backlog must not become a storm; the cap is reported so a capped run says so. */
  it("bounds one run and says when it was bounded", () => {
    const sql = stripSql(read(MIGRATION));
    expect(sql).toMatch(/limit max_conversations/);
    expect(sql).toMatch(/'capped', n >= k_max/);
  });

  /**
   * WITHOUT THE SEED the first sweep reads the whole recent history as
   * unannounced and pushes for each conversation at once. Nobody wants a
   * notification about a two-day-old message.
   */
  it("seeds existing conversations as covered", () => {
    const sql = stripSql(read(MIGRATION));
    expect(sql).toMatch(
      /insert into public\.message_push_state[\s\S]*?select c\.id, now\(\), 0 from public\.conversations c/,
    );
  });
});

describe("send-push gained a server caller and lost nothing", () => {
  const src = stripComments(read(SEND_PUSH));

  /** The backstop has no session, because the case it covers is the client that died. */
  it("admits the service role as a caller", () => {
    expect(src).toMatch(/_roleOf\(bearer\) === "service_role"/);
  });

  /**
   * THE SERVER NAMES ITS SENDER AND IT MUST BE REAL. Without the check the
   * recipient set is "every member" — including the person who wrote the
   * message, notified about their own text.
   */
  it("requires a uuid sender_id from the server and refuses anything else", () => {
    expect(src).toMatch(/\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(claimed\)/);
    expect(src).toMatch(/sender_id required/);
  });

  /**
   * THE PERSON'S PATH IS UNTOUCHED, and this is the assertion that matters
   * most: send-push carries every chat notification in the app, and the only
   * safe shape for this change was additive. A session caller still resolves
   * through getUser, still rate-limits, and still proves membership.
   */
  it("still authenticates and rate-limits a real session exactly as before", () => {
    const branch = src.slice(src.indexOf("if (!fromServer) {"), src.indexOf("let body:"));
    expect(branch).toMatch(/userClient\.auth\.getUser\(\)/);
    expect(branch).toMatch(/_rateLimit\(senderId, 60\)/);
    expect(branch).toMatch(/status: 401/);
  });

  /** The membership check is skipped for the server ONLY — a committed row already passed RLS. */
  it("skips membership for the server and keeps it for everyone else", () => {
    expect(src).toMatch(/const \{ data: senderMember \} = fromServer/);
    expect(src).toMatch(/conversation_members[\s\S]{0,200}\.eq\("user_id", senderId\)/);
  });
});
