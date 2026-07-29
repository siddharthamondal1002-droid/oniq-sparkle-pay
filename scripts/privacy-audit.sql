-- ONIQ privacy audit — run read-only against production.
-- PASS = all three queries return zero rows.

-- 1) Tables in public without RLS enabled
SELECT 'RLS_DISABLED' AS violation, tablename
FROM pg_tables
WHERE schemaname = 'public' AND NOT rowsecurity
ORDER BY tablename;

-- 2) Permissive USING (true) policies on write commands, or on reads of
--    user-content tables (messages, media, contacts, health, calls).
SELECT 'PERMISSIVE_POLICY' AS violation, tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual = 'true' OR with_check = 'true')
  AND (
    cmd IN ('INSERT','UPDATE','DELETE','ALL')
    OR tablename IN (
      'messages','conversations','conversation_members','moments_posts',
      'moments_comments','clips','clips_comments','contacts','vitals',
      'health_entries','call_logs','learner_profiles','study_papers',
      'friendships','profiles'
    )
  )
ORDER BY tablename, policyname;

-- 3) Public storage buckets
SELECT 'PUBLIC_BUCKET' AS violation, id
FROM storage.buckets
WHERE public
ORDER BY id;
