-- Periodic hands-on checks for birds that aren't handled day to day (breeding and aviary birds):
-- caught up, weighed, condition scored, beak and talons coped. Due again after care_settings.checkup_every_days.
create table if not exists public.bird_checkups (
  id              uuid primary key default gen_random_uuid(),
  bird_id         uuid not null references public.birds on delete cascade,
  checked_on      date not null,                -- the day it was done (can be logged afterwards)
  weight_g        numeric check (weight_g is null or (weight_g > 0 and weight_g < 20000)),
  condition_score numeric check (condition_score is null or (condition_score >= 1 and condition_score <= 5)),
  coped_beak      boolean not null default false,
  coped_talons    boolean not null default false,
  notes           text,
  logged_at       timestamptz not null default now(),
  staff_id        uuid not null references public.profiles,
  voided_by       uuid references public.profiles,
  voided_at       timestamptz
);
create index if not exists bird_checkups_bird_idx on public.bird_checkups (bird_id, checked_on);

alter table public.care_settings add column if not exists checkup_every_days int not null default 182;

create or replace function public.bird_checkups_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.staff_id  := auth.uid();
  new.logged_at := now();
  -- Not in the future, and not more than a year back
  new.checked_on := greatest(least(coalesce(new.checked_on, public.today_london()), public.today_london()), public.today_london() - 366);
  new.voided_by := null; new.voided_at := null;
  return new;
end $$;
drop trigger if exists bird_checkups_insert on public.bird_checkups;
create trigger bird_checkups_insert before insert on public.bird_checkups for each row execute function public.bird_checkups_before_insert();

create or replace function public.void_checkup(log_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.bird_checkups set voided_by = auth.uid(), voided_at = now() where id = log_id and voided_at is null;
end $$;
revoke execute on function public.void_checkup(uuid) from public, anon;
grant execute on function public.void_checkup(uuid) to authenticated;

alter table public.bird_checkups enable row level security;
drop policy if exists "read checkups" on public.bird_checkups;
drop policy if exists "add checkups" on public.bird_checkups;
create policy "read checkups" on public.bird_checkups for select to authenticated using (true);
create policy "add checkups"  on public.bird_checkups for insert to authenticated with check (auth.uid() is not null);
do $$ begin alter publication supabase_realtime add table public.bird_checkups; exception when duplicate_object then null; end $$;
