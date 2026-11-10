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
