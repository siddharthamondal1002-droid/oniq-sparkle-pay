DROP POLICY IF EXISTS "chat-media select member or owner" ON storage.objects;

CREATE POLICY "chat-media select member or owner"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'chat-media'
  AND (
    (storage.foldername(name))[1] = (auth.uid())::text
    OR EXISTS (
      SELECT 1
      FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
      WHERE cm.user_id = auth.uid()
        AND (
          m.media_url = objects.name
          OR split_part(split_part(m.media_url, '/chat-media/', 2), '?', 1) = objects.name
        )
    )
  )
);