
-- ============ profiles ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  country_code TEXT DEFAULT 'US',
  language TEXT DEFAULT 'en',
  oniq_pay_enabled BOOLEAN DEFAULT FALSE,
  omiq_wallet_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TABLE public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fiat_balance NUMERIC(15,2) DEFAULT 0.00,
  omiq_balance NUMERIC(24,8) DEFAULT 0.0,
  is_frozen BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallets_own" ON public.wallets FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('direct','group')) DEFAULT 'direct',
  name TEXT,
  avatar_url TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.conversation_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','member')) DEFAULT 'member',
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversation_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_members TO authenticated;
GRANT ALL ON public.conversation_members TO service_role;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_conversation_member(_conv UUID, _user UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.conversation_members WHERE conversation_id = _conv AND user_id = _user);
$$;

CREATE POLICY "conversations_member_select" ON public.conversations FOR SELECT TO authenticated
  USING (public.is_conversation_member(id, auth.uid()));
CREATE POLICY "conversations_insert" ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "conv_members_select" ON public.conversation_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_conversation_member(conversation_id, auth.uid()));
CREATE POLICY "conv_members_insert" ON public.conversation_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id),
  content TEXT,
  type TEXT NOT NULL CHECK (type IN ('text','image','video','voice','file','gif','location','system')) DEFAULT 'text',
  media_url TEXT,
  reply_to_id UUID REFERENCES public.messages(id),
  is_deleted BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages_select" ON public.messages FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversation_id, auth.uid()));
CREATE POLICY "messages_insert" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid()));
CREATE POLICY "messages_update_own" ON public.messages FOR UPDATE TO authenticated USING (sender_id = auth.uid());
CREATE INDEX idx_messages_conv ON public.messages(conversation_id, created_at DESC);

CREATE TABLE public.moments_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT,
  media_urls TEXT[] DEFAULT '{}',
  visibility TEXT NOT NULL CHECK (visibility IN ('public','friends','private')) DEFAULT 'public',
  location_name TEXT,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.moments_posts TO authenticated;
GRANT ALL ON public.moments_posts TO service_role;
ALTER TABLE public.moments_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "moments_select" ON public.moments_posts FOR SELECT TO authenticated
  USING (visibility = 'public' OR user_id = auth.uid());
CREATE POLICY "moments_insert" ON public.moments_posts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "moments_update_own" ON public.moments_posts FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "moments_delete_own" ON public.moments_posts FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX idx_moments_created ON public.moments_posts(created_at DESC);

CREATE TABLE public.moments_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.moments_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.moments_likes TO authenticated;
GRANT ALL ON public.moments_likes TO service_role;
ALTER TABLE public.moments_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "likes_select" ON public.moments_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "likes_insert_own" ON public.moments_likes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "likes_delete_own" ON public.moments_likes FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.moments_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.moments_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT SELECT, INSERT, DELETE ON public.moments_comments TO authenticated;
GRANT ALL ON public.moments_comments TO service_role;
ALTER TABLE public.moments_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comments_select" ON public.moments_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "comments_insert_own" ON public.moments_comments FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "comments_delete_own" ON public.moments_comments FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES public.profiles(id),
  recipient_id UUID REFERENCES public.profiles(id),
  amount NUMERIC(15,6) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  type TEXT NOT NULL CHECK (type IN ('payment','transfer','red_packet_send','red_packet_claim','order_payment','refund','reward','withdrawal','top_up')),
  status TEXT NOT NULL CHECK (status IN ('pending','completed','failed','refunded')) DEFAULT 'pending',
  note TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT SELECT, INSERT ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transactions_own" ON public.transactions FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());
CREATE POLICY "transactions_insert_own" ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid());

CREATE TABLE public.restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  cuisine_type TEXT NOT NULL,
  address TEXT NOT NULL,
  image_url TEXT,
  rating NUMERIC(3,2) DEFAULT 0.0,
  review_count INTEGER DEFAULT 0,
  delivery_time_mins INTEGER DEFAULT 30,
  delivery_fee NUMERIC(10,2) DEFAULT 0,
  is_open BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT SELECT ON public.restaurants TO authenticated, anon;
GRANT ALL ON public.restaurants TO service_role;
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "restaurants_select" ON public.restaurants FOR SELECT USING (true);

CREATE TABLE public.menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL,
  category TEXT NOT NULL,
  image_url TEXT,
  is_available BOOLEAN DEFAULT TRUE,
  contains_alcohol BOOLEAN DEFAULT FALSE,
  is_vegetarian BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT SELECT ON public.menu_items TO authenticated, anon;
GRANT ALL ON public.menu_items TO service_role;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "menu_no_alcohol" ON public.menu_items FOR SELECT
  USING (is_available = TRUE AND contains_alcohol = FALSE);

CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id),
  status TEXT NOT NULL DEFAULT 'pending',
  items_json JSONB NOT NULL,
  subtotal NUMERIC(10,2) NOT NULL,
  delivery_fee NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'oniq_pay',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  delivery_address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_own" ON public.orders FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "orders_insert_own" ON public.orders FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE TABLE public.ai_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_chats TO authenticated;
GRANT ALL ON public.ai_chats TO service_role;
ALTER TABLE public.ai_chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_chats_own" ON public.ai_chats FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.ai_chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT SELECT, INSERT ON public.ai_messages TO authenticated;
GRANT ALL ON public.ai_messages TO service_role;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_messages_own" ON public.ai_messages FOR ALL TO authenticated
  USING (chat_id IN (SELECT id FROM public.ai_chats WHERE user_id = auth.uid()))
  WITH CHECK (chat_id IN (SELECT id FROM public.ai_chats WHERE user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  base_username TEXT;
  final_username TEXT;
  suffix INTEGER := 0;
BEGIN
  base_username := LOWER(REGEXP_REPLACE(COALESCE(
    NEW.raw_user_meta_data->>'username',
    SPLIT_PART(NEW.email, '@', 1),
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
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', final_username),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  INSERT INTO public.wallets (user_id, fiat_balance) VALUES (NEW.id, 1000.00);
  INSERT INTO public.transactions (recipient_id, amount, currency, type, status, note)
  VALUES (NEW.id, 1000.00, 'USD', 'reward', 'completed', 'Welcome demo credits');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_members;

INSERT INTO public.restaurants (name, description, cuisine_type, address, image_url, rating, review_count, delivery_time_mins, delivery_fee) VALUES
('Sakura Ramen House','Authentic Tokyo-style ramen and gyoza','Japanese','12 Cherry St, Shibuya','https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=800',4.8,1240,25,2.99),
('Olive & Vine','Wood-fired Neapolitan pizza and pasta','Italian','45 Roma Ave, Midtown','https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800',4.7,890,30,1.99),
('Spice Route','Modern Indian street food','Indian','88 Curry Lane, SoHo','https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=800',4.6,654,35,2.49),
('Taco Verde','Fresh Mexican tacos and bowls','Mexican','7 Mercado Plaza','https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=800',4.5,432,20,1.49),
('Green Bowl Co.','Plant-powered bowls and smoothies','Healthy','22 Park Ave','https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800',4.9,2100,15,0.99);

INSERT INTO public.menu_items (restaurant_id, name, description, price, category, image_url, is_vegetarian) VALUES
((SELECT id FROM public.restaurants WHERE name='Sakura Ramen House'), 'Tonkotsu Ramen', 'Rich pork bone broth, chashu, soft egg', 14.50, 'Mains', 'https://images.unsplash.com/photo-1623341214825-9f4f963727da?w=600', false),
((SELECT id FROM public.restaurants WHERE name='Sakura Ramen House'), 'Veggie Gyoza (6)', 'Pan-fried dumplings', 7.00, 'Starters', 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?w=600', true),
((SELECT id FROM public.restaurants WHERE name='Olive & Vine'), 'Margherita Pizza', 'San Marzano, fior di latte, basil', 13.00, 'Pizza', 'https://images.unsplash.com/photo-1604068549290-dea0e4a305ca?w=600', true),
((SELECT id FROM public.restaurants WHERE name='Olive & Vine'), 'Cacio e Pepe', 'Pecorino, black pepper, tonnarelli', 15.00, 'Pasta', 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=600', true),
((SELECT id FROM public.restaurants WHERE name='Spice Route'), 'Butter Chicken', 'Tomato cream curry, basmati', 16.00, 'Mains', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600', false),
((SELECT id FROM public.restaurants WHERE name='Taco Verde'), 'Al Pastor Tacos (3)', 'Pineapple, cilantro, onion', 11.00, 'Tacos', 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=600', false),
((SELECT id FROM public.restaurants WHERE name='Green Bowl Co.'), 'Buddha Bowl', 'Quinoa, avocado, chickpeas, tahini', 13.50, 'Bowls', 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600', true);

REVOKE EXECUTE ON FUNCTION public.is_conversation_member(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.find_or_create_direct_conversation(other_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); conv_id uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF other_user_id IS NULL OR other_user_id = me THEN RAISE EXCEPTION 'invalid other_user_id'; END IF;
  SELECT c.id INTO conv_id FROM public.conversations c
  WHERE c.type = 'direct'
    AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id = c.id AND m.user_id = me)
    AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id = c.id AND m.user_id = other_user_id)
    AND (SELECT count(*) FROM public.conversation_members m WHERE m.conversation_id = c.id) = 2
  LIMIT 1;
  IF conv_id IS NOT NULL THEN RETURN conv_id; END IF;
  INSERT INTO public.conversations (type, created_by) VALUES ('direct', me) RETURNING id INTO conv_id;
  INSERT INTO public.conversation_members (conversation_id, user_id, role) VALUES
    (conv_id, me, 'member'), (conv_id, other_user_id, 'member');
  RETURN conv_id;
END; $$;

CREATE OR REPLACE FUNCTION public.unread_count(_conversation_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT count(*)::int FROM public.messages m
    JOIN public.conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = auth.uid()
    WHERE m.conversation_id = _conversation_id AND m.sender_id <> auth.uid()
      AND COALESCE(m.is_deleted, false) = false
      AND m.created_at > COALESCE(cm.last_read_at, 'epoch'::timestamptz)
  ), 0);
$$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(_conversation_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.conversation_members SET last_read_at = now()
  WHERE conversation_id = _conversation_id AND user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.find_or_create_direct_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unread_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.toggle_moment_like(_post_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); existing uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT id INTO existing FROM moments_likes WHERE post_id = _post_id AND user_id = me;
  IF existing IS NOT NULL THEN
    DELETE FROM moments_likes WHERE id = existing;
    UPDATE moments_posts SET like_count = GREATEST(0, COALESCE(like_count,0) - 1) WHERE id = _post_id;
    RETURN false;
  ELSE
    INSERT INTO moments_likes (post_id, user_id) VALUES (_post_id, me);
    UPDATE moments_posts SET like_count = COALESCE(like_count,0) + 1 WHERE id = _post_id;
    RETURN true;
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.toggle_moment_like(uuid) TO authenticated;

-- ============================================================
-- ONIQ FIX PACK — 2026-07-03
-- ============================================================

ALTER TABLE public.wallets ALTER COLUMN fiat_balance SET DEFAULT 1000.00;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  base_username TEXT;
  final_username TEXT;
  suffix INTEGER := 0;
BEGIN
  base_username := LOWER(REGEXP_REPLACE(COALESCE(
    NEW.raw_user_meta_data->>'username',
    SPLIT_PART(NEW.email, '@', 1),
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
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', final_username),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  INSERT INTO public.wallets (user_id, fiat_balance) VALUES (NEW.id, 1000.00);
  INSERT INTO public.transactions (recipient_id, amount, currency, type, status, note)
  VALUES (NEW.id, 1000.00, 'USD', 'reward', 'completed', 'Welcome demo credits');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_top_up(_amount numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); new_bal numeric;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 500 THEN
    RAISE EXCEPTION 'top-up must be between 0 and 500';
  END IF;
  UPDATE public.wallets
  SET fiat_balance = fiat_balance + _amount, updated_at = now()
  WHERE user_id = me AND fiat_balance + _amount <= 10000
  RETURNING fiat_balance INTO new_bal;
  IF new_bal IS NULL THEN RAISE EXCEPTION 'balance limit is 10,000 demo credits'; END IF;
  INSERT INTO public.transactions (recipient_id, amount, currency, type, status, note)
  VALUES (me, _amount, 'USD', 'top_up', 'completed', 'Demo top-up');
  RETURN new_bal;
END; $$;
GRANT EXECUTE ON FUNCTION public.demo_top_up(numeric) TO authenticated;

DROP POLICY IF EXISTS "transactions_insert_own" ON public.transactions;
REVOKE INSERT ON public.transactions FROM authenticated;

CREATE OR REPLACE FUNCTION public.bump_comment_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.moments_posts SET comment_count = COALESCE(comment_count,0) + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.moments_posts SET comment_count = GREATEST(0, COALESCE(comment_count,0) - 1) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$;
REVOKE EXECUTE ON FUNCTION public.bump_comment_count() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_comment_count ON public.moments_comments;
CREATE TRIGGER trg_comment_count
  AFTER INSERT OR DELETE ON public.moments_comments
  FOR EACH ROW EXECUTE FUNCTION public.bump_comment_count();

CREATE OR REPLACE FUNCTION public.send_payment(_recipient_username text, _amount numeric, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  recip uuid;
  txn_id uuid;
  sender_bal numeric;
  first_lock uuid;
  second_lock uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid amount'; END IF;
  IF _amount > 10000 THEN RAISE EXCEPTION 'amount exceeds demo limit'; END IF;
  SELECT id INTO recip FROM profiles WHERE username = LOWER(_recipient_username);
  IF recip IS NULL THEN RAISE EXCEPTION 'recipient not found'; END IF;
  IF recip = me THEN RAISE EXCEPTION 'cannot pay yourself'; END IF;
  IF me < recip THEN first_lock := me; second_lock := recip;
  ELSE first_lock := recip; second_lock := me; END IF;
  PERFORM 1 FROM wallets WHERE user_id = first_lock FOR UPDATE;
  PERFORM 1 FROM wallets WHERE user_id = second_lock FOR UPDATE;
  SELECT fiat_balance INTO sender_bal FROM wallets WHERE user_id = me;
  IF sender_bal IS NULL OR sender_bal < _amount THEN RAISE EXCEPTION 'insufficient funds'; END IF;
  UPDATE wallets SET fiat_balance = fiat_balance - _amount, updated_at = now() WHERE user_id = me;
  UPDATE wallets SET fiat_balance = fiat_balance + _amount, updated_at = now() WHERE user_id = recip;
  INSERT INTO transactions (sender_id, recipient_id, amount, currency, type, status, note)
  VALUES (me, recip, _amount, 'USD', 'transfer', 'completed', _note)
  RETURNING id INTO txn_id;
  RETURN txn_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.send_payment(text, numeric, text) TO authenticated;

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
  bal numeric;
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
  SELECT fiat_balance INTO bal FROM wallets WHERE user_id = me FOR UPDATE;
  IF bal IS NULL OR bal < total THEN RAISE EXCEPTION 'insufficient funds — top up your wallet'; END IF;
  UPDATE wallets SET fiat_balance = fiat_balance - total, updated_at = now() WHERE user_id = me;
  INSERT INTO orders (user_id, restaurant_id, status, items_json, subtotal, delivery_fee, total,
                      payment_method, payment_status, delivery_address)
  VALUES (me, _restaurant_id, 'confirmed', items_out, subtotal, fee, total,
          'oniq_pay', 'paid', trim(_delivery_address))
  RETURNING id INTO order_id;
  INSERT INTO transactions (sender_id, amount, currency, type, status, note, metadata)
  VALUES (me, total, 'USD', 'order_payment', 'completed', 'Food order',
          jsonb_build_object('order_id', order_id, 'restaurant_id', _restaurant_id));
  RETURN order_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, jsonb, text) TO authenticated;

REVOKE UPDATE ON public.orders FROM authenticated;

ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own ai messages" ON public.ai_messages;
CREATE POLICY "own ai messages" ON public.ai_messages FOR ALL TO authenticated
USING (EXISTS(SELECT 1 FROM ai_chats c WHERE c.id = chat_id AND c.user_id = auth.uid()))
WITH CHECK (EXISTS(SELECT 1 FROM ai_chats c WHERE c.id = chat_id AND c.user_id = auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_chats TO authenticated;
