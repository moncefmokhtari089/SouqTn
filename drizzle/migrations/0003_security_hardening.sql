-- =========================================================
-- 0003 SECURITY & RELIABILITY HARDENING
-- Additive only: no table/data is dropped. Written against schema 0000-0002.
-- NOT executed against a live database by the author (no Postgres available):
-- run on a staging branch, then run supabase/tests/security.sql (see SECURITY.md).
-- =========================================================

-- ---------------------------------------------------------
-- 1. LISTINGS: sold status is owned by the order functions
--    Client roles (authenticated/anon) cannot revive a sold listing,
--    cannot set 'sold', and cannot change seller_id.
--    SECURITY DEFINER functions run as their owner, so create_order /
--    update_order_status / expire_unpaid_orders are unaffected.
-- ---------------------------------------------------------
create or replace function public.guard_listing_status()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if old.status = 'sold' then
      raise exception 'Cette annonce est vendue et ne peut plus être modifiée.';
    end if;
    if new.status = 'sold' then
      raise exception 'Le statut vendu est géré automatiquement par les commandes.';
    end if;
    if new.seller_id is distinct from old.seller_id then
      raise exception 'Le vendeur d''une annonce ne peut pas être modifié.';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.guard_listing_status() from public, anon, authenticated;
drop trigger if exists listings_guard_status on public.listings;
create trigger listings_guard_status before update on public.listings
  for each row execute function public.guard_listing_status();

-- ---------------------------------------------------------
-- 2. ORDERS / PAYMENTS: refund_pending and refunded can never go back to paid
-- ---------------------------------------------------------
create or replace function public.guard_order_payment_status()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.payment_status in ('refund_pending', 'refunded')
     and new.payment_status not in ('refund_pending', 'refunded') then
    raise exception 'Une commande en remboursement ne peut plus repasser en statut payé.';
  end if;
  if old.payment_status = 'refunded' and new.payment_status <> 'refunded' then
    raise exception 'Une commande remboursée ne peut plus changer de statut de paiement.';
  end if;
  return new;
end; $$;
revoke all on function public.guard_order_payment_status() from public, anon, authenticated;
drop trigger if exists orders_guard_payment_status on public.orders;
create trigger orders_guard_payment_status before update of payment_status on public.orders
  for each row execute function public.guard_order_payment_status();

-- Defence in depth: clients have no write access to money tables (explicit, idempotent).
revoke insert, update, delete, truncate on public.orders, public.order_items, public.transactions,
  public.wallets, public.wallet_transactions from anon, authenticated;
revoke all on public.payment_events from anon, authenticated;
revoke insert, update, delete, truncate on public.payment_providers from anon, authenticated;

-- _apply_payment_success: also refuse orders already flagged for refund.
-- BUGFIX: the 0002 version listed order_id as a target column but supplied no value for it
-- (8 columns, 7 values), so it would fail at runtime for every wallet/online payment.
create or replace function public._apply_payment_success(p_tx_id uuid, p_source text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tx public.transactions; v_order public.orders; v_wallet uuid;
begin
  select * into v_tx from public.transactions where id = p_tx_id for update;
  if v_tx.status = 'succeeded' then return; end if;
  if v_tx.status <> 'pending' then raise exception 'Transaction déjà clôturée.'; end if;
  select * into v_order from public.orders where id = v_tx.order_id for update;
  if v_order.status in ('cancelled','refunded') or v_order.payment_status in ('refund_pending','refunded') then
    raise exception 'Commande annulée.';
  end if;
  update public.transactions set status = 'succeeded' where id = p_tx_id;
  update public.orders set payment_status = 'paid',
    status = case when status = 'pending' then 'confirmed' else status end where id = v_order.id;
  if v_order.payment_method <> 'cod' then
    v_wallet := public.ensure_wallet(v_order.seller_id);
    insert into public.wallet_transactions (wallet_id, user_id, type, amount, status, reference, order_id, description)
      values (v_wallet, v_order.seller_id, 'sale_proceeds', v_order.total_amount,
              case when v_order.status = 'delivered' then 'completed' else 'pending' end,
              'sale:' || v_order.id, v_order.id, 'Produit de la vente (disponible après livraison)')
      on conflict (reference) do nothing;
  end if;
  insert into public.payment_events (transaction_id, order_id, actor_id, source, event_type, details)
    values (p_tx_id, v_order.id, auth.uid(), p_source, 'payment_succeeded', jsonb_build_object('provider', v_tx.provider, 'amount', v_tx.amount));
end; $$;
revoke all on function public._apply_payment_success(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------
-- 3. EXPIRE UNPAID ONLINE ORDERS (service role / DB scheduler only)
--    - only status='pending' AND payment_status='awaiting_payment', online providers
--    - never touches an order with a succeeded transaction
--    - FOR UPDATE SKIP LOCKED: skips rows being settled/cancelled right now (no waits, no deadlocks)
--    - idempotent: a second run finds nothing to do
--    - releases a listing only if no other live order holds it
--    - no money is moved: nothing was paid
-- ---------------------------------------------------------
create or replace function public.expire_unpaid_orders(p_minutes integer default 30)
returns integer language plpgsql security definer set search_path = public as $$
declare v_cand record; v_pending integer; v_locked integer; v_order public.orders; v_count integer := 0;
begin
  if p_minutes is null or p_minutes < 5 then raise exception 'Délai invalide (minimum 5 minutes).'; end if;
  for v_cand in
    select o.id from public.orders o
    where o.status = 'pending' and o.payment_status = 'awaiting_payment'
      and o.payment_method not in ('cod', 'wallet')
      and o.created_at < now() - make_interval(mins => p_minutes)
    order by o.created_at limit 200
  loop
    -- same lock order as _apply_payment_success: transactions first, then order
    select count(*) into v_pending from public.transactions t where t.order_id = v_cand.id and t.status = 'pending';
    with l as (select 1 from public.transactions t where t.order_id = v_cand.id and t.status = 'pending' for update skip locked)
      select count(*) into v_locked from l;
    if v_locked < v_pending then continue; end if;  -- a payment is being settled right now: retry next run
    if exists (select 1 from public.transactions t where t.order_id = v_cand.id and t.status = 'succeeded') then continue; end if;

    select * into v_order from public.orders o where o.id = v_cand.id for update skip locked;
    if v_order.id is null then continue; end if;
    -- re-check under lock (state may have changed since the candidate scan)
    if v_order.status <> 'pending' or v_order.payment_status <> 'awaiting_payment' then continue; end if;

    update public.transactions set status = 'cancelled', failure_reason = coalesce(failure_reason, 'order_expired')
      where order_id = v_order.id and status = 'pending';
    update public.listings l set status = 'active'
      where l.status = 'sold'
        and l.id in (select oi.listing_id from public.order_items oi where oi.order_id = v_order.id)
        and not exists (select 1 from public.order_items oi2 join public.orders o2 on o2.id = oi2.order_id
                        where oi2.listing_id = l.id and o2.id <> v_order.id and o2.status not in ('cancelled', 'refunded'));
    update public.orders set status = 'cancelled', payment_status = 'failed' where id = v_order.id;
    insert into public.payment_events (order_id, source, event_type, details)
      values (v_order.id, 'system', 'order_expired', jsonb_build_object('after_minutes', p_minutes));
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;
revoke all on function public.expire_unpaid_orders(integer) from public, anon, authenticated;
grant execute on function public.expire_unpaid_orders(integer) to service_role;

-- ---------------------------------------------------------
-- 4. LATE PAYMENTS: a provider success for a closed order is never silently completed
--    and never silently dropped: the order is flagged refund_pending for manual handling.
--    (NO provider refund API exists yet: see SECURITY.md.)
-- ---------------------------------------------------------
create or replace function public.settle_payment(p_reference text, p_provider_reference text, p_status text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_tx public.transactions; v_order public.orders;
begin
  select * into v_tx from public.transactions where reference = p_reference for update;
  if v_tx.id is null then raise exception 'Unknown transaction'; end if;
  if v_tx.provider in ('cod','wallet') then raise exception 'Not an online payment'; end if;
  insert into public.payment_events (transaction_id, order_id, source, event_type, details)
    values (v_tx.id, v_tx.order_id, 'webhook', 'provider_' || p_status, coalesce(p_details, '{}'::jsonb));

  select * into v_order from public.orders where id = v_tx.order_id for update;

  -- Late success on a cancelled/expired/failed transaction or a closed order
  if p_status = 'succeeded'
     and (v_tx.status in ('cancelled', 'failed')
          or (v_tx.status = 'pending' and (v_order.status in ('cancelled', 'refunded')
                                           or v_order.payment_status in ('refund_pending', 'refunded')))) then
    if not exists (select 1 from public.payment_events
                   where transaction_id = v_tx.id and event_type = 'late_payment_flagged') then
      update public.transactions
        set provider_reference = coalesce(provider_reference, p_provider_reference),
            failure_reason = 'late_payment_refund_required'
        where id = v_tx.id;
      if v_order.payment_status not in ('paid', 'refund_pending', 'refunded') then
        update public.orders set payment_status = 'refund_pending' where id = v_order.id;
      end if;
      insert into public.payment_events (transaction_id, order_id, source, event_type, details)
        values (v_tx.id, v_tx.order_id, 'webhook', 'late_payment_flagged',
                jsonb_build_object('amount', v_tx.amount, 'provider', v_tx.provider, 'action', 'manual_refund_required'));
    end if;
    return;
  end if;

  if v_tx.status <> 'pending' then return; end if;
  update public.transactions set provider_reference = p_provider_reference where id = v_tx.id;
  if p_status = 'succeeded' then
    perform public._apply_payment_success(v_tx.id, 'webhook');
  elsif p_status = 'failed' then
    update public.transactions set status = 'failed', failure_reason = p_details->>'reason' where id = v_tx.id;
    update public.orders set payment_status = 'failed'
      where id = v_tx.order_id and payment_status not in ('paid', 'refund_pending', 'refunded');
  end if;
end; $$;
revoke all on function public.settle_payment(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.settle_payment(text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------
-- 5. MESSAGING ABUSE PROTECTION (enforced in the database)
--    Messages : max 15 / minute and 300 / hour per user; max 3 identical bodies / 5 min per conversation.
--    Conversations (new ones only; re-opening an existing one is free):
--               max 3 / hour per seller, 10 / hour and 30 / day per buyer.
-- ---------------------------------------------------------
create index if not exists messages_sender_created_idx on public.messages (sender_id, created_at desc);
create index if not exists conversations_buyer_created_idx on public.conversations (buyer_id, created_at desc);

create or replace function public.guard_message_rate()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    perform pg_advisory_xact_lock(hashtext('msg:' || new.sender_id::text));
    if (select count(*) from public.messages where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 15 then
      raise exception 'Trop de messages envoyés. Réessayez dans une minute.';
    end if;
    if (select count(*) from public.messages where sender_id = new.sender_id and created_at > now() - interval '1 hour') >= 300 then
      raise exception 'Limite horaire de messages atteinte. Réessayez plus tard.';
    end if;
    if (select count(*) from public.messages where sender_id = new.sender_id and conversation_id = new.conversation_id
          and body = new.body and created_at > now() - interval '5 minutes') >= 3 then
      raise exception 'Message identique envoyé trop de fois.';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.guard_message_rate() from public, anon, authenticated;
drop trigger if exists messages_guard_rate on public.messages;
create trigger messages_guard_rate before insert on public.messages
  for each row execute function public.guard_message_rate();

create or replace function public.start_conversation(p_listing_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_seller uuid; v_title text; v_id uuid;
begin
  if v_uid is null then raise exception 'Connexion requise.'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then raise exception 'Profil introuvable.'; end if;
  select seller_id, title into v_seller, v_title from public.listings where id = p_listing_id and status = 'active';
  if v_seller is null then raise exception 'Annonce introuvable ou indisponible.'; end if;
  if v_seller = v_uid then raise exception 'Vous ne pouvez pas vous écrire à vous-même.'; end if;

  select id into v_id from public.conversations where listing_id = p_listing_id and buyer_id = v_uid and seller_id = v_seller;
  if v_id is not null then return v_id; end if;

  perform pg_advisory_xact_lock(hashtext('conv:' || v_uid::text));
  if (select count(*) from public.conversations where buyer_id = v_uid and seller_id = v_seller
        and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Trop de conversations ouvertes avec ce vendeur. Réessayez plus tard.';
  end if;
  if (select count(*) from public.conversations where buyer_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Trop de nouvelles conversations. Réessayez plus tard.';
  end if;
  if (select count(*) from public.conversations where buyer_id = v_uid and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Limite quotidienne de conversations atteinte.';
  end if;

  insert into public.conversations (listing_id, buyer_id, seller_id, listing_title)
    values (p_listing_id, v_uid, v_seller, v_title)
    on conflict (listing_id, buyer_id, seller_id) where listing_id is not null do nothing
    returning id into v_id;
  if v_id is null then
    select id into v_id from public.conversations where listing_id = p_listing_id and buyer_id = v_uid and seller_id = v_seller;
  else
    insert into public.conversation_participants (conversation_id, user_id, role)
      values (v_id, v_uid, 'buyer'), (v_id, v_seller, 'seller');
  end if;
  return v_id;
end; $$;
revoke all on function public.start_conversation(uuid) from public, anon;
grant execute on function public.start_conversation(uuid) to authenticated;

-- ---------------------------------------------------------
-- 6. STORAGE
--    souqtn-avatars : public read kept on purpose (avatars appear on public seller cards / chats).
--    souqtn-listings: read limited to (a) the owner's own folder, (b) photos of ACTIVE listings,
--                     (c) photos of orders the user is a party to. Evaluated via a SECURITY DEFINER
--                     helper so anon needs no table privileges. Public browsing keeps working.
--    Writes: authenticated only, own folder only, exact path depth, safe image extensions.
--    Size / MIME limits are enforced by the Storage API through the bucket settings below.
--    Rollback for reads: recreate the previous policy "Anyone can view avatars and listing photos".
-- ---------------------------------------------------------
create index if not exists listings_images_gin_idx on public.listings using gin (images);

create or replace function public.can_read_listing_image(_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.listings l where l.status = 'active' and l.images @> array[_name])
      or (auth.uid() is not null and (
            exists (select 1 from public.listings l where l.seller_id = auth.uid() and l.images @> array[_name])
         or exists (select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
                    where oi.image_path = _name and (o.buyer_id = auth.uid() or o.seller_id = auth.uid()))));
$$;
revoke all on function public.can_read_listing_image(text) from public;
grant execute on function public.can_read_listing_image(text) to anon, authenticated;

update storage.buckets
  set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  where id in ('souqtn-avatars', 'souqtn-listings');

drop policy if exists "Anyone can view avatars and listing photos" on storage.objects;
drop policy if exists "Public can view avatars" on storage.objects;
drop policy if exists "View listing photos" on storage.objects;
create policy "Public can view avatars" on storage.objects for select to anon, authenticated
  using (bucket_id = 'souqtn-avatars');
create policy "View listing photos" on storage.objects for select to anon, authenticated
  using (bucket_id = 'souqtn-listings'
         and ((auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text)
              or public.can_read_listing_image(name)));

drop policy if exists "Owners upload avatars" on storage.objects;
create policy "Owners upload avatars" on storage.objects for insert to authenticated
  with check (bucket_id = 'souqtn-avatars'
              and (storage.foldername(name))[1] = auth.uid()::text
              and array_length(storage.foldername(name), 1) = 1
              and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp'));
drop policy if exists "Sellers upload listing photos" on storage.objects;
create policy "Sellers upload listing photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'souqtn-listings'
              and (storage.foldername(name))[1] = auth.uid()::text
              and array_length(storage.foldername(name), 1) = 2
              and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp'));
-- update/delete policies from 0000 already restrict to the owner's own folder.

-- ---------------------------------------------------------
-- 7. SCHEDULING (NOT ACTIVE until you run it)
--    Preferred: pg_cron inside the database (no key leaves Postgres). Needs the pg_cron extension.
--      select cron.schedule('expire-unpaid-orders', '*/5 * * * *', $$select public.expire_unpaid_orders(30)$$);
--    Alternative: POST /api/public/cron/expire-orders with "Authorization: Bearer <LOVABLE_CRON_SECRET>".
-- ---------------------------------------------------------
