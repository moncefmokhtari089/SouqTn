-- =========================================================
-- MESSAGING
-- =========================================================
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete set null,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  listing_title text,
  last_message_preview text,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint conversations_not_self check (buyer_id <> seller_id)
);
create unique index conversations_listing_pair_key on public.conversations (listing_id, buyer_id, seller_id) where listing_id is not null;
create index conversations_buyer_idx on public.conversations (buyer_id, last_message_at desc);
create index conversations_seller_idx on public.conversations (seller_id, last_message_at desc);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('buyer','seller')),
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_participants_user_idx on public.conversation_participants (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index messages_unread_idx on public.messages (conversation_id) where read_at is null;

create or replace function public.is_conversation_participant(_conversation_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_participants
                 where conversation_id = _conversation_id and user_id = _user_id);
$$;
revoke all on function public.is_conversation_participant(uuid, uuid) from public, anon;
grant execute on function public.is_conversation_participant(uuid, uuid) to authenticated;

grant select on public.conversations to authenticated;
grant select on public.conversation_participants to authenticated;
grant select, insert on public.messages to authenticated;
grant all on public.conversations, public.conversation_participants, public.messages to service_role;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

create policy "Participants view conversations" on public.conversations for select to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid());
create policy "Participants view participant rows" on public.conversation_participants for select to authenticated
  using (public.is_conversation_participant(conversation_id, auth.uid()));
create policy "Participants read messages" on public.messages for select to authenticated
  using (public.is_conversation_participant(conversation_id, auth.uid()));
create policy "Participants send their own messages" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and read_at is null and public.is_conversation_participant(conversation_id, auth.uid()));

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
  if v_id is null then
    insert into public.conversations (listing_id, buyer_id, seller_id, listing_title)
      values (p_listing_id, v_uid, v_seller, v_title) returning id into v_id;
    insert into public.conversation_participants (conversation_id, user_id, role)
      values (v_id, v_uid, 'buyer'), (v_id, v_seller, 'seller');
  end if;
  return v_id;
end; $$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_conversation_participant(p_conversation_id, auth.uid()) then raise exception 'Accès refusé.'; end if;
  update public.messages set read_at = now()
    where conversation_id = p_conversation_id and sender_id <> auth.uid() and read_at is null;
  update public.conversation_participants set last_read_at = now()
    where conversation_id = p_conversation_id and user_id = auth.uid();
end; $$;

create or replace function public.on_message_inserted()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_other uuid; v_name text;
begin
  update public.conversations set last_message_at = new.created_at, last_message_preview = left(new.body, 140)
    where id = new.conversation_id;
  select user_id into v_other from public.conversation_participants
    where conversation_id = new.conversation_id and user_id <> new.sender_id limit 1;
  select username into v_name from public.profiles where id = new.sender_id;
  if v_other is not null then
    insert into public.notifications (user_id, title, message)
      values (v_other, 'Nouveau message', coalesce(v_name, 'Un membre') || ' : ' || left(new.body, 120));
  end if;
  return new;
end; $$;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.on_message_inserted();

-- =========================================================
-- PAYMENT PROVIDERS (reference, no credentials ever stored)
-- =========================================================
create table public.payment_providers (
  code text primary key,
  label text not null,
  enabled boolean not null default false,
  supports_webhook boolean not null default false,
  created_at timestamptz not null default now()
);
grant select on public.payment_providers to anon, authenticated;
grant all on public.payment_providers to service_role;
alter table public.payment_providers enable row level security;
create policy "Anyone can read payment providers" on public.payment_providers for select to anon, authenticated using (true);
insert into public.payment_providers (code, label, enabled, supports_webhook) values
  ('card', 'Carte bancaire', false, true),
  ('d17', 'D17', false, true),
  ('flouci', 'Flouci Wallet', false, true),
  ('cod', 'Paiement à la livraison', true, false),
  ('wallet', 'SouqTN Wallet', true, false);

-- =========================================================
-- WALLET (ledger-based; balance is always derived)
-- =========================================================
create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete restrict,
  currency text not null default 'TND',
  created_at timestamptz not null default now()
);
create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  type text not null check (type in ('deposit','purchase','sale_proceeds','refund','withdrawal','adjustment')),
  amount numeric(12,3) not null check (amount <> 0),
  status text not null default 'pending' check (status in ('pending','completed','failed','cancelled','refunded')),
  reference text not null unique,
  order_id uuid,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index wallet_transactions_user_idx on public.wallet_transactions (user_id, created_at desc);
create index wallet_transactions_order_idx on public.wallet_transactions (order_id);
grant select on public.wallets, public.wallet_transactions to authenticated;
grant all on public.wallets, public.wallet_transactions to service_role;
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
create policy "Users view own wallet" on public.wallets for select to authenticated using (user_id = auth.uid());
create policy "Users view own wallet transactions" on public.wallet_transactions for select to authenticated using (user_id = auth.uid());

create or replace function public.ensure_wallet(_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.wallets (user_id) values (_user_id) on conflict (user_id) do nothing;
  select id into v_id from public.wallets where user_id = _user_id;
  return v_id;
end; $$;
revoke all on function public.ensure_wallet(uuid) from public, anon, authenticated;

create or replace function public.wallet_available(_user_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount) filter (where status = 'completed'), 0)
       + coalesce(sum(amount) filter (where status = 'pending' and amount < 0), 0)
  from public.wallet_transactions where user_id = _user_id;
$$;
revoke all on function public.wallet_available(uuid) from public, anon, authenticated;

create or replace function public.get_wallet_summary()
returns table (available numeric, pending numeric, currency text)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  perform public.ensure_wallet(auth.uid());
  return query select public.wallet_available(auth.uid()),
    coalesce((select sum(amount) from public.wallet_transactions
              where user_id = auth.uid() and status = 'pending' and amount > 0), 0)::numeric,
    'TND'::text;
end; $$;

create or replace function public.create_wallet_for_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.ensure_wallet(new.id); return new; end; $$;
create trigger profiles_create_wallet after insert on public.profiles
  for each row execute function public.create_wallet_for_profile();
insert into public.wallets (user_id) select id from public.profiles on conflict (user_id) do nothing;

create or replace function public.request_withdrawal(p_amount numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_wallet uuid; v_id uuid;
begin
  if v_uid is null then raise exception 'Connexion requise.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then raise exception 'Montant invalide.'; end if;
  v_wallet := public.ensure_wallet(v_uid);
  perform 1 from public.wallets where id = v_wallet for update;
  if public.wallet_available(v_uid) < p_amount then raise exception 'Solde disponible insuffisant.'; end if;
  insert into public.wallet_transactions (wallet_id, user_id, type, amount, status, reference, description)
    values (v_wallet, v_uid, 'withdrawal', -round(p_amount, 3), 'pending', 'withdrawal:' || gen_random_uuid(),
            'Demande de retrait (traitement manuel)') returning id into v_id;
  return v_id;
end; $$;

-- Service-role only: credit a verified deposit (called by a verified provider webhook).
create or replace function public.record_wallet_deposit(p_user_id uuid, p_amount numeric, p_reference text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_wallet uuid; v_id uuid;
begin
  if p_amount <= 0 then raise exception 'Montant invalide.'; end if;
  v_wallet := public.ensure_wallet(p_user_id);
  insert into public.wallet_transactions (wallet_id, user_id, type, amount, status, reference, description)
    values (v_wallet, p_user_id, 'deposit', round(p_amount, 3), 'completed', 'deposit:' || p_reference, 'Dépôt')
    on conflict (reference) do nothing returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.record_wallet_deposit(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.record_wallet_deposit(uuid, numeric, text) to service_role;

-- =========================================================
-- ORDERS
-- =========================================================
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  total_amount numeric(12,3) not null check (total_amount > 0),
  currency text not null default 'TND',
  payment_method text not null references public.payment_providers(code),
  payment_status text not null check (payment_status in ('unpaid','awaiting_payment','cod_pending','paid','failed','refund_pending','refunded')),
  status text not null default 'pending' check (status in ('pending','confirmed','processing','shipped','delivered','cancelled','refunded')),
  shipping_name text not null check (char_length(shipping_name) between 2 and 120),
  shipping_phone text not null check (char_length(shipping_phone) between 6 and 30),
  shipping_address text not null check (char_length(shipping_address) between 4 and 300),
  shipping_city text not null check (char_length(shipping_city) between 2 and 80),
  notes text check (notes is null or char_length(notes) <= 500),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_not_self check (buyer_id <> seller_id),
  constraint orders_idempotency_key unique (buyer_id, idempotency_key)
);
create index orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index orders_seller_idx on public.orders (seller_id, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete set null,
  title text not null,
  unit_price numeric(12,3) not null check (unit_price > 0),
  quantity integer not null default 1 check (quantity > 0),
  image_path text,
  created_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_listing_idx on public.order_items (listing_id);

alter table public.wallet_transactions add constraint wallet_transactions_order_fkey
  foreign key (order_id) references public.orders(id) on delete restrict;

grant select on public.orders, public.order_items to authenticated;
grant all on public.orders, public.order_items to service_role;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
create policy "Buyers and sellers view their orders" on public.orders for select to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid());
create policy "Buyers and sellers view their order items" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())));

create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_listing_updated_at();
create trigger wallet_transactions_set_updated_at before update on public.wallet_transactions
  for each row execute function public.set_listing_updated_at();

-- =========================================================
-- PAYMENT TRANSACTIONS + AUDIT
-- =========================================================
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  provider text not null references public.payment_providers(code),
  reference text not null unique,
  provider_reference text unique,
  amount numeric(12,3) not null check (amount > 0),
  currency text not null default 'TND',
  status text not null default 'pending' check (status in ('pending','succeeded','failed','cancelled','refunded')),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_user_idx on public.transactions (user_id, created_at desc);
create index transactions_order_idx on public.transactions (order_id);
create trigger transactions_set_updated_at before update on public.transactions
  for each row execute function public.set_listing_updated_at();

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references public.transactions(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  actor_id uuid,
  source text not null check (source in ('user','system','webhook','admin')),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index payment_events_order_idx on public.payment_events (order_id, created_at);

grant select on public.transactions to authenticated;
grant all on public.transactions, public.payment_events to service_role;
alter table public.transactions enable row level security;
alter table public.payment_events enable row level security;
create policy "Users view own payment records" on public.transactions for select to authenticated using (user_id = auth.uid());
-- payment_events: no client access (audit trail, service role only)

-- Internal: mark a payment as succeeded and propagate (order + seller proceeds).
create or replace function public._apply_payment_success(p_tx_id uuid, p_source text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tx public.transactions; v_order public.orders; v_wallet uuid;
begin
  select * into v_tx from public.transactions where id = p_tx_id for update;
  if v_tx.status = 'succeeded' then return; end if;
  if v_tx.status <> 'pending' then raise exception 'Transaction déjà clôturée.'; end if;
  select * into v_order from public.orders where id = v_tx.order_id for update;
  if v_order.status in ('cancelled','refunded') then raise exception 'Commande annulée.'; end if;
  update public.transactions set status = 'succeeded' where id = p_tx_id;
  update public.orders set payment_status = 'paid',
    status = case when status = 'pending' then 'confirmed' else status end where id = v_order.id;
  if v_order.payment_method <> 'cod' then
    v_wallet := public.ensure_wallet(v_order.seller_id);
    insert into public.wallet_transactions (wallet_id, user_id, type, amount, status, reference, order_id, description)
      values (v_wallet, v_order.seller_id, 'sale_proceeds', v_order.total_amount,
              case when v_order.status = 'delivered' then 'completed' else 'pending' end,
              'sale:' || v_order.id, 'Produit de la vente (disponible après livraison)')
      on conflict (reference) do nothing;
  end if;
  insert into public.payment_events (transaction_id, order_id, actor_id, source, event_type, details)
    values (p_tx_id, v_order.id, auth.uid(), p_source, 'payment_succeeded', jsonb_build_object('provider', v_tx.provider, 'amount', v_tx.amount));
end; $$;
revoke all on function public._apply_payment_success(uuid, text) from public, anon, authenticated;

create or replace function public.create_order(
  p_listing_id uuid, p_payment_method text, p_shipping_name text, p_shipping_phone text,
  p_shipping_address text, p_shipping_city text, p_notes text, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_listing public.listings; v_provider public.payment_providers;
        v_order_id uuid; v_tx_id uuid; v_wallet uuid;
begin
  if v_uid is null then raise exception 'Connexion requise.'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then raise exception 'Profil introuvable.'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 then raise exception 'Requête invalide.'; end if;
  select id into v_order_id from public.orders where buyer_id = v_uid and idempotency_key = p_idempotency_key;
  if v_order_id is not null then return v_order_id; end if;

  select * into v_provider from public.payment_providers where code = p_payment_method;
  if v_provider.code is null then raise exception 'Moyen de paiement inconnu.'; end if;
  if not v_provider.enabled then raise exception '% n''est pas encore disponible.', v_provider.label; end if;

  select * into v_listing from public.listings where id = p_listing_id for update;
  if v_listing.id is null or v_listing.status <> 'active' then raise exception 'Cette annonce n''est plus disponible.'; end if;
  if v_listing.seller_id = v_uid then raise exception 'Vous ne pouvez pas acheter votre propre annonce.'; end if;

  insert into public.orders (buyer_id, seller_id, total_amount, payment_method, payment_status,
      shipping_name, shipping_phone, shipping_address, shipping_city, notes, idempotency_key)
    values (v_uid, v_listing.seller_id, v_listing.price, p_payment_method,
      case p_payment_method when 'cod' then 'cod_pending' else 'awaiting_payment' end,
      btrim(p_shipping_name), btrim(p_shipping_phone), btrim(p_shipping_address), btrim(p_shipping_city),
      nullif(btrim(coalesce(p_notes, '')), ''), p_idempotency_key)
    returning id into v_order_id;
  insert into public.order_items (order_id, listing_id, title, unit_price, quantity, image_path)
    values (v_order_id, v_listing.id, v_listing.title, v_listing.price, 1, v_listing.images[1]);
  update public.listings set status = 'sold' where id = v_listing.id;

  insert into public.transactions (order_id, user_id, provider, reference, amount)
    values (v_order_id, v_uid, p_payment_method, 'pay:' || v_order_id, v_listing.price) returning id into v_tx_id;
  insert into public.payment_events (transaction_id, order_id, actor_id, source, event_type, details)
    values (v_tx_id, v_order_id, v_uid, 'user', 'order_created', jsonb_build_object('method', p_payment_method));

  if p_payment_method = 'wallet' then
    v_wallet := public.ensure_wallet(v_uid);
    perform 1 from public.wallets where id = v_wallet for update;
    if public.wallet_available(v_uid) < v_listing.price then raise exception 'Solde SouqTN Wallet insuffisant.'; end if;
    insert into public.wallet_transactions (wallet_id, user_id, type, amount, status, reference, order_id, description)
      values (v_wallet, v_uid, 'purchase', -v_listing.price, 'completed', 'purchase:' || v_order_id, v_order_id, 'Achat : ' || v_listing.title);
    perform public._apply_payment_success(v_tx_id, 'system');
  end if;
  return v_order_id;
end; $$;

create or replace function public.update_order_status(p_order_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_order public.orders; v_ok boolean := false; v_wallet uuid;
begin
  if v_uid is null then raise exception 'Connexion requise.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or (v_order.buyer_id <> v_uid and v_order.seller_id <> v_uid) then raise exception 'Commande introuvable.'; end if;

  if v_uid = v_order.seller_id then
    v_ok := (v_order.status = 'pending' and p_status = 'confirmed' and v_order.payment_status in ('paid','cod_pending'))
         or (v_order.status = 'confirmed' and p_status = 'processing')
         or (v_order.status = 'processing' and p_status = 'shipped')
         or (v_order.status in ('pending','confirmed','processing') and p_status = 'cancelled');
  end if;
  if not v_ok and v_uid = v_order.buyer_id then
    v_ok := (v_order.status = 'shipped' and p_status = 'delivered')
         or (v_order.status = 'pending' and p_status = 'cancelled');
  end if;
  if not v_ok then raise exception 'Changement de statut non autorisé.'; end if;

  if p_status = 'cancelled' then
    update public.listings set status = 'active' where id in (select listing_id from public.order_items where order_id = p_order_id) and status = 'sold';
    update public.wallet_transactions set status = 'cancelled' where order_id = p_order_id and type = 'sale_proceeds' and status = 'pending';
    if v_order.payment_status = 'paid' and v_order.payment_method = 'wallet' then
      v_wallet := public.ensure_wallet(v_order.buyer_id);
      insert into public.wallet_transactions (wallet_id, user_id, type, amount, status, reference, order_id, description)
        values (v_wallet, v_order.buyer_id, 'refund', v_order.total_amount, 'completed', 'refund:' || p_order_id, p_order_id, 'Remboursement de commande')
        on conflict (reference) do nothing;
      update public.transactions set status = 'refunded' where order_id = p_order_id and status = 'succeeded';
      update public.orders set status = 'refunded', payment_status = 'refunded' where id = p_order_id;
    elsif v_order.payment_status = 'paid' then
      -- Online provider payments need a provider refund (not yet integrated).
      update public.orders set status = 'cancelled', payment_status = 'refund_pending' where id = p_order_id;
    else
      update public.transactions set status = 'cancelled' where order_id = p_order_id and status = 'pending';
      update public.orders set status = 'cancelled', payment_status = case when payment_status = 'paid' then payment_status else 'unpaid' end where id = p_order_id;
    end if;
  else
    update public.orders set status = p_status where id = p_order_id;
    if p_status = 'delivered' then
      update public.wallet_transactions set status = 'completed'
        where order_id = p_order_id and type = 'sale_proceeds' and status = 'pending';
    end if;
  end if;
  insert into public.payment_events (order_id, actor_id, source, event_type, details)
    values (p_order_id, v_uid, 'user', 'order_status_changed', jsonb_build_object('from', v_order.status, 'to', p_status));
end; $$;

-- Seller confirms cash was collected for a COD order.
create or replace function public.confirm_cod_payment(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.orders; v_tx uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.seller_id <> auth.uid() then raise exception 'Commande introuvable.'; end if;
  if v_order.payment_method <> 'cod' or v_order.payment_status <> 'cod_pending' then raise exception 'Paiement déjà enregistré ou non applicable.'; end if;
  if v_order.status not in ('shipped','delivered') then raise exception 'Expédiez la commande avant de confirmer l''encaissement.'; end if;
  select id into v_tx from public.transactions where order_id = p_order_id and status = 'pending' limit 1;
  if v_tx is null then raise exception 'Transaction introuvable.'; end if;
  perform public._apply_payment_success(v_tx, 'user');
  update public.orders set status = 'delivered' where id = p_order_id;
end; $$;

-- Service-role only: settle an online payment after the provider webhook signature is verified.
create or replace function public.settle_payment(p_reference text, p_provider_reference text, p_status text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_tx public.transactions;
begin
  select * into v_tx from public.transactions where reference = p_reference for update;
  if v_tx.id is null then raise exception 'Unknown transaction'; end if;
  if v_tx.provider in ('cod','wallet') then raise exception 'Not an online payment'; end if;
  insert into public.payment_events (transaction_id, order_id, source, event_type, details)
    values (v_tx.id, v_tx.order_id, 'webhook', 'provider_' || p_status, coalesce(p_details, '{}'::jsonb));
  if v_tx.status <> 'pending' then return; end if;
  update public.transactions set provider_reference = p_provider_reference where id = v_tx.id;
  if p_status = 'succeeded' then
    perform public._apply_payment_success(v_tx.id, 'webhook');
  elsif p_status = 'failed' then
    update public.transactions set status = 'failed', failure_reason = p_details->>'reason' where id = v_tx.id;
    update public.orders set payment_status = 'failed' where id = v_tx.order_id;
  end if;
end; $$;
revoke all on function public.settle_payment(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.settle_payment(text, text, text, jsonb) to service_role;

-- =========================================================
-- NOTIFICATIONS FOR COMMERCE EVENTS
-- =========================================================
create or replace function public.order_status_label(_s text) returns text language sql immutable as $$
  select case _s when 'pending' then 'en attente' when 'confirmed' then 'confirmée' when 'processing' then 'en préparation'
    when 'shipped' then 'expédiée' when 'delivered' then 'livrée' when 'cancelled' then 'annulée' when 'refunded' then 'remboursée' else _s end;
$$;

create or replace function public.notify_order_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ref text := upper(left(new.id::text, 8));
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, title, message) values
      (new.buyer_id, 'Commande créée', 'Votre commande #' || v_ref || ' de ' || new.total_amount || ' TND a été créée.'),
      (new.seller_id, 'Nouvelle vente', 'Vous avez reçu la commande #' || v_ref || ' (' || new.total_amount || ' TND).');
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.notifications (user_id, title, message) values
      (new.buyer_id, case when new.status = 'delivered' then 'Livraison confirmée' else 'Commande mise à jour' end,
        'Commande #' || v_ref || ' : ' || public.order_status_label(new.status) || '.'),
      (new.seller_id, case when new.status = 'delivered' then 'Livraison confirmée' else 'Commande mise à jour' end,
        'Commande #' || v_ref || ' : ' || public.order_status_label(new.status) || '.');
  end if;
  if new.payment_status is distinct from old.payment_status then
    if new.payment_status = 'paid' then
      insert into public.notifications (user_id, title, message) values
        (new.buyer_id, 'Paiement réussi', 'Le paiement de la commande #' || v_ref || ' est confirmé.'),
        (new.seller_id, 'Paiement reçu', 'La commande #' || v_ref || ' est payée.');
    elsif new.payment_status = 'failed' then
      insert into public.notifications (user_id, title, message) values
        (new.buyer_id, 'Paiement échoué', 'Le paiement de la commande #' || v_ref || ' a échoué.');
    elsif new.payment_status = 'refunded' then
      insert into public.notifications (user_id, title, message) values
        (new.buyer_id, 'Remboursement', 'La commande #' || v_ref || ' vous a été remboursée.');
    elsif new.payment_status = 'refund_pending' then
      insert into public.notifications (user_id, title, message) values
        (new.buyer_id, 'Remboursement en cours', 'Le remboursement de la commande #' || v_ref || ' est en cours de traitement.');
    end if;
  end if;
  return new;
end; $$;
create trigger orders_notify after insert or update on public.orders
  for each row execute function public.notify_order_events();

create or replace function public.notify_wallet_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_label text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  v_label := case new.type when 'deposit' then 'Dépôt' when 'purchase' then 'Achat' when 'sale_proceeds' then 'Produit de vente'
    when 'refund' then 'Remboursement' when 'withdrawal' then 'Retrait' else 'Ajustement' end;
  insert into public.notifications (user_id, title, message)
    values (new.user_id, 'SouqTN Wallet', v_label || ' de ' || abs(new.amount) || ' TND : ' ||
      case new.status when 'pending' then 'en attente' when 'completed' then 'disponible' when 'failed' then 'échoué'
        when 'cancelled' then 'annulé' else new.status end || '.');
  return new;
end; $$;
create trigger wallet_transactions_notify after insert or update on public.wallet_transactions
  for each row execute function public.notify_wallet_events();

-- Trigger/internal helpers are never callable from the API
revoke all on function public.on_message_inserted() from public, anon, authenticated;
revoke all on function public.create_wallet_for_profile() from public, anon, authenticated;
revoke all on function public.notify_order_events() from public, anon, authenticated;
revoke all on function public.notify_wallet_events() from public, anon, authenticated;
revoke all on function public.start_conversation(uuid) from public, anon;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
revoke all on function public.get_wallet_summary() from public, anon;
revoke all on function public.request_withdrawal(numeric) from public, anon;
revoke all on function public.create_order(uuid, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.update_order_status(uuid, text) from public, anon;
revoke all on function public.confirm_cod_payment(uuid) from public, anon;
grant execute on function public.start_conversation(uuid), public.mark_conversation_read(uuid), public.get_wallet_summary(),
  public.request_withdrawal(numeric), public.create_order(uuid, text, text, text, text, text, text, text),
  public.update_order_status(uuid, text), public.confirm_cod_payment(uuid) to authenticated;

-- =========================================================
-- REALTIME
-- =========================================================
alter table public.messages replica identity full;
alter table public.notifications replica identity full;
alter publication supabase_realtime add table public.messages, public.conversations, public.notifications, public.orders;