-- ONIQ HEALTH — a per-person daily cap for `describe_document`.
--
-- OWNER DIRECTIVE, 2026-09-10, asked what ONIQ should do with a radiology
-- report: "Show it, don't store it." That adds a sixth AI task, and
-- `capForTask` reads a cap PER TASK: a task with no key in `ai_daily_caps`
-- gets 0, and 0 is `caps_unset` — a 503 for everyone, always. So the task
-- cannot run at all until this row carries a number.
--
-- THE NUMBER IS INFERRED FROM B11, NOT PICKED. The owner's 2026-09-08 table
-- set "document extraction 10 documents", and classify_document and
-- extract_document both carry 10 because they are two calls of ONE operation:
-- reading a document the person uploaded. Describing that same document is the
-- same act on the same file, so it takes the same ceiling. It is stated as an
-- inference rather than an owner decision, and changing it is one audited
-- UPDATE from /app/admin/health-ai -> Daily caps (the trigger on this table
-- appends a config.changed row whichever path makes the change).
--
-- WHY A NEW MIGRATION RATHER THAN AN EDIT TO PHASE 2. `20260908150000` is
-- APPLIED, and `appliedCopies.test.ts` asserts our copy equals Lovable's
-- applied copy statement for statement. Editing it would put the repo at odds
-- with production and with its own tests.

-- 1. New rows get every task's cap.
alter table public.health_config
  alter column ai_daily_caps set default
  '{"answer_question": 10, "explain_record": 5, "summarize_timeline": 3, "classify_document": 10, "extract_document": 10, "describe_document": 10}'::jsonb;

-- 2. The existing row keeps every value it already has. The `?` guard makes a
--    re-run a no-op AND, more importantly, means this can never overwrite a
--    number the owner has since set from the admin screen.
update public.health_config
   set ai_daily_caps = ai_daily_caps || '{"describe_document": 10}'::jsonb
 where id
   and not (ai_daily_caps ? 'describe_document');

-- 3. THE RECEIPT'S TASK LIST IS A CLOSED CHECK, AND A RECEIPT IS WRITTEN
--    BEFORE THE PROVIDER RUNS. So without this the sixth task does not
--    degrade — every request fails at `health_ai_reserve_request` with a
--    constraint violation, after the gate and before anything is read. Widened
--    the way Phase 3 widened the provider list: drop the named constraint and
--    add it back, so the file is idempotent and the constraint keeps its name.
alter table public.health_ai_requests
  drop constraint if exists health_ai_requests_task_check;
alter table public.health_ai_requests
  add constraint health_ai_requests_task_check
  check (task in (
    'explain_record','summarize_timeline','answer_question',
    'classify_document','extract_document','describe_document'));

-- 4. The refusal vocabulary gains `document_rejected` (a describe whose
--    document text reads as an instruction). Same closed-check treatment: the
--    stored refusal reason may only ever be one of the known names.
alter table public.health_ai_requests
  drop constraint if exists health_ai_requests_refusal_reason_check;
alter table public.health_ai_requests
  add constraint health_ai_requests_refusal_reason_check
  check (refusal_reason is null or refusal_reason in (
    'ai_disabled','task_not_allowed','provider_not_allowed','model_not_allowed',
    'unpriced_model','caps_unset','region_blocked','age_unverified','minor_blocked',
    'synthetic_in_production','ai_consent_required','consent_required',
    'question_rejected','not_found','no_text','document_rejected','text_too_long',
    'quota_user','quota_house','output_rejected','provider_error'));

comment on column public.health_config.ai_daily_caps is
  'Per-person, per-day request ceilings keyed by AI task (owner directive B11, 2026-09-08; describe_document added 2026-09-10 by inference from the document-extraction row). A task with no key here, or a value that is not a positive number, is 0 — and 0 means unavailable, never unlimited. Changeable by UPDATE; every change is audited by health_config_audit_ai_controls.';
