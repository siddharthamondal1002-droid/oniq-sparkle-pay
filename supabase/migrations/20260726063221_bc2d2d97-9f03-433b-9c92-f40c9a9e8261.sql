create or replace function public.prevent_is_admin_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_admin is distinct from old.is_admin then
    if not public.is_admin(auth.uid()) then
      new.is_admin := old.is_admin;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_is_admin_escalation on public.profiles;
create trigger trg_prevent_is_admin_escalation
before update on public.profiles
for each row execute function public.prevent_is_admin_escalation();

revoke update (is_admin) on public.profiles from authenticated;
revoke update (is_admin) on public.profiles from anon;