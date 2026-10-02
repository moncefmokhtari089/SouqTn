create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users (id) on delete cascade,
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

create index if not exists listings_active_created_at_idx
  on public.listings (created_at desc)
  where status = 'active';
create index if not exists listings_seller_id_idx
  on public.listings (seller_id);

create or replace function public.set_listing_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists listings_set_updated_at on public.listings;
create trigger listings_set_updated_at
  before update on public.listings
  for each row execute function public.set_listing_updated_at();

alter table public.listings enable row level security;
grant select on table public.listings to anon, authenticated;
grant insert, update, delete on table public.listings to authenticated;

drop policy if exists "Anyone can read active listings and owners can read theirs" on public.listings;
create policy "Anyone can read active listings and owners can read theirs"
  on public.listings for select
  to anon, authenticated
  using (status = 'active' or seller_id = (select auth.uid()));

drop policy if exists "Authenticated sellers can create their own active listings" on public.listings;
create policy "Authenticated sellers can create their own active listings"
  on public.listings for insert
  to authenticated
  with check (seller_id = (select auth.uid()) and status = 'active');

drop policy if exists "Sellers can update only their own listings" on public.listings;
create policy "Sellers can update only their own listings"
  on public.listings for update
  to authenticated
  using (seller_id = (select auth.uid()))
  with check (seller_id = (select auth.uid()));

drop policy if exists "Sellers can delete only their own listings" on public.listings;
create policy "Sellers can delete only their own listings"
  on public.listings for delete
  to authenticated
  using (seller_id = (select auth.uid()));

create or replace view public.marketplace_seller_public
with (security_invoker = false)
as
select profile.id, profile.username, profile.avatar_url
from public.profiles as profile
where exists (
  select 1
  from public.listings as listing
  where listing.seller_id = profile.id
    and listing.status = 'active'
);
grant select on public.marketplace_seller_public to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'souqtn-listings',
  'souqtn-listings',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read listing photos" on storage.objects;
create policy "Public can read listing photos"
  on storage.objects for select
  to public
  using (bucket_id = 'souqtn-listings');

drop policy if exists "Sellers can upload their listing photos" on storage.objects;
create policy "Sellers can upload their listing photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'souqtn-listings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Sellers can update their listing photos" on storage.objects;
create policy "Sellers can update their listing photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'souqtn-listings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'souqtn-listings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Sellers can delete their listing photos" on storage.objects;
create policy "Sellers can delete their listing photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'souqtn-listings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );