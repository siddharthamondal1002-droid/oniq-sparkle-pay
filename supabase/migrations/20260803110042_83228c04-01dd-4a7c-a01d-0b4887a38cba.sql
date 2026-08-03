create or replace function public.__tmp_debug_request_headers()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_setting('request.headers', true), '')::jsonb
$$;
grant execute on function public.__tmp_debug_request_headers() to authenticated, anon;