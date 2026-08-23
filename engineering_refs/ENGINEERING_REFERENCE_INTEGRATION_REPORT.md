# ENGINEERING REFERENCE INTEGRATION REPORT (atlas loop, 2026-08-23)

SOURCE IMAGES: 2 attached this loop (bb8910bd atlas; b39160a7 re-send)
UNIQUE MASTERS: 1 new (ENG-004 705e1c37..., 1536x1024 PNG, decode OK)
DUPLICATES: 1 (b39160a7 byte-identical to ENG-003 -> recorded as ALIAS; master kept once)
SHA-256: all recorded in ENGINEERING_EVIDENCE_SHA256.txt; 11 previously
registered masters re-verified against manifests this session (0 mismatches)
CAMERA DETAILS: 5,000 (100 atlas panels x 5 subject scales x 10 camera
modes; overlap combinations flagged as identity combinations)
LIGHTING DETAILS: 5,000 (100 panels x 10 directions x 5 qualities)
CAMERA x LIGHTING COMBINATIONS: 10,000 (full 100x100 panel matrix)
SCENE DETAILS: 200 (derived slice of the 1000-library, domains 06+08)
MOTION DETAILS: 100 (domain 03 slice)
CHARACTER DETAILS: 200 (domains 01+02 slice)
EMOTION DETAILS: 36 (reference vocabulary; expression heads MEASURED)
ENGINEERING DETAILS (authored master set): 1,000 (ENG-0001..ENG-1000,
100x10 domains; MEASURED 563 / REFERENCE 398 / INFERRED 24 / OPEN 15;
ENFORCED 434 / REFERENCE_ONLY 421 / STRESS_TEST 107 / BLOCKED 32 /
CANDIDATE 6; invariant ENFORCED=>MEASURED holds, validated + test-pinned)
NEGATIVE REFERENCES: 12 catalogue classes indexed in the QA slice; real
failures only, never generation targets
QA REFERENCES: 100 (domain 10)
INTEGRATION STATUS: repo branch claude/video-generator-engineering carries
the registry (ENG-001..004), the 1000-detail library file + catalog, the
atlas metadata, and the deterministic retrieval layer
(retrieveReferenceShelves) — REFERENCE RETRIEVAL NEVER GENERATES; the
explicit-generation flow is unchanged and pinned.
TEST RESULTS: see final chat report (exact counts)
PRODUCTION CHANGES: 0 · GENERATION COUNT: 0 · API SPEND: ₹0 · GPU SPEND: ₹0
OPEN GAPS: AIRCRAFT scene category (standing LIBRARY_GAP); clothing-coverage
experiment BLOCKED on owner approval; TURN/REACH grammars UNKNOWN; 3/4+
camera lanes for character motion unvalidated; no color-temperature
calibration exists.
The 10,000-detail target is met as ENGINEERING DETAILS WITH TRACEABLE
VISUAL REFERENCES (5,000 camera + 5,000 lighting, every record pointing at
its ENG-004 panel + source hash). No claim is made that 10,000 unique
images exist.
