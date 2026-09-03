/**
 * Regenerate public/_headers from src/lib/securityHeaders.ts.
 *
 *   npx vite-node scripts/gen-headers.ts
 *
 * The module is the source of truth — src/server.ts sends these headers on
 * every document — and the file exists for hosts that read it (Cloudflare
 * serves it for static assets) and for the tests that parse it.
 * src/lib/__tests__/securityHeaders.test.ts fails when the two drift.
 */
import { writeFileSync } from "node:fs";
import { PERMISSIONS_POLICY, contentSecurityPolicy } from "../src/lib/securityHeaders";

const csp = contentSecurityPolicy("production");

const out = `# GENERATED from src/lib/securityHeaders.ts — do not edit by hand.
#   npx vite-node scripts/gen-headers.ts
#
# WHERE THESE HEADERS ACTUALLY COME FROM (owner directive, 2026-09-03: "fix
# the CSP header so production actually serves it"). This file is the
# Netlify / Cloudflare Pages convention, and the hosting does NOT read it for
# the documents the Worker in src/server.ts renders — on 2026-09-03 production
# served no Content-Security-Policy at all. src/server.ts now sends the policy
# on every HTML response, enforced on oniqhub.com and report-only on preview
# hosts. This file mirrors that policy for anything that does read it
# (Cloudflare applies it to static assets) and for the tests that parse it.
#
# WHAT IS IN THE POLICY, briefly (the module carries the full reasoning):
#   script-src  YouTube's IFrame API, Razorpay's checkout, Google Tag Manager,
#               plus inline/eval for Vite's runtime and the WASM face model.
#   style-src   inline plus fonts.googleapis.com — the per-script font sheet.
#   frame-src   Google OAuth, YouTube, the four players in
#               src/data/watchEmbeds.ts (EMBED_HOSTS is the source), Razorpay's
#               checkout frames, and blob: for the CV PDF preview.
#   frame-ancestors 'none' — ONIQ is never framed in production.
#
# NO SDK SCRIPT for Vimeo, Dailymotion, Twitch or the Archive: script-src does
# not name them. Their ENDED events ride postMessage.
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: ${PERMISSIONS_POLICY}
  Content-Security-Policy: ${csp}
`;

writeFileSync(new URL("../public/_headers", import.meta.url), out);
console.log(`public/_headers written (${csp.length} chars of CSP)`);
