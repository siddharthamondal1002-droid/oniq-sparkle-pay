import { describe, it, expect } from "vitest";

import { buildInviteMessage, emailShareUrl, smsShareUrl, invitePayload, INVITE_SUBJECT } from "../shareInvite";
import { REGION_PROVIDER_TARGET } from "../regionService";

// shareInvite transitively imports the supabase client via regionService.
import { vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

describe("buildInviteMessage", () => {
  it("mentions the region and the 20-provider threshold", () => {
    const msg = buildInviteMessage("Singur");
    expect(msg).toContain("Singur");
    expect(msg).toContain(String(REGION_PROVIDER_TARGET));
    expect(msg).toContain("free");
  });

  it("weaves in live progress when a count is known", () => {
    const msg = buildInviteMessage("Kolkata", 7);
    expect(msg).toContain("7 neighbours");
    expect(msg).toContain(String(REGION_PROVIDER_TARGET - 7));
  });

  it("falls back to a generic area when region is blank", () => {
    expect(buildInviteMessage("  ")).toContain("our area");
  });
});

describe("share URLs", () => {
  it("email URL carries subject and fully-encoded body", () => {
    const url = emailShareUrl("hello & welcome\nline2");
    expect(url.startsWith("mailto:?subject=")).toBe(true);
    expect(url).toContain(encodeURIComponent(INVITE_SUBJECT));
    expect(url).toContain(encodeURIComponent("hello & welcome\nline2"));
    expect(url).not.toContain("hello & welcome"); // raw ampersand must not leak
  });

  it("sms URL uses the cross-platform compose form", () => {
    const url = smsShareUrl("come join ONIQ");
    expect(url.startsWith("sms:?&body=")).toBe(true);
    expect(url).toContain(encodeURIComponent("come join ONIQ"));
  });
});

describe("invitePayload", () => {
  it("returns a systemShare-compatible payload with the invite copy", () => {
    const p = invitePayload("Singur", 3);
    expect(p.title).toBe(INVITE_SUBJECT);
    expect(p.text).toContain("Singur");
    expect(p.url).toBe("https://oniqhub.com");
  });
});
