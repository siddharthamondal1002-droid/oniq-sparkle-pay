-- P4: provenance-scan results ride the existing append-only ledger.
-- confidence: none | possible | likely | confirmed
-- evidence: raw signals found (marker names, generator strings, byte range)
ALTER TABLE public.media_provenance ADD COLUMN IF NOT EXISTS confidence text;
ALTER TABLE public.media_provenance ADD COLUMN IF NOT EXISTS evidence jsonb;
