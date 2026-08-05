// My TV — user-curated YouTube channels. Authenticated.
// Action: "resolve" (channel URL → { channelId, name }).
//
// NO LIVE CHANNELS loop, Phase 1. The "videos" action is gone. It merged each
// saved channel's recent uploads out of RSS so the in-app player had something
// to play; nothing plays in ONIQ now, so it returned video ids that no caller
// could use. Removing it also removes the per-user video cache.
//
// What is left resolves a channel id to a channel NAME, so the saved row can
// be labelled with something other than a UC... string. That is the whole job.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// An honest identifier. The desktop-Chrome string that used to sit here, with
// a "CONSENT=YES+1" cookie beside it, was camouflage for the page scrape that
// this function no longer does. The only endpoint it now touches is YouTube's
// public RSS feed, which wants neither.
const UA = "ONIQ/1.0 (+https://oniqhub.com)";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchText(url: string, timeoutMs = 6000): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/atom+xml, application/xml" },
      redirect: "follow",
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractHandleOrId(input: string): { channelId?: string; handle?: string } | null {
  const s = input.trim();
  if (!s) return null;
  const idMatch = s.match(/(UC[A-Za-z0-9_-]{22})/);
  if (idMatch) return { channelId: idMatch[1] };
  const handleUrl = s.match(/youtube\.com\/@([A-Za-z0-9._-]+)/i);
  if (handleUrl) return { handle: handleUrl[1] };
  const bareAt = s.match(/^@([A-Za-z0-9._-]+)$/);
  if (bareAt) return { handle: bareAt[1] };
  if (/^[A-Za-z0-9._-]+$/.test(s)) return { handle: s };
  return null;
}

/**
 * Resolve a user-pasted channel reference WITHOUT scraping.
 *
 * This used to fetch the channel or @handle page and regex externalId /
 * channelId / og:title out of the markup. YouTube's ToS require the Data API
 * for that, so it is gone.
 *
 * A URL containing a channel id needs no lookup — the id is right there. The
 * channel NAME then comes from YouTube's official RSS feed
 * (feeds/videos.xml?channel_id=...), which is a published syndication
 * endpoint, the same basis Pulse stands on.
 *
 * A bare @handle cannot be turned into a channel id without either the Data
 * API (no key is configured on this project) or a scrape, so it is refused
 * with a message telling the user what to paste instead. Refusing is the
 * honest failure: silently scraping was the bug.
 */
async function resolveChannel(input: string): Promise<{ channelId: string; name: string } | null> {
  const parsed = extractHandleOrId(input);
  if (!parsed?.channelId) return null;
  const channelId = parsed.channelId;

  let name = channelId;
  const xml = await fetchText(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
    8000,
  );
  if (xml) {
    const authorName = xml.match(/<author>[\s\S]*?<name>([^<]+)<\/name>/);
    if (authorName) name = authorName[1].trim();
  }
  return { channelId, name };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "unauthorized" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return json(401, { error: "unauthorized" });
  const userId = userData.user.id;

  let body: any = {};
  try { body = await req.json(); } catch { /* noop */ }
  const action = body?.action;

  try {
    if (action === "resolve") {
      const input = String(body?.input ?? "").slice(0, 500);
      const resolved = await resolveChannel(input);
      if (!resolved) {
        return json(404, { error: "Couldn't find that channel — paste the full link" });
      }
      return json(200, resolved);
    }

    return json(400, { error: "unknown action" });
  } catch (e) {
    console.error("[my-tv]", e);
    return json(500, { error: String(e) });
  }
});
