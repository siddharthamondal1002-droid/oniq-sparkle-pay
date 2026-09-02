#!/usr/bin/env python3
"""
Step 11C — fetch an owner-authorised corpus BY DERIVED KEY, on the runner.

    fetch_corpus.py <corpus-manifest.json> <corpus_dir>
    fetch_corpus.py --selftest

Runner side only, never inside the image. Reads an oniq.arap-corpus-manifest/1
whose `stills` are keyed by stem (`<jobId>-<sceneId>-<shotId>`), fetches each
one from the manifest's public read base at `story/still/<stem>.png`, and
writes corpus_dir/<stem>.png plus corpus_dir/corpus-manifest.json with what it
established: sha256, byte count, PNG dimensions, fetch time.

FAILS CLOSED. The run stops on: a read base that is not a bare https origin
(a query string would be a credential in a public place); a stem that is not
a plain id; a body that is not a PNG; a declared sha256 that does not match
the bytes; any HTTP status other than 200 or 404; a corpus directory that is
not empty (an extra still is an unauthorised still). A 404 is NOT a failure:
it is recorded as missing, and the decision CLI turns it into a MISSING
record — never a silently shorter corpus.

Only stems the manifest lists are ever requested. The manifest is the owner's
statement of scope; this script cannot widen it.
"""
import hashlib
import json
import re
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SCHEMA = "oniq.arap-corpus-manifest/1"
KEY_PREFIX = "story/still/"
STEM = re.compile(r"^[A-Za-z0-9_-]{1,120}$")
PNG_SIG = b"\x89PNG\r\n\x1a\n"


def fail(msg: str):
    print(f"FAIL: {msg}")
    raise SystemExit(1)


def check_base(base) -> str:
    if not isinstance(base, str):
        fail("readBase missing")
    p = urllib.parse.urlsplit(base)
    if p.scheme != "https":
        fail(f"readBase must be https, got {base!r}")
    if not p.netloc or "@" in p.netloc:
        fail(f"readBase must be a bare host, got {base!r}")
    if p.query or p.fragment or p.path not in ("", "/"):
        fail(f"readBase must be a bare origin with no path, query or fragment, got {base!r}")
    return f"https://{p.netloc}"


def png_dims(body: bytes):
    if body[:8] != PNG_SIG or body[12:16] != b"IHDR":
        return None
    w, h = struct.unpack(">II", body[16:24])
    return (w, h) if w > 0 and h > 0 else None


def http_fetch(url: str):
    """(status, body). 404 is returned, not raised; anything else raises."""
    req = urllib.request.Request(url, headers={"User-Agent": "oniq-arap-fetch-corpus/1"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return 404, b""
        raise


def fetch_all(manifest: dict, corpus_dir: Path, fetch=http_fetch, now=time.time) -> dict:
    if manifest.get("schema") != SCHEMA:
        fail(f"manifest schema {manifest.get('schema')!r} is not {SCHEMA}")
    stills = manifest.get("stills")
    if not isinstance(stills, dict) or not stills:
        fail("manifest lists no stills")
    base = check_base(manifest.get("readBase"))
    corpus_dir.mkdir(parents=True, exist_ok=True)
    extra = [p.name for p in corpus_dir.iterdir()]
    if extra:
        fail(f"corpus dir is not empty: {extra[:5]} — an extra still is an unauthorised still")

    out = json.loads(json.dumps(manifest))
    fetched, missing = [], []
    for stem in sorted(stills):
        entry = out["stills"][stem]
        if not STEM.match(stem):
            fail(f"stem {stem!r} is not a plain id")
        url = f"{base}/{KEY_PREFIX}{stem}.png"
        status, body = fetch(url)
        if status == 404:
            entry["fetched"] = False
            entry["missing"] = "HTTP 404 at the derived key"
            missing.append(stem)
            print(f"  404  {'-':>9}  {stem}")
            continue
        if status != 200:
            fail(f"{stem}: HTTP {status}")
        dims = png_dims(body)
        if dims is None:
            fail(f"{stem}: body is not a PNG")
        sha = hashlib.sha256(body).hexdigest()
        declared = entry.get("sha256")
        if isinstance(declared, str) and declared:
            if declared.lower() != sha:
                fail(f"{stem}: sha256 mismatch — manifest {declared}, fetched {sha}")
            entry["sha256Verified"] = True
        entry["sha256"] = sha
        entry["bytes"] = len(body)
        entry["width"], entry["height"] = dims
        entry["fetched"] = True
        (corpus_dir / f"{stem}.png").write_bytes(body)
        fetched.append(stem)
        print(f"  200  {len(body):>9}  {stem}  {dims[0]}x{dims[1]}  {sha}")

    out["readBaseHost"] = urllib.parse.urlsplit(base).netloc
    out["fetchedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now()))
    out["fetchSummary"] = {
        "listed": len(stills),
        "fetched": len(fetched),
        "missing": len(missing),
        "missingStems": missing,
    }
    (corpus_dir / "corpus-manifest.json").write_text(json.dumps(out, indent=2) + "\n")
    print(f"FETCH: {len(fetched)} fetched, {len(missing)} missing (404), of {len(stills)} listed")
    return out


def selftest() -> int:
    """No network: a fake fetch that serves one PNG, one 404, and a wrong-hash case."""
    import tempfile

    png = (
        PNG_SIG
        + b"\x00\x00\x00\x0dIHDR"
        + struct.pack(">II", 4, 3)
        + b"\x08\x06\x00\x00\x00"
        + b"\x00" * 8
    )
    sha = hashlib.sha256(png).hexdigest()

    def fake(url):
        if url.endswith("/story/still/job-s-shot000.png"):
            return 200, png
        if url.endswith("/story/still/job-s-shot001.png"):
            return 404, b""
        raise AssertionError(f"unexpected url {url}")

    manifest = {
        "schema": SCHEMA,
        "readBase": "https://example.invalid",
        "stills": {"job-s-shot000": {"jobId": "job"}, "job-s-shot001": {"jobId": "job"}},
    }
    with tempfile.TemporaryDirectory() as d:
        out = fetch_all(manifest, Path(d) / "c", fetch=fake, now=lambda: 0)
        assert out["stills"]["job-s-shot000"]["sha256"] == sha, "hash recorded"
        assert out["stills"]["job-s-shot000"]["width"] == 4, "dims recorded"
        assert out["stills"]["job-s-shot001"]["fetched"] is False, "404 recorded as missing"
        assert out["fetchSummary"] == {
            "listed": 2,
            "fetched": 1,
            "missing": 1,
            "missingStems": ["job-s-shot001"],
        }
        assert (Path(d) / "c" / "job-s-shot000.png").read_bytes() == png
        written = json.loads((Path(d) / "c" / "corpus-manifest.json").read_text())
        assert written["fetchedAt"] == "1970-01-01T00:00:00Z"
    with tempfile.TemporaryDirectory() as d:
        m = json.loads(json.dumps(manifest))
        m["stills"]["job-s-shot000"]["sha256"] = sha
        out = fetch_all(m, Path(d) / "c", fetch=fake, now=lambda: 0)
        assert out["stills"]["job-s-shot000"]["sha256Verified"] is True
    with tempfile.TemporaryDirectory() as d:
        m = json.loads(json.dumps(manifest))
        m["stills"]["job-s-shot000"]["sha256"] = "0" * 64
        try:
            fetch_all(m, Path(d) / "c", fetch=fake, now=lambda: 0)
            raise AssertionError("mismatch must fail")
        except SystemExit as e:
            assert e.code == 1
    for bad in [
        "http://example.invalid",
        "https://example.invalid/?sig=x",
        "https://user@example.invalid",
        "https://example.invalid/bucket",
    ]:
        try:
            check_base(bad)
            raise AssertionError(f"{bad} must be refused")
        except SystemExit:
            pass
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "stray.png").write_bytes(png)
        try:
            fetch_all(manifest, Path(d), fetch=fake, now=lambda: 0)
            raise AssertionError("non-empty corpus dir must be refused")
        except SystemExit:
            pass
    print("SELFTEST: ok")
    return 0


def main(argv) -> int:
    if len(argv) == 2 and argv[1] == "--selftest":
        return selftest()
    if len(argv) != 3:
        print(__doc__)
        return 2
    manifest = json.loads(Path(argv[1]).read_text())
    fetch_all(manifest, Path(argv[2]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
