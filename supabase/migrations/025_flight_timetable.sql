-- Owl evenings as a flight type, and today's demonstration timetable.
alter table public.feed_logs drop constraint if exists feed_logs_flight_type_check;
alter table public.feed_logs add constraint feed_logs_flight_type_check
  check (flight_type in ('display', 'experience', 'training', 'school', 'evening', 'other'));

-- The usual demonstration times, e.g. {11:30,13:30,15:30}. Each day staff add the birds to each slot.
alter table public.care_settings add column if not exists demo_times text[] not null default '{}';

-- One row per slot per day. Birds are chosen on the day; logging it records a flight for each bird
-- (sharing session_id), so the flights themselves stay in feed_logs like any other.
create table if not exists public.flight_plan (
  id          uuid primary key default gen_random_uuid(),
  plan_date   date not null default public.today_london(),
  slot_time   text not null check (slot_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  flight_type text not null default 'display' check (flight_type in ('display', 'experience', 'training', 'school', 'evening', 'other')),
  bird_ids    uuid[] not null default '{}',
  session_id  uuid,                       -- set when the slot is logged as flown
  updated_by  uuid references public.profiles default auth.uid(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists flight_plan_slot_key on public.flight_plan (plan_date, slot_time, flight_type);

create or replace function public.flight_plan_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists flight_plan_touch on public.flight_plan;
create trigger flight_plan_touch before insert or update on public.flight_plan for each row execute function public.flight_plan_touch();

-- It's a shared whiteboard: everyone signed in can read and change today's plan
alter table public.flight_plan enable row level security;
drop policy if exists "read plan" on public.flight_plan;
drop policy if exists "write plan" on public.flight_plan;
create policy "read plan" on public.flight_plan for select to authenticated using (true);
create policy "write plan" on public.flight_plan for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
do $$ begin alter publication supabase_realtime add table public.flight_plan; exception when duplicate_object then null; end $$;
