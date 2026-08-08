// Locate a browser Remotion can drive, on whichever box is doing the render.
//
// Extracted from the three render scripts, which each carried their own copy.
// They had already drifted once and would again; more to the point, episode 3
// may be rendered on the Lovable agent's container rather than this one, and a
// resolver that only knows about this container's layout is a resolver that
// fails there.
//
// The order is deliberate:
//
//   1. PUPPETEER_EXECUTABLE_PATH — an explicit override always wins.
//   2. Playwright's install roots, VERSIONED. This script originally hardcoded
//      /opt/pw-browsers/chromium/chrome-linux/chrome, which is empty on a
//      re-provisioned box because Playwright installs under a versioned sibling
//      (chromium-1194). It failed as a path error thrown before a single frame
//      rendered, which reads like a Remotion problem and is not one.
//   3. A plain PATH-style lookup. Lovable's container has /bin/chromium and no
//      /opt/pw-browsers at all.
//   4. undefined — let Remotion find or fetch a browser itself. A wrong path is
//      worse than no path.
import fs from 'fs';
import path from 'path';

/** Where Playwright unpacks browsers, across the environments this runs in. */
const PLAYWRIGHT_ROOTS = ['/opt/pw-browsers', '/opt/ms-playwright'];

/** Ordinary system locations, for boxes with no Playwright install. */
const SYSTEM_BINARIES = [
  '/bin/chromium',
  '/usr/bin/chromium',
  '/bin/chromium-browser',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chrome',
];

export function findChromium() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;

  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, ...PLAYWRIGHT_ROOTS].filter(
    (r) => r && fs.existsSync(r),
  );

  for (const root of roots) {
    const dirs = fs
      .readdirSync(root)
      .filter((d) => d.startsWith('chromium'))
      .sort()
      .reverse();
    // BINARY FIRST, VERSION SECOND, and the nesting order is the whole point.
    // Playwright ships chromium_headless_shell beside chromium, and '_' sorts
    // above '-', so looping directories on the outside finds the shell — which
    // chromeMode 'chrome-for-testing' cannot drive. Full chrome in ANY version
    // beats a headless shell in the newest.
    for (const leaf of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
      for (const dir of dirs) {
        const candidate = path.join(root, dir, leaf);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  return SYSTEM_BINARIES.find((c) => fs.existsSync(c));
}
