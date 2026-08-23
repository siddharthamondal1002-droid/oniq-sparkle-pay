Determinism is per-host: after container recreation (2026-08-23 05:28 UTC)
the 3 frozen fixtures re-render byte-identically within the new host
(pair-tested) but differ from the frozen hashes by 2-26 px/frame FP noise.
Inputs/rigs/configs/libs verified byte-identical; cause = CPU SIMD kernel
dispatch (host: Intel Xeon AVX-512). Decoded pixels reviewed: same walk.
Frozen hashes NOT re-baselined. Per-host hash pairs (old -> this host):
aladdin_hand c56f9565d8472d7d -> a60f80b7bcb14a27
aladdin_auto 6ad08124ff881cd7 -> 757228fd73075d43
morgiana     99d1d34f2aa5a8b7 -> 894d29b159124145
