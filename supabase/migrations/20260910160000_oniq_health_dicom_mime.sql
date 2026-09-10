-- ONIQ HEALTH — accept a DICOM as a document. Owner directive 2026-09-10,
-- "B and C"; this is B, and B stores and renders a scan without interpreting it.
--
-- ONE CHECK, WIDENED BY ONE VALUE. `health_documents.mime` is a closed list —
-- it was created that way on purpose, so a mime nothing in ONIQ can read cannot
-- be registered — and `src/health/__tests__/migration.test.ts` compares that
-- list against `DOCUMENT_MIMES` in domain.ts. Adding the mime to the TypeScript
-- constant without this migration would let `documents.register` write a row
-- the database refuses, which surfaces to a person as "something went wrong"
-- after their file has already been picked.
--
-- DROP AND ADD AS ADJACENT STATEMENTS, and read between them (CLAUDE.md,
-- 2026-09-10): the drop landing while the add has not leaves the table with NO
-- mime check at all, which is a worse state than either end.
--
-- THE SIZE CAP IS NOT TOUCHED. 10 MiB still holds: a single JPEG-encapsulated
-- radiograph is comfortably inside it and an uncompressed 2048x2048 16-bit one
-- is 8 MB. A whole CT SERIES is not, and is not meant to be — ONIQ takes one
-- instance, not a study, and `dicom.ts` refuses what it cannot read BY NAME so
-- the person is told which format rather than "unsupported".
--
-- THE IN-LIST IS ON ONE LINE ON PURPOSE: `migration.test.ts` finds it by the
-- literal `check (mime in (`, so a line break inside that phrase hides the
-- constraint from the guard whose whole job is to compare it with domain.ts.

alter table public.health_documents
  drop constraint if exists health_documents_mime_check;

alter table public.health_documents
  add constraint health_documents_mime_check
  check (mime in ('application/pdf','image/jpeg','image/png','image/webp','application/dicom'));
