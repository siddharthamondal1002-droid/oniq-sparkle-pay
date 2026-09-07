/**
 * THE MESSAGE CHANNEL, PINNED IN THE THREE PLACES THAT MUST AGREE.
 *
 * A chat push takes two different routes depending on where the app is, and
 * they render on the same channel from different code:
 *
 *   app closed / backgrounded -> the FCM SDK posts the `notification` block
 *                                itself, on the channel named in the MANIFEST
 *   app in the foreground     -> OniqMessagingService builds it, on its own
 *                                MSG_CHANNEL_ID constant
 *
 * and MainActivity creates that channel at startup so the first route has one
 * to land on. Three names for one thing. Rename any one alone and nothing
 * fails to compile, no test that only reads Java fails, and the app simply
 * stops announcing messages on the route you did not touch — in production,
 * only for people whose app is shut.
 *
 * WHAT WAS ACTUALLY WRONG, 2026-09-06. `oniq_messages` was created at
 * IMPORTANCE_DEFAULT while `oniq_calls` is IMPORTANCE_HIGH. DEFAULT puts a
 * message in the shade and never pops it up; HIGH is what produces the
 * heads-up banner. So a call peeked and a message did not, which to anyone not
 * pulling the shade down is indistinguishable from no notification at all.
 *
 * AND THE ONE-LINE FIX WOULD HAVE DONE NOTHING. Android locks a channel's
 * importance when it is created; the app can never raise it, and deleting the
 * channel does not reset it because Android remembers a deleted channel's
 * settings and restores them for the same id. So changing DEFAULT to HIGH in
 * place would have compiled, shipped, and left every existing install exactly
 * as quiet. A NEW ID is the only way to get a new importance — which is why
 * the id being different from the legacy one is asserted here rather than
 * left as a thing someone has to remember.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Strip Java/XML comments before matching. Every comment above quotes the
 * constants it explains, so a grep strict enough to be useful hits the prose
 * — the fourth time that has happened in this repo, and the reason this is a
 * helper rather than a footnote.
 */
const codeOnly = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const MANIFEST = codeOnly(read("android/app/src/main/AndroidManifest.xml"));
const ACTIVITY = codeOnly(read("android/app/src/main/java/com/oniqhub/app/MainActivity.java"));
const SERVICE = codeOnly(
  read("android/app/src/main/java/com/oniqhub/app/OniqMessagingService.java"),
);

/** The channel id the FCM SDK uses for the app-is-closed route. */
function manifestChannelId(): string {
  const m = MANIFEST.match(/default_notification_channel_id"\s*\n?\s*android:value="([^"]+)"/);
  return m?.[1] ?? "";
}

const javaConst = (src: string, name: string): string =>
  src.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`))?.[1] ?? "";

describe("the message channel is one id in three files", () => {
  it("manifest, MainActivity and the service name the same channel", () => {
    const fromManifest = manifestChannelId();
    expect(fromManifest, "the manifest lost its channel meta-data").not.toBe("");
    expect(javaConst(ACTIVITY, "MSG_CHANNEL_ID")).toBe(fromManifest);
    expect(javaConst(SERVICE, "MSG_CHANNEL_ID")).toBe(fromManifest);
  });

  it("is NOT the legacy id, because a reused id keeps its old importance", () => {
    // The whole point of the change. Android restores a deleted channel's
    // settings for the same id, so shipping "oniq_messages" again would
    // silently reinstate IMPORTANCE_DEFAULT on every phone that ever had it.
    expect(manifestChannelId()).not.toBe("oniq_messages");
    expect(javaConst(ACTIVITY, "LEGACY_MSG_CHANNEL_ID")).toBe("oniq_messages");
  });

  it("retires the legacy channel instead of leaving a dead row in settings", () => {
    expect(ACTIVITY).toContain("deleteNotificationChannel(LEGACY_MSG_CHANNEL_ID)");
  });
});

describe("a message announces itself as loudly as a call", () => {
  it("MainActivity creates it at IMPORTANCE_HIGH, not DEFAULT", () => {
    const create = ACTIVITY.slice(ACTIVITY.indexOf("ensureNotificationChannels"));
    const msgLine = create.slice(create.indexOf('MSG_CHANNEL_ID, "Messages"'));
    expect(msgLine.slice(0, 200)).toContain("IMPORTANCE_HIGH");
    expect(msgLine.slice(0, 200), "the message channel went back to DEFAULT").not.toContain(
      "IMPORTANCE_DEFAULT",
    );
  });

  it("the service's lazy creation agrees, so whichever runs first is the same", () => {
    // If these two disagreed, the importance would be decided by a race:
    // whether a push arrived before the activity ever started.
    const lazy = SERVICE.slice(SERVICE.indexOf('MSG_CHANNEL_ID, "Messages"'));
    expect(lazy.slice(0, 160)).toContain("IMPORTANCE_HIGH");
  });

  it("sets PRIORITY_HIGH too, because minSdk 24 predates channels", () => {
    // API 24 and 25 have no channels at all — importance is ignored there and
    // only the builder's priority produces a heads-up. Both the per-chat
    // notification and the group summary need it: the summary is what a
    // grouped pre-O notification actually displays.
    const builders = SERVICE.split("new NotificationCompat.Builder(ctx, MSG_CHANNEL_ID)").slice(1);
    expect(builders.length, "the message notification builders moved").toBe(2);
    for (const b of builders) expect(b.slice(0, 900)).toContain("PRIORITY_HIGH");
  });
});
