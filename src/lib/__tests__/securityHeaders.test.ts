/**
 * THE SECURITY HEADERS ARE SENT, NOT JUST WRITTEN DOWN — owner directive,
 * 2026-09-03: "fix the CSP header so production actually serves it".
 *
 * What is pinned: the policy names everything the app is known to load, the
 * Worker applies it to documents and nothing else, production is enforced
 * and previews are report-only, and public/_headers is a faithful copy of
 * the module rather than a second policy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EMBED_FRAME_HOSTS, EMBED_HOSTS } from "@/data/watchEmbeds";
import { THIRD_PARTY_REQUESTS } from "@/config/playCompliance";
import {
  CSP_DIRECTIVES,
  PERMISSIONS_POLICY,
  PRODUCTION_HOSTS,
  contentSecurityPolicy,
  isProductionHost,
  securityHeadersFor,
  withSecurityHeaders,
} from "@/lib/securityHeaders";

const ROOT = process.cwd();

function directive(csp: string, name: string): string[] {
  const m = csp
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name} `));
  return m ? m.slice(name.length + 1).split(/\s+/) : [];
}

describe("the policy names what the app actually loads", () => {
  const csp = contentSecurityPolicy("production");

  it("frames every Watch player host, from the same list the players use", () => {
    const frames = directive(csp, "frame-src");
    for (const h of Object.values(EMBED_HOSTS)) expect(frames).toContain(`https://${h}`);
    // And every host a player REDIRECTS to: Dailymotion's embed URL answers
    // 301 to geo.dailymotion.com, and a policy that names only the first hop
    // shows a black frame (owner screenshot, 2026-09-03).
    for (const h of EMBED_FRAME_HOSTS) expect(frames).toContain(`https://${h}`);
    expect(frames).toContain("https://geo.dailymotion.com");
    expect(frames).toContain("https://www.youtube-nocookie.com");
    expect(frames).toContain("https://www.youtube.com");
  });

  it("frames Razorpay's checkout and lets its script load — payments were missing from the old file", () => {
    expect(directive(csp, "frame-src")).toContain("https://api.razorpay.com");
    expect(directive(csp, "frame-src")).toContain("https://checkout.razorpay.com");
    expect(directive(csp, "script-src")).toContain("https://checkout.razorpay.com");
  });

  it("lets the Google Fonts stylesheet load — the old file would have blocked it", () => {
    expect(directive(csp, "style-src")).toContain("https://fonts.googleapis.com");
    expect(directive(csp, "font-src")).toContain("https:");
  });

  it("frames blob: for the CV PDF preview and allows workers for the service worker and MediaPipe", () => {
    expect(directive(csp, "frame-src")).toContain("blob:");
    expect(directive(csp, "worker-src")).toEqual(["'self'", "blob:"]);
    expect(directive(csp, "script-src")).toContain("'wasm-unsafe-eval'");
  });

  it("loads no SDK script for the four players — only YouTube's API is a script", () => {
    const scripts = directive(csp, "script-src").join(" ");
    for (const h of ["vimeo", "dailymotion", "twitch", "archive.org"]) {
      expect(scripts, `${h} script allowed`).not.toContain(h);
    }
  });

  it("closes the doors that stay closed", () => {
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
  });

  it("names every declared third-party player host in frame-src or script-src", () => {
    // A host the app declares it reaches automatically had better be allowed
    // to load, or the declaration describes a request the policy blocks.
    const allowed = [...directive(csp, "frame-src"), ...directive(csp, "script-src")].join(" ");
    for (const r of THIRD_PARTY_REQUESTS) {
      // A lookup made FROM THE SERVER never touches the browser's policy.
      if (/from ONIQ's server/i.test(r.sends)) continue;
      if (/youtube|vimeo|dailymotion|twitch|archive\.org/.test(r.host)) {
        expect(allowed, `${r.host} is declared but not allowed`).toContain(r.host);
      }
    }
  });

  it("lets Razorpay's frame use the Payment Request API", () => {
    expect(PERMISSIONS_POLICY).toMatch(/payment=\(self "https:\/\/api\.razorpay\.com"/);
  });
});

describe("enforced on production, report-only on previews", () => {
  it("knows the production hosts and nothing else", () => {
    expect(PRODUCTION_HOSTS).toEqual(["oniqhub.com", "www.oniqhub.com"]);
    expect(isProductionHost("ONIQHUB.COM")).toBe(true);
    expect(isProductionHost("id-preview--686baacf.lovable.app")).toBe(false);
    expect(isProductionHost("localhost")).toBe(false);
  });

  it("sends the enforced policy and DENY on production", () => {
    const h = securityHeadersFor("oniqhub.com");
    expect(h["Content-Security-Policy"]).toBe(contentSecurityPolicy("production"));
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Content-Security-Policy-Report-Only"]).toBeUndefined();
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("sends report-only on a preview host, with the editor allowed as an ancestor", () => {
    const h = securityHeadersFor("id-preview--686baacf.lovable.app");
    expect(h["Content-Security-Policy"]).toBeUndefined();
    expect(h["X-Frame-Options"]).toBeUndefined();
    const ro = h["Content-Security-Policy-Report-Only"];
    expect(ro).toBeTruthy();
    expect(directive(ro, "frame-ancestors")).toContain("https://lovable.dev");
    // Everything but the ancestors is the same policy.
    expect(ro.replace(/frame-ancestors [^;]*/, "")).toBe(
      contentSecurityPolicy("production").replace(/frame-ancestors [^;]*/, ""),
    );
  });
});

describe("the Worker applies it to documents and nothing else", () => {
  const html = () =>
    new Response("<!doctype html><title>x</title>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "x-keep": "1" },
    });

  it("decorates an HTML response for production and keeps its body, status and headers", async () => {
    const out = withSecurityHeaders(html(), new Request("https://oniqhub.com/app/watch"));
    expect(out.status).toBe(200);
    expect(out.headers.get("x-keep")).toBe("1");
    expect(out.headers.get("content-security-policy")).toBe(contentSecurityPolicy("production"));
    expect(out.headers.get("x-frame-options")).toBe("DENY");
    expect(await out.text()).toContain("<title>x</title>");
  });

  it("decorates a preview document as report-only", () => {
    const out = withSecurityHeaders(
      html(),
      new Request("https://id-preview--686baacf.lovable.app/"),
    );
    expect(out.headers.get("content-security-policy")).toBeNull();
    expect(out.headers.get("content-security-policy-report-only")).toContain("frame-ancestors");
  });

  it("leaves JSON, redirects and assets untouched", () => {
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    expect(withSecurityHeaders(json, new Request("https://oniqhub.com/_serverFn/x"))).toBe(json);
    const redirect = Response.redirect("https://oniqhub.com/", 302);
    expect(withSecurityHeaders(redirect, new Request("https://oniqhub.com/old"))).toBe(redirect);
    const js = new Response("x", { headers: { "content-type": "text/javascript" } });
    expect(withSecurityHeaders(js, new Request("https://oniqhub.com/assets/a.js"))).toBe(js);
  });

  it("survives a response whose headers are immutable", () => {
    // Response.redirect() hands back immutable headers; an HTML one shaped
    // the same way must still come out decorated rather than throwing.
    const immutable = Response.redirect("https://oniqhub.com/", 302);
    let threw = false;
    try {
      immutable.headers.set("x", "y");
    } catch {
      threw = true;
    }
    expect(threw, "the fixture is not immutable").toBe(true);
    const doc = new Response("<p>hi</p>", {
      headers: new Headers({ "content-type": "text/html" }),
    });
    expect(() => withSecurityHeaders(doc, new Request("https://oniqhub.com/"))).not.toThrow();
  });

  it("is wired into the server entry for the app's documents and the error page", () => {
    const src = readFileSync(join(ROOT, "src/server.ts"), "utf8");
    expect(src.match(/withSecurityHeaders\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("public/_headers is a copy of the module, not a second policy", () => {
  const file = readFileSync(join(ROOT, "public/_headers"), "utf8");
  const line = (name: string) =>
    file
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith(`${name}:`))
      ?.slice(name.length + 1)
      .trim() ?? "";

  it("carries the production policy verbatim", () => {
    expect(line("Content-Security-Policy")).toBe(contentSecurityPolicy("production"));
  });

  it("carries the same permissions policy and says it is generated", () => {
    expect(line("Permissions-Policy")).toBe(PERMISSIONS_POLICY);
    expect(file).toContain("GENERATED from src/lib/securityHeaders.ts");
  });

  it("every directive in the module survives the round trip", () => {
    const csp = line("Content-Security-Policy");
    for (const name of Object.keys(CSP_DIRECTIVES)) {
      expect(csp, `${name} missing from public/_headers`).toContain(`${name} `);
    }
  });
});
