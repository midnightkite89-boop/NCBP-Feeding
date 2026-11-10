-- Set up a brand-new centre: paste this whole file into Supabase > SQL Editor > New query, then press Run.
-- Run it once, on an empty project. Built by scripts/build-setup-sql.mjs; do not edit by hand.


-- ===== schema.sql =====
-- SMJ Feeding: database schema
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run.
-- It is safe to run on a fresh project only (it creates tables; it does not migrate).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- "Today" is always the calendar date in Europe/London, decided by the server.
create or replace function public.today_london() returns date
language sql stable as $$
  select (now() at time zone 'Europe/London')::date
$$;

-- ---------------------------------------------------------------------------
-- Staff profiles (one per login; created automatically when a user is added)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text not null,
  role         text not null default 'staff' check (role in ('admin', 'staff')),
  created_at   timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Aviaries and birds
-- ---------------------------------------------------------------------------

create table public.aviaries (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  number     integer,
  slug       text not null unique default substr(md5(gen_random_uuid()::text), 1, 6),
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);
-- An aviary is a section name plus an optional number within it (e.g. Mews 5)
create unique index aviaries_section_number_key on public.aviaries (lower(name), coalesce(number, -1));

create table public.birds (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  species           text,
  sex               text check (sex in ('M', 'F', 'U')),
  photo_path        text,
  aviary_id         uuid references public.aviaries on delete set null,
  target_weight_min numeric(6, 1),
  target_weight_max numeric(6, 1),
  weight_unit       text not null default 'g' check (weight_unit in ('g', 'lb_oz')),  -- weights are always stored in grams
  default_food      text,
  default_portion   text,
  feeds_per_day     smallint not null default 1 check (feeds_per_day between 1 and 6),
  -- ISO weekdays: 1 = Monday ... 7 = Sunday
  fast_days         smallint[] not null default '{}',
  care_notes        text,
  route_order       integer,  -- position on the feeding round; empty = end of the list
  status            text not null default 'active' check (status in ('active', 'archived')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index birds_name_key on public.birds (lower(name));

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger birds_touch before update on public.birds
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Feed logs
-- Logs are never edited or deleted. A mistake is "voided", which keeps a record
-- of who voided it and when.
-- ---------------------------------------------------------------------------

create table public.feed_logs (
  id         uuid primary key default gen_random_uuid(),  -- phones generate this so offline retries can't double-log
  bird_id    uuid not null references public.birds on delete cascade,
  logged_at  timestamptz not null default now(),          -- when the staff member tapped
  log_date   date not null,                               -- set by the server (Europe/London)
  staff_id   uuid not null references public.profiles,
  status     text not null check (status in ('fed', 'fasting', 'weighed', 'flown')),  -- weighed = weight only; flown = flight, logged_at is the flight time
  food_type  text,
  amount     text,
  weight_g   numeric(6, 1) check (weight_g > 0),
  notes      text,
  more_due   boolean not null default false,              -- true = bird still needs more food later today
  more_due_amount text,                                   -- how much more, e.g. '1 chick'
  session_id uuid,                                        -- flights logged together as one session
  flight_type text check (flight_type in ('display', 'experience', 'training', 'school', 'other')),  -- for flown logs
  synced_at  timestamptz not null default now(),
  voided_by  uuid references public.profiles,
  voided_at  timestamptz
);
create index feed_logs_date_idx on public.feed_logs (log_date);
create index feed_logs_bird_idx on public.feed_logs (bird_id, logged_at desc);

create or replace function public.feed_logs_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.staff_id  := auth.uid();
  -- Trust the phone's tap time (needed for logs queued offline) but never in the
  -- future and never more than 2 days old, so a wrong phone clock can't do damage.
  new.logged_at := greatest(least(coalesce(new.logged_at, now()), now()), now() - interval '2 days');
  new.log_date  := (new.logged_at at time zone 'Europe/London')::date;
  new.synced_at := now();
  new.voided_by := null;
  new.voided_at := null;
  return new;
end $$;

create trigger feed_logs_insert before insert on public.feed_logs
  for each row execute function public.feed_logs_before_insert();

create or replace function public.void_feed_log(log_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.feed_logs
     set voided_by = auth.uid(), voided_at = now()
   where id = log_id and voided_at is null;
end $$;

-- ---------------------------------------------------------------------------
-- Special requests (bird_id empty = general notice for everyone)
-- ---------------------------------------------------------------------------

create table public.special_requests (
  id          uuid primary key default gen_random_uuid(),
  bird_id     uuid references public.birds on delete cascade,
  instruction text not null check (length(trim(instruction)) > 0),
  created_by  uuid not null references public.profiles,
  created_at  timestamptz not null default now(),
  expires_on  date,              -- null = until cleared; otherwise shown up to and including this date
  cleared_by  uuid references public.profiles,
  cleared_at  timestamptz
);

create or replace function public.special_requests_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  new.cleared_by := null;
  new.cleared_at := null;
  return new;
end $$;

create trigger special_requests_insert before insert on public.special_requests
  for each row execute function public.special_requests_before_insert();

create or replace function public.clear_special_request(request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.special_requests
     set cleared_by = auth.uid(), cleared_at = now()
   where id = request_id and cleared_at is null;
end $$;

-- ---------------------------------------------------------------------------
-- Security rules (Row Level Security)
-- Everyone signed in can read everything. Only the admin can change birds,
-- aviaries and staff roles. Staff add logs and requests; they can never edit
-- or delete them (only void/clear through the functions above).
-- ---------------------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.aviaries         enable row level security;
alter table public.birds            enable row level security;
alter table public.feed_logs        enable row level security;
alter table public.special_requests enable row level security;

create policy "read profiles"   on public.profiles for select to authenticated using (true);
create policy "admin profiles"  on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read aviaries"   on public.aviaries for select to authenticated using (true);
create policy "admin aviaries"  on public.aviaries for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read birds"      on public.birds    for select to authenticated using (true);
create policy "admin birds"     on public.birds    for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read logs"       on public.feed_logs for select to authenticated using (true);
create policy "add logs"        on public.feed_logs for insert to authenticated with check (auth.uid() is not null);

create policy "read requests"   on public.special_requests for select to authenticated using (true);
create policy "add requests"    on public.special_requests for insert to authenticated with check (auth.uid() is not null);
create policy "admin requests"  on public.special_requests for delete to authenticated using (public.is_admin());

revoke execute on function public.void_feed_log(uuid)         from public, anon;
revoke execute on function public.clear_special_request(uuid) from public, anon;
grant  execute on function public.void_feed_log(uuid)         to authenticated;
grant  execute on function public.clear_special_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Live updates to every phone
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.feed_logs, public.special_requests, public.birds, public.aviaries;

-- ---------------------------------------------------------------------------
-- Bird photos (private storage; only the admin uploads)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public) values ('bird-photos', 'bird-photos', false)
on conflict (id) do nothing;

create policy "read bird photos"  on storage.objects for select to authenticated using (bucket_id = 'bird-photos');
create policy "admin add photos"  on storage.objects for insert to authenticated with check (bucket_id = 'bird-photos' and public.is_admin());
create policy "admin edit photos" on storage.objects for update to authenticated using (bucket_id = 'bird-photos' and public.is_admin());
create policy "admin del photos"  on storage.objects for delete to authenticated using (bucket_id = 'bird-photos' and public.is_admin());


-- ===== migrations/002_weight_unit.sql =====
-- Lets each bird be weighed in grams or lb/oz. Weights are still stored in grams.
-- Run once in Supabase > SQL Editor on a database set up before 30 Sep 2026.
alter table public.birds
  add column if not exists weight_unit text not null default 'g'
  check (weight_unit in ('g', 'lb_oz'));


-- ===== migrations/003_more_due_amount.sql =====
-- Records how much more food a bird still needs later today, e.g. '1 chick'.
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.feed_logs add column if not exists more_due_amount text;


-- ===== migrations/004_aviary_sections.sql =====
-- Aviaries become "section + number" (Mews 5, Mews 6 ...), so the same
-- section name can be used many times with different numbers.
-- Run once in Supabase > SQL Editor. Safe to run twice.
drop index if exists public.aviaries_name_key;
create unique index if not exists aviaries_section_number_key on public.aviaries (lower(name), coalesce(number, -1));


-- ===== migrations/005_route_and_flown.sql =====
-- 1. Each bird's position on the feeding round.
-- 2. "flown" as a log type (the log's time is when the bird was flown),
--    with the type of flight: display, experience, training, school or other.
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.birds add column if not exists route_order integer;

alter table public.feed_logs drop constraint if exists feed_logs_status_check;
alter table public.feed_logs add constraint feed_logs_status_check
  check (status in ('fed', 'fasting', 'weighed', 'flown'));

alter table public.feed_logs add column if not exists flight_type text
  check (flight_type in ('display', 'experience', 'training', 'school', 'other'));


-- ===== migrations/006_care.sql =====
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


-- ===== migrations/007_ferrets.sql =====
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


-- ===== migrations/008_sessions.sql =====
-- Groups the flights (and glove feeds) logged together for one experience,
-- display or training session, so you can see which birds took part.
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.feed_logs add column if not exists session_id uuid;
create index if not exists feed_logs_session_idx on public.feed_logs (session_id) where session_id is not null;


-- ===== migrations/009_cleaning_alerts.sql =====
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


-- ===== migrations/010_flight_tracks.sql =====
-- GPS tracks from the Marshall AeroVision app, attached to a logged flight.
-- Only the trimmed track (one point a second) and its stats are kept, not the
-- original file. Run once in Supabase > SQL Editor. Safe to run twice.

create table if not exists public.flight_tracks (
  id            uuid primary key default gen_random_uuid(),
  feed_log_id   uuid not null references public.feed_logs on delete cascade,  -- the "flown" log
  bird_id       uuid not null references public.birds on delete cascade,
  uploaded_by   uuid not null references public.profiles,
  uploaded_at   timestamptz not null default now(),
  file_name     text,
  start_clock   text,          -- e.g. "16:31", from the file
  trim_start    int not null,  -- seconds into the recording
  trim_end      int not null,
  duration_s    int not null,
  distance_m    int not null,
  max_speed_mph numeric,
  avg_speed_mph numeric,
  max_dist_m    numeric,
  gap_s         int not null default 0,
  fast_s        int not null default 0,  -- seconds at 25 mph or more
  track         jsonb not null,          -- [[secs, lat, lon, mph, metres from you, height vs you], ...]
  me_track      jsonb,                   -- [[secs, lat, lon], ...] the receiver
  voided_by     uuid references public.profiles,
  voided_at     timestamptz
);
-- One live track per flight; replacing one voids the old
create unique index if not exists flight_tracks_one_per_log on public.flight_tracks (feed_log_id) where voided_at is null;
create index if not exists flight_tracks_bird_idx on public.flight_tracks (bird_id, uploaded_at desc);

create or replace function public.flight_tracks_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.uploaded_by := auth.uid();
  new.uploaded_at := now();
  new.voided_by   := null;
  new.voided_at   := null;
  -- The bird always matches the flight it's attached to
  select bird_id into new.bird_id from public.feed_logs where id = new.feed_log_id and status = 'flown';
  if new.bird_id is null then raise exception 'GPS tracks can only be added to a flight'; end if;
  -- Replacing: void the flight's current track first
  update public.flight_tracks set voided_by = auth.uid(), voided_at = now()
   where feed_log_id = new.feed_log_id and voided_at is null;
  return new;
end $$;

drop trigger if exists flight_tracks_insert on public.flight_tracks;
create trigger flight_tracks_insert before insert on public.flight_tracks
  for each row execute function public.flight_tracks_before_insert();

create or replace function public.void_flight_track(track_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.flight_tracks set voided_by = auth.uid(), voided_at = now()
   where id = track_id and voided_at is null;
end $$;

alter table public.flight_tracks enable row level security;
drop policy if exists "read tracks" on public.flight_tracks;
drop policy if exists "add tracks" on public.flight_tracks;
create policy "read tracks" on public.flight_tracks for select to authenticated using (true);
create policy "add tracks"  on public.flight_tracks for insert to authenticated with check (auth.uid() is not null);

revoke execute on function public.void_flight_track(uuid) from public, anon;
grant  execute on function public.void_flight_track(uuid) to authenticated;


-- ===== migrations/011_health.sql =====
-- Health: issues tracked with dated photos and notes, medication courses and
-- each dose given. Anyone signed in can add; nothing is edited or deleted,
-- only closed, stopped or voided. Run once in Supabase > SQL Editor. Safe to run twice.

-- ---------------------------------------------------------------------------
-- Issues (e.g. "Dry, cracking front toes"), each with a timeline of entries
-- ---------------------------------------------------------------------------
create table if not exists public.health_issues (
  id               uuid primary key default gen_random_uuid(),
  bird_id          uuid not null references public.birds on delete cascade,
  title            text not null check (length(trim(title)) > 0),
  started_on       date not null default ((now() at time zone 'Europe/London')::date),
  photo_every_days int check (photo_every_days > 0),   -- photo reminder, e.g. every 2 days
  opened_by        uuid not null references public.profiles,
  opened_at        timestamptz not null default now(),
  closed_by        uuid references public.profiles,
  closed_at        timestamptz,
  outcome          text,                                 -- how it ended, e.g. "healed"
  voided_by        uuid references public.profiles,
  voided_at        timestamptz
);
create index if not exists health_issues_bird_idx on public.health_issues (bird_id);

create table if not exists public.health_entries (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null references public.health_issues on delete cascade,
  bird_id     uuid not null references public.birds on delete cascade,
  notes       text,
  action      text,                                -- action taken (R2 "record action taken")
  photo_paths text[] not null default '{}',        -- in the health-photos bucket
  logged_at   timestamptz not null default now(),
  log_date    date not null,
  staff_id    uuid not null references public.profiles,
  voided_by   uuid references public.profiles,
  voided_at   timestamptz
);
create index if not exists health_entries_issue_idx on public.health_entries (issue_id, logged_at);

-- ---------------------------------------------------------------------------
-- Medication: the top half of the paper chart. Doses: the bottom half.
-- ---------------------------------------------------------------------------
create table if not exists public.medications (
  id                 uuid primary key default gen_random_uuid(),
  bird_id            uuid not null references public.birds on delete cascade,
  issue_id           uuid references public.health_issues on delete set null,
  name_dose          text not null check (length(trim(name_dose)) > 0),  -- e.g. "Meloxicam 1.5mg/ml"
  med_type           text not null default 'fluid' check (med_type in ('tablet', 'fluid', 'injection', 'cream', 'drops', 'other')),
  amount             text not null,                 -- e.g. "0.07ml"
  times_per_day      int not null default 1 check (times_per_day between 1 and 6),
  every_days         int not null default 1 check (every_days between 1 and 14),  -- 2 = every other day
  start_date         date not null,
  end_date           date,                          -- null = until stopped
  notes              text,                          -- e.g. "give with food"
  prescribed_by      text,                          -- vet
  prescription_paths text[] not null default '{}',
  created_by         uuid not null references public.profiles,
  created_at         timestamptz not null default now(),
  stopped_by         uuid references public.profiles,
  stopped_at         timestamptz,
  stop_reason        text,
  voided_by          uuid references public.profiles,
  voided_at          timestamptz,
  check (end_date is null or end_date >= start_date)
);
create index if not exists medications_bird_idx on public.medications (bird_id);

create table if not exists public.med_doses (
  id            uuid primary key default gen_random_uuid(),
  medication_id uuid not null references public.medications on delete cascade,
  bird_id       uuid not null references public.birds on delete cascade,
  dose_date     date not null,
  amount        text,
  notes         text,
  logged_at     timestamptz not null default now(),
  staff_id      uuid not null references public.profiles,
  synced_at     timestamptz not null default now(),
  voided_by     uuid references public.profiles,
  voided_at     timestamptz
);
create index if not exists med_doses_med_idx on public.med_doses (medication_id, dose_date);
create index if not exists med_doses_date_idx on public.med_doses (dose_date);

-- ---------------------------------------------------------------------------
-- Who and when are always recorded by the server
-- ---------------------------------------------------------------------------
create or replace function public.health_issues_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.opened_by := auth.uid(); new.opened_at := now();
  new.closed_by := null; new.closed_at := null; new.outcome := null;
  new.voided_by := null; new.voided_at := null;
  return new;
end $$;
drop trigger if exists health_issues_insert on public.health_issues;
create trigger health_issues_insert before insert on public.health_issues for each row execute function public.health_issues_before_insert();

create or replace function public.health_entries_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.staff_id  := auth.uid();
  new.logged_at := greatest(least(coalesce(new.logged_at, now()), now()), now() - interval '2 days');
  new.log_date  := (new.logged_at at time zone 'Europe/London')::date;
  select bird_id into new.bird_id from public.health_issues where id = new.issue_id;
  new.voided_by := null; new.voided_at := null;
  return new;
end $$;
drop trigger if exists health_entries_insert on public.health_entries;
create trigger health_entries_insert before insert on public.health_entries for each row execute function public.health_entries_before_insert();

create or replace function public.medications_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := auth.uid(); new.created_at := now();
  new.stopped_by := null; new.stopped_at := null; new.stop_reason := null;
  new.voided_by := null; new.voided_at := null;
  return new;
end $$;
drop trigger if exists medications_insert on public.medications;
create trigger medications_insert before insert on public.medications for each row execute function public.medications_before_insert();

create or replace function public.med_doses_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.staff_id  := auth.uid();
  new.logged_at := greatest(least(coalesce(new.logged_at, now()), now()), now() - interval '2 days');
  new.synced_at := now();
  select bird_id into new.bird_id from public.medications where id = new.medication_id;
  new.voided_by := null; new.voided_at := null;
  return new;
end $$;
drop trigger if exists med_doses_insert on public.med_doses;
create trigger med_doses_insert before insert on public.med_doses for each row execute function public.med_doses_before_insert();

-- ---------------------------------------------------------------------------
-- Changes allowed after the fact
-- ---------------------------------------------------------------------------
create or replace function public.close_health_issue(p_id uuid, p_outcome text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.health_issues set closed_by = auth.uid(), closed_at = now(), outcome = nullif(trim(p_outcome), '')
   where id = p_id and closed_at is null;
end $$;

create or replace function public.reopen_health_issue(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.health_issues set closed_by = null, closed_at = null, outcome = null where id = p_id;
end $$;

create or replace function public.set_photo_reminder(p_id uuid, p_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.health_issues set photo_every_days = nullif(p_days, 0) where id = p_id;
end $$;

create or replace function public.stop_medication(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.medications set stopped_by = auth.uid(), stopped_at = now(), stop_reason = nullif(trim(p_reason), '')
   where id = p_id and stopped_at is null;
end $$;

create or replace function public.void_health_row(p_table text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_table = 'health_entries' then update public.health_entries set voided_by = auth.uid(), voided_at = now() where id = p_id and voided_at is null;
  elsif p_table = 'med_doses' then update public.med_doses set voided_by = auth.uid(), voided_at = now() where id = p_id and voided_at is null;
  elsif p_table = 'medications' then update public.medications set voided_by = auth.uid(), voided_at = now() where id = p_id and voided_at is null;
  elsif p_table = 'health_issues' then update public.health_issues set voided_by = auth.uid(), voided_at = now() where id = p_id and voided_at is null;
  else raise exception 'Unknown table %', p_table;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Security: everyone signed in reads and adds; changes only through the functions above
-- ---------------------------------------------------------------------------
alter table public.health_issues  enable row level security;
alter table public.health_entries enable row level security;
alter table public.medications    enable row level security;
alter table public.med_doses      enable row level security;

drop policy if exists "read issues" on public.health_issues;   drop policy if exists "add issues" on public.health_issues;
drop policy if exists "read entries" on public.health_entries; drop policy if exists "add entries" on public.health_entries;
drop policy if exists "read meds" on public.medications;       drop policy if exists "add meds" on public.medications;
drop policy if exists "read doses" on public.med_doses;        drop policy if exists "add doses" on public.med_doses;
create policy "read issues"  on public.health_issues  for select to authenticated using (true);
create policy "add issues"   on public.health_issues  for insert to authenticated with check (auth.uid() is not null);
create policy "read entries" on public.health_entries for select to authenticated using (true);
create policy "add entries"  on public.health_entries for insert to authenticated with check (auth.uid() is not null);
create policy "read meds"    on public.medications    for select to authenticated using (true);
create policy "add meds"     on public.medications    for insert to authenticated with check (auth.uid() is not null);
create policy "read doses"   on public.med_doses      for select to authenticated using (true);
create policy "add doses"    on public.med_doses      for insert to authenticated with check (auth.uid() is not null);

do $$
declare f text;
begin
  foreach f in array array['close_health_issue(uuid, text)', 'reopen_health_issue(uuid)', 'set_photo_reminder(uuid, int)', 'stop_medication(uuid, text)', 'void_health_row(text, uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Photos of injuries and prescriptions: private; staff can add, nobody deletes from the app
insert into storage.buckets (id, name, public) values ('health-photos', 'health-photos', false) on conflict (id) do nothing;
drop policy if exists "read health photos" on storage.objects;
drop policy if exists "add health photos" on storage.objects;
create policy "read health photos" on storage.objects for select to authenticated using (bucket_id = 'health-photos');
create policy "add health photos"  on storage.objects for insert to authenticated with check (bucket_id = 'health-photos');

-- Live updates
do $$ begin alter publication supabase_realtime add table public.health_issues;  exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.health_entries; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.medications;    exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.med_doses;      exception when duplicate_object then null; end $$;


-- ===== migrations/012_drive_folders.sql =====
-- Each bird's folder in the SMJ Falconry Database on Google Drive (01 Birds).
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.birds add column if not exists drive_folder_url text;


-- ===== migrations/013_ferret_weights.sql =====
-- Individual ferrets and their weights. Weights are ferret_logs with kind 'weigh'.
-- Run once in Supabase > SQL Editor. Safe to run twice.

create table if not exists public.ferrets (
  id       uuid primary key default gen_random_uuid(),
  cage_id  uuid references public.ferret_cages on delete set null,
  name     text not null,             -- e.g. "Polecat male 1" (rename to their real names any time)
  sort     int not null default 0,
  archived boolean not null default false
);

-- Starting list: polecat males x2 (Boys), polecat female x1 and albino females x2 (Girls)
insert into public.ferrets (cage_id, name, sort)
select c.id, f.name, f.sort
from (values ('Boys', 'Polecat male 1', 1), ('Boys', 'Polecat male 2', 2),
             ('Girls', 'Polecat female', 3), ('Girls', 'Albino female 1', 4), ('Girls', 'Albino female 2', 5)) as f(cage, name, sort)
left join public.ferret_cages c on c.name = f.cage
where not exists (select 1 from public.ferrets);

alter table public.ferret_logs add column if not exists ferret_id uuid references public.ferrets on delete cascade;
alter table public.ferret_logs add column if not exists weight_g numeric check (weight_g > 0 and weight_g < 10000);
alter table public.ferret_logs drop constraint if exists ferret_logs_kind_check;
alter table public.ferret_logs add constraint ferret_logs_kind_check check (kind in ('feed', 'clean', 'weigh'));
create index if not exists ferret_logs_weigh_idx on public.ferret_logs (ferret_id, logged_at desc) where kind = 'weigh';

alter table public.ferrets enable row level security;
drop policy if exists "read ferrets" on public.ferrets;
drop policy if exists "admin ferrets" on public.ferrets;
create policy "read ferrets"  on public.ferrets for select to authenticated using (true);
create policy "admin ferrets" on public.ferrets for all to authenticated using (public.is_admin()) with check (public.is_admin());

do $$ begin
  alter publication supabase_realtime add table public.ferrets;
exception when duplicate_object then null; end $$;


-- ===== migrations/014_drive_sync.sql =====
-- Copying to Google Drive: a queue of things to copy, filled automatically.
-- The drive-sync function works through it. Run once in Supabase > SQL Editor. Safe to run twice.

create table if not exists public.drive_queue (
  id         bigserial primary key,
  kind       text not null,    -- bird_photo, health_entry, entry_removed, issue_closed, medication, med_stopped, dose, dose_removed
  ref_id     uuid not null,
  created_at timestamptz not null default now(),
  done_at    timestamptz,
  attempts   int not null default 0,
  last_error text,
  note       text
);
create index if not exists drive_queue_pending_idx on public.drive_queue (id) where done_at is null;

alter table public.drive_queue enable row level security;
drop policy if exists "admin read drive queue" on public.drive_queue;
create policy "admin read drive queue" on public.drive_queue for select to authenticated using (public.is_admin());

create or replace function public.drive_enqueue(p_kind text, p_ref uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.drive_queue (kind, ref_id) values (p_kind, p_ref);
$$;
revoke execute on function public.drive_enqueue(text, uuid) from public, anon, authenticated;

-- Admin: try failed copies again (e.g. after fixing a bird's Drive link)
create or replace function public.drive_retry_failed() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.drive_queue set attempts = 0, last_error = null where done_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.drive_retry_failed() from public, anon;
grant  execute on function public.drive_retry_failed() to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers: what gets copied
-- ---------------------------------------------------------------------------
create or replace function public.drive_on_bird() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.photo_path is not null and (tg_op = 'INSERT' or new.photo_path is distinct from old.photo_path) then
    perform public.drive_enqueue('bird_photo', new.id);
  end if;
  return new;
end $$;
drop trigger if exists drive_bird on public.birds;
create trigger drive_bird after insert or update of photo_path on public.birds for each row execute function public.drive_on_bird();

create or replace function public.drive_on_health_entry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform public.drive_enqueue('health_entry', new.id);
  elsif new.voided_at is not null and old.voided_at is null then perform public.drive_enqueue('entry_removed', new.id);
  end if;
  return new;
end $$;
drop trigger if exists drive_health_entry on public.health_entries;
create trigger drive_health_entry after insert or update of voided_at on public.health_entries for each row execute function public.drive_on_health_entry();

create or replace function public.drive_on_issue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.closed_at is not null and old.closed_at is null then perform public.drive_enqueue('issue_closed', new.id); end if;
  return new;
end $$;
drop trigger if exists drive_issue on public.health_issues;
create trigger drive_issue after update of closed_at on public.health_issues for each row execute function public.drive_on_issue();

create or replace function public.drive_on_medication() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform public.drive_enqueue('medication', new.id);
  elsif new.stopped_at is not null and old.stopped_at is null then perform public.drive_enqueue('med_stopped', new.id);
  end if;
  return new;
end $$;
drop trigger if exists drive_medication on public.medications;
create trigger drive_medication after insert or update of stopped_at on public.medications for each row execute function public.drive_on_medication();

create or replace function public.drive_on_dose() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform public.drive_enqueue('dose', new.id);
  elsif new.voided_at is not null and old.voided_at is null then perform public.drive_enqueue('dose_removed', new.id);
  end if;
  return new;
end $$;
drop trigger if exists drive_dose on public.med_doses;
create trigger drive_dose after insert or update of voided_at on public.med_doses for each row execute function public.drive_on_dose();

-- ---------------------------------------------------------------------------
-- Copy across everything already in the app (only the first time this runs)
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from public.drive_queue) then
    insert into public.drive_queue (kind, ref_id, created_at)
    select k, id, at from (
      select 'bird_photo' k, id, now() at from public.birds where photo_path is not null and status = 'active'
      union all select 'medication', id, created_at from public.medications where voided_at is null
      union all select 'health_entry', id, logged_at from public.health_entries where voided_at is null
      union all select 'dose', id, logged_at from public.med_doses where voided_at is null
      union all select 'issue_closed', id, closed_at from public.health_issues where closed_at is not null and voided_at is null
      union all select 'med_stopped', id, stopped_at from public.medications where stopped_at is not null and voided_at is null
    ) x order by at;
  end if;
end $$;


-- ===== migrations/015_shared_device.sql =====
-- Shared devices (e.g. the shed iPad): one login that several people use.
-- The device asks "who's using it?" and each log records that person as
-- logged_for, alongside the device account in staff_id. Volunteers have no
-- login: their typed first name goes in logged_for_name instead.
-- Run once in Supabase > SQL Editor. Safe to run twice.

alter table public.profiles add column if not exists shared_device boolean not null default false;

alter table public.feed_logs      add column if not exists logged_for uuid references public.profiles;
alter table public.care_logs      add column if not exists logged_for uuid references public.profiles;
alter table public.ferret_logs    add column if not exists logged_for uuid references public.profiles;
alter table public.med_doses      add column if not exists logged_for uuid references public.profiles;
alter table public.health_entries add column if not exists logged_for uuid references public.profiles;

alter table public.feed_logs      add column if not exists logged_for_name text;
alter table public.care_logs      add column if not exists logged_for_name text;
alter table public.ferret_logs    add column if not exists logged_for_name text;
alter table public.med_doses      add column if not exists logged_for_name text;
alter table public.health_entries add column if not exists logged_for_name text;

-- Only a shared-device account may name someone else: a real person (not
-- another device) or a volunteer's name. Anything else is quietly dropped.
create or replace function public.check_logged_for() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.logged_for is not null and (
       new.logged_for = auth.uid()
    or not exists (select 1 from public.profiles where id = auth.uid() and shared_device)
    or not exists (select 1 from public.profiles where id = new.logged_for and not shared_device)
  ) then
    new.logged_for := null;
  end if;
  new.logged_for_name := left(nullif(trim(new.logged_for_name), ''), 40);
  if new.logged_for is not null or not exists (select 1 from public.profiles where id = auth.uid() and shared_device) then
    new.logged_for_name := null;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['feed_logs', 'care_logs', 'ferret_logs', 'med_doses', 'health_entries'] loop
    execute format('drop trigger if exists zz_logged_for on public.%I', t);
    execute format('create trigger zz_logged_for before insert on public.%I for each row execute function public.check_logged_for()', t);
  end loop;
end $$;


-- ===== migrations/016_drive_claim.sql =====
-- Drive copying: each queue item is claimed by one run, so two runs at the same moment
-- (the 5-minute timer and the Copy now button) never copy the same thing twice.
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.drive_queue add column if not exists claimed_at timestamptz;

create or replace function public.drive_claim(p_limit int) returns setof public.drive_queue
language sql security definer set search_path = public as $$
  update public.drive_queue q set claimed_at = now()
   where q.id in (
     select id from public.drive_queue
      where done_at is null and attempts < 10
        and (claimed_at is null or claimed_at < now() - interval '10 minutes')
      order by id
      limit p_limit
      for update skip locked)
  returning q.*;
$$;
revoke execute on function public.drive_claim(int) from public, anon, authenticated;


-- ===== migrations/017_bird_targets.sql =====
-- Staff can change a bird's target weights and usual amount of food (nothing else).
-- Every change to those, by anyone, is logged; only admins can read the log.
-- Run once in Supabase > SQL Editor. Safe to run twice.

create table if not exists public.bird_changes (
  id               bigserial primary key,
  bird_id          uuid not null references public.birds on delete cascade,
  field            text not null,        -- target_weight_min, target_weight_max, default_portion, default_food
  old_value        text,
  new_value        text,
  changed_by       uuid references public.profiles,   -- the signed-in account (null = changed in Supabase directly)
  changed_for      uuid references public.profiles,   -- on a shared device: the person picked
  changed_for_name text,                               -- on a shared device: a volunteer's name
  note             text,
  changed_at       timestamptz not null default now()
);
create index if not exists bird_changes_bird_idx on public.bird_changes (bird_id, changed_at desc);

alter table public.bird_changes enable row level security;
drop policy if exists "admin read bird changes" on public.bird_changes;
create policy "admin read bird changes" on public.bird_changes for select to authenticated using (public.is_admin());

-- Log changes to the target weights and usual food, however they were made
create or replace function public.log_bird_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f   text;
  o   text;
  n   text;
  who uuid := auth.uid();
  forid uuid := nullif(current_setting('smj.changed_for', true), '')::uuid;
  forname text := nullif(current_setting('smj.changed_for_name', true), '');
  why text := nullif(current_setting('smj.change_note', true), '');
begin
  foreach f in array array['target_weight_min', 'target_weight_max', 'default_portion', 'default_food'] loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f) into o, n using old, new;
    if o is distinct from n then
      insert into public.bird_changes (bird_id, field, old_value, new_value, changed_by, changed_for, changed_for_name, note)
      values (new.id, f, o, n, who, forid, forname, why);
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists bird_changes_log on public.birds;
create trigger bird_changes_log after update on public.birds for each row execute function public.log_bird_changes();

-- The one way staff can change a bird: target weights (grams) and usual amount
create or replace function public.set_bird_targets(
  p_bird uuid, p_min numeric, p_max numeric, p_portion text,
  p_note text default null, p_for uuid default null, p_for_name text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare shared boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_min is not null and (p_min <= 0 or p_min > 20000) then raise exception 'Target min must be a weight in grams'; end if;
  if p_max is not null and (p_max <= 0 or p_max > 20000) then raise exception 'Target max must be a weight in grams'; end if;
  if p_min is not null and p_max is not null and p_min > p_max then raise exception 'Target min is bigger than target max'; end if;
  if p_portion is not null and length(trim(p_portion)) > 40 then raise exception 'Amount is too long'; end if;

  -- Only a shared device may say it was someone else
  select shared_device into shared from public.profiles where id = auth.uid();
  perform set_config('smj.changed_for', case when coalesce(shared, false) then coalesce(p_for::text, '') else '' end, true);
  perform set_config('smj.changed_for_name', case when coalesce(shared, false) and p_for is null then coalesce(left(trim(p_for_name), 40), '') else '' end, true);
  perform set_config('smj.change_note', coalesce(left(trim(p_note), 200), ''), true);

  update public.birds
     set target_weight_min = round(p_min, 1),
         target_weight_max = round(p_max, 1),
         default_portion   = nullif(trim(p_portion), '')
   where id = p_bird;
  if not found then raise exception 'Bird not found'; end if;
end $$;

revoke execute on function public.set_bird_targets(uuid, numeric, numeric, text, text, uuid, text) from public, anon;
grant  execute on function public.set_bird_targets(uuid, numeric, numeric, text, text, uuid, text) to authenticated;
revoke execute on function public.log_bird_changes() from public, anon, authenticated;


-- ===== migrations/018_log_corrections.sql =====
-- Corrections: changing a logged feed or flight voids the original and adds a new
-- log that points back to it, so the record shows what was changed, by whom and when.
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.feed_logs add column if not exists replaces uuid references public.feed_logs;
create index if not exists feed_logs_replaces_idx on public.feed_logs (replaces) where replaces is not null;


-- ===== migrations/019_cleaning_alert_level.sql =====
-- How loud the cleaning alerts are (the Clean tab badge and the chip on Today):
--   off   = no alerts
--   quiet = only aviaries past their "overdue" day (the default until the cleaning rota is agreed)
--   full  = overdue aviaries, baths due, daily sections and today's list
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.care_settings add column if not exists alert_level text not null default 'quiet'
  check (alert_level in ('off', 'quiet', 'full'));


-- ===== migrations/020_aal_records.sql =====
-- AAL records: the extra details on each bird for R1 and R2, plus R1/R4 settings.
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.birds add column if not exists scientific_name text;
alter table public.birds add column if not exists ring_microchip text;
alter table public.birds add column if not exists hatch_year int;
alter table public.birds add column if not exists a10_cert text;
alter table public.birds add column if not exists used_for text;
alter table public.birds add column if not exists supplier text;
alter table public.birds add column if not exists hatch_date text;
alter table public.birds add column if not exists arrival_date text;
alter table public.birds add column if not exists age_at_arrival text;
alter table public.birds add column if not exists neutered text;
alter table public.birds add column if not exists insured text;
alter table public.birds add column if not exists housed_alone text;
alter table public.birds add column if not exists enrichment text;
alter table public.birds add column if not exists enrichment_frequency text;
alter table public.birds add column if not exists vaccinations text;
alter table public.birds add column if not exists treatments text;
alter table public.birds add column if not exists feeding_regime text;
alter table public.birds add column if not exists exercise_regime text;
alter table public.birds add column if not exists record_notes text;
alter table public.birds add column if not exists died_on date;
alter table public.birds add column if not exists death_cause text;
alter table public.birds add column if not exists disposal_reason text;
alter table public.birds add column if not exists carcass_disposal text;

-- One row: details printed on R1 and R4
create table if not exists public.aal_settings (
  id              int primary key default 1 check (id = 1),
  owner           text not null default 'SMJ Falconry & Crafts',
  local_authority text,
  vet             jsonb not null default '{}'::jsonb
);
insert into public.aal_settings (id, vet) values (1, '{"name": "Avian Veterinary Services (Richard Jones)", "address": "16 Dalby Court, CW9 7TN", "phone": "01606 350 410"}'::jsonb)
on conflict (id) do nothing;

alter table public.aal_settings enable row level security;
drop policy if exists "read aal settings" on public.aal_settings;
drop policy if exists "admin aal settings" on public.aal_settings;
create policy "read aal settings"  on public.aal_settings for select to authenticated using (true);
create policy "admin aal settings" on public.aal_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());


-- ===== migrations/021_outings.sql =====
-- Outings: one record per trip out with birds. Holds what R8 needs for every trip,
-- plus R6 and the site risk assessment (R7) for shows and weddings.
-- Run once in Supabase > SQL Editor. Safe to run twice.
create table if not exists public.outings (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('show', 'wedding', 'school', 'party', 'experience', 'other')),
  venue      text not null,
  start_date date not null,
  end_date   date not null,
  details    jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at  timestamptz
);
create index if not exists outings_start_idx on public.outings (start_date desc);

alter table public.outings enable row level security;
drop policy if exists "read outings" on public.outings;
drop policy if exists "add outings" on public.outings;
drop policy if exists "change outings" on public.outings;
-- Any signed-in staff can fill these in. There's no delete: a mistake is voided and stays on file.
create policy "read outings"   on public.outings for select to authenticated using (true);
create policy "add outings"    on public.outings for insert to authenticated with check (auth.uid() is not null);
create policy "change outings" on public.outings for update to authenticated using (true) with check (auth.uid() is not null);


-- ===== migrations/022_r5_assessment.sql =====
-- R5 Accommodation Self-Assessment: the latest answers, kept with the other AAL settings.
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.aal_settings add column if not exists r5 jsonb;


-- ===== migrations/023_leftovers_team_rounds.sql =====
-- Food left over, and which birds are weighed.
-- 'left' = food found uneaten (food_type / amount say what was left); it doesn't change whether the bird is fed.
alter table public.feed_logs drop constraint if exists feed_logs_status_check;
alter table public.feed_logs add constraint feed_logs_status_check
  check (status in ('fed', 'fasting', 'weighed', 'flown', 'left'));

-- flying = on the team and weighed daily; resting = flying bird having time off at weight; aviary = not flown, not weighed
alter table public.birds
  add column if not exists team text not null default 'flying'
  check (team in ('flying', 'resting', 'aviary'));

create index if not exists feed_logs_left_idx on public.feed_logs (log_date) where status = 'left';

-- Feeding rounds: some centres feed in more than one round (e.g. an afternoon owl round).
-- Each bird belongs to one round; the names live in care_settings, round 1 first.
alter table public.birds add column if not exists feed_round smallint not null default 1 check (feed_round between 1 and 9);
alter table public.care_settings add column if not exists round_names text[] not null default '{Feeding round}';
