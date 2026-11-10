-- Ferrets: two cages (Boys, Girls), feeding and cleaning logs.
-- Run once in Supabase > SQL Editor. Safe to run twice.

create table if not exists public.ferret_cages (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique,
  ferrets  int not null default 1,     -- how many live in it
  names    text,                       -- the ferrets' names, optional
  sort     int not null default 0,
  archived boolean not null default false
);
insert into public.ferret_cages (name, ferrets, sort) values ('Boys', 2, 1), ('Girls', 4, 2)
on conflict (name) do nothing;

-- feed  = fed (food says what with)
-- clean = cleaned (tasks: spot, full)
create table if not exists public.ferret_logs (
  id        uuid primary key default gen_random_uuid(),
  cage_id   uuid not null references public.ferret_cages on delete cascade,
  kind      text not null check (kind in ('feed', 'clean')),
  food      text,
  tasks     text[] not null default '{}',
  notes     text,
  logged_at timestamptz not null default now(),
  log_date  date not null,
  staff_id  uuid not null references public.profiles,
  synced_at timestamptz not null default now(),
  voided_by uuid references public.profiles,
  voided_at timestamptz
);
create index if not exists ferret_logs_date_idx on public.ferret_logs (log_date);

create or replace function public.ferret_logs_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.staff_id  := auth.uid();
  new.logged_at := greatest(least(coalesce(new.logged_at, now()), now()), now() - interval '2 days');
  new.log_date  := (new.logged_at at time zone 'Europe/London')::date;
  new.synced_at := now();
  new.voided_by := null;
  new.voided_at := null;
  return new;
end $$;

drop trigger if exists ferret_logs_insert on public.ferret_logs;
create trigger ferret_logs_insert before insert on public.ferret_logs
  for each row execute function public.ferret_logs_before_insert();

create or replace function public.void_ferret_log(log_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.ferret_logs set voided_by = auth.uid(), voided_at = now()
   where id = log_id and voided_at is null;
end $$;

alter table public.ferret_cages enable row level security;
alter table public.ferret_logs  enable row level security;
drop policy if exists "read ferret cages"  on public.ferret_cages;
drop policy if exists "admin ferret cages" on public.ferret_cages;
drop policy if exists "read ferret logs"   on public.ferret_logs;
drop policy if exists "add ferret logs"    on public.ferret_logs;
create policy "read ferret cages"  on public.ferret_cages for select to authenticated using (true);
create policy "admin ferret cages" on public.ferret_cages for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read ferret logs"   on public.ferret_logs  for select to authenticated using (true);
create policy "add ferret logs"    on public.ferret_logs  for insert to authenticated with check (auth.uid() is not null);

revoke execute on function public.void_ferret_log(uuid) from public, anon;
grant  execute on function public.void_ferret_log(uuid) to authenticated;

-- The food buttons for ferrets (admin can change them in the app)
alter table public.care_settings add column if not exists ferret_foods text[] not null
  default '{Ferret biscuits,Raw meat,Chick,Mice,Rabbit,Egg}';

do $$ begin
  alter publication supabase_realtime add table public.ferret_logs;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.ferret_cages;
exception when duplicate_object then null; end $$;
