/**
 * THE RESULT SCREENS, and the four doors that reach them.
 *
 * The owner's reference draws "Your Image", "Your Music" and "Your Voice" —
 * the screen you land on after ONIQ has made something. Until this route
 * existed a finished picture lived only as a thumbnail in the list that made
 * it, and a finished song only as a bare <audio controls> strip; there was
 * nowhere to go to LOOK at the thing.
 *
 * Six properties are worth pinning, because each is one careless edit from
 * being lost and none of them fails loudly:
 *
 *   1. ONE ROUTE, TWO LAYOUTS. Three files would be three places for a share
 *      button to drift. Same argument as the six Create cards living in one
 *      component.
 *   2. IT IS AN AI SURFACE — three of them, in fact, one per kind, all
 *      declared in playCompliance.ts. A result screen survives a reload and a
 *      shared link, so it can be the FIRST place somebody meets generated
 *      media with no memory of a prompt being typed.
 *   3. IT REFETCHES AND SPENDS NOTHING. The `list` action signs URLs and
 *      passes no spend gate. A screen reached by tapping a thumbnail must not
 *      be able to charge the account for being opened.
 *   4. THE TRANSPORT IS A REAL <audio> ELEMENT. Only the chrome is ours.
 *   5. "SAVE" IS NOT A BUTTON. On every platform ONIQ targets it is the same
 *      call as Download, and two buttons implying a distinction that does not
 *      exist is its own kind of lie.
 *   6. THE LINK INTO IT LIVES ONCE. Four screens point here; the route path is
 *      spelled out in one component so a rename cannot leave three behind.
 *
 * It also holds a line about a bug the type system CANNOT catch — see the last
 * block.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clockTime } from "@/components/oniq/OniqAudioPlayer";
import { AI_SURFACES } from "@/config/playCompliance";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const ROUTE_PATH = "src/routes/_authenticated/app.made.$kind.$id.tsx";
const SCREEN = read(ROUTE_PATH);
const PLAYER = read("src/components/oniq/OniqAudioPlayer.tsx");
const ACTIONS = read("src/components/oniq/OniqResultActions.tsx");
const MADE_LINK = read("src/components/oniq/OniqMadeLink.tsx");
const IMAGE = read("src/routes/_authenticated/app.image.tsx");
const MUSIC = read("src/routes/_authenticated/app.music.tsx");
const VOICE = read("src/routes/_authenticated/app.voice.tsx");
const CREATIONS = read("src/routes/_authenticated/app.creations.tsx");

describe("the route exists and serves all three kinds", () => {
  it("is a real route, registered in the generated tree", () => {
    expect(SCREEN).toContain('createFileRoute("/_authenticated/app/made/$kind/$id")');
    // Without this the typed <Link> would not compile — which is the point of
    // routing through one component rather than four hand-written hrefs.
    expect(read("src/routeTree.gen.ts")).toContain("/_authenticated/app/made/$kind/$id");
  });

  it("carries one entry per kind and no more", () => {
    expect(SCREEN).toContain('const KINDS = ["image", "music", "voice"] as const');
    for (const kind of ["image", "music", "voice"]) {
      expect(SCREEN, kind).toMatch(new RegExp(`\\n  ${kind}: \\{`));
    }
  });

  it("says so rather than throwing when the kind is not one of them", () => {
    // A URL is something anyone can type. KIND_META[kind] on an unknown kind
    // would be undefined and the screen would throw to the error boundary.
    expect(SCREEN).toContain("(KINDS as readonly string[]).includes(kind)");
    expect(SCREEN).toContain("That link does not name anything ONIQ makes.");
  });
});

describe("it is declared as a generative surface, three times", () => {
  it.each(["image_ai_output", "music_ai_output", "voice_ai_output"])(
    "%s names the result route in playCompliance",
    (id) => {
      const rows = AI_SURFACES.filter((s) => s.file === ROUTE_PATH);
      expect(rows.map((r) => r.id)).toContain(id);
    },
  );

  it("labels the output and offers the report control", () => {
    expect(SCREEN).toContain("AI_OUTPUT_LABEL");
    expect(SCREEN).toContain("<AiOutputReport");
  });

  it("reports against the ROW, not a made-up id", () => {
    // "an AI picture was wrong" with no idea which one is not a report. The
    // row id is the only thing that makes it actionable.
    expect(SCREEN).toContain("targetId={item.id}");
  });
});

describe("opening it costs nothing", () => {
  it("reads through the free list action, never a generate call", () => {
    expect(SCREEN).toContain('body: { action: "list" }');
    // No prompt, no style, no aspectRatio — the fields that make a call
    // billable. A screen you reach by tapping a thumbnail must not spend.
    expect(SCREEN).not.toMatch(/body:\s*\{\s*prompt/);
    expect(SCREEN).not.toContain("aspectRatio");
  });

  it("refetches rather than being handed the row", () => {
    // An in-memory hand-off survives neither a reload nor a shared link, and
    // the signed URL it would carry may have expired while it was being read.
    expect(SCREEN).toContain("supabase.functions.invoke(meta.fn");
    expect(SCREEN).toContain("alive = false");
  });
});

describe("the transport is a real element with our chrome on it", () => {
  it("mounts an <audio> and listens to it rather than predicting it", () => {
    expect(PLAYER).toContain("<audio");
    for (const ev of ["timeupdate", "durationchange", "play", "pause", "ended"]) {
      expect(PLAYER, ev).toContain(`addEventListener("${ev}"`);
    }
    // Every listener added is removed; a result screen is navigated away from
    // constantly and a leaked listener on a torn-down element is a real leak.
    for (const ev of ["timeupdate", "durationchange", "play", "pause", "ended"]) {
      expect(PLAYER, ev).toContain(`removeEventListener("${ev}"`);
    }
  });

  it("keeps the keyboard and screen readers, by using real controls", () => {
    // A div with a click handler is not a button and a div with a drag
    // handler is not a slider. These come free from the right elements.
    expect(PLAYER).toContain('type="range"');
    expect(PLAYER).toMatch(/aria-label=\{`Back \$\{SKIP\} seconds`\}/);
    expect(PLAYER).toContain('aria-label={playing ? "Pause" : "Play"}');
    expect(PLAYER).toContain('aria-live="polite"');
  });

  it("does not pull the whole file down on a screen nobody presses play on", () => {
    expect(PLAYER).toContain('preload="metadata"');
  });

  it.each([
    [0, "0:00"],
    [7, "0:07"],
    [59, "0:59"],
    [60, "1:00"],
    [61.9, "1:01"],
    [605, "10:05"],
    [3600, "60:00"],
  ])("clockTime(%s) is %s", (secs, want) => {
    expect(clockTime(secs)).toBe(want);
  });

  it("clockTime survives what a not-yet-loaded element actually reports", () => {
    // duration is NaN before metadata arrives and Infinity on a live stream.
    // Either one rendered raw would put "NaN:aN" on the screen.
    expect(clockTime(Number.NaN)).toBe("0:00");
    expect(clockTime(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(clockTime(-5)).toBe("0:00");
  });
});

describe("share and download, and the button that is deliberately absent", () => {
  it("ships exactly two actions", () => {
    expect(ACTIONS).toContain('["share", "Share", Share2]');
    expect(ACTIONS).toContain('["download", "Download", Download]');
    // "Save" is the same call as Download on every platform ONIQ targets.
    expect(ACTIONS).not.toMatch(/"save"|>Save</);
  });

  it("says the thing a Save button would have implied, as a fact", () => {
    expect(SCREEN).toContain("Saved to your Creations");
  });

  it("fetches the bytes rather than handing over a URL that expires", () => {
    expect(ACTIONS).toContain("await fetch(url)");
    expect(ACTIONS).toContain("await res.blob()");
  });

  it("never reports a dismissed share sheet as a failure", () => {
    // The person chose to stop. An error toast for that is the app arguing.
    expect(ACTIONS).toContain("isShareCancelled(e)");
  });

  it("carries the reference's contextual fourth tile — where it goes somewhere", () => {
    // The reference draws Edit on a picture and "Use in Video" on a song.
    // Only Edit has a destination: the Story worker writes its own narration
    // and takes no user-supplied track, so "Use in Video" would be a button
    // that does nothing.
    expect(SCREEN).toContain('data-testid="made-edit"');
    expect(SCREEN).toMatch(/kind === "image" \? \(\s*<Link/);
    // Not RENDERED — the comment above the tile names it as the one left out,
    // so match a JSX text position rather than the word anywhere in the file.
    expect(SCREEN).not.toMatch(/>\s*Use in Video/);
    expect((SCREEN.match(/className=\{RESULT_TILE\}/g) ?? []).length).toBe(1);
  });

  it("uses ONE tile object, so the fourth cannot drift from the first three", () => {
    expect(ACTIONS).toContain("export const RESULT_TILE");
    expect(SCREEN).toContain("className={RESULT_TILE}");
  });

  it("keeps the tiles bordered rather than filled, which is a measurement", () => {
    // White on the `create` gradient is 1.81:1 at its cyan end (#22d3ee),
    // measured in a browser 2026-09-04 — below the 4.5:1 floor. The world's
    // colour goes on the ICON; the label stays on the card.
    expect(ACTIONS).toContain("border border-border-strong");
    expect(ACTIONS).not.toMatch(/RESULT_TILE[\s\S]{0,240}bg-world/);
    expect(ACTIONS).toContain("1.81:1");
  });
});

describe("the four doors into it", () => {
  it("spells the route out once, in one component", () => {
    expect(MADE_LINK).toContain('to="/app/made/$kind/$id"');
    for (const [name, src] of [
      ["image", IMAGE],
      ["music", MUSIC],
      ["voice", VOICE],
      ["creations", CREATIONS],
    ] as const) {
      expect(src, name).toContain("OniqMadeLink");
      expect(src, name).not.toContain("/app/made/");
    }
  });

  it("points each list at the kind it actually holds", () => {
    expect(IMAGE).toContain('<OniqMadeLink kind="image" id={p.id}');
    expect(MUSIC).toContain('<OniqMadeLink kind="music" id={s.id}');
    expect(VOICE).toContain('<OniqMadeLink kind="voice" id={c.id}');
    expect(CREATIONS).toContain('<OniqMadeLink kind="image" id={item.id}');
    expect(CREATIONS).toContain('kind={item.kind === "song" ? "music" : "voice"}');
  });

  it("is a footer link and not a card-wide one", () => {
    // Those cards contain an <audio controls>. Wrapping one in a link makes
    // the tap that should press play navigate away instead, and nests an
    // interactive control inside another, which is invalid.
    // The link's own children are a label and nothing else — no card, no
    // media, no controls of any kind inside it.
    // Read the COMPONENT BODY, not the file — the header comment names the
    // very elements this asserts are absent from the markup.
    const body = MADE_LINK.slice(MADE_LINK.indexOf("export function OniqMadeLink"));
    expect(body).toMatch(/>\s*\{label\} →\s*<\/Link>/);
    expect(body).not.toContain("<OniqCard");
    expect(body).not.toContain("<audio");
    for (const [name, src] of [
      ["music", MUSIC],
      ["voice", VOICE],
    ] as const) {
      // The card keeps its own preview control, sitting beside the link
      // rather than inside it.
      expect(src, name).toContain("<audio controls");
    }
  });
});

describe("Create — Image has the three tabs the reference draws", () => {
  it("draws Generate, Edit and Transform", () => {
    expect(IMAGE).toContain('{ id: "generate" as const, label: "Generate" }');
    expect(IMAGE).toContain('{ id: "edit" as const, label: "Edit" }');
    expect(IMAGE).toContain('{ id: "transform" as const, label: "Transform" }');
  });

  it("gives each tab a job no other tab has", () => {
    // Three tabs posting the same request under three names would be the
    // fault that kept "Save" off the result screen: a control implying a
    // distinction that does not exist.
    //   Generate  — a sentence, no attachment.
    //   Edit      — picture + what to change.
    //   Transform — picture + a style, which only this tab insists on.
    expect(IMAGE).toContain('const needsPicture = tab !== "generate"');
    expect(IMAGE).toContain('transforming && style === "auto"');
  });

  it("keeps the tab in the URL rather than in a second copy of the truth", () => {
    // ?mode=edit already existed as the hero chip's target. Reading the tab
    // from it means a reload and a back gesture both land where you were.
    expect(IMAGE).toContain('const tab: Tab = mode ?? "generate"');
    expect(IMAGE).toMatch(/replace: true/);
    // And the route has to ACCEPT all three, or TanStack drops the param and
    // the tab is a button that does nothing.
    expect(IMAGE).toMatch(/s\.mode === "edit" \|\| s\.mode === "transform"/);
  });

  it("offers the attachment only where there is something to attach it to", () => {
    // On Generate a picture would silently turn the call into an edit while
    // the button still said "Make a picture".
    expect(IMAGE).toMatch(/\{needsPicture \? \(\s*<OniqAttachImage/);
    expect(IMAGE).toContain("if (!needsPicture) setReference(null)");
  });

  it("will not fire a tab that is missing a part", () => {
    // Without the picture, Edit and Transform would quietly generate a NEW
    // image from the instruction alone — a billable call nobody asked for.
    expect(IMAGE).toContain("disabled={missing !== null || busy}");
    expect(IMAGE).toContain("if (missing || busy) return;");
  });

  it("says which part is missing rather than greying out in silence", () => {
    expect(IMAGE).toContain('data-testid="image-needs"');
    expect(IMAGE).toContain("Add a picture above to get started.");
    expect(IMAGE).toContain("Pick a style — that is what Transform changes.");
  });

  it("puts Transform's opener IN the box rather than sending it from behind", () => {
    // A hidden, client-authored sentence on a paid model is a second prompt
    // slot nobody can see or clear.
    expect(IMAGE).toContain("const TRANSFORM_OPENER");
    expect(IMAGE).toContain("setPrompt((cur) => (cur.trim() ? cur : TRANSFORM_OPENER))");
  });

  it("does not send an aspect ratio it has not measured on this path", () => {
    // aspectRatio was measured on a TEXT-ONLY call. Whether it survives an
    // inlineData part going first is unmeasured, and an accepted-and-ignored
    // parameter is indistinguishable from a working one by status code.
    expect(IMAGE).toContain("aspectRatio: needsPicture ? null : ratio");
    expect(IMAGE).toMatch(/NOT measured/);
  });

  it("draws the tab row the way the reference does, and Voice the same way", () => {
    // The reference's active tab is a pale wash carrying the world's own ink,
    // not white on the gradient — which is also the legible one at 1.7:1.
    // Both Create tab rows go through OniqChip so there is one pill, not two.
    expect(IMAGE).toMatch(/role="tab"\s*\n\s*tone="soft"/);
    expect(VOICE).toMatch(/role="tab"[\s\S]{0,400}tone="soft"/);
    expect(IMAGE).not.toContain('className="mx-5 mt-4 flex gap-1 rounded-full oniq-glass');
  });

  it("offers starters that suit the sentence each tab takes", () => {
    expect(IMAGE).toContain("IDEAS[tab]");
    expect(IMAGE).toContain('"make the wall green"');
    expect(IMAGE).toContain('"keep the scene and composition"');
  });
});

/**
 * A BUG THE TYPE SYSTEM CANNOT CATCH.
 *
 * TypeScript deliberately skips excess-property checking for JSX attributes
 * whose names are not valid identifiers — every `data-*` among them. So
 * `<OniqCard data-testid="x">` type-checks perfectly and the attribute is
 * DROPPED, because OniqCard forwards `testId` and spreads nothing.
 *
 * Nine of these were live in the app on 2026-09-04 — on Image, Music, Voice,
 * Creations and Insights — every one a test hook that reached no DOM node.
 * They cost nothing until somebody writes a test against one and cannot work
 * out why it never matches.
 */
describe("no Oniq component is handed a data-* attribute it will drop", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const full = join(dir, e);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith(".tsx") ? [full] : [];
    });

  it("has none anywhere in src", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      const src = readFileSync(file, "utf8");
      // Opening tags of <OniqSomething ...>, including multi-line ones —
      // reading ONLY that tag's own attribute region.
      //
      // `[^<>]*` is doing real work: an Oniq component can be handed JSX in a
      // prop (`<OniqEmpty action={<button data-testid="x" />} />`), and a
      // pattern that ran to the first `>` would swallow the nested element and
      // blame the wrapper for an attribute that is not its. That false
      // positive fired the day this guard was written, on app.weather.tsx.
      for (const m of src.matchAll(/<(Oniq[A-Za-z]+)\b([^<>]*)[<>]/gs)) {
        if (!/\bdata-[a-z-]+=/.test(m[2])) continue;
        offenders.push(
          `${file.slice(ROOT.length + 1)}:${src.slice(0, m.index).split("\n").length} <${m[1]}>`,
        );
      }
    }
    expect(
      offenders,
      `these data-* attributes are silently dropped — use testId:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
