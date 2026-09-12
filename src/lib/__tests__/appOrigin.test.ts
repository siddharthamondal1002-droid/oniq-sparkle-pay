/**
 * THE HOST SWITCH, PINNED.
 *
 * Owner directive 2026-09-12: "Use www.oniqhub.com", after the apex stopped
 * serving and the Capacitor shell — which loads `server.url` out of
 * capacitor.config.json — sat on a 404 and would not open.
 *
 * Everything here is wiring a typechecker cannot see. capacitor.config.json is
 * JSON, so `tsc` never reads it; AndroidManifest.xml is XML, so nothing reads
 * it; and both are baked into the APK at build time, which means a mistake in
 * either is discovered on a handset after a Play release rather than in CI.
 * That is the most expensive place in this project to find anything.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_HOST, APP_HOSTS, APP_ORIGIN, isAppHost } from "@/config/appOrigin";
import { parseProfileQr, PROFILE_QR_ORIGIN } from "../qr/oniqProfileQr";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("the app's own origin", () => {
  it("names www as the primary host, with the apex still ours", () => {
    expect(APP_HOST).toBe("www.oniqhub.com");
    expect(APP_ORIGIN).toBe("https://www.oniqhub.com");
    expect(APP_HOSTS[0]).toBe(APP_HOST);
    expect([...APP_HOSTS].sort()).toEqual(["oniqhub.com", "www.oniqhub.com"]);
  });

  it("accepts either ONIQ host and refuses every lookalike", () => {
    expect(isAppHost("www.oniqhub.com")).toBe(true);
    expect(isAppHost("oniqhub.com")).toBe(true);
    expect(isAppHost("ONIQHUB.COM")).toBe(true);
    // The two shapes a prefix/suffix test would wave through. Both are real
    // attack strings, not hypotheticals — oniqProfileQr.ts records the second.
    expect(isAppHost("evil-oniqhub.com")).toBe(false);
    expect(isAppHost("oniqhub.com.evil.test")).toBe(false);
    expect(isAppHost("oniqhub.com@evil.test")).toBe(false);
    expect(isAppHost("")).toBe(false);
  });
});

describe("the shell points at a host that serves", () => {
  // THE ONE THAT MATTERS. If this drifts, the app opens a 404 and every other
  // test in this repo still passes — which is exactly what happened.
  it("capacitor.config.json server.url IS the app origin", () => {
    const cfg = JSON.parse(read("capacitor.config.json"));
    expect(cfg.server.url).toBe(APP_ORIGIN);
    expect(cfg.server.androidScheme).toBe("https");
    expect(cfg.server.cleartext).toBe(false);
  });

  it("declares an App Link for every ONIQ host, not just the primary", () => {
    const mf = read("android/app/src/main/AndroidManifest.xml");
    // A prefix registered for one host and not the other is a deep link that
    // opens a browser instead of the app — silent, and only on the host you
    // did not test.
    for (const host of APP_HOSTS) {
      for (const prefix of ["/auth-native-callback", "/r/", "/m/", "/u/"]) {
        expect(
          mf.includes(
            `<data android:scheme="https" android:host="${host}" android:pathPrefix="${prefix}" />`,
          ),
        ).toBe(true);
      }
    }
  });
});

describe("inbound URLs already in the world keep working", () => {
  const TOKEN = "a".repeat(22);

  it("parses a profile QR on either host", () => {
    for (const host of APP_HOSTS) {
      const got = parseProfileQr(`https://${host}/q/${TOKEN}`);
      expect(got?.token).toBe(TOKEN);
    }
  });

  it("mints new codes on the serving host", () => {
    expect(PROFILE_QR_ORIGIN).toBe(APP_ORIGIN);
  });

  it("still refuses a port, a lookalike and plain http", () => {
    // url.origin equality used to reject a port for free; host membership does
    // not, so the port check is explicit and this is what proves it is there.
    expect(parseProfileQr(`https://www.oniqhub.com:8443/q/${TOKEN}`)).toBeNull();
    expect(parseProfileQr(`http://oniqhub.com/q/${TOKEN}`)).toBeNull();
    expect(parseProfileQr(`https://oniqhub.com.evil.test/q/${TOKEN}`)).toBeNull();
    expect(parseProfileQr(`https://evil.test/q/${TOKEN}`)).toBeNull();
  });
});
