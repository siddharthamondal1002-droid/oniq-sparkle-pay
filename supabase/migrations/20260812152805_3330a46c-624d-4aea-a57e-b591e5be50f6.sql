update public.story_jobs
   set status = 'purged', updated_at = now()
 where id = 'fd48e8d3-759a-459a-b190-f211ee17de8e'
   and status = 'ready';