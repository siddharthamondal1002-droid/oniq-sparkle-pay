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

/**
 * MEASURED 2026-09-25, AND THE 2026-09-12 PREMISE IS GONE. The apex recovered
 * while this branch sat unmerged, and the reading is the exact inverse of the
 * one above — taken with `pg_net` from inside production, because both hosts
 * are proxy-blocked from the dev container:
 *
 *     oniqhub.com/app      200  x-deployment-id psr2.18fbbbb2-…  CSP present
 *     www.oniqhub.com/app  200  location: https://oniqhub.com/app
 *                               no x-deployment-id, no CSP
 *
 * `net.http_get` follows redirects, so www's 200 IS the apex's response and
 * the `location` header is the proof: **www does not serve ONIQ, it 302s to
 * the apex.** By this file's own rule — an absent `x-deployment-id` means
 * Cloudflare answered without reaching the Lovable origin — the apex is the
 * host that serves and www is the one that does not.
 *
 * `authorizedDomains` was re-measured the same minute with the public web key
 * and still reads [localhost, oniq-309bd.firebaseapp.com, oniq-309bd.web.app,
 * oniqhub.com] — www is STILL not authorized, so reCAPTCHA phone sign-in
 * refuses on any flow that genuinely runs on that origin.
 *
 * THE VALUE IS LEFT AT www BECAUSE THE DIRECTIVE SAID www, and changing it
 * back is the owner's call now that the reason for it is gone. What the flip
 * would cost TODAY is small and worth stating precisely, because the scary
 * version is wrong: `server.url` is compiled into the APK, so a WEB publish
 * cannot move an installed shell and therefore cannot sign anybody out. What
 * a web publish on www actually costs is one redirect hop on every outbound
 * link ONIQ hands out. The origin-keyed sign-out and the phone-sign-in gap
 * arrive only with the next ANDROID build, which is where the decision
 * really bites.
 *
 * SO THE FLIP IS TWO LINES HERE PLUS `server.url` IN capacitor.config.json,
 * and the guard in appOrigin.test.ts refuses to let one move without the
 * other — deliberately, because those two disagreeing is a handset-only
 * failure discovered after a Play release. That guard is also the answer to
 * why 2026-09-12 was worth doing whichever host wins: the three-way sort,
 * `isAppHost` accepting both names, and the config/manifest pins are what
 * make this a two-line decision instead of a hundred-site edit.
 */

/** The host ONIQ serves from and hands out links to. */
export const APP_HOST = "www.oniqhub.com";

/** The origin every outbound ONIQ link is built from. */
export const APP_ORIGIN = `https://${APP_HOST}`;

/**
 * Every host that is ONIQ. Order matters only in that APP_HOST is first;
 * membership is what callers ask about.
 *
 * BOTH stay listed whichever one APP_HOST names, and the reason is unchanged
 * by the flip: an inbound link naming either is still ONIQ's own link, QR
 * codes and deep links minted under both are already in the world, and www
 * redirects rather than failing — so a stored `www` URL resolves and must not
 * be refused on arrival.
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
