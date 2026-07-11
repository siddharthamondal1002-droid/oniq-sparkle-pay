CREATE TABLE public.otp_attempts (
  phone TEXT PRIMARY KEY,
  otp TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.otp_attempts TO service_role;
ALTER TABLE public.otp_attempts ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated: table is service-role only.