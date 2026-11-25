-- Office CRM, its OWN Supabase project (not the restoration CRM's). Paste into SQL Editor once.
-- Only the people on office_staff (the owner + the office manager) can use anything.
-- 🔒 No Social Security numbers are ever stored.

create table if not exists public.office_staff (
  email text primary key,
  name text not null default '',
  added_at timestamptz not null default now()
);
alter table public.office_staff enable row level security;

create or replace function public.office_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.office_staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
grant execute on function public.office_is_staff() to authenticated;

create policy "staff read staff" on public.office_staff for select to authenticated using (public.office_is_staff());

-- Server-only keys (AI spending, etc.). No policies = nobody but the server (service_role) can read it.
create table if not exists public.office_private (
  key text primary key,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.office_private enable row level security;
grant select, insert, update, delete on public.office_private to service_role;

-- First people (change the emails before running):
-- insert into public.office_staff (email, name) values ('emergencyservicellc@gmail.com', 'Owner'), ('<office manager login>', 'Office Manager');
