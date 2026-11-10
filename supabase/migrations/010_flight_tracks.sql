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
