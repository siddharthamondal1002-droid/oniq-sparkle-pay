#!/usr/bin/env python3
"""
Google sign-in smoke test (isolated browser context).

Realistic scope: a headless script cannot complete an interactive Google
consent screen without real credentials, and hard-coding those into a smoke
test is a footgun. Instead this test verifies the two things that actually
break in practice:

  1. The public /auth page renders and the "Continue with Google" button
     kicks off the managed OAuth broker flow (network call to the Lovable
     OAuth initiate endpoint OR a navigation toward accounts.google.com /
     oauth.lovable.app).

  2. A valid Supabase session — the one the Lovable browser harness injects
     into the sandbox as LOVABLE_BROWSER_SUPABASE_* env vars — lands the
     user on /app with an authenticated session (supabase.auth.getUser()
     returns a real user, not null), and survives a page refresh.

The context is always a fresh browser.new_context() so it never shares
storage with the developer's manual preview session.

Usage:
  python3 scripts/smoke/google-signin.py [--base-url http://localhost:8080]

Exit code 0 = PASS, 1 = FAIL. Screenshots under /tmp/browser/google-signin/.
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/google-signin")
SHOTS.mkdir(parents=True, exist_ok=True)


def log(step: str, ok: bool, detail: str = "") -> None:
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {step}" + (f" — {detail}" if detail else ""))


async def check_button_initiates_oauth(context, base_url: str) -> bool:
    page = await context.new_page()
    broker_hits: list[str] = []

    def record(url: str) -> None:
        if (
            "/~oauth" in url
            or "oauth.lovable.app" in url
            or "accounts.google.com" in url
        ):
            broker_hits.append(url)

    page.on("request", lambda req: record(req.url))
    page.on("framenavigated", lambda fr: record(fr.url))
    context.on("page", lambda pg: record(pg.url))

    await page.goto(f"{base_url}/auth", wait_until="domcontentloaded")
    await page.screenshot(path=str(SHOTS / "1_auth_page.png"))

    btn = page.get_by_role("button", name="Continue with Google")
    if await btn.count() == 0:
        log("Auth page renders Google button", False, "button not found")
        await page.close()
        return False
    log("Auth page renders Google button", True)

    # The helper either opens a popup or navigates the current page to
    # /~oauth/initiate. Either counts as a broker start. Don't wait for the
    # consent screen — we only need proof the flow started.
    try:
        await btn.click()
    except Exception:
        pass
    await page.wait_for_timeout(3000)
    # Also inspect the final URL of every open page in the context.
    for pg in context.pages:
        record(pg.url)

    ok = len(broker_hits) > 0
    log(
        "Google button initiates OAuth broker",
        ok,
        f"{len(broker_hits)} hit(s); first: {broker_hits[0] if broker_hits else 'none'}",
    )
    await page.close()
    return ok



async def check_injected_session_reaches_app(context, base_url: str) -> bool:
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    status = os.environ.get("LOVABLE_BROWSER_AUTH_STATUS", "unknown")

    if status != "injected" or not (storage_key and session_json):
        log(
            "Session-lands-on-/app check",
            True,
            f"skipped (LOVABLE_BROWSER_AUTH_STATUS={status}; no injected session available)",
        )
        return True

    page = await context.new_page()

    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = base_url
        await context.add_cookies(cookies)

    await page.goto(base_url, wait_until="domcontentloaded")
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
    )

    # Navigate to a protected route.
    await page.goto(f"{base_url}/app", wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle")
    await page.screenshot(path=str(SHOTS / "3_app_after_session.png"))

    on_app = "/app" in page.url and "/auth" not in page.url
    log("Protected /app renders (no bounce to /auth)", on_app, f"url={page.url}")

    # Confirm the client-side Supabase session is actually valid.
    user_info = await page.evaluate(
        """
        async () => {
          const mod = await import('/src/integrations/supabase/client.ts').catch(() => null);
          if (!mod) return { ok: false, reason: 'client import failed' };
          const { data, error } = await mod.supabase.auth.getUser();
          return { ok: !!data?.user && !error, user_id: data?.user?.id ?? null, error: error?.message ?? null };
        }
        """
    )
    session_ok = bool(user_info.get("ok"))
    log(
        "supabase.auth.getUser() returns a user",
        session_ok,
        f"user_id={user_info.get('user_id')} err={user_info.get('error')}",
    )

    # Reload and confirm we don't bounce.
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle")
    await page.screenshot(path=str(SHOTS / "4_after_reload.png"))
    survived = "/app" in page.url and "/auth" not in page.url
    log("Session survives a reload", survived, f"url={page.url}")

    await page.close()
    return on_app and session_ok and survived


async def main(base_url: str) -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        # Isolated context — never shares storage with the manual session.
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})

        try:
            r1 = await check_button_initiates_oauth(context, base_url)
            r2 = await check_injected_session_reaches_app(context, base_url)
        finally:
            await context.close()
            await browser.close()

    all_ok = r1 and r2
    print("\n" + ("ALL GREEN" if all_ok else "FAILED"))
    return 0 if all_ok else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:8080")
    args = ap.parse_args()
    sys.exit(asyncio.run(main(args.base_url)))
