-- Lets each bird be weighed in grams or lb/oz. Weights are still stored in grams.
-- Run once in Supabase > SQL Editor on a database set up before 30 Sep 2026.
alter table public.birds
  add column if not exists weight_unit text not null default 'g'
  check (weight_unit in ('g', 'lb_oz'));
