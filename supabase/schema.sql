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
