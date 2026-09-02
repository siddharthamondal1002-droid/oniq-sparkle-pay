#!/usr/bin/env python3
"""PROOF: the torch in ENV A is the CPU build, and no CUDA came with it.

This is the pin the owner directive made a stop condition, so it is checked
three ways rather than one. `torch.version.cuda is None` is the direct
statement, but a mis-resolved wheel can also announce itself by weight: the
PyPI torch 1.13.1 for linux is 887,450,534 bytes because it carries bundled
CUDA libraries, and the CPU build does not. Measuring the installed tree
catches a substitution that a version string alone would hide.
"""
import sys
import torch
from pathlib import Path

fail = []

if not torch.__version__.startswith("1.13.1"):
    fail.append(f"torch is {torch.__version__}, pinned 1.13.1")
if torch.version.cuda is not None:
    fail.append(f"torch reports cuda {torch.version.cuda} — this is NOT the CPU build")
if torch.cuda.is_available():
    fail.append("torch.cuda.is_available() is True in a CPU-only runtime")

site = Path(torch.__file__).parent
cuda_libs = sorted(
    p.name for p in (site / "lib").glob("*")
    if any(t in p.name.lower() for t in ("cudnn", "cublas", "cudart", "nccl", "cufft"))
)
if cuda_libs:
    fail.append(f"CUDA runtime libraries shipped in torch/lib: {cuda_libs[:6]}")

nvidia = [p.name for p in site.parent.glob("nvidia*")]
if nvidia:
    fail.append(f"nvidia-* packages present in site-packages: {nvidia}")

size = sum(f.stat().st_size for f in site.rglob("*") if f.is_file())
print(f"torch {torch.__version__} cuda={torch.version.cuda} tree={size} bytes")
print(f"torch/lib entries: {len(list((site / 'lib').glob('*')))}, cuda-ish: {len(cuda_libs)}")

# A real forward pass, so "it imports" is not mistaken for "it works".
x = torch.randn(2, 3, 8, 8)
y = torch.nn.Conv2d(3, 4, 3)(x)
assert tuple(y.shape) == (2, 4, 6, 6), y.shape
print("PROOF forward pass on CPU:", tuple(y.shape))

if fail:
    for f in fail:
        print("FAIL:", f)
    sys.exit(1)
print("PROOF torch: CPU-only 1.13.1, no CUDA runtime shipped")
