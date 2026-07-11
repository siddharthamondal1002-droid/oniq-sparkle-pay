
-- 1) health_profiles
CREATE TABLE public.health_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  experience text NOT NULL CHECK (experience IN ('men','women')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_profiles TO authenticated;
GRANT ALL ON public.health_profiles TO service_role;
ALTER TABLE public.health_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own health profile" ON public.health_profiles
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER health_profiles_touch BEFORE UPDATE ON public.health_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 2) health_checkins
CREATE TABLE public.health_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT current_date,
  sleep_hrs numeric,
  mood int CHECK (mood BETWEEN 1 AND 5),
  energy int CHECK (energy BETWEEN 1 AND 5),
  exercised boolean,
  water_glasses int,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_checkins TO authenticated;
GRANT ALL ON public.health_checkins TO service_role;
ALTER TABLE public.health_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own checkins" ON public.health_checkins
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX health_checkins_user_day_idx ON public.health_checkins(user_id, day DESC);

-- 3) cycle_logs
CREATE TABLE public.cycle_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date,
  symptoms text[],
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cycle_logs TO authenticated;
GRANT ALL ON public.cycle_logs TO service_role;
ALTER TABLE public.cycle_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cycles" ON public.cycle_logs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX cycle_logs_user_start_idx ON public.cycle_logs(user_id, period_start DESC);
