/**
 * THE SECURITY HEADERS PRODUCTION ACTUALLY SENDS.
 *
 * Owner directive, 2026-09-03: "fix the CSP header so production actually
 * serves it".
 *
 * WHY THIS MODULE EXISTS. public/_headers is a Netlify / Cloudflare Pages
 * convention. This app builds with nitro's cloudflare-module preset and every
 * document is rendered by the Worker in src/server.ts; the hosting reads no
 * such file for those responses, and on 2026-09-03 production answered with
 * no Content-Security-Policy at all. Every "grant" in that file had been
 * documentation — which is also how it came to forbid two things the app
 * has needed all along: the Google Fonts stylesheet (style-src) and Razorpay's
 * checkout script and frames. Both are listed here because they were found
 * by reading the app, not the old file.
 *
 * The policy lives HERE, typed, and src/server.ts applies it to every HTML
 * response. public/_headers is regenerated from this module for hosts that
 * do read it (Cloudflare serves it for static assets) and for the tests that
 * parse it; src/lib/__tests__/securityHeaders.test.ts fails if the two ever
 * differ.
 *
 * ENFORCED ON PRODUCTION, REPORT-ONLY EVERYWHERE ELSE. The Lovable preview
 * runs inside the editor's frame and brokers its auth session to that frame
 * (src/integrations/supabase/previewAuthStorage.ts), and the editor injects
 * its own tooling there. Enforcing frame-ancestors 'none' on a preview host
 * would blank the editor; enforcing script-src might break its tools. So a
 * request to a PRODUCTION_HOST gets Content-Security-Policy, and any other
 * host gets the same policy as Content-Security-Policy-Report-Only, with the
 * editor's origins allowed as ancestors — visible in devtools, breaking
 * nothing.
 *
 * WHAT THE POLICY SAYS, and why each line is as wide as it is:
 *   script-src   'self' plus inline and eval (Vite's runtime and the WASM
 *                face landmarker need them), YouTube's IFrame API, Razorpay's
 *                checkout, and Google Tag Manager as before.
 *   style-src    'self' and inline, plus fonts.googleapis.com — the per-script
 *                Baloo/Noto stylesheet in src/routes/__root.tsx.
 *   frame-src    Google OAuth, YouTube's two origins, the four players in
 *                src/data/watchEmbeds.ts (EMBED_HOSTS is the source, so the
 *                two cannot drift), Razorpay's checkout frames, and blob: for
 *                the CV PDF preview.
 *   connect-src  any https/wss origin — Supabase, the AI gateway, Razorpay's
 *                telemetry — plus blob: and data: for uploads and exports.
 *   img/media    any https origin (storage, avatars, DMCA badge), data, blob.
 *   worker-src   'self' and blob: — the service worker and MediaPipe.
 *   object-src 'none', base-uri 'self', form-action 'self': nothing in the
 *                app posts a form off-origin (Razorpay runs in its own frame).
 *   frame-ancestors 'none' on production: ONIQ is never framed.
 */
import { EMBED_HOSTS } from "@/data/watchEmbeds";

/** Hosts that get the policy ENFORCED. Everything else gets report-only. */
export const PRODUCTION_HOSTS: readonly string[] = ["oniqhub.com", "www.oniqhub.com"];

/** Where a preview may be framed: the Lovable editor and its older domain. */
export const PREVIEW_FRAME_ANCESTORS: readonly string[] = [
  "'self'",
  "https://lovable.dev",
  "https://*.lovable.dev",
  "https://gptengineer.app",
  "https://*.gptengineer.app",
];

const PLAYER_ORIGINS = Object.values(EMBED_HOSTS).map((h) => `https://${h}`);

export const CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  "default-src": ["'self'"],
  "script-src": [
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
    "'wasm-unsafe-eval'",
    "https://www.googletagmanager.com",
    "https://www.youtube.com",
    "https://s.ytimg.com",
    "https://checkout.razorpay.com",
  ],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "data:", "https:"],
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "media-src": ["'self'", "blob:", "data:", "https:"],
  "connect-src": ["'self'", "https:", "wss:", "blob:", "data:"],
  "frame-src": [
    "https://accounts.google.com",
    "https://www.youtube-nocookie.com",
    "https://www.youtube.com",
    ...PLAYER_ORIGINS,
    "https://api.razorpay.com",
    "https://checkout.razorpay.com",
    "blob:",
  ],
  "worker-src": ["'self'", "blob:"],
  "manifest-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
};

export type CspMode = "production" | "preview";

/** The policy string. Production is what public/_headers carries verbatim. */
export function contentSecurityPolicy(mode: CspMode): string {
  const ancestors = mode === "production" ? ["'none'"] : PREVIEW_FRAME_ANCESTORS;
  const directives = { ...CSP_DIRECTIVES, "frame-ancestors": ancestors };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/**
 * Razorpay's frame may use the Payment Request API for some UPI and card
 * flows, so `payment` is granted to its origins rather than switched off.
 */
export const PERMISSIONS_POLICY =
  'geolocation=(self), camera=(self), microphone=(self), payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com")';

export function isProductionHost(hostname: string): boolean {
  return PRODUCTION_HOSTS.includes(hostname.toLowerCase());
}

/** The headers a document response carries, by the host it was asked for. */
export function securityHeadersFor(hostname: string): Record<string, string> {
  const production = isProductionHost(hostname);
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": PERMISSIONS_POLICY,
  };
  if (production) {
    headers["Content-Security-Policy"] = contentSecurityPolicy("production");
    headers["X-Frame-Options"] = "DENY";
  } else {
    headers["Content-Security-Policy-Report-Only"] = contentSecurityPolicy("preview");
  }
  return headers;
}

function isHtml(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("text/html");
}

/**
 * Apply the headers to a DOCUMENT response and leave everything else alone —
 * server-function JSON, redirects, and assets carry nothing from here. A new
 * Response is built rather than mutating the old one, because a Response
 * whose headers are immutable throws on `set` and the body streams through
 * either way.
 */
export function withSecurityHeaders(response: Response, request: Request): Response {
  if (!isHtml(response)) return response;
  let hostname = "";
  try {
    hostname = new URL(request.url).hostname;
  } catch {
    hostname = "";
  }
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeadersFor(hostname))) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
