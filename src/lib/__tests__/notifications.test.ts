/**
 * Notification behaviour that lives in Java and is triggered from TypeScript.
 *
 * Source-shape checks, and weak on purpose — they catch a half-revert of a
 * rule whose two ends are in different languages. Whether a notification LOOKS
 * right has to be seen on a device; nothing here substitutes for that.
 *
 * What is worth pinning is the set of decisions that are invisible in review:
 * a category nobody set, a lock-screen visibility left to an undocumented
 * default, an id derived twice, and a tray entry nothing ever cleared.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Comments stripped — a comment naming a call is not a call. */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}
const javaCode = codeOnly;

const FCM = javaCode(read("android/app/src/main/java/com/oniqhub/app/OniqMessagingService.java"));
const TRAY = read("android/app/src/main/java/com/oniqhub/app/NotificationTrayPlugin.java");
const MAIN = javaCode(read("android/app/src/main/java/com/oniqhub/app/MainActivity.java"));

describe("every notification declares what it is", () => {
  it("messages carry CATEGORY_MESSAGE", () => {
    // Android uses the category for ranking and filtering. The call path has
    // always set one; the message path never did.
    expect(FCM).toMatch(/setCategory\(NotificationCompat\.CATEGORY_MESSAGE\)/);
  });

  it("calls carry CATEGORY_CALL", () => {
    expect(FCM).toMatch(/setCategory\(NotificationCompat\.CATEGORY_CALL\)/);
  });

  it("message content is PRIVATE on a lock screen, and says so", () => {
    // This matches the effective default rather than changing behaviour. The
    // point is that it is now written down: a private message must not put
    // its text on a locked screen, and a default nobody has stated is how
    // that changes by accident.
    expect(FCM).toMatch(/setVisibility\(NotificationCompat\.VISIBILITY_PRIVATE\)/);
  });

  it("a ringing call stays PUBLIC — you must see who is calling", () => {
    expect(FCM).toMatch(/setVisibility\(NotificationCompat\.VISIBILITY_PUBLIC\)/);
  });
});

describe("conversations use the messaging template", () => {
  it("builds a MessagingStyle with the sender as a Person", () => {
    expect(FCM).toMatch(/MessagingStyle/);
    expect(FCM).toMatch(/Person\.Builder\(\)/);
  });

  it("reads history back off the live notification rather than holding it", () => {
    // An FCM service is created and destroyed per message, so anything kept
    // in a field is gone by the next push. Without this, message four erases
    // messages one to three and the user never learns what they missed.
    expect(FCM).toMatch(/extractMessagingStyleFromNotification/);
  });

  it("groups conversations under a summary", () => {
    expect(FCM).toMatch(/setGroup\(MSG_GROUP\)/);
    expect(FCM).toMatch(/setGroupSummary\(true\)/);
  });
});

describe("stale notifications are cleared", () => {
  it("the tray plugin is registered", () => {
    expect(MAIN).toMatch(/registerPlugin\(NotificationTrayPlugin\.class\)/);
  });

  it("opening a conversation clears its notification", () => {
    const thread = read("src/routes/_authenticated/app.chat.$conversationId.tsx");
    expect(thread).toMatch(/clearConversationNotification\(conversationId\)/);
  });

  it("the notification id is derived in exactly ONE place", () => {
    // Cancelling by a re-derived hash that disagrees by one bit cancels
    // somebody else's conversation. The plugin calls the service's helper.
    expect(FCM).toMatch(/static int conversationNotificationId\(String/);
    expect(TRAY).toMatch(/OniqMessagingService\.conversationNotificationId\(/);
    // And the TypeScript side must not grow its own copy of the arithmetic.
    // codeOnly, because that file's header names String.hashCode in order to
    // explain why it does NOT reimplement it — a comment about a rule is not
    // a breach of it, and this exact false positive has bitten the repo
    // several times now.
    const tray = codeOnly(read("src/lib/notificationTray.ts"));
    expect(tray, "the hash was mirrored into TypeScript").not.toMatch(
      /0x20000000|hashCode|charCodeAt/,
    );
  });
});

describe("nothing notifies for a reason Play prohibits", () => {
  it("send-push accepts only message, call and call_cancel", () => {
    // The guidance's do-not list is mostly about categories of nag —
    // promotion, re-engagement, ratings, greetings. The narrow kind check in
    // the edge function is what makes those unrepresentable rather than
    // merely unwritten: there is no payload shape that expresses them.
    const fn = read("supabase/functions/send-push/index.ts");
    expect(fn).toMatch(/kind !== "message" && kind !== "call" && kind !== "call_cancel"/);
  });

  it("no client anywhere sends a push of another kind", () => {
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        if (e === "node_modules" || e.startsWith(".")) continue;
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(p) && !p.includes("__tests__")) {
          const src = readFileSync(p, "utf8");
          if (!/invoke\(\s*["'`]send-push["'`]/.test(src)) continue;
          for (const m of src.matchAll(/kind:\s*["'`]([a-z_]+)["'`]/g)) {
            if (!["message", "call", "call_cancel"].includes(m[1])) {
              callers.push(`${p.slice(ROOT.length + 1)}: ${m[1]}`);
            }
          }
        }
      }
    };
    walk(join(ROOT, "src"));
    expect(callers, "a push kind outside the allowed three").toEqual([]);
  });
});
