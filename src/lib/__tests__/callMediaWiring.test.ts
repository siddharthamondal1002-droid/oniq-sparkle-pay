/**
 * The three call-media faults reported 2026-08-14, pinned so they cannot
 * quietly come back.
 *
 * All three share a failure signature: NOTHING THROWS. A flip that returns
 * the same camera, a filter drawing from a video that never decoded, and a
 * draw loop running three times faster than the frames it feeds all look like
 * healthy code and a healthy call. There is no error to assert on at runtime,
 * so the guards are structural — the same reason the story-plot wiring pins
 * exist.
 *
 * Researched against the documented WebView behaviour rather than guessed:
 * facingMode is unreliable inside an Android WebView, and `ideal` does not
 * fail when it cannot satisfy a request — it returns the closest match, which
 * is the camera already open.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../../..", "src/components/chat/CallOverlay.tsx"),
  "utf8",
);

describe("the back camera", () => {
  it("picks a device by id rather than trusting facingMode", () => {
    expect(SRC).toContain("cameraDeviceFor");
    expect(SRC).toContain("enumerateDevices()");
    expect(SRC, "the flip must ask for a specific camera").toContain(
      "deviceId: { exact: targetId }",
    );
  });

  it("verifies the camera actually changed before committing", () => {
    // The silent no-op: `ideal` hands back the running camera, the swap
    // succeeds, and the button reports success having changed nothing.
    expect(SRC).toContain("const moved = (t: MediaStreamTrack)");
    expect(SRC).toContain("s2.deviceId !== oldId");
  });

  it("releases the running camera and retries when the first ask fails", () => {
    // Many Android devices hold exactly one camera open at a time, so the
    // non-destructive attempt can never succeed there. This is the step the
    // original code never took.
    expect(SRC).toContain("released = true");
    expect(
      /oldTrack\.stop\(\);\s*\n\s*released = true;/.test(SRC),
      "the old track is no longer released before the retry",
    ).toBe(true);
  });

  it("restores video if the retry left the call blind", () => {
    // Stopping the only working camera and then failing must not end with a
    // caller who can no longer be seen.
    expect(SRC).toContain("facingMode: { ideal: facingRef.current }");
  });
});

describe("the in-call filter", () => {
  it("keeps its source video in the document so it actually decodes", () => {
    // A detached <video> can sit at readyState 0 forever in an Android
    // WebView; drawImage then paints nothing and the far side sees black.
    expect(SRC).toContain("document.body.appendChild(video)");
    expect(SRC, "display:none suspends rendering — the bug, restated").not.toMatch(
      /appendChild\(video\)[\s\S]{0,200}display:none/,
    );
  });

  it("reaches peers that connect after the filter is chosen", () => {
    // addTrack used to hand every new peer the raw camera, so the second
    // person into a group call saw an unfiltered stream while the sender
    // watched a filtered self-view and believed it worked.
    expect(SRC).toContain('t.kind === "video" && fxRef.current ? fxRef.current.track : t');
  });

  /**
   * NOTHING MAY PUT THE RAW CAMERA BACK IN THE SELF-VIEW WHILE A FILTER IS ON.
   *
   * The self-view sync effect runs on every `status` change and used to assign
   * localStreamRef.current unconditionally. Pick a filter while the call is
   * still `connecting`, and the `connecting` -> `connected` transition fired
   * it, saw the canvas stream was "wrong", and restored the bare camera. The
   * peer went on receiving the filtered track — the senders were already
   * swapped — so the ONLY person who saw the filter die was the one who chose
   * it. Reported 2026-08-15 as the filter not being active during calls.
   *
   * Choosing a filter after `connected` looked fine, because no further status
   * change arrived to undo it. That intermittency is why this is pinned by the
   * rule rather than by the symptom.
   */
  it("never lets a status change overwrite the filtered self-view", () => {
    const effect = SRC.slice(
      SRC.indexOf("// Sync local video srcObject"),
      SRC.indexOf("// Native audio routing"),
    );
    expect(effect.length, "the self-view sync effect moved or was renamed").toBeGreaterThan(0);
    expect(
      effect,
      "the self-view is assigned the raw camera again — a filter chosen before connect will be undone",
    ).toContain("fxRef.current?.stream ?? localStreamRef.current");
    expect(
      /const stream = localStreamRef\.current;/.test(effect),
      "back to the unconditional raw-camera assignment",
    ).toBe(false);
  });

  it("guards every other self-view assignment the same way", () => {
    // Two more places set srcObject while a filter can be running: the
    // camera-recovery branch and the flip path. Both must defer to fx.
    expect(SRC).toContain("if (localVideoRef.current && !fxRef.current) localVideoRef.current");
    expect(SRC).toContain("} else if (localVideoRef.current) {");
  });

  /**
   * `ctx.filter` REFUSES A VALUE IT DOES NOT SUPPORT, SILENTLY.
   *
   * No throw, no warning: the assignment does nothing and every drawImage
   * after it paints the frame untouched. The pipeline stays healthy, frames
   * keep flowing, the peer keeps receiving video — and the picture is simply
   * not filtered. There is no error anywhere to notice, which is why this is
   * asked once at runtime rather than assumed from a version.
   */
  it("asks whether ctx.filter works instead of assuming it", () => {
    expect(SRC).toContain("function canvasFilterSupported()");
    // Set-and-read-back is the only honest probe.
    expect(SRC).toContain('ctx.filter = "grayscale(1)"');
    expect(SRC).toContain('ctx.filter !== "none"');
    expect(
      /navigator\.userAgent[\s\S]{0,80}filter/i.test(SRC),
      "sniffing the UA models the engine instead of asking it",
    ).toBe(false);
  });

  it("gives every ctx.filter-based filter a fallback", () => {
    // The invariant is about DEPENDENCE, not about every entry in the list: a
    // filter that leans on ctx.filter needs a path for engines without it.
    // The face-tracked ones and the gallery photo lean on neither — they are
    // painted onto the frame — so demanding a fallback from them would be
    // demanding a fallback for a problem they do not have.
    const block = SRC.slice(SRC.indexOf("const CALL_FILTERS"), SRC.indexOf("const PHOTO_MIX"));
    expect(block, "the filter list moved or changed shape").toContain('id: "alien"');
    // Split into per-entry chunks on the id line, then check each chunk.
    const entries = block.split(/\{\s*\n?\s*id: "/).slice(1);
    expect(entries.length).toBeGreaterThan(5);
    for (const entry of entries) {
      const id = entry.slice(0, entry.indexOf('"'));
      if (!entry.includes("css:")) continue;
      expect(entry, `${id} uses ctx.filter with no fallback`).toContain("fallback: [");
    }
  });

  it("does not make the face filters depend on ctx.filter at all", () => {
    // They draw shapes onto the finished frame, so they work identically on
    // an engine that has no filter support — which is the point of carrying
    // no css chain.
    //
    // This used to check three ids spelled out in CALL_FILTERS. The rack grew
    // to fifteen and moved to FACE_LENSES in faceFx, which is a STRONGER
    // guarantee than the one asserted here: an entry in that list is
    // { id, label } and has nowhere to put a css chain even by accident. So
    // the check is now that the lenses still arrive by that route.
    const block = SRC.slice(SRC.indexOf("const CALL_FILTERS"), SRC.indexOf("const PHOTO_MIX"));
    expect(block, "face lenses no longer come from the typed lens list").toContain(
      "...FACE_LENSES",
    );
    const lensList = readFileSync(join(process.cwd(), "src/lib/faceFx.ts"), "utf8");
    const decl = lensList.slice(
      lensList.indexOf("export const FACE_LENSES"),
      lensList.indexOf("export function isFaceFilter"),
    );
    expect(decl, "the lens list gained a css chain").not.toContain("css:");
    expect(decl).toContain("readonly { id: string; label: string }[]");
  });

  it("resets the blend mode every frame", () => {
    // The fallback leaves a composite mode on the context. Carried into the
    // next frame it blends the new frame with the old one — a smearing,
    // ghosting picture that reads as a broken camera, not a filter.
    const draw = SRC.slice(SRC.indexOf("const draw = ()"), SRC.indexOf("const kick ="));
    expect(draw).toContain('ctx.globalCompositeOperation = "source-over"');
    expect(
      draw.indexOf('ctx.globalCompositeOperation = "source-over"'),
      "the reset must come before the frame is drawn, not only after",
    ).toBeLessThan(draw.indexOf("ctx.drawImage"));
  });

  /**
   * THE CHIPS MUST NOT BE A FLOATING ROW AT A GUESSED HEIGHT.
   *
   * They were absolutely positioned at `bottom-9.5rem` with the same z-30 as
   * the control tray. Two positioned siblings at equal z-index paint in DOM
   * order and the tray is second, so the instant the tray grew past 152px it
   * covered them outright. It grows for entirely ordinary reasons: the button
   * row is `flex-wrap` and seven controls wrap to two rows on a narrow screen,
   * and gesture-navigation safe-area padding adds more on top.
   *
   * Which is why this looked like a caller/callee bug and was not one. Same
   * build, two phones: the wider screen showed the chips, the narrower one
   * swallowed them, and the person on the narrow phone reported a Filter
   * button that opened nothing.
   *
   * Nothing here can be caught by a unit test at runtime — there is no layout
   * engine in this suite — so the STRUCTURE is pinned instead: the chips live
   * inside the tray, where there is no stacking question left to lose.
   */
  it("keeps the filter chips inside the control tray", () => {
    const trayAt = SRC.indexOf("WhatsApp-style control tray");
    const chipsAt = SRC.indexOf("CALL_FILTERS.map(");
    expect(trayAt, "the tray comment moved").toBeGreaterThan(-1);
    expect(chipsAt, "the chip row moved").toBeGreaterThan(-1);
    expect(
      chipsAt,
      "the chips render before the tray again — a taller tray will paint straight over them",
    ).toBeGreaterThan(trayAt);
  });

  it("no longer positions the chips at a hardcoded height", () => {
    expect(
      /bottom-\[[\d.]+rem\][^\n]*z-30/.test(SRC),
      "a guessed offset is back; it is only ever right for one tray height on one phone",
    ).toBe(false);
    expect(SRC).not.toContain("bottom-[9.5rem]");
  });

  it("does not re-gate the chips on trayHidden", () => {
    // Inside the tray they ride its hide/show transform. A separate
    // `!trayHidden` test would be a second source of truth for one thing.
    const chipBlock = SRC.slice(SRC.indexOf("FILTER CHIPS LIVE INSIDE THE TRAY"));
    const gate = chipBlock.slice(0, chipBlock.indexOf("CALL_FILTERS.map("));
    expect(gate).toContain('filterOpen && status !== "incoming"');
    expect(gate).not.toContain("!trayHidden");
  });

  it("tears the pipeline down completely", () => {
    expect(SRC).toContain("v.remove()");
    // fxRef must be cleared BEFORE cancelling, or an in-flight callback can
    // resurrect a torn-down pipeline.
    const teardown = SRC.slice(SRC.indexOf("const teardownFx"));
    expect(teardown.indexOf("fxRef.current = null")).toBeLessThan(
      teardown.indexOf("fx.track.stop()"),
    );
  });
});

describe("the draw loop", () => {
  it("draws once per camera frame, not once per screen refresh", () => {
    expect(SRC).toContain("requestVideoFrameCallback");
    expect(SRC, "a timer at the capture rate is the fallback").toContain(
      "window.setTimeout(draw, 1000 / FX_FPS)",
    );
    expect(
      /cur\.raf = requestAnimationFrame\(draw\)/.test(SRC),
      "the rAF draw loop is back — it redraws 3-6x per captured frame",
    ).toBe(false);
  });

  it("captures at the same rate the camera produces", () => {
    expect(SRC).toContain("const FX_FPS = 20");
    expect(SRC).toContain("canvas.captureStream(FX_FPS)");
    // The camera is constrained to the same number; a mismatch is exactly the
    // waste this fixes.
    expect(SRC).toContain("frameRate: { ideal: 20, max: 24 }");
  });

  it("does not ask the compositor to blend an opaque camera frame", () => {
    expect(SRC).toContain('getContext("2d", { alpha: false })');
  });

  /**
   * rVFC is not a timer, and that is the whole danger of it.
   *
   * It calls back when the next frame is PRESENTED. If none ever is — the
   * WebView backgrounds the page and pauses the element, the camera stalls,
   * the track is swapped — the callback never fires and the loop is gone for
   * good, where rAF would have kept repainting. captureStream only samples a
   * canvas that changes, so the far side freezes with it. Taking the
   * efficiency without the recovery turns a stutter into a dead filter.
   */
  it("restarts a loop that stopped being called back", () => {
    expect(SRC).toContain("const FX_STALL_MS");
    expect(SRC, "no watchdog — one stall would freeze the filter forever").toContain(
      "Date.now() - cur.lastDrawAt > FX_STALL_MS",
    );
    expect(SRC).toContain("cur.lastDrawAt = Date.now()");
    // The restart must cancel what is pending first, or two loops run at once.
    const kick = SRC.slice(SRC.indexOf("const kick ="));
    expect(kick.indexOf("cancelVideoFrameCallback")).toBeLessThan(kick.indexOf("draw()"));
    // A paused element presents no frames, so nothing self-restarts without
    // this: it is the half that actually revives the pipeline.
    expect(kick).toContain("if (cur.video.paused)");
  });

  it("stops the watchdog when the pipeline is torn down", () => {
    expect(SRC).toContain("clearInterval(fx.watchdog)");
  });
});

/**
 * THE OFFER IS THE ONE MESSAGE THAT COULD NOT BE LOST, AND IT WAS.
 *
 * Diagnosed 2026-08-16 from two logged failures with the same signature:
 * role=callee, iceConnectionState "new" after the full 20s deadline, one peer
 * in the pool. ICE "new" means the connection never began — not that it tried
 * and failed. For that pair the offerer is fixed by uuid comparison
 * (74caf65b < d3b58345), so the callee was always the one waiting, and glare
 * is ruled out: it never offers in that direction.
 *
 * Signalling rides Supabase Realtime broadcast, which is fire-and-forget.
 * `hello` was already re-broadcast on a timer. The offer was sent once. One
 * lost message and the call is dead until the watchdog.
 */
describe("the offer survives a lost broadcast", () => {
  it("re-sends until an answer comes back", () => {
    expect(SRC).toContain("const sendOfferNow = (");
    expect(SRC, "the offer is still sent bare, with no retry").not.toMatch(
      /sendSig\("offer", peerId, \{ sdp: offer \}\)/,
    );
    expect(SRC).toContain("entry.offerRetryTimer = window.setTimeout(");
  });

  it("stops the moment a remote description exists", () => {
    // Re-sending after the answer landed would renegotiate a working call.
    const fn = SRC.slice(
      SRC.indexOf("const sendOfferNow = ("),
      SRC.indexOf("const teardownPeer = ("),
    );
    expect(fn).toContain("if (cur.pc.remoteDescription || cur.reachedConnected) return;");
  });

  it("gives up before the connect deadline rather than racing it", () => {
    // Four tries at 2.5s is ~10s, well inside the 20s watchdog, so a
    // recovered call still beats the timeout instead of arriving after the
    // user has already been told it failed.
    const fn = SRC.slice(
      SRC.indexOf("const sendOfferNow = ("),
      SRC.indexOf("const teardownPeer = ("),
    );
    expect(fn).toContain("if (entry.offersSent >= 4) return;");
    expect(fn).toContain("}, 2500);");
  });

  it("is cancelled when the peer is torn down", () => {
    // A timer outliving its peer would resend an offer into a dead call.
    const fn = SRC.slice(SRC.indexOf("const teardownPeer = ("));
    expect(fn.slice(0, 900)).toContain("clearTimeout(entry.offerRetryTimer)");
  });

  it("records enough at the timeout to tell the two silences apart", () => {
    // "No offer was ever made" and "the answer never came back" both present
    // as ICE new. Without these fields the report is a dead end — which is
    // what the first two occurrences were.
    const block = SRC.slice(SRC.indexOf('"call-connect-timeout"'));
    for (const field of ["sig:", "haveLocal:", "haveRemote:", "amOfferer:", "offersSent:"]) {
      expect(block.slice(0, 1400), `${field} missing from the report`).toContain(field);
    }
  });
});
