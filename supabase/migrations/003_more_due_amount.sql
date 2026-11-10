-- Records how much more food a bird still needs later today, e.g. '1 chick'.
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.feed_logs add column if not exists more_due_amount text;
