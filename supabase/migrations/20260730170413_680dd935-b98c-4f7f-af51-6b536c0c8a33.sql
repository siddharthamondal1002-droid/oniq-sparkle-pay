ALTER TABLE public.media_provenance ADD COLUMN IF NOT EXISTS confidence text;
ALTER TABLE public.media_provenance ADD COLUMN IF NOT EXISTS evidence jsonb;