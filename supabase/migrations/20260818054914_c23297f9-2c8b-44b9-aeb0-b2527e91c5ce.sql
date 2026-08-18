drop policy if exists "moments update own" on storage.objects;
create policy "moments update own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'moments'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = (auth.uid())::text
  )
  with check (
    bucket_id = 'moments'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = (auth.uid())::text
    and lower(coalesce(storage.extension(name), '')) = any (array['jpg','jpeg','png','webp','gif'])
  );

revoke select (is_admin, oniq_pay_enabled) on public.profiles from anon, authenticated;
revoke update (is_admin, oniq_pay_enabled) on public.profiles from anon, authenticated;