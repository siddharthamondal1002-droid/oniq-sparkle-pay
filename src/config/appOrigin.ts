/**
 * ONIQ'S OWN HOST — the one place the app's public origin is decided.
 *
 * Owner directive, 2026-09-28: "Fix the host, point it back to the apex."
 * This SUPERSEDES the 2026-09-12 "Use www.oniqhub.com", whose whole premise was
 * that the apex had stopped serving. It serves again, and www is now the one
 * that does not.
 *
 * MEASURED with `pg_net` from inside production, because both hosts are
 * proxy-blocked from the dev container:
 *
 *     GET oniqhub.com/                 200  x-deployment-id psr2.e0f40115-…
 *                                           enforcing CSP
 *     GET www.oniqhub.com/                  location: https://oniqhub.com/
 *                                           no x-deployment-id, no CSP
 *     GET <apex>/__l5e/assets-v1/….jpg 200  image/jpeg  content-length 507596
 *     GET <www>/… the same path …           location: <apex>  content-length 0
 *
 * `net.http_get` follows redirects, so www's 200 IS the apex's response and the
 * `location` header is the proof. By this file's own rule — an absent
 * `x-deployment-id` means Cloudflare answered without ever reaching the Lovable
 * origin — the apex is the host that serves and www only bounces to it.
 *
 * THE FLIP COSTS INSTALLED USERS NOTHING, and that is measured rather than
 * hoped. `server.url` is baked into the APK, and the last Android build is run
 * #37 of 2026-08-18 — a month BEFORE the www directive — so no shipped shell
 * has ever pointed at www. Every phone carrying ONIQ already loads the apex, so
 * this makes the repo agree with the field again rather than moving anybody:
 *
 *   no sign-out          no shell changes origin, so no localStorage session is
 *                        orphaned. Moving TO www later is what would sign all
 *                        126 accounts out, and that cost lands on the Android
 *                        release, never on a web publish.
 *   phone sign-in works  Firebase authorizedDomains re-measured on the public
 *                        web key is [localhost, oniq-309bd.firebaseapp.com,
 *                        oniq-309bd.web.app, oniqhub.com] — www is STILL
 *                        absent, so reCAPTCHA refuses on any flow genuinely
 *                        running there.
 *   one less hop         every outbound ONIQ link stops paying a 302.
 *
 * WHY A CONSTANT AND NOT A FIND-AND-REPLACE. The host appears in ~100 places,
 * and they are not one kind of thing. Three groups, deliberately treated
 * differently:
 *
 *   BUILDS an outbound URL   -> APP_ORIGIN. A link ONIQ hands out must point
 *                               at a host that serves.
 *   VALIDATES an inbound URL -> isAppHost(). Accepts BOTH hosts whichever one
 *                               is primary: QR codes already printed, deep
 *                               links already shared and reference URLs already
 *                               stored name both, and both are ONIQ's own.
 *   NAMES A CANONICAL PAGE   -> left alone on purpose. og:url, rel=canonical
 *                               and sitemap.xml say the apex, which this flip
 *                               makes correct for free — they were never moved,
 *                               precisely because flipping them twice is worse
 *                               than flipping them once.
 *
 * That three-way sort is what makes the host a two-line decision instead of a
 * hundred-site edit, and it is why the 2026-09-12 work was worth doing
 * whichever host ended up winning.
 */

/** The host ONIQ serves from and hands out links to. */
export const APP_HOST = "oniqhub.com";

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
export const APP_HOSTS: readonly string[] = [APP_HOST, "www.oniqhub.com"];

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
