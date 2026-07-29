-- Reels: poster thumbnails + private visibility.
-- thumbnail_url is a signed URL into the existing private `clips` bucket
-- (owner-folder paths, same policies as the videos themselves).
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS thumbnail_url text;

-- Owner actions add a Private option; clips_feed already serves only
-- public/moots, so private clips surface exclusively on the owner's page.
ALTER TABLE public.clips DROP CONSTRAINT IF EXISTS clips_visibility_check;
ALTER TABLE public.clips
  ADD CONSTRAINT clips_visibility_check CHECK (visibility IN ('public','moots','private'));