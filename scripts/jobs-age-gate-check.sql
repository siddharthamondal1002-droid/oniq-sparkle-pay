-- ONIQ — career/jobs age-gate guard (Phase 3a).
--
-- Every table in `public` whose name looks like a career/jobs surface MUST have
-- RLS enabled AND at least one RESTRICTIVE policy whose qualifier references
-- `is_adult_18`. This is the durable protection against a FUTURE Jobs table
-- shipping without the 18+ data gate.
--
-- PASS = zero rows returned. Run read-only against production.
-- The same assertion runs in CI via src/data/__tests__/jobsAgeGate.test.ts
-- whenever database credentials (PGHOST…) are present.

WITH matched AS (
  SELECT c.oid, c.relname, c.relrowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND (
      c.relname LIKE 'cv\_%'
      OR c.relname LIKE 'job\_%'
      OR c.relname LIKE '%\_jobs'
      OR c.relname LIKE 'career\_%'
      OR c.relname LIKE '%alert\_subscription%'
      OR c.relname LIKE 'saved\_job%'
    )
)
SELECT 'MISSING_ADULT_GATE' AS violation, m.relname AS table_name,
       'Add: ALTER TABLE public.' || m.relname || ' ENABLE ROW LEVEL SECURITY; '
       || 'CREATE POLICY "' || m.relname || ' adults only" ON public.' || m.relname
       || ' AS RESTRICTIVE FOR ALL TO authenticated '
       || 'USING (public.is_adult_18(auth.uid())) WITH CHECK (public.is_adult_18(auth.uid()));'
       AS remedy
FROM matched m
WHERE NOT m.relrowsecurity
   OR NOT EXISTS (
     SELECT 1 FROM pg_policy p
     WHERE p.polrelid = m.oid
       AND p.polpermissive = false
       AND (
         coalesce(pg_get_expr(p.polqual, p.polrelid), '') ILIKE '%is_adult_18%'
         OR coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ILIKE '%is_adult_18%'
       )
   )
ORDER BY m.relname;
