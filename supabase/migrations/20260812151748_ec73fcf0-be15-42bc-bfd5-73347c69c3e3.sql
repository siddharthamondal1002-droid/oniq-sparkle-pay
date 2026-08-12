update public.story_config
   set enabled = true,
       updated_at = now()
 where id = true;