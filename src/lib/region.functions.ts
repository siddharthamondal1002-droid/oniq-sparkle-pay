// Country-code-only location detection. Reads Cloudflare's edge header on the
// server; returns null when the edge cannot tell. NO GPS, no coordinates, no
// storage — the caller keeps the answer on-device.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { ALL_COUNTRIES, type Country } from "@/data/appRegistry";

export const detectRegion = createServerFn({ method: "GET" }).handler(async () => {
  const raw = (getRequestHeader("cf-ipcountry") ?? "").toUpperCase();
  // 'XX' = unknown client, 'T1' = Tor exit node. Both mean "cannot tell";
  // the client falls back to the device language tag.
  const known = raw && raw !== "XX" && raw !== "T1";
  const country = known && (ALL_COUNTRIES as string[]).includes(raw) ? (raw as Country) : null;
  return { country };
});
