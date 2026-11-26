-- Office CRM, its OWN Supabase project "ServPlus Office" (not the restoration CRM's). Paste ALL of this into
-- SQL Editor once (it is safe to run again). Only the people on office_staff (the owner + the office manager) can
-- use anything, and once someone turns on 2-step sign-in, their login only works with the phone code too.
-- 🔒 No Social Security numbers are ever stored. Saved passwords arrive already locked (vault.js), scrambled.

-- ---------- Who may use it ----------
create table if not exists public.office_staff (
  email text primary key,
  name text not null default '',
  added_at timestamptz not null default now()
);
alter table public.office_staff enable row level security;

-- Staff = on the list AND (no 2-step set up yet OR signed in with the 2-step code)
create or replace function public.office_is_staff() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from public.office_staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    and (
      coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
    );
$$;
grant execute on function public.office_is_staff() to authenticated;

drop policy if exists "staff read staff" on public.office_staff;
create policy "staff read staff" on public.office_staff for select to authenticated using (public.office_is_staff());
grant select on public.office_staff to authenticated;

-- ---------- The CRM's data: one row per bill, purchase, contact…; one row per setting ----------
-- key = "bills|<id>" for a list item, "k:settings" for everything else. Removed = deleted true (never erased).
create table if not exists public.office_rows (
  key text primary key,
  data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
alter table public.office_rows enable row level security;
create or replace function public.office_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists office_rows_touch on public.office_rows;
create trigger office_rows_touch before insert or update on public.office_rows for each row execute function public.office_touch();

drop policy if exists "staff read rows" on public.office_rows;
drop policy if exists "staff add rows" on public.office_rows;
drop policy if exists "staff change rows" on public.office_rows;
create policy "staff read rows" on public.office_rows for select to authenticated using (public.office_is_staff());
create policy "staff add rows" on public.office_rows for insert to authenticated with check (public.office_is_staff());
create policy "staff change rows" on public.office_rows for update to authenticated using (public.office_is_staff()) with check (public.office_is_staff());
grant select, insert, update on public.office_rows to authenticated;

-- Live updates between the two computers
do $$ begin
  alter publication supabase_realtime add table public.office_rows;
exception when duplicate_object then null; end $$;

-- ---------- History: the version before every change, kept 90 days ----------
create table if not exists public.office_history (
  hid bigserial primary key,
  key text not null,
  data jsonb,
  deleted boolean,
  changed_at timestamptz not null default now(),
  changed_by text
);
alter table public.office_history enable row level security;
drop policy if exists "staff read history" on public.office_history;
create policy "staff read history" on public.office_history for select to authenticated using (public.office_is_staff());
grant select on public.office_history to authenticated;
create or replace function public.office_keep_history() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.office_history (key, data, deleted, changed_by) values (old.key, old.data, old.deleted, new.updated_by);
  delete from public.office_history where changed_at < now() - interval '90 days';
  return new;
end $$;
drop trigger if exists office_rows_history on public.office_rows;
create trigger office_rows_history before update on public.office_rows for each row execute function public.office_keep_history();

-- ---------- Scanned originals (pictures, PDFs, emails): private storage ----------
insert into storage.buckets (id, name, public) values ('office-files', 'office-files', false) on conflict (id) do nothing;
drop policy if exists "staff read files" on storage.objects;
drop policy if exists "staff add files" on storage.objects;
drop policy if exists "staff change files" on storage.objects;
drop policy if exists "staff remove files" on storage.objects;
create policy "staff read files" on storage.objects for select to authenticated using (bucket_id = 'office-files' and public.office_is_staff());
create policy "staff add files" on storage.objects for insert to authenticated with check (bucket_id = 'office-files' and public.office_is_staff());
create policy "staff change files" on storage.objects for update to authenticated using (bucket_id = 'office-files' and public.office_is_staff());
create policy "staff remove files" on storage.objects for delete to authenticated using (bucket_id = 'office-files' and public.office_is_staff());

-- ---------- Server-only keys (AI spending, etc.). No policies = only the server can read it ----------
create table if not exists public.office_private (
  key text primary key,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.office_private enable row level security;
grant select, insert, update, delete on public.office_private to service_role;

-- ---------- The two people (the office manager's line: put her email in and remove the -- in front) ----------
insert into public.office_staff (email, name) values ('emergencyservicellc@gmail.com', 'Owner') on conflict do nothing;
-- insert into public.office_staff (email, name) values ('<office manager email>', 'Office Manager') on conflict do nothing;
