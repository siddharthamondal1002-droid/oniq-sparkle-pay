CREATE TABLE public.user_channels (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel_id text NOT NULL CHECK (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);

GRANT SELECT, INSERT, DELETE ON public.user_channels TO authenticated;
GRANT ALL ON public.user_channels TO service_role;

ALTER TABLE public.user_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own channels" ON public.user_channels
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users add own channels" ON public.user_channels
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users remove own channels" ON public.user_channels
  FOR DELETE TO authenticated USING (user_id = auth.uid());