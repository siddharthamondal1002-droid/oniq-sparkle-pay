
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text','image','voice','video','file','system','call'));

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_size bigint;

DROP POLICY IF EXISTS "chat-media insert own folder" ON storage.objects;
CREATE POLICY "chat-media insert own folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND lower(regexp_replace(name, '^.*\.', '')) IN (
      'jpg','jpeg','png','webp','gif',
      'webm','m4a','mp3','ogg','wav',
      'mp4','mov','mkv',
      'pdf','doc','docx','xls','xlsx','ppt','pptx','txt','csv','json',
      'zip','rar'
    )
  );
