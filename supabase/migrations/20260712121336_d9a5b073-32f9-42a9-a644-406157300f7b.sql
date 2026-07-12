CREATE TABLE public.message_hides (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);
CREATE INDEX message_hides_user_conv_idx ON public.message_hides (user_id, conversation_id);
GRANT SELECT, INSERT, DELETE ON public.message_hides TO authenticated;
GRANT ALL ON public.message_hides TO service_role;
ALTER TABLE public.message_hides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own hides read" ON public.message_hides FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own hides insert" ON public.message_hides FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own hides delete" ON public.message_hides FOR DELETE TO authenticated USING (auth.uid() = user_id);