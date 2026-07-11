
-- User-defined genres and channels for the Watch (my tv) experience.
-- Named user_watch_* to avoid clashing with the existing user_channels
-- table (which is UC-YouTube-channel-only and drives the my-tv edge fn).

CREATE TABLE public.user_watch_genres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_watch_genres_user_pos_idx ON public.user_watch_genres (user_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_watch_genres TO authenticated;
GRANT ALL ON public.user_watch_genres TO service_role;

ALTER TABLE public.user_watch_genres ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own watch genres" ON public.user_watch_genres
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users add own watch genres" ON public.user_watch_genres
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own watch genres" ON public.user_watch_genres
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own watch genres" ON public.user_watch_genres
  FOR DELETE TO authenticated USING (user_id = auth.uid());


CREATE TABLE public.user_watch_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  genre_id uuid NOT NULL REFERENCES public.user_watch_genres(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  youtube_url text NOT NULL CHECK (length(youtube_url) BETWEEN 8 AND 500),
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_watch_channels_user_genre_pos_idx
  ON public.user_watch_channels (user_id, genre_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_watch_channels TO authenticated;
GRANT ALL ON public.user_watch_channels TO service_role;

ALTER TABLE public.user_watch_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own watch channels" ON public.user_watch_channels
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users add own watch channels" ON public.user_watch_channels
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own watch channels" ON public.user_watch_channels
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own watch channels" ON public.user_watch_channels
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- updated_at auto-bumper
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER user_watch_genres_touch BEFORE UPDATE ON public.user_watch_genres
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER user_watch_channels_touch BEFORE UPDATE ON public.user_watch_channels
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
