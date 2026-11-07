-- Olax Gas: POS (one row per sale). Run once in Supabase SQL Editor.
create table if not exists public.sales (
  id          bigint generated always as identity primary key,
  day         date not null,
  sold_at     timestamptz not null default now(),
  kind        text not null check (kind in ('gas','accessory')),
  item        text,
  kg          numeric not null default 0 check (kg >= 0),
  price       numeric not null default 0 check (price >= 0),
  amount      numeric not null check (amount >= 0),
  method      text not null check (method in ('cash','pos','transfer')),
  created_by  uuid default auth.uid() references auth.users(id)
);
create index if not exists sales_day_idx on public.sales(day);

-- gas sales always use the price set by the owner; amount = kg x price
create or replace function public.sales_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'gas' then
    select price_per_kg into new.price from public.settings where id = 1;
    new.amount := round(new.kg * new.price);
    new.item := null;
  else
    new.kg := 0; new.price := 0;
  end if;
  new.created_by := auth.uid();
  return new;
end $$;
drop trigger if exists sales_fill on public.sales;
create trigger sales_fill before insert or update on public.sales for each row execute function public.sales_fill();

alter table public.sales enable row level security;
drop policy if exists "sales partners" on public.sales;
drop policy if exists "sales salesman read" on public.sales;
drop policy if exists "sales salesman insert" on public.sales;
drop policy if exists "sales salesman delete" on public.sales;
create policy "sales partners" on public.sales for all
  using (public.my_role() in ('owner','partner')) with check (public.my_role() in ('owner','partner'));
create policy "sales salesman read" on public.sales for select
  using (public.my_role() = 'salesman' and day >= current_date - 14);
create policy "sales salesman insert" on public.sales for insert
  with check (public.my_role() = 'salesman' and day between current_date - 1 and current_date + 1);
-- salesman can undo his own sale within 30 minutes
create policy "sales salesman delete" on public.sales for delete
  using (public.my_role() = 'salesman' and created_by = auth.uid() and sold_at > now() - interval '30 minutes');

grant select, insert, update, delete on public.sales to authenticated;
grant usage, select on all sequences in schema public to authenticated;
