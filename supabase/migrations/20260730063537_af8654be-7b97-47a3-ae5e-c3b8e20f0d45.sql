ALTER TABLE public.moments_posts ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.status_updates ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.bump_post_view_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.post_type = 'moment' THEN
    UPDATE moments_posts SET view_count = view_count + 1 WHERE id = NEW.post_id;
  ELSIF NEW.post_type = 'reel' THEN
    UPDATE clips SET view_count = view_count + 1 WHERE id = NEW.post_id;
  ELSIF NEW.post_type = 'update' THEN
    UPDATE status_updates SET view_count = view_count + 1 WHERE id = NEW.post_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bump_post_view_count() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS post_views_bump ON public.post_views;
CREATE TRIGGER post_views_bump AFTER INSERT ON public.post_views
  FOR EACH ROW EXECUTE FUNCTION public.bump_post_view_count();

INSERT INTO public.post_views (post_type, post_id, viewer_id, first_viewed_at, last_viewed_at)
SELECT 'reel', v.clip_id, v.user_id, v.created_at, v.created_at
FROM public.clips_views v
JOIN public.clips c ON c.id = v.clip_id
WHERE v.user_id <> c.user_id
  AND NOT EXISTS (
    SELECT 1 FROM public.blocked_users b
    WHERE (b.blocker_id = v.user_id AND b.blocked_id = c.user_id)
       OR (b.blocker_id = c.user_id AND b.blocked_id = v.user_id))
ON CONFLICT DO NOTHING;

INSERT INTO public.post_views (post_type, post_id, viewer_id, first_viewed_at, last_viewed_at)
SELECT 'update', v.status_id, v.viewer_id, v.viewed_at, v.viewed_at
FROM public.status_views v
JOIN public.status_updates s ON s.id = v.status_id
WHERE v.viewer_id <> s.user_id
  AND NOT EXISTS (
    SELECT 1 FROM public.blocked_users b
    WHERE (b.blocker_id = v.viewer_id AND b.blocked_id = s.user_id)
       OR (b.blocker_id = s.user_id AND b.blocked_id = v.viewer_id))
ON CONFLICT DO NOTHING;

UPDATE public.clips c SET view_count = COALESCE(x.n, 0)
FROM (SELECT post_id, count(*) AS n FROM public.post_views WHERE post_type='reel' GROUP BY post_id) x
WHERE x.post_id = c.id;
UPDATE public.clips SET view_count = 0
WHERE id NOT IN (SELECT post_id FROM public.post_views WHERE post_type='reel');
UPDATE public.status_updates s SET view_count = COALESCE(x.n, 0)
FROM (SELECT post_id, count(*) AS n FROM public.post_views WHERE post_type='update' GROUP BY post_id) x
WHERE x.post_id = s.id;
UPDATE public.moments_posts SET view_count = 0 WHERE view_count <> 0;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.clips;
EXCEPTION WHEN duplicate_object THEN NULL;
        WHEN undefined_object THEN NULL;
END $$;