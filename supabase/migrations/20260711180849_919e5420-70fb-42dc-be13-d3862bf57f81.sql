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
  INSERT INTO public.wallets (user_id, fiat_balance) VALUES (NEW.id, 1000.00);
  INSERT INTO public.transactions (recipient_id, amount, currency, type, status, note)
  VALUES (NEW.id, 1000.00, 'USD', 'reward', 'completed', 'Welcome demo credits');
  RETURN NEW;
END;
$function$;