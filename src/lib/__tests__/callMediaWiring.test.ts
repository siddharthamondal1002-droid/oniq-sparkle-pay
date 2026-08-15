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
