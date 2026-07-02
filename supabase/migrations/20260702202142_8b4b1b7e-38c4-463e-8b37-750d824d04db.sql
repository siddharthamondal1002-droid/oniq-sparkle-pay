CREATE POLICY "moments read authenticated" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'moments');
CREATE POLICY "moments upload own folder" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'moments' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "moments update own" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'moments' AND owner = auth.uid());
CREATE POLICY "moments delete own" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'moments' AND owner = auth.uid());