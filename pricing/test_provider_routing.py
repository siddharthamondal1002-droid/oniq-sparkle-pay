#!/usr/bin/env python3
"""Regression tests for ONIQ provider routing and the secret boundary.

These are STATIC tests over the shipped source. They need no credential, no
network and no provider call — which is exactly why they are worth having: they
pin the claims this audit made, so a later change cannot quietly falsify them.

Phase-19 items covered here: 1 (secret never exposed), 8 (Claude not hard-coded
globally), 10 (search cannot trigger video), 11 (Veo cannot be silently
selected), 12 (Runway server-only), 20 (secrets never logged).
"""
import re
import sys
from pathlib import Path

REPO = Path("/home/user/oniq-sparkle-pay")
T = []


def test(fn):
    T.append(fn)
    return fn


def read(p):
    return (REPO / p).read_text(errors="replace")


# ---------------------------------------------------------- secret boundary
@test
def t01_runway_key_is_read_in_exactly_one_place():
    hits = []
    for p in REPO.rglob("*.ts"):
        if "node_modules" in str(p):
            continue
        if "RUNWAY_API_KEY" in p.read_text(errors="replace"):
            hits.append(p.relative_to(REPO).as_posix())
    assert hits == ["src/lib/runway.server.ts"], (
        f"RUNWAY_API_KEY must be read in exactly one server-only file; found {hits}")


@test
def t02_no_provider_secret_reaches_any_client_surface():
    """No VITE_/NEXT_PUBLIC_ prefixed provider credential, anywhere."""
    bad = []
    for p in list(REPO.rglob("*.ts")) + list(REPO.rglob("*.tsx")) + \
            list(REPO.rglob("*.env*")) + list(REPO.rglob("*.json")):
        s = str(p)
        if "node_modules" in s or "/.git/" in s:
            continue
        try:
            txt = p.read_text(errors="replace")
        except Exception:  # noqa: BLE001
            continue
        for m in re.finditer(r"(VITE_|NEXT_PUBLIC_)[A-Z0-9_]*(RUNWAY|GOOGLE_AI|GEMINI|ANTHROPIC)[A-Z0-9_]*", txt):
            bad.append(f"{p.relative_to(REPO)}: {m.group(0)}")
    assert not bad, f"provider credential exposed to a client surface: {bad}"


@test
def t03_runway_server_module_is_never_imported_by_the_client():
    bad = []
    for p in list(REPO.rglob("*.tsx")) + list(REPO.rglob("*.ts")):
        s = str(p)
        # server modules may import each other; TESTS may import a server module
        # to assert on it — that is not a client leak. Everything else is.
        if ("node_modules" in s or p.name.endswith(".server.ts")
                or "__tests__" in s or p.name.endswith(".test.ts")
                or p.name.endswith(".test.tsx")):
            continue
        txt = p.read_text(errors="replace")
        if re.search(r"from\s+['\"][^'\"]*runway\.server['\"]", txt):
            bad.append(p.relative_to(REPO).as_posix())
    assert not bad, f"runway.server imported outside a server module: {bad}"


@test
def t04_runway_is_admin_gated():
    s = read("src/lib/runway.server.ts")
    assert "requireAdmin" in s
    assert "is_admin" in s
    assert "class Forbidden" in s


@test
def t05_secrets_are_not_logged():
    """No log statement may interpolate a credential variable."""
    bad = []
    for p in list(REPO.rglob("*.ts")) + list(REPO.rglob("*.mjs")):
        if "node_modules" in str(p):
            continue
        for ln in p.read_text(errors="replace").splitlines():
            if re.search(r"console\.(log|warn|error|info)", ln) and \
               re.search(r"\$\{[^}]*(API_KEY|SERVICE_ROLE|SECRET)[^}]*\}", ln):
                bad.append(f"{p.relative_to(REPO)}: {ln.strip()[:90]}")
    assert not bad, f"a credential may be reaching the logs: {bad}"


# ---------------------------------------------------------- routing claims
@test
def t06_search_cannot_trigger_video_generation():
    for fn in ("smart-scout", "hotel-scout"):
        s = read(f"supabase/functions/{fn}/index.ts")
        for banned in ("veo", "runway", "story-clip", "predictLongRunning"):
            assert banned.lower() not in s.lower(), (
                f"{fn} references {banned} — search must never reach video generation")


@test
def t07_veo_cannot_be_selected_without_the_owner_switch():
    s = read("remotion/scripts/story-worker.mjs")
    assert "process.env.STORY_MOVIE === 'on'" in s
    assert "process.env.STORY_MOVIE === 'select'" in s
    m = re.search(r"const clipStage\s*=(.{0,400})", s, re.S)
    assert m and "'off'" in m.group(1), (
        "the clip stage must default to 'off' when STORY_MOVIE is unset")


@test
def t08_claude_is_not_the_only_configured_provider():
    s = read("supabase/functions/_shared/modelRegistry.ts")
    providers = set(re.findall(r'provider:\s*"([^"]+)"', s))
    assert "anthropic" in providers
    assert "google-direct" in providers, "Google must be a configured provider"
    assert "lovable-gateway" in providers
    assert len(providers) >= 3, providers


@test
def t09_google_serves_image_tts_and_video():
    s = read("supabase/functions/_shared/modelRegistry.ts")
    pairs = dict(re.findall(r'id:\s*"([^"]+)",\s*\n\s*provider:\s*"([^"]+)"', s))
    assert pairs.get("google/gemini-2.5-flash-image") == "lovable-gateway"
    assert pairs.get("google/gemini-2.5-flash-tts") == "lovable-gateway"
    assert pairs.get("veo-3.1-fast-generate-preview") == "google-direct"
    assert pairs.get("gemini-3.6-flash") == "google-direct"


@test
def t10_the_gemini_fallback_trigger_is_narrow_and_that_is_recorded():
    """The audit's central finding. If the trigger widens, this must be revisited."""
    s = read("supabase/functions/_shared/llm.ts")
    assert "isAnthropicBillingExhaustion" in s
    body = re.search(r"function isAnthropicBillingExhaustion.*?\n}", s, re.S)
    assert body, "the predicate must exist"
    b = body.group(0)
    assert "status !== 400" in b
    assert "credit balance" in b
    assert "429" not in b and "500" not in b, (
        "if the predicate now covers 429/5xx the fallback has been widened — "
        "the routing audit's central finding needs updating")


@test
def t11_the_gemini_fallback_model_is_pinned_not_an_alias():
    s = read("supabase/functions/_shared/llm.ts")
    m = re.search(r'GEMINI_FALLBACK_MODEL\s*=\s*"([^"]+)"', s)
    assert m, "the fallback model must be a named constant"
    assert m.group(1) != "gemini-flash-latest", (
        "a moving alias under a fallback changes silently mid-outage")


@test
def t12_no_dead_model_id_is_wired_as_a_live_route():
    """veo-3.0-fast is a tombstone; it must not be the primary clip model."""
    s = read("supabase/functions/story-clip/index.ts")
    m = re.search(r'CLIP_MODEL\s*=\s*"([^"]+)"', s)
    assert m and m.group(1) == "veo-3.1-fast-generate-preview", m


# ---------------------------------------------------------- honesty pins
@test
def t13_no_authenticated_true_is_claimed_without_a_live_call():
    d = Path(__file__).resolve().parent.parent
    for name in ("PROVIDER_CONNECTIVITY_REPORT.md", "ONIQ_PROVIDER_VERIFICATION.md"):
        s = (d / name).read_text()
        assert "authenticated: true" not in s.lower().replace(" =", ":"), name
        assert "UNTESTED" in s or "NOT_ATTEMPTED" in s or "not reachable" in s.lower(), name


@test
def t14_no_runway_rupee_price_was_invented():
    d = Path(__file__).resolve().parent.parent
    for name in ("ONIQ_PROVIDER_VERIFICATION.md", "PROVIDER_CONNECTIVITY_REPORT.md",
                 "ONIQ_VIDEO_PROVIDER_ROUTING_AUDIT.md"):
        s = (d / name).read_text()
        # a ₹ figure must never appear on the same line as a runway credit rate
        for ln in s.splitlines():
            if "CREDITS_PER_SECOND" in ln or "25 credits" in ln:
                assert "₹" not in ln or "without" in ln.lower() or "not" in ln.lower(), ln


if __name__ == "__main__":
    p = f = 0
    for fn in T:
        try:
            fn()
            print(f"  PASS  {fn.__name__}")
            p += 1
        except Exception as e:  # noqa: BLE001
            print(f"  FAIL  {fn.__name__}: {e}")
            f += 1
    print(f"\n  {p} passed, {f} failed")
    raise SystemExit(1 if f else 0)
