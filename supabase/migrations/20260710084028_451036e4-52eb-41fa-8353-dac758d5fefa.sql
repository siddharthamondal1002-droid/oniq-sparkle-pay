DROP POLICY IF EXISTS "chat-media select authenticated" ON storage.objects;

CREATE POLICY "chat-media select member or owner"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-media'
  AND (
    (storage.foldername(name))[1] = (auth.uid())::text
    OR EXISTS (
      SELECT 1 FROM public.messages m
      JOIN public.conversation_members cm
        ON cm.conversation_id = m.conversation_id
      WHERE cm.user_id = auth.uid()
        AND m.media_url LIKE '%/chat-media/' || storage.objects.name || '%'
    )
  )
);