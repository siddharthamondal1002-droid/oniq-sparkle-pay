CREATE TABLE public.partner_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text NOT NULL,
  city text NOT NULL,
  area text,
  skills text[] NOT NULL DEFAULT '{}',
  experience_years int NOT NULL DEFAULT 0,
  availability text[] NOT NULL DEFAULT '{}',
  note text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.partner_applications TO authenticated;
GRANT ALL ON public.partner_applications TO service_role;

ALTER TABLE public.partner_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insert own partner application" ON public.partner_applications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "read own partner application" ON public.partner_applications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE UNIQUE INDEX partner_applications_user_unique
  ON public.partner_applications(user_id)
  WHERE user_id IS NOT NULL;