-- Integration checks for migration 0003. RUN ON A STAGING BRANCH ONLY, as the postgres role:
--   psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security.sql
-- Everything runs in one transaction and is rolled back. Any "FAIL" raises and stops the run.
-- Author note: written without a Postgres instance, so this script has NOT been executed yet.
begin;

create schema tsec;
grant usage on schema tsec to public;

create function tsec.act_as(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function tsec.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
end $$;
create function tsec.as_service() returns void language plpgsql as $$
begin execute 'set local role service_role'; end $$;
create function tsec.as_admin() returns void language plpgsql as $$
begin execute 'reset role'; end $$;
create function tsec.expect_fail(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'PASS: % (%)', label, sqlerrm; return; end;
  raise exception 'FAIL: % (statement succeeded)', label;
end $$;
create function tsec.expect_ok(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise exception 'FAIL: % (%)', label, sqlerrm; end;
  raise notice 'PASS: %', label;
end $$;
create function tsec.affected(stmt text) returns integer language plpgsql as $$
declare n integer; begin execute stmt; get diagnostics n = row_count; return n; end $$;
create function tsec.expect_eq(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL: % (got %, want %)', label, got, want; end if;
  raise notice 'PASS: %', label;
end $$;

-- fixtures (as admin) ------------------------------------------------------
insert into public.profiles (id, username, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'sec_seller', 'Seller A'),
  ('00000000-0000-0000-0000-0000000000b1', 'sec_other',  'Seller B'),
  ('00000000-0000-0000-0000-0000000000c1', 'sec_buyer',  'Buyer C');
update public.payment_providers set enabled = true where code = 'card';
insert into public.listings (id, seller_id, title, description, price, category, condition, location, images, status) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Active item', 'Description long enough', 10, 'cat', 'Neuf', 'Tunis', array['00000000-0000-0000-0000-0000000000a1/l1/a.jpg'], 'active'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Sold item',   'Description long enough', 10, 'cat', 'Neuf', 'Tunis', array['00000000-0000-0000-0000-0000000000a1/l2/a.jpg'], 'sold'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'Online item', 'Description long enough', 25, 'cat', 'Neuf', 'Tunis', array['00000000-0000-0000-0000-0000000000a1/l3/a.jpg'], 'active');
insert into public.listings (seller_id, title, description, price, category, condition, location, images, status)
  select '00000000-0000-0000-0000-0000000000a1', 'Extra item ' || g, 'Description long enough', 1, 'cat', 'Neuf', 'Tunis', array['00000000-0000-0000-0000-0000000000a1/x' || g || '/a.jpg'], 'active'
  from generate_series(1, 4) g;
insert into storage.buckets (id, name, public) values ('souqtn-listings', 'souqtn-listings', false), ('souqtn-avatars', 'souqtn-avatars', false)
  on conflict (id) do nothing;

-- 1. LISTINGS --------------------------------------------------------------
select tsec.act_as('00000000-0000-0000-0000-0000000000a1');
select tsec.expect_fail('seller cannot revive a sold listing',
  $q$update public.listings set status = 'active' where id = '10000000-0000-0000-0000-000000000002'$q$);
select tsec.expect_fail('seller cannot mark listing sold',
  $q$update public.listings set status = 'sold' where id = '10000000-0000-0000-0000-000000000001'$q$);
select tsec.expect_fail('seller cannot change seller_id',
  $q$update public.listings set seller_id = '00000000-0000-0000-0000-0000000000b1' where id = '10000000-0000-0000-0000-000000000001'$q$);
select tsec.expect_ok('seller can still edit an unsold listing',
  $q$update public.listings set price = 12 where id = '10000000-0000-0000-0000-000000000001'$q$);
select tsec.expect_ok('seller can archive then re-activate an unsold listing',
  $q$update public.listings set status = 'archived' where id = '10000000-0000-0000-0000-000000000001'; update public.listings set status = 'active' where id = '10000000-0000-0000-0000-000000000001'$q$);
select tsec.act_as('00000000-0000-0000-0000-0000000000b1');
select tsec.expect_eq('other seller updates 0 rows of someone else''s listing',
  tsec.affected($q$update public.listings set price = 1 where id = '10000000-0000-0000-0000-000000000001'$q$)::text, '0');

-- 2. NO CLIENT WRITES ON MONEY TABLES / SPOOFING ---------------------------
select tsec.act_as('00000000-0000-0000-0000-0000000000c1');
select tsec.expect_fail('client cannot update orders', $q$update public.orders set payment_status = 'paid'$q$);
select tsec.expect_fail('client cannot update transactions', $q$update public.transactions set status = 'succeeded'$q$);
select tsec.expect_fail('client cannot insert wallet transactions',
  $q$insert into public.wallet_transactions (wallet_id, user_id, type, amount, status, reference) values (gen_random_uuid(), auth.uid(), 'deposit', 100, 'completed', 'x')$q$);
select tsec.expect_fail('client cannot write payment_events', $q$insert into public.payment_events (source, event_type) values ('user', 'x')$q$);

-- 3. SERVICE-ROLE-ONLY FUNCTIONS -------------------------------------------
select tsec.expect_fail('authenticated cannot run expire_unpaid_orders', $q$select public.expire_unpaid_orders(30)$q$);
select tsec.expect_fail('authenticated cannot run settle_payment', $q$select public.settle_payment('r', 'p', 'succeeded', '{}')$q$);
select tsec.expect_fail('authenticated cannot run record_wallet_deposit',
  $q$select public.record_wallet_deposit(auth.uid(), 100, 'x')$q$);
select tsec.as_anon();
select tsec.expect_fail('anon cannot run expire_unpaid_orders', $q$select public.expire_unpaid_orders(30)$q$);

-- 4. ORDER EXPIRY, IDEMPOTENCE, LATE PAYMENT -------------------------------
select tsec.act_as('00000000-0000-0000-0000-0000000000c1');
select tsec.expect_ok('buyer creates an online order',
  $q$select public.create_order('10000000-0000-0000-0000-000000000003', 'card', 'Buyer C', '20000000', '1 rue Test', 'Tunis', null, 'idem-key-0001')$q$);
select tsec.as_admin();
select tsec.expect_eq('listing locked as sold by the order',
  (select status from public.listings where id = '10000000-0000-0000-0000-000000000003'), 'sold');
select tsec.expect_eq('fresh order is NOT expired', (select public.expire_unpaid_orders(30))::text, '0');
update public.orders set created_at = now() - interval '31 minutes';
select tsec.as_service();
select tsec.expect_eq('stale order expires (first run)', (select public.expire_unpaid_orders(30))::text, '1');
select tsec.expect_eq('second run is idempotent', (select public.expire_unpaid_orders(30))::text, '0');
select tsec.as_admin();
select tsec.expect_eq('listing released', (select status from public.listings where id = '10000000-0000-0000-0000-000000000003'), 'active');
select tsec.expect_eq('order cancelled', (select status || '/' || payment_status from public.orders limit 1), 'cancelled/failed');
select tsec.expect_eq('transaction cancelled', (select status from public.transactions limit 1), 'cancelled');
select tsec.expect_eq('audit event written', (select count(*) from public.payment_events where event_type = 'order_expired')::text, '1');
select tsec.expect_eq('no wallet money moved', (select count(*) from public.wallet_transactions)::text, '0');
select tsec.expect_fail('expired order cannot be paid via the normal success path',
  $q$select public._apply_payment_success((select id from public.transactions limit 1), 'user')$q$);
select tsec.as_service();
select tsec.expect_ok('late provider success does not raise',
  $q$select public.settle_payment((select reference from public.transactions limit 1), 'prov-1', 'succeeded', '{}')$q$);
select tsec.expect_ok('duplicate late webhook does not raise',
  $q$select public.settle_payment((select reference from public.transactions limit 1), 'prov-1', 'succeeded', '{}')$q$);
select tsec.as_admin();
select tsec.expect_eq('late payment flagged for manual refund',
  (select status || '/' || payment_status from public.orders limit 1), 'cancelled/refund_pending');
select tsec.expect_eq('flag recorded once', (select count(*) from public.payment_events where event_type = 'late_payment_flagged')::text, '1');
select tsec.expect_fail('refund_pending can never return to paid',
  $q$update public.orders set payment_status = 'paid'$q$);

-- 5. WALLET PURCHASE / PAYMENT REGRESSION -----------------------------------
select tsec.as_admin();
insert into public.listings (id, seller_id, title, description, price, category, condition, location, images, status)
  values ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1',
          'Wallet item', 'Description long enough', 7, 'cat', 'Neuf', 'Tunis',
          array['00000000-0000-0000-0000-0000000000a1/l4/a.jpg'], 'active');
select tsec.as_service();
select tsec.expect_ok('service credits buyer wallet',
  $q$select public.record_wallet_deposit('00000000-0000-0000-0000-0000000000c1', 20, 'security-wallet-0001')$q$);
select tsec.act_as('00000000-0000-0000-0000-0000000000c1');
select tsec.expect_ok('wallet purchase succeeds and applies payment',
  $q$select public.create_order('10000000-0000-0000-0000-000000000004', 'wallet', 'Buyer C', '20000000', '1 rue Test', 'Tunis', null, 'wallet-order-0001')$q$);
select tsec.as_admin();
select tsec.expect_eq('wallet order payment is paid',
  (select payment_status from public.orders where idempotency_key = 'wallet-order-0001'), 'paid');
select tsec.expect_eq('wallet sale proceeds link to order',
  (select count(*) from public.wallet_transactions wt join public.orders o on o.id = wt.order_id
   where o.idempotency_key = 'wallet-order-0001' and wt.type = 'sale_proceeds' and wt.order_id is not null)::text, '1');
select tsec.expect_eq('wallet sale proceeds start pending',
  (select wt.status from public.wallet_transactions wt join public.orders o on o.id = wt.order_id
   where o.idempotency_key = 'wallet-order-0001' and wt.type = 'sale_proceeds'), 'pending');
select tsec.act_as('00000000-0000-0000-0000-0000000000a1');
select tsec.expect_ok('seller processes confirmed wallet order',
  $q$select public.update_order_status((select id from public.orders where idempotency_key = 'wallet-order-0001'), 'processing')$q$);
select tsec.expect_ok('seller ships wallet order',
  $q$select public.update_order_status((select id from public.orders where idempotency_key = 'wallet-order-0001'), 'shipped')$q$);
select tsec.act_as('00000000-0000-0000-0000-0000000000c1');
select tsec.expect_ok('buyer receives wallet order',
  $q$select public.update_order_status((select id from public.orders where idempotency_key = 'wallet-order-0001'), 'delivered')$q$);
select tsec.as_admin();
select tsec.expect_eq('wallet sale proceeds complete on delivery',
  (select wt.status from public.wallet_transactions wt join public.orders o on o.id = wt.order_id
   where o.idempotency_key = 'wallet-order-0001' and wt.type = 'sale_proceeds'), 'completed');

-- 6. MESSAGING ----------------------------------------------------------------
select tsec.act_as('00000000-0000-0000-0000-0000000000c1');
select tsec.expect_ok('buyer opens a conversation',
  $q$select public.start_conversation('10000000-0000-0000-0000-000000000001')$q$);
select tsec.expect_eq('re-opening returns the same conversation (no new row)',
  (select (public.start_conversation('10000000-0000-0000-0000-000000000001') = (select id from public.conversations limit 1))::text), 'true');
select tsec.expect_fail('cannot spoof sender_id',
  $q$insert into public.messages (conversation_id, sender_id, body) values ((select id from public.conversations limit 1), '00000000-0000-0000-0000-0000000000a1', 'hi')$q$);
do $$
declare i integer; cid uuid;
begin
  select id into cid from public.conversations limit 1;
  for i in 1..15 loop
    insert into public.messages (conversation_id, sender_id, body) values (cid, auth.uid(), 'msg ' || i);
  end loop;
  begin
    insert into public.messages (conversation_id, sender_id, body) values (cid, auth.uid(), 'msg 16');
    raise exception 'FAIL: 16th message in a minute was accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: message flood blocked (%)', sqlerrm;
  end;
end $$;
select tsec.expect_fail('cannot start more than 3 conversations with one seller within an hour',
  $q$select public.start_conversation(id) from public.listings
       where seller_id = '00000000-0000-0000-0000-0000000000a1' and status = 'active'$q$);

-- 6. STORAGE ------------------------------------------------------------------
select tsec.act_as('00000000-0000-0000-0000-0000000000c1');
select tsec.expect_fail('cannot upload into another user''s folder',
  $q$insert into storage.objects (bucket_id, name, owner) values ('souqtn-listings', '00000000-0000-0000-0000-0000000000a1/l9/x.jpg', auth.uid())$q$);
select tsec.expect_fail('cannot upload a non-image extension',
  $q$insert into storage.objects (bucket_id, name, owner) values ('souqtn-listings', '00000000-0000-0000-0000-0000000000c1/l9/x.exe', auth.uid())$q$);
select tsec.expect_fail('cannot upload with the wrong path depth',
  $q$insert into storage.objects (bucket_id, name, owner) values ('souqtn-listings', '00000000-0000-0000-0000-0000000000c1/x.jpg', auth.uid())$q$);
select tsec.expect_ok('can upload a listing photo into own folder',
  $q$insert into storage.objects (bucket_id, name, owner) values ('souqtn-listings', '00000000-0000-0000-0000-0000000000c1/l9/x.jpg', auth.uid())$q$);
select tsec.as_anon();
select tsec.expect_fail('anon cannot upload', $q$insert into storage.objects (bucket_id, name) values ('souqtn-avatars', 'x/y.jpg')$q$);
select tsec.expect_eq('anon cannot read an unreferenced private upload',
  (select count(*) from storage.objects where bucket_id = 'souqtn-listings')::text, '0');
select tsec.as_admin();

rollback;
