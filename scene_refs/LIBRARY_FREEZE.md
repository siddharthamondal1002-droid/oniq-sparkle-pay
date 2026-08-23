# ONIQ_SCENE_REFERENCE_LIBRARY — FREEZE RECORD

- Library version: **1.0**
- Frozen: **2026-08-23** (UTC; exact timestamp in the manifest)
- Mode: LIBRARY INGESTION ONLY — **zero images generated** (no internal,
  external, API, or synthetic generation; no recreations; no derivatives
  manufactured as references)
- Source images: **10** (user-attached)
- Valid (decode + integrity): **10** — no HOLD, no CORRUPT, no UNREADABLE
- Exact duplicates: **4** (SCN-003/004/005 byte-identical to registered
  character-program references; SCN-008 byte-identical to SCN-003)
- Near-duplicates (non-exact, perceptual flag only): **0**
- Unique new masters: **6** (SCN-001, 002, 006, 007, 009, 010)
- Distinct masters stored under `masters/`: **9** (one per distinct SHA-256;
  aliases recorded, never a second copy)
- Taxonomy categories covered: **69 / 70** — LIBRARY_GAP: 16 AIRCRAFT
  (recorded, not filled by generation, per §28)
- 5:4 native sources: **0** (SCN-007 is 1402×1122 = 1.2496, within 0.04%
  of 5:4 but not exact; recorded, never cropped)
- SHA-256 manifest: `evidence/EVIDENCE_SHA256.txt` (measured, this host)
- Machine manifest: `manifests/SCENE_LIBRARY_MANIFEST.json` — every record
  carries `"generation_allowed": false`
- Human index: `indexes/SCENE_REFERENCE_INDEX.md`
- Originals: preserved byte-for-byte; every stored master re-hashed after
  copy and verified equal to its source hash. No resize, recompress,
  re-encode, crop, or retouch was performed.
- Determinism honesty: hashes are file-content hashes (host-independent);
  no pixel-render determinism is claimed by this record.

Structure note: the loop's §26 suggested layout is realized as
`masters/ · indexes/ · manifests/ · evidence/`; the per-dimension category,
engineering, cinematography, environment, lighting, weather, motion, story,
negative and QA indexes are consolidated inside
`indexes/SCENE_REFERENCE_INDEX.md` rather than as empty directories, so
every path in the library is populated and traceable.

Storage policy (§32): per the standing ONIQ library policy, reference media
lives on the `val-charlib` evidence branch — production `main`, the motion
driver, ARAP, L3R, Veo, PR #83, frozen motion fixtures and production
configuration are untouched by this registration. No weights committed.

This tranche is CLOSED. Any future addition to the scene library is a new
owner-commissioned tranche and a new library version; this record and the
v1.0 manifest are append-only history.
