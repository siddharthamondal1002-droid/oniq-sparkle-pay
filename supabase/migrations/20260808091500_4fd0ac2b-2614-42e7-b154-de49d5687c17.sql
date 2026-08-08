create policy "video_gen_admin_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'video-gen' and public.is_admin(auth.uid()));