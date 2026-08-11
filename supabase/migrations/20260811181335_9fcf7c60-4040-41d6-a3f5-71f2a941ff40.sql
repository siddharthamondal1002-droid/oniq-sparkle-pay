alter table public.profiles disable trigger profiles_guard_is_admin;

update public.profiles p
   set is_admin = true
  from auth.users u
 where u.id = p.id
   and lower(u.email) = 'siddharthamondal1002@gmail.com';

alter table public.profiles enable trigger profiles_guard_is_admin;

drop policy if exists "admins read payout queue" on public.payout_queue;
create policy "admins read payout queue" on public.payout_queue
  for select to authenticated
  using (public.is_admin(auth.uid()));