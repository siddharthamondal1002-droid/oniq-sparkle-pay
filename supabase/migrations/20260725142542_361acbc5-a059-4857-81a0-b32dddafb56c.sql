
CREATE TABLE IF NOT EXISTS public.call_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  peer_name text,
  remind_at timestamptz NOT NULL,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_reminders TO authenticated;
GRANT ALL ON public.call_reminders TO service_role;
ALTER TABLE public.call_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "call_reminders_own_all" ON public.call_reminders FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS call_reminders_due_idx
  ON public.call_reminders (user_id, remind_at) WHERE dismissed_at IS NULL;
