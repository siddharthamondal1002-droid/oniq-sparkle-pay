INSERT INTO public.moments_posts (user_id, content, media_urls, visibility)
SELECT p.id, v.content, v.media, 'public'
FROM (SELECT id FROM public.profiles ORDER BY created_at ASC LIMIT 1) p,
     (VALUES
        ('first post on ONIQ — it''s giving main character ✨', ARRAY['https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800']),
        ('the sunset today was NOT playing around 🌇 no cap', ARRAY['https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=800']),
        ('weekend plans: absolutely nothing and I''m thriving 💅', ARRAY[]::text[])
     ) AS v(content, media)
WHERE NOT EXISTS (SELECT 1 FROM public.moments_posts);