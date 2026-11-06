-- Olax Gas Sales Book: database, logins and permissions.
-- Run this whole file once in Supabase: SQL Editor > New query > paste > Run.

-- ---------- users & roles ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  full_name   text not null,
  role        text not null check (role in ('owner','partner','salesman')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- the signed-in person's role (null if no profile or deactivated)
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- ---------- settings (one row) ----------
create table if not exists public.settings (
  id            int primary key default 1 check (id = 1),
  price_per_kg  numeric not null default 1300,
  cost_per_kg   numeric not null default 1150,
  salary        numeric not null default 60000,
  reinvest_pct  numeric not null default 50 check (reinvest_pct between 0 and 100),
  partner_a     text not null default 'Sodeeq Gbadegesin',
  partner_b     text not null default 'Olajumoke Abdul Aziz',
  updated_at    timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict do nothing;

-- ---------- daily sales (one row per day) ----------
create table if not exists public.days (
  day         date primary key,
  seller      text,
  kg          numeric not null default 0 check (kg >= 0),
  price       numeric not null default 0 check (price >= 0),
  cost        numeric not null default 0,
  acc         numeric not null default 0 check (acc >= 0),
  cash        numeric not null default 0 check (cash >= 0),
  transfer    numeric not null default 0 check (transfer >= 0),
  notes       text,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);

-- ---------- partner expenses ----------
create table if not exists public.expenses (
  id           bigint generated always as identity primary key,
  date         date not null,
  amount       numeric not null check (amount > 0),
  category     text not null,
  description  text,
  paid_by      text,
  created_by   uuid default auth.uid() references auth.users(id),
  created_at   timestamptz not null default now()
);

-- A day's buying cost is copied from settings when it is first saved.
-- The salesman cannot change the selling price or the cost.
create or replace function public.days_fill() returns trigger
language plpgsql security definer set search_path = public as $$
declare s public.settings;
begin
  select * into s from public.settings where id = 1;
  if tg_op = 'INSERT' or public.my_role() = 'salesman' then
    new.cost := s.cost_per_kg;
  end if;
  if public.my_role() = 'salesman' then
    new.price := s.price_per_kg;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists days_fill on public.days;
create trigger days_fill before insert or update on public.days
for each row execute function public.days_fill();

-- ---------- permissions (row level security) ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.days     enable row level security;
alter table public.expenses enable row level security;

drop policy if exists "profiles read"        on public.profiles;
drop policy if exists "profiles owner write" on public.profiles;
create policy "profiles read" on public.profiles for select
  using (id = auth.uid() or public.my_role() in ('owner','partner'));
create policy "profiles owner write" on public.profiles for all
  using (public.my_role() = 'owner') with check (public.my_role() = 'owner');

drop policy if exists "settings read"         on public.settings;
drop policy if exists "settings owner update" on public.settings;
create policy "settings read" on public.settings for select
  using (public.my_role() is not null);
create policy "settings owner update" on public.settings for update
  using (public.my_role() = 'owner') with check (public.my_role() = 'owner');

drop policy if exists "days partners"         on public.days;
drop policy if exists "days salesman read"    on public.days;
drop policy if exists "days salesman insert"  on public.days;
drop policy if exists "days salesman update"  on public.days;
-- partners: everything
create policy "days partners" on public.days for all
  using (public.my_role() in ('owner','partner'))
  with check (public.my_role() in ('owner','partner'));
-- salesman: sees the last 14 days, can save today and the 2 days before
create policy "days salesman read" on public.days for select
  using (public.my_role() = 'salesman' and day >= current_date - 14);
create policy "days salesman insert" on public.days for insert
  with check (public.my_role() = 'salesman' and day between current_date - 2 and current_date + 1);
create policy "days salesman update" on public.days for update
  using (public.my_role() = 'salesman' and day >= current_date - 2)
  with check (public.my_role() = 'salesman' and day between current_date - 2 and current_date + 1);

drop policy if exists "expenses partners" on public.expenses;
create policy "expenses partners" on public.expenses for all
  using (public.my_role() in ('owner','partner'))
  with check (public.my_role() in ('owner','partner'));

-- ---------- make yourself the owner ----------
-- 1. Authentication > Users > Add user > Create new user
--    Email: sodeeq@olaxgas.app   Password: (your choice)   tick "Auto Confirm User"
-- 2. Then run just the statement below:
--
-- insert into public.profiles (id, username, full_name, role)
-- select id, 'sodeeq', 'Sodeeq Gbadegesin', 'owner' from auth.users where email = 'sodeeq@olaxgas.app'
-- on conflict (id) do update set role = 'owner', active = true;
