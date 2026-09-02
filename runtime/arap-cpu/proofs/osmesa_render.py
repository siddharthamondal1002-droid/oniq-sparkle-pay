#!/usr/bin/env python3
"""PROOF: headless GL works — a real OSMesa context, at the version AD needs.

Run in ENV B. This is the single most environment-sensitive thing in the
image: OSMesa is a system library, PyOpenGL finds it by dlopen, and the
failure mode when it is missing is not an ImportError but a context that
silently produces black frames. So this makes a context, draws, and reads
the pixels back.
"""
import os
import sys

os.environ.setdefault("PYOPENGL_PLATFORM", "osmesa")
os.environ.setdefault("MESA_GL_VERSION_OVERRIDE", "3.3")

import ctypes  # noqa: E402

import numpy as np  # noqa: E402
from OpenGL import GL  # noqa: E402
from OpenGL.osmesa import (  # noqa: E402
    OSMesaCreateContextAttribs, OSMesaMakeCurrent,
    OSMESA_FORMAT, OSMESA_RGBA, OSMESA_DEPTH_BITS, OSMESA_PROFILE,
    OSMESA_CORE_PROFILE, OSMESA_CONTEXT_MAJOR_VERSION,
    OSMESA_CONTEXT_MINOR_VERSION,
)

W = H = 64
# PyOpenGL exposes these as IntConstant objects, not plain ints, and a
# ctypes array will not take them directly (IndexError: invalid index).
# int() is not tidying — without it this proof cannot build its attribute
# list at all.
attrs = (ctypes.c_int * 13)(*[int(v) for v in (
    OSMESA_FORMAT, OSMESA_RGBA,
    OSMESA_DEPTH_BITS, 24,
    OSMESA_PROFILE, OSMESA_CORE_PROFILE,
    OSMESA_CONTEXT_MAJOR_VERSION, 3,
    OSMESA_CONTEXT_MINOR_VERSION, 3,
    0, 0, 0,
)])
ctx = OSMesaCreateContextAttribs(attrs, None)
if not ctx:
    print("FAIL: OSMesaCreateContextAttribs returned NULL — no OSMesa library?")
    sys.exit(1)

buf = np.zeros((H, W, 4), dtype=np.uint8)
if not OSMesaMakeCurrent(ctx, buf, GL.GL_UNSIGNED_BYTE, W, H):
    print("FAIL: OSMesaMakeCurrent failed")
    sys.exit(1)

ver = GL.glGetString(GL.GL_VERSION).decode()
ren = GL.glGetString(GL.GL_RENDERER).decode()
print("GL_VERSION ", ver)
print("GL_RENDERER", ren)

GL.glClearColor(0.2, 0.6, 0.9, 1.0)
GL.glClear(GL.GL_COLOR_BUFFER_BIT | GL.GL_DEPTH_BUFFER_BIT)
GL.glFinish()

px = np.frombuffer(buf, dtype=np.uint8).reshape(H, W, 4)
got = tuple(int(v) for v in px[H // 2, W // 2, :3])
want = (51, 153, 229)
if max(abs(a - b) for a, b in zip(got, want)) > 3:
    print(f"FAIL: cleared pixel is {got}, expected about {want} — the context "
          "made no pixels, which is how a missing OSMesa presents")
    sys.exit(1)

major = int(ver.split()[0].split(".")[0])
minor = int(ver.split()[0].split(".")[1])
if (major, minor) < (3, 3):
    print(f"FAIL: GL {major}.{minor} — Animated Drawings needs 3.3")
    sys.exit(1)

print(f"PROOF OSMesa: GL {major}.{minor} context, real pixels {got}")
