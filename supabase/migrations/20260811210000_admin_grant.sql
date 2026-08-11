-- ============================================================================
-- ADMIN GRANT — the owner's account runs the shop.
--
-- siddharthamondal1002@gmail.com is the ONIQ owner. This flips is_admin on
-- that account's profile, which is the single switch every admin surface
-- keys on: the moderation inbox at /app/admin (reports, partner KYC,
-- takedowns, deletion proofs, payouts), admin RLS policies, and the
-- payout-run branch of the razorpay-order edge function.
--
-- The profiles_guard_is_admin trigger rejects is_admin changes unless the
-- caller is already an admin — correct for JWTs, wrong for a migration,
-- which runs with no auth.uid() at all. Lift it for exactly this statement.
-- Idempotent: replaying re-sets a flag that is already true.
-- ============================================================================
alter table public.profiles disable trigger profiles_guard_is_admin;

update public.profiles p
   set is_admin = true
  from auth.users u
 where u.id = p.id
   and lower(u.email) = 'siddharthamondal1002@gmail.com';

alter table public.profiles enable trigger profiles_guard_is_admin;

-- ----------------------------------------------------------------------------
-- Admins see the whole payout queue. The base policy is own-rows-only (each
-- recipient sees their money); the dashboard needs the full ledger to show
-- queued / paid / failed / no-UPI counts. Policies OR together, so this only
-- widens reads for admins and changes nothing for everyone else.
-- ----------------------------------------------------------------------------
drop policy if exists "admins read payout queue" on public.payout_queue;
create policy "admins read payout queue" on public.payout_queue
  for select to authenticated
  using (public.is_admin(auth.uid()));
