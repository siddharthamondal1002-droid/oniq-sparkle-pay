
-- Add duration_s and constrain type
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS duration_s int;
ALTER TABLE public.messages ALTER COLUMN type SET DEFAULT 'text';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_type_check'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_type_check
      CHECK (type IN ('text','image','voice','system','call'));
  END IF;
END$$;

-- Storage policies on chat-media bucket
DROP POLICY IF EXISTS "chat-media insert own folder" ON storage.objects;
CREATE POLICY "chat-media insert own folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND lower(regexp_replace(name, '^.*\.', '')) IN ('jpg','jpeg','png','webp','gif','webm','m4a','mp3','ogg','mp4')
  );

DROP POLICY IF EXISTS "chat-media select authenticated" ON storage.objects;
CREATE POLICY "chat-media select authenticated" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'chat-media');

DROP POLICY IF EXISTS "chat-media delete own folder" ON storage.objects;
CREATE POLICY "chat-media delete own folder" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'chat-media' AND (storage.foldername(name))[1] = auth.uid()::text);
