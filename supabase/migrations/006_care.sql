-- Cleaning, daily bird checks, concerns, winter baths and cold spots.
-- Run once in Supabase > SQL Editor. Safe to run twice.

-- ---------------------------------------------------------------------------
-- Care log: like feed_logs, never edited or deleted, only voided.
--   aviary_clean  = an aviary was cleaned (tasks say what was done)
--   section_clean = a whole section cleaned (e.g. the Mews, daily)
--   bird_check    = daily check of a bird; concern = true flags a problem
--   baths_in / baths_out = winter: baths taken in for the night / put back out
-- ---------------------------------------------------------------------------
create table if not exists public.care_logs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('aviary_clean', 'section_clean', 'bird_check', 'baths_in', 'baths_out')),
  aviary_id   uuid references public.aviaries on delete cascade,
  section     text,
  bird_id     uuid references public.birds on delete cascade,
  logged_at   timestamptz not null default now(),
  log_date    date not null,
  staff_id    uuid not null references public.profiles,
  tasks       text[] not null default '{}',  -- bath, spot, astroturf, deep, disinfect
  product     text,                          -- disinfectant used, e.g. Safe4
  concern     boolean not null default false,
  notes       text,
  resolved_by uuid references public.profiles,
  resolved_at timestamptz,
  resolution  text,                          -- action taken for a concern
  synced_at   timestamptz not null default now(),
  voided_by   uuid references public.profiles,
  voided_at   timestamptz
);
create index if not exists care_logs_date_idx on public.care_logs (log_date);
create index if not exists care_logs_aviary_idx on public.care_logs (aviary_id, logged_at desc);
create index if not exists care_logs_open_concerns_idx on public.care_logs (concern) where concern and resolved_at is null;

create or replace function public.care_logs_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.staff_id    := auth.uid();
  new.logged_at   := greatest(least(coalesce(new.logged_at, now()), now()), now() - interval '2 days');
  new.log_date    := (new.logged_at at time zone 'Europe/London')::date;
  new.synced_at   := now();
  new.resolved_by := null;
  new.resolved_at := null;
  new.resolution  := null;
  new.voided_by   := null;
  new.voided_at   := null;
  return new;
end $$;

drop trigger if exists care_logs_insert on public.care_logs;
create trigger care_logs_insert before insert on public.care_logs
  for each row execute function public.care_logs_before_insert();

create or replace function public.void_care_log(log_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.care_logs set voided_by = auth.uid(), voided_at = now()
   where id = log_id and voided_at is null;
end $$;

-- Record the action taken for a concern (R3 "Action taken")
create or replace function public.resolve_concern(log_id uuid, action text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if action is null or length(trim(action)) = 0 then raise exception 'Say what action was taken'; end if;
  update public.care_logs set resolved_by = auth.uid(), resolved_at = now(), resolution = trim(action)
   where id = log_id and concern and resolved_at is null;
end $$;

alter table public.care_logs enable row level security;
drop policy if exists "read care" on public.care_logs;
drop policy if exists "add care" on public.care_logs;
create policy "read care" on public.care_logs for select to authenticated using (true);
create policy "add care"  on public.care_logs for insert to authenticated with check (auth.uid() is not null);

revoke execute on function public.void_care_log(uuid) from public, anon;
revoke execute on function public.resolve_concern(uuid, text) from public, anon;
grant  execute on function public.void_care_log(uuid) to authenticated;
grant  execute on function public.resolve_concern(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Settings (one row). Admin can change these in the app.
-- ---------------------------------------------------------------------------
create table if not exists public.care_settings (
  id                 int primary key default 1 check (id = 1),
  clean_due_days     int not null default 7,    -- amber from here
  clean_overdue_days int not null default 14,   -- red from here ("second week max")
  daily_sections     text[] not null default '{Mews}',  -- cleaned as a whole, every day
  products           text[] not null default '{Safe4}', -- disinfectants, first is the default
  winter_start       text not null default '11-01',     -- MM-DD: baths in at night from here...
  winter_end         text not null default '03-31',     -- ...to here
  frost_below        numeric not null default 1         -- frost banner when tonight's low is at or below this (°C)
);
insert into public.care_settings (id) values (1) on conflict (id) do nothing;

alter table public.care_settings enable row level security;
drop policy if exists "read care settings" on public.care_settings;
drop policy if exists "admin care settings" on public.care_settings;
create policy "read care settings"  on public.care_settings for select to authenticated using (true);
create policy "admin care settings" on public.care_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Cold spots: aviaries to check on frost nights
-- ---------------------------------------------------------------------------
alter table public.aviaries add column if not exists cold_spot boolean not null default false;
alter table public.aviaries add column if not exists cold_note text;

-- Live updates
do $$ begin
  alter publication supabase_realtime add table public.care_logs;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.care_settings;
exception when duplicate_object then null; end $$;
