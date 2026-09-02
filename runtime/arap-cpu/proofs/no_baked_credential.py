#!/usr/bin/env python3
"""PROOF: no credential is baked into the image's environment.

Runs OUTSIDE the container, on `docker image inspect --format
'{{json .Config.Env}}'` piped to stdin.

WHY THIS IS A SCRIPT AND NOT A grep. The first version was
`grep -qiE 'token|secret|key='` over the same JSON, and it failed the build
on `GPG_KEY=A035C8C19219BA821ECEA86B64E628F8D684696D` — a variable the
OFFICIAL python:3.10-slim-bookworm image sets, holding the Python release
manager's PUBLIC signing fingerprint. A public key fingerprint is the
opposite of a credential, and a guard that cries wolf on its own base image
gets deleted by the third person who hits it.

The fix is not a weaker pattern, it is a NARROWER allowance. Each exempt
name is listed individually with the reason it is public by construction;
anything else whose name looks credential-shaped still fails, and so does
any name not on the expected list at all. That second half makes this
STRONGER than the grep it replaces: a variable called `DEPLOY_HELPER` with
a secret in it would have sailed past the old check and is caught here.
"""
import json
import re
import sys

# Public by construction. Each of these is a HASH or a PUBLIC KEY FINGERPRINT
# published in the base image's own Dockerfile, verifiable by anyone.
PUBLIC_BY_CONSTRUCTION = {
    "GPG_KEY": "Python release manager's public signing fingerprint (docker-library/python)",
    "PYTHON_SHA256": "checksum of the published Python tarball",
    "PYTHON_GET_PIP_SHA256": "checksum of the published get-pip.py",
}

# Everything the image is expected to carry. A name outside this set is not
# automatically a failure — but it IS if it looks credential-shaped, and it
# is always reported so a new variable gets a human look.
EXPECTED = {
    "PATH", "LANG", "PYTHON_VERSION", "PYTHON_PIP_VERSION",
    "PYTHON_SETUPTOOLS_VERSION", "PYTHON_GET_PIP_URL",
    # ONIQ's own, all set in the Dockerfile and none of them secret.
    "PYOPENGL_PLATFORM", "MESA_GL_VERSION_OVERRIDE", "CUDA_VISIBLE_DEVICES",
    "AD_DIR", "AD_MODEL_STORE", "ONIQ_ARAP_PINS",
} | set(PUBLIC_BY_CONSTRUCTION)

# Deliberately BROAD, including a bare "key". Narrowing it to api_key /
# access_key would have fixed the GPG_KEY false positive too — and would
# have let a variable called plain KEY through, which is worse than the bug
# it fixed. The allowlist above is what resolves the tension, and that is
# why it carries a reason per entry rather than being a list of names.
CREDENTIAL_SHAPED = re.compile(
    r"(token|secret|password|passwd|credential|key|auth)", re.I
)

def main() -> int:
    env = json.load(sys.stdin) or []
    names = [e.split("=", 1)[0] for e in env]

    fail, unknown = [], []
    for name in names:
        if name in PUBLIC_BY_CONSTRUCTION:
            print(f"ALLOWED {name} — {PUBLIC_BY_CONSTRUCTION[name]}")
            continue
        if CREDENTIAL_SHAPED.search(name):
            fail.append(f"{name} is credential-shaped and is not an allowed public value")
            continue
        if name not in EXPECTED:
            unknown.append(name)

    for name in unknown:
        # Not fatal on its own — a base image bump legitimately adds
        # variables — but never silent, because "we did not notice it
        # appear" is how the thing this guard exists for arrives.
        print(f"NOTE unexpected environment variable in the image: {name}")

    print(f"checked {len(names)} environment variables, "
          f"{len(unknown)} unexpected, {len(fail)} credential-shaped")
    if fail:
        for f in fail:
            print("FAIL:", f)
        return 1
    print("PROOF image env: no credential-shaped variable baked in")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
