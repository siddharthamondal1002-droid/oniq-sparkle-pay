-- Study assessment engine — Evidence-Centred Design schema.
--
-- Additive only. Nothing below alters or drops an existing object.
--
-- WHY THREE LINKED MODELS AND NOT A QUESTIONS TABLE
--
-- Today every Study question is produced by a free LLM call at request time
-- (study-paper-generate calls Claude three times and returns whatever comes
-- back). There is no template, no key verification, and no record of how any
-- question came to exist. A wrong key reaches a fourteen-year-old with nothing
-- in the way.
--
-- These tables make the safe path the structural default:
--
--   competency  — what is being assessed. Bloom AND Webb's DOK, because they
--                 measure different things: Bloom is the cognitive process,
--                 DOK is how many mental steps the task actually demands. An
--                 item can be "Analyse" on Bloom and DOK 1 if the analysis is
--                 recall of a taught analysis.
--   task_model  — how evidence is elicited. The template, its typed slots, and
--                 crucially key_derivation: how the answer is COMPUTED rather
--                 than asserted. This is what makes a key checkable.
--   item        — one generated instance, carrying provenance, a similarity
--                 score, and a status that starts at draft.
--   response    — one student's answer. RLS-scoped to that student and nobody
--                 else, because Study's users are overwhelmingly minors.
--
-- REVERSIBLE
--
--   DROP TABLE public.assessment_response;
--   DROP TABLE public.assessment_item;
--   DROP TABLE public.assessment_task_model;
--   DROP TABLE public.assessment_competency;
--   DROP TYPE public.assessment_item_status;
--
-- Dropped in that order — children first — because of the FK chain.

-- ---------------------------------------------------------------------------
-- Status is an enum rather than free text: "quarantined" is a safety state and
-- a typo that silently became "quarantine" would publish a held item.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.assessment_item_status AS ENUM
    ('draft', 'quarantined', 'approved', 'retired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- competency — what is being assessed
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_competency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board text NOT NULL,
  class_level text NOT NULL,
  subject text NOT NULL,
  chapter text,
  statement text NOT NULL,
  -- Bloom's revised taxonomy, lowercase.
  bloom_level text NOT NULL CHECK (bloom_level IN
    ('remember', 'understand', 'apply', 'analyse', 'evaluate', 'create')),
  -- Webb's Depth of Knowledge, 1–4.
  dok_level smallint NOT NULL CHECK (dok_level BETWEEN 1 AND 4),
  command_word text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- task_model — how evidence is elicited
--
-- key_derivation is NOT NULL on purpose. A task model that cannot say how its
-- answer is computed cannot have its key verified, and an unverifiable key is
-- the failure mode this whole schema exists to prevent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_task_model (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competency_id uuid NOT NULL
    REFERENCES public.assessment_competency(id) ON DELETE CASCADE,
  format text NOT NULL CHECK (format IN
    ('mcq', 'assertion_reason', 'case_study', 'short', 'long', 'numeric')),
  stem_template text NOT NULL,
  -- Typed, manipulable elements the template instantiates.
  slots jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- How the correct answer is computed from the slots. By construction, never
  -- by asking a model what the answer is.
  key_derivation text NOT NULL,
  -- Misconception-based, never filler. Each rule names the misconception it
  -- embodies so feedback can name it back to the student.
  distractor_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  marks smallint NOT NULL CHECK (marks > 0),
  difficulty_target numeric(3, 2) CHECK (difficulty_target BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assessment_task_model_competency_idx
  ON public.assessment_task_model(competency_id);

-- ---------------------------------------------------------------------------
-- item — a generated instance
--
-- status defaults to 'draft'. Nothing is publishable by accident: reaching
-- 'approved' requires either two agreeing derivations or a human, and that
-- transition is enforced by the trigger below rather than by convention.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_model_id uuid NOT NULL
    REFERENCES public.assessment_task_model(id) ON DELETE CASCADE,
  stem text NOT NULL,
  options jsonb,
  key text NOT NULL,
  -- 'derivation' = two independent derivations agreed. 'human' = a person
  -- approved it. NULL = neither has happened yet.
  key_verified_by text CHECK (key_verified_by IN ('derivation', 'human')),
  verified_at timestamptz,
  verified_by_user uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- model, template id, timestamp, prompt hash.
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Anti-memorisation. 0 = nothing like known text, 1 = verbatim match.
  similarity_score numeric(4, 3) CHECK (similarity_score BETWEEN 0 AND 1),
  similarity_matched_against text,
  status public.assessment_item_status NOT NULL DEFAULT 'draft',
  quarantine_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assessment_item_task_model_idx
  ON public.assessment_item(task_model_id);
CREATE INDEX IF NOT EXISTS assessment_item_status_idx
  ON public.assessment_item(status);

-- An item may only be 'approved' if its key was actually verified. Rule 4 says
-- no item reaches a student without key verification; a CHECK constraint is
-- the only place that cannot be forgotten by a caller.
ALTER TABLE public.assessment_item
  DROP CONSTRAINT IF EXISTS assessment_item_approved_needs_verification;
ALTER TABLE public.assessment_item
  ADD CONSTRAINT assessment_item_approved_needs_verification
  CHECK (
    status <> 'approved'
    OR (key_verified_by IS NOT NULL AND verified_at IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- response — one student's answer, for later item analysis
--
-- This is the table that must never become profiling. It is scoped to the
-- student by RLS and carries no cohort, class, school or comparison column —
-- there is deliberately nothing here to rank a minor against anyone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_response (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL
    REFERENCES public.assessment_item(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answer text,
  correct boolean,
  -- Optional self-rated confidence, for surfacing confidently-wrong knowledge.
  confidence smallint CHECK (confidence BETWEEN 1 AND 5),
  answered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assessment_response_user_idx
  ON public.assessment_response(user_id);
CREATE INDEX IF NOT EXISTS assessment_response_item_idx
  ON public.assessment_response(item_id);

-- ---------------------------------------------------------------------------
-- Grants and RLS
--
-- The three content tables are authored by the pipeline, not by students:
-- authenticated may read, only service_role may write. The response table is
-- the student's own and follows the owner pattern used elsewhere.
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.assessment_competency TO authenticated;
GRANT SELECT ON public.assessment_task_model TO authenticated;
GRANT SELECT ON public.assessment_item TO authenticated;
GRANT SELECT, INSERT ON public.assessment_response TO authenticated;
GRANT ALL ON public.assessment_competency TO service_role;
GRANT ALL ON public.assessment_task_model TO service_role;
GRANT ALL ON public.assessment_item TO service_role;
GRANT ALL ON public.assessment_response TO service_role;

ALTER TABLE public.assessment_competency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_task_model ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_response ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "competency readable" ON public.assessment_competency;
CREATE POLICY "competency readable" ON public.assessment_competency
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "task model readable" ON public.assessment_task_model;
CREATE POLICY "task model readable" ON public.assessment_task_model
  FOR SELECT TO authenticated USING (true);

-- Only approved items are readable. A quarantined or draft item is invisible
-- to the client, so a failed key check cannot leak into a paper through a
-- forgotten filter in application code.
DROP POLICY IF EXISTS "only approved items readable" ON public.assessment_item;
CREATE POLICY "only approved items readable" ON public.assessment_item
  FOR SELECT TO authenticated USING (status = 'approved');

DROP POLICY IF EXISTS "response owner select" ON public.assessment_response;
CREATE POLICY "response owner select" ON public.assessment_response
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "response owner insert" ON public.assessment_response;
CREATE POLICY "response owner insert" ON public.assessment_response
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- A RESTRICTIVE policy on top: even if a permissive policy is ever widened by
-- mistake, no authenticated caller can read another student's responses. The
-- same belt-and-braces shape used for the 18+ gate, and for the same reason —
-- this is minors' data.
DROP POLICY IF EXISTS "response never leaves its owner" ON public.assessment_response;
CREATE POLICY "response never leaves its owner" ON public.assessment_response
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
