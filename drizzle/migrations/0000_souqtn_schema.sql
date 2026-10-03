create table public.profiles (
  id uuid primary key,
  username text not null unique,
  full_name text not null,
  avatar_url text,
  phone text,
  location text,
  bio text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "Owners can read their profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "Owners can create their profile" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "Owners can update their profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  description text not null check (char_length(btrim(description)) between 10 and 5000),
  price numeric(12, 3) not null check (price > 0),
  category text not null check (char_length(btrim(category)) between 1 and 80),
  condition text not null check (condition in ('Neuf', 'Comme neuf', 'Très bon état', 'Bon état')),
  location text not null check (char_length(btrim(location)) between 1 and 120),
  images text[] not null check (cardinality(images) between 1 and 5),
  status text not null default 'active' check (status in ('active', 'sold', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index listings_active_created_at_idx on public.listings (created_at desc) where status = 'active';
create index listings_seller_id_idx on public.listings (seller_id);

create or replace function public.set_listing_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;
create trigger listings_set_updated_at before update on public.listings for each row execute function public.set_listing_updated_at();

grant select on public.listings to anon, authenticated;
grant insert, update, delete on public.listings to authenticated;
grant all on public.listings to service_role;
alter table public.listings enable row level security;
create policy "Anyone can read active listings and owners can read theirs" on public.listings for select to anon, authenticated using (status = 'active' or seller_id = auth.uid());
create policy "Sellers create their own active listings" on public.listings for insert to authenticated with check (seller_id = auth.uid() and status = 'active');
create policy "Sellers update only their own listings" on public.listings for update to authenticated using (seller_id = auth.uid()) with check (seller_id = auth.uid());
create policy "Sellers delete only their own listings" on public.listings for delete to authenticated using (seller_id = auth.uid());

create or replace function public.get_public_sellers(seller_ids uuid[])
returns table (id uuid, username text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.avatar_url from public.profiles p
  where p.id = any(seller_ids)
    and exists (select 1 from public.listings l where l.seller_id = p.id and l.status = 'active');
$$;
revoke all on function public.get_public_sellers(uuid[]) from public;
grant execute on function public.get_public_sellers(uuid[]) to anon, authenticated;

create policy "Anyone can view avatars and listing photos" on storage.objects for select to anon, authenticated
  using (bucket_id in ('souqtn-avatars', 'souqtn-listings'));
create policy "Owners upload avatars" on storage.objects for insert to authenticated
  with check (bucket_id = 'souqtn-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Owners update avatars" on storage.objects for update to authenticated
  using (bucket_id = 'souqtn-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Owners delete avatars" on storage.objects for delete to authenticated
  using (bucket_id = 'souqtn-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Sellers upload listing photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'souqtn-listings' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Sellers update listing photos" on storage.objects for update to authenticated
  using (bucket_id = 'souqtn-listings' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Sellers delete listing photos" on storage.objects for delete to authenticated
  using (bucket_id = 'souqtn-listings' and (storage.foldername(name))[1] = auth.uid()::text);