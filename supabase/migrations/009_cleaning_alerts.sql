-- Cleaning alerts: timings per section and per aviary, bath checks and bath
-- cleans, a shared "today's cleaning list" and a weekly rota.
-- Run once in Supabase > SQL Editor. Safe to run twice.

-- ---------------------------------------------------------------------------
-- Timings. An aviary uses its own numbers if set, else its section's, else the
-- defaults in care_settings (clean_due_days / clean_overdue_days).
-- ---------------------------------------------------------------------------
alter table public.aviaries add column if not exists clean_due_days int check (clean_due_days > 0);
alter table public.aviaries add column if not exists clean_overdue_days int check (clean_overdue_days > 0);
alter table public.aviaries add column if not exists has_bath boolean not null default true;

alter table public.care_settings add column if not exists section_rules jsonb not null default '{}'::jsonb;  -- {"Back": {"due": 7, "overdue": 14}}
alter table public.care_settings add column if not exists bath_check_days int not null default 1;          -- check every bath this often
alter table public.care_settings add column if not exists bath_clean_days int not null default 3;          -- clean every bath this often
alter table public.care_settings add column if not exists suggest_count int not null default 6;            -- "Suggest" adds this many aviaries
alter table public.care_settings add column if not exists rota jsonb not null default '{}'::jsonb;         -- {"1": ["Back"], ...} 1 = Monday

-- ---------------------------------------------------------------------------
-- New care log kinds: a bath checked, a bath cleaned (per aviary)
-- ---------------------------------------------------------------------------
alter table public.care_logs drop constraint if exists care_logs_kind_check;
alter table public.care_logs add constraint care_logs_kind_check
  check (kind in ('aviary_clean', 'section_clean', 'bird_check', 'baths_in', 'baths_out', 'bath_check', 'bath_clean'));

-- ---------------------------------------------------------------------------
-- Today's cleaning list. Anyone can add or take off an aviary for a day.
-- The latest row for an aviary on a day wins: removed_at set = taken off.
-- Rota aviaries are on the list without a row, unless taken off.
-- ---------------------------------------------------------------------------
create table if not exists public.clean_plan (
  id         uuid primary key default gen_random_uuid(),
  plan_date  date not null,
  aviary_id  uuid not null references public.aviaries on delete cascade,
  added_by   uuid not null references public.profiles,
  added_at   timestamptz not null default now(),
  removed_by uuid references public.profiles,
  removed_at timestamptz
);
create index if not exists clean_plan_date_idx on public.clean_plan (plan_date);

-- Take an aviary off a day's list (works for rota aviaries too)
create or replace function public.remove_from_clean_plan(p_date date, p_aviary uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.clean_plan (plan_date, aviary_id, added_by, added_at, removed_by, removed_at)
  values (p_date, p_aviary, auth.uid(), now(), auth.uid(), now());
end $$;

-- Staff inserts always record who and when, and can't pre-mark a row removed.
-- Runs as the caller (not security definer) so current_user tells them apart:
-- remove_from_clean_plan runs as the table owner, so its "removed" row is kept.
create or replace function public.clean_plan_before_insert() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if current_user = 'authenticated' then
    new.added_by   := auth.uid();
    new.added_at   := now();
    new.removed_by := null;
    new.removed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists clean_plan_insert on public.clean_plan;
create trigger clean_plan_insert before insert on public.clean_plan
  for each row execute function public.clean_plan_before_insert();

alter table public.clean_plan enable row level security;
drop policy if exists "read plan" on public.clean_plan;
drop policy if exists "add to plan" on public.clean_plan;
create policy "read plan"   on public.clean_plan for select to authenticated using (true);
create policy "add to plan" on public.clean_plan for insert to authenticated with check (auth.uid() is not null);

revoke execute on function public.remove_from_clean_plan(date, uuid) from public, anon;
grant  execute on function public.remove_from_clean_plan(date, uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.clean_plan;
exception when duplicate_object then null; end $$;
