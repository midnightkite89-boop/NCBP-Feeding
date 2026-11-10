-- Corrections: changing a logged feed or flight voids the original and adds a new
-- log that points back to it, so the record shows what was changed, by whom and when.
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.feed_logs add column if not exists replaces uuid references public.feed_logs;
create index if not exists feed_logs_replaces_idx on public.feed_logs (replaces) where replaces is not null;
