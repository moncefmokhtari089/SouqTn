create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  full_name text not null,
  avatar_url text,
  phone text,
  location text,
  bio text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, public;
grant select, insert, update on table public.profiles to authenticated;

drop policy if exists "Owners can read their profile" on public.profiles;
create policy "Owners can read their profile"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

drop policy if exists "Owners can create their profile" on public.profiles;
create policy "Owners can create their profile"
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

drop policy if exists "Owners can update their profile" on public.profiles;
create policy "Owners can update their profile"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

insert into storage.buckets (id, name, public)
values ('souqtn-avatars', 'souqtn-avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Owners can upload their avatars" on storage.objects;
create policy "Owners can upload their avatars"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'souqtn-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Owners can update their avatars" on storage.objects;
create policy "Owners can update their avatars"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'souqtn-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'souqtn-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Owners can delete their avatars" on storage.objects;
create policy "Owners can delete their avatars"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'souqtn-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );