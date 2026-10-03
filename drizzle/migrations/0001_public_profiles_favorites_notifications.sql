-- 1. Public seller info via safe projection (phone/bio/email never returned)
create or replace function public.get_public_profiles(profile_ids uuid[])
returns table (id uuid, username text, full_name text, avatar_url text, location text)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.full_name, p.avatar_url, p.location
  from public.profiles p where p.id = any(profile_ids);
$$;
revoke all on function public.get_public_profiles(uuid[]) from public;
grant execute on function public.get_public_profiles(uuid[]) to anon, authenticated;

-- 2. listings.seller_id -> profiles.id, RESTRICT so a profile delete never removes listings
alter table public.listings
  add constraint listings_seller_id_fkey foreign key (seller_id)
  references public.profiles(id) on delete restrict not valid;
alter table public.listings validate constraint listings_seller_id_fkey;

-- 3. Favorites
create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint favorites_user_listing_key unique (user_id, listing_id)
);
create index favorites_listing_id_idx on public.favorites (listing_id);
grant select, insert, delete on public.favorites to authenticated;
grant all on public.favorites to service_role;
alter table public.favorites enable row level security;
create policy "Users view own favorites" on public.favorites for select to authenticated using (user_id = auth.uid());
create policy "Users add own favorites" on public.favorites for insert to authenticated with check (user_id = auth.uid());
create policy "Users remove own favorites" on public.favorites for delete to authenticated using (user_id = auth.uid());

-- 4. Notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
grant select, update, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;
alter table public.notifications enable row level security;
create policy "Users view own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "Users update own notifications" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete own notifications" on public.notifications for delete to authenticated using (user_id = auth.uid());

-- Only allow toggling "read" from the client
revoke update on public.notifications from authenticated;
grant update (read) on public.notifications to authenticated;

-- Notify a seller when someone favorites their listing (server-side, no client inserts)
create or replace function public.notify_listing_favorited()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_seller uuid; v_title text; v_fan text;
begin
  select seller_id, title into v_seller, v_title from public.listings where id = new.listing_id;
  if v_seller is null or v_seller = new.user_id then return new; end if;
  select username into v_fan from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, title, message)
  values (v_seller, 'Nouveau favori', coalesce(v_fan, 'Un membre') || ' a ajouté « ' || v_title || ' » à ses favoris.');
  return new;
end; $$;
revoke all on function public.notify_listing_favorited() from public, anon, authenticated;
create trigger favorites_notify_seller after insert on public.favorites
  for each row execute function public.notify_listing_favorited();