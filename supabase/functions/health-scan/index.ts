// health-scan — RETIRED (owner directive 2026-09-09: "Remove Anthropic from
// the active Health AI path. Do not leave an accidental fallback that sends
// health data to Anthropic.").
//
// WHAT THIS WAS. The Vitals "reports" section sent an uploaded lab report,
// as base64, to Anthropic (Claude Haiku on ANTHROPIC_API_KEY) with a
// web-search tool, ephemeral, rate-limited, forbidden to diagnose — and with
// NO consent step, outside the health audit, unnamed by the privacy notice.
// Measured configured in production on 2026-09-09 (docs/health/02 §16).
//
// WHY A STUB AND NOT A DELETED FOLDER. Deleting source does not undeploy:
// the function stays live on production until the OWNER deletes it from the
// Supabase dashboard (the Lovable agent's delete tool refuses, CLAUDE.md
// 2026-09-06). A deployed stub closes the path from HERE, with one deploy
// message, whether or not that dashboard visit ever happens. The Vitals
// caller is gone too (src/routes/_authenticated/app.vitals.tsx), so nothing
// in the shipped app reaches this URL; a stale client that still does gets
// 410 and no scan.
//
// WHAT IT MUST NEVER GROW BACK INTO, pinned by
// src/health/__tests__/anthropicRetired.test.ts: no fetch, no provider host,
// no ANTHROPIC_API_KEY, no request body read. The consented, audited Health
// AI path is `health-ai` through the gateway (docs/health/05 §17).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      error: "The report scan has been retired. Use Health → Ask about my records.",
      reason: "health_scan_retired",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
