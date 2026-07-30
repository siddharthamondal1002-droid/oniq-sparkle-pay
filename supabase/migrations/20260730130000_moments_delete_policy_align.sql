-- P2: the moments bucket DELETE policy keyed on owner = auth.uid() while
-- INSERT keys on the folder path — align DELETE to the same folder check so
-- every object a user uploaded into their folder is deletable by them
-- (verified: zero null-owner objects exist in the bucket today).
DROP POLICY IF EXISTS "moments delete own" ON storage.objects;
CREATE POLICY "moments delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'moments'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );
