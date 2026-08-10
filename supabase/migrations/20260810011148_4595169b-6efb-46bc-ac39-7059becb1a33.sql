do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'project_url';
  if v_id is null then
    perform vault.create_secret('https://bqwttemnnoexadpwifcj.supabase.co', 'project_url', 'Base URL for internal function calls');
  else
    perform vault.update_secret(v_id, 'https://bqwttemnnoexadpwifcj.supabase.co', 'project_url', 'Base URL for internal function calls');
  end if;
end
$$;