-- ============================================================================
-- The watermark addon is free for admins too — same directive as
-- 20260812010000. create_watermark_purchase gains one branch: an admin
-- asking to remove the mark gets it applied ON THE SPOT, no purchase row,
-- no Razorpay order. razorpay-order sees `free: true` and skips the
-- payment sheet; the client reports success immediately.
--
-- The already-clean refusal stays FIRST, so an admin double-tap reads
-- "already has no watermark" rather than silently cloning a second
-- re-render job.
-- ============================================================================
create or replace function public.create_watermark_purchase(_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  addon story_addons%rowtype;
  j story_jobs%rowtype;
  pid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into j from story_jobs where id = _job_id and user_id = me;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no-such-job');
  end if;
  if j.no_watermark then
    return jsonb_build_object('ok', false, 'reason', 'already-clean');
  end if;

  -- THE OWNER RIDES FREE: applied immediately, nothing to pay. Deliberately
  -- ahead of the addon-active check — an admin's removal is not a purchase,
  -- so pausing sales does not pause it.
  if is_admin(me) then
    return jsonb_build_object('ok', true, 'free', true,
                              'applied', grant_watermark_removal(_job_id));
  end if;

  select * into addon from story_addons where key = 'watermark_removal';
  if not found or addon.active is not true then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  insert into watermark_purchases (user_id, job_id, price_paise, currency)
  values (me, _job_id, addon.price_paise, 'INR')
  returning id into pid;
  return jsonb_build_object(
    'ok', true,
    'purchaseId', pid,
    'label', addon.label,
    'amountMinor', addon.price_paise,
    'currency', 'INR'
  );
end;
$$;
revoke all on function public.create_watermark_purchase(uuid) from public, anon;
grant execute on function public.create_watermark_purchase(uuid) to authenticated;