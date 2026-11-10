-- Groups the flights (and glove feeds) logged together for one experience,
-- display or training session, so you can see which birds took part.
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.feed_logs add column if not exists session_id uuid;
create index if not exists feed_logs_session_idx on public.feed_logs (session_id) where session_id is not null;
