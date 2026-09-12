/**
 * ONIQ'S OWN HOST — the one place the app's public origin is decided.
 *
 * Owner directive, 2026-09-12: "Use www.oniqhub.com". The apex `oniqhub.com`
 * stopped serving that afternoon — measured, every path 404 with no
 * `x-deployment-id`, i.e. Cloudflare answering without ever reaching the
 * Lovable origin, while `www` returned 200 and ONIQ's enforcing CSP. The
 * Capacitor shell loads `server.url` from capacitor.config.json, so the
 * WebView was fetching that 404 and the app would not open.
 *
 * WHY A CONSTANT AND NOT A FIND-AND-REPLACE. The host appears in ~100 places,
 * and they are not one kind of thing. Three groups, deliberately treated
 * differently:
 *
 *   BUILDS an outbound URL   -> APP_ORIGIN. A link ONIQ hands out must point
 *                               at a host that serves.
 *   VALIDATES an inbound URL -> isAppHost(). Must accept BOTH hosts: QR codes
 *                               already printed, deep links already shared and
 *                               reference URLs already stored all name the
 *                               apex, and they must keep working the day it
 *                               comes back. Widening here is safe because both
 *                               names are ONIQ's own.
 *   NAMES A CANONICAL PAGE   -> left alone on purpose. og:url, rel=canonical
 *                               and sitemap.xml still say the apex. Which host
 *                               is canonical is an SEO decision with its own
 *                               consequences, it is not what "the app will not
 *                               open" needed, and flipping it twice is worse
 *                               than flipping it once deliberately.
 *
 * THE ORIGIN CHANGE SIGNS EVERYONE OUT, and that is a property of the browser
 * rather than a bug here: the Supabase session lives in localStorage, which is
 * keyed by origin, so a shell that moves from `oniqhub.com` to
 * `www.oniqhub.com` cannot see the session stored under the old one.
 */

/** The host ONIQ serves from and hands out links to. */
export const APP_HOST = "www.oniqhub.com";

/** The origin every outbound ONIQ link is built from. */
export const APP_ORIGIN = `https://${APP_HOST}`;

/**
 * Every host that is ONIQ. Order matters only in that APP_HOST is first;
 * membership is what callers ask about.
 *
 * The apex stays listed even while it is down. An inbound link naming it is
 * still ONIQ's own link, and refusing it would break every QR code and shared
 * URL minted before today — permanently, not just while the apex is dark.
 */
export const APP_HOSTS: readonly string[] = [APP_HOST, "oniqhub.com"];

/**
 * Is this hostname ONIQ's?
 *
 * Exact match against the list, never a prefix or `endsWith` test: a check
 * like `endsWith("oniqhub.com")` accepts `evil-oniqhub.com`, and one like
 * `startsWith` accepts `oniqhub.com.evil.test`. oniqProfileQr.ts already
 * carries a comment recording that second shape as a real attack on this
 * codebase, so it is not a hypothetical.
 */
export function isAppHost(hostname: string): boolean {
  return APP_HOSTS.includes(hostname.toLowerCase());
}
