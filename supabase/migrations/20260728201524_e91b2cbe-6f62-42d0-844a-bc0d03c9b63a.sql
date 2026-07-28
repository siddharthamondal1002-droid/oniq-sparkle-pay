-- Server-side removal of all stored-money features, following the UI removal
-- (PR #27). Order matters:
--   1. stop the signup trigger seeding wallets (or signups would break),
--   2. make place_order money-free (or food ordering would break),
--   3. drop the money RPCs,
--   4. archive the money tables to service-role-only _archive_* copies,
--   5. drop the originals,
--   6. drop profiles.omiq_wallet_address (recreating its dependent function).

-- ---------- 1) handle_new_user: profile only, no demo credits ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  base_username TEXT;
  final_username TEXT;
  phone_digits TEXT;
  phone_tail TEXT;
  suffix INTEGER := 0;
BEGIN
  phone_digits := regexp_replace(COALESCE(NEW.phone, ''), '\D', '', 'g');
  phone_tail := CASE WHEN length(phone_digits) >= 4 THEN right(phone_digits, 4) ELSE NULL END;

  base_username := LOWER(REGEXP_REPLACE(COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'username', ''),
    NULLIF(SPLIT_PART(COALESCE(NEW.email, ''), '@', 1), ''),
    CASE WHEN phone_tail IS NOT NULL THEN 'user' || phone_tail ELSE NULL END,
    'user'
  ), '[^a-z0-9_]', '', 'g'));
  IF LENGTH(base_username) < 3 THEN base_username := 'user' || SUBSTRING(NEW.id::text, 1, 6); END IF;
  final_username := base_username;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_username) LOOP
    suffix := suffix + 1;
    final_username := base_username || suffix::text;
  END LOOP;

  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    final_username,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      final_username
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$function$;

-- ---------- 2) place_order: record the order, no wallet debit ----------
CREATE OR REPLACE FUNCTION public.place_order(
  _restaurant_id uuid,
  _items jsonb,
  _delivery_address text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  item record;
  line jsonb;
  qty int;
  subtotal numeric := 0;
  fee numeric;
  total numeric;
  order_id uuid;
  items_out jsonb := '[]'::jsonb;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _delivery_address IS NULL OR length(trim(_delivery_address)) < 5 THEN
    RAISE EXCEPTION 'delivery address required';
  END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'cart is empty';
  END IF;
  IF jsonb_array_length(_items) > 30 THEN RAISE EXCEPTION 'too many items'; END IF;

  SELECT delivery_fee INTO fee FROM restaurants WHERE id = _restaurant_id AND is_open = TRUE;
  IF fee IS NULL THEN RAISE EXCEPTION 'restaurant not found or closed'; END IF;

  FOR line IN SELECT * FROM jsonb_array_elements(_items) LOOP
    qty := COALESCE((line->>'qty')::int, 0);
    IF qty < 1 OR qty > 20 THEN RAISE EXCEPTION 'invalid quantity'; END IF;

    SELECT id, name, price INTO item
    FROM menu_items
    WHERE id = (line->>'menu_item_id')::uuid
      AND restaurant_id = _restaurant_id
      AND is_available = TRUE
      AND contains_alcohol = FALSE;
    IF item.id IS NULL THEN RAISE EXCEPTION 'item unavailable'; END IF;

    subtotal := subtotal + item.price * qty;
    items_out := items_out || jsonb_build_object(
      'menu_item_id', item.id, 'name', item.name, 'price', item.price, 'qty', qty
    );
  END LOOP;

  total := subtotal + fee;
  -- Payment happens outside ONIQ (cash/UPI on delivery) — nothing debited here.
  INSERT INTO orders (user_id, restaurant_id, status, items_json, subtotal, delivery_fee, total,
                      payment_method, payment_status, delivery_address)
  VALUES (me, _restaurant_id, 'confirmed', items_out, subtotal, fee, total,
          'pay_on_delivery', 'pending', trim(_delivery_address))
  RETURNING id INTO order_id;
  RETURN order_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.place_order(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, jsonb, text) TO authenticated;

-- ---------- 3) drop the money RPCs ----------
DROP FUNCTION IF EXISTS public.demo_top_up(numeric);
DROP FUNCTION IF EXISTS public.withdraw_to_bank(uuid, numeric);
DROP FUNCTION IF EXISTS public.send_red_packet(text, numeric, text);
DROP FUNCTION IF EXISTS public.open_red_packet(uuid);
DROP FUNCTION IF EXISTS public.reclaim_red_packet(uuid);
DROP FUNCTION IF EXISTS public.create_payment_request(text, numeric, text);
DROP FUNCTION IF EXISTS public.respond_payment_request(uuid, boolean);

-- ---------- 4) archive money tables (service-role-only) ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wallets','transactions','bank_accounts','red_packets','payment_requests'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL AND to_regclass('public._archive_' || t) IS NULL THEN
      EXECUTE format('CREATE TABLE public._archive_%I AS TABLE public.%I', t, t);
      EXECUTE format('ALTER TABLE public._archive_%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public._archive_%I FROM PUBLIC, anon, authenticated', t);
      EXECUTE format('GRANT ALL ON public._archive_%I TO service_role', t);
    END IF;
  END LOOP;
END $$;

-- ---------- 5) drop the originals ----------
DROP TABLE IF EXISTS public.red_packets CASCADE;
DROP TABLE IF EXISTS public.payment_requests CASCADE;
DROP TABLE IF EXISTS public.bank_accounts CASCADE;
DROP TABLE IF EXISTS public.transactions CASCADE;
DROP TABLE IF EXISTS public.wallets CASCADE;

-- ---------- 6) drop profiles.omiq_wallet_address ----------
DROP FUNCTION IF EXISTS public.get_my_profile_private();
ALTER TABLE public.profiles DROP COLUMN IF EXISTS omiq_wallet_address;

CREATE OR REPLACE FUNCTION public.get_my_profile_private()
RETURNS TABLE(
  upi_vpa text,
  oniq_pay_enabled boolean,
  date_of_birth date,
  is_minor boolean,
  parent_name text,
  parent_email text,
  parent_phone text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT upi_vpa, oniq_pay_enabled,
         date_of_birth, is_minor, parent_name, parent_email, parent_phone
  FROM public.profiles WHERE id = auth.uid();
$function$;

REVOKE EXECUTE ON FUNCTION public.get_my_profile_private() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_private() TO authenticated;