
-- 1. Add visibility column to clips (idempotent)
ALTER TABLE public.clips
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clips_visibility_check'
  ) THEN
    ALTER TABLE public.clips
      ADD CONSTRAINT clips_visibility_check CHECK (visibility IN ('public','moots'));
  END IF;
END $$;

-- 2. Ensure moments_posts visibility CHECK is present + covers same set
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'moments_posts_visibility_check') THEN
    ALTER TABLE public.moments_posts DROP CONSTRAINT moments_posts_visibility_check;
  END IF;
  ALTER TABLE public.moments_posts
    ADD CONSTRAINT moments_posts_visibility_check CHECK (visibility IN ('public','moots'));
END $$;

-- 3. Replace SELECT policies with moots-aware versions
DROP POLICY IF EXISTS clips_select ON public.clips;
CREATE POLICY clips_select ON public.clips
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      is_deleted = false
      AND (
        visibility = 'public'
        OR (
          visibility = 'moots'
          AND EXISTS (
            SELECT 1 FROM public.friendships f
            WHERE f.status = 'accepted'
              AND (
                (f.user_a = auth.uid() AND f.user_b = clips.user_id)
                OR (f.user_b = auth.uid() AND f.user_a = clips.user_id)
              )
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS moments_select ON public.moments_posts;
CREATE POLICY moments_select ON public.moments_posts
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR visibility = 'public'
    OR (
      visibility = 'moots'
      AND EXISTS (
        SELECT 1 FROM public.friendships f
        WHERE f.status = 'accepted'
          AND (
            (f.user_a = auth.uid() AND f.user_b = moments_posts.user_id)
            OR (f.user_b = auth.uid() AND f.user_a = moments_posts.user_id)
          )
      )
    )
  );

-- 4. Update SECURITY DEFINER clips_feed to enforce visibility server-side
CREATE OR REPLACE FUNCTION public.clips_feed(_limit integer DEFAULT 10, _offset integer DEFAULT 0)
 RETURNS SETOF public.clips
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.clips c
  WHERE c.is_deleted = FALSE
    AND (
      c.visibility = 'public'
      OR c.user_id = auth.uid()
      OR (
        c.visibility = 'moots'
        AND EXISTS (
          SELECT 1 FROM public.friendships f
          WHERE f.status = 'accepted'
            AND (
              (f.user_a = auth.uid() AND f.user_b = c.user_id)
              OR (f.user_b = auth.uid() AND f.user_a = c.user_id)
            )
        )
      )
    )
  ORDER BY
    (c.like_count * 3 + c.comment_count * 5 + c.view_count)
      / POWER(GREATEST(EXTRACT(EPOCH FROM (now() - c.created_at)) / 3600, 1), 1.2) DESC,
    c.created_at DESC
  LIMIT LEAST(GREATEST(_limit, 1), 20) OFFSET GREATEST(_offset, 0);
$function$;
