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
