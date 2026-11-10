-- Aviaries become "section + number" (Mews 5, Mews 6 ...), so the same
-- section name can be used many times with different numbers.
-- Run once in Supabase > SQL Editor. Safe to run twice.
drop index if exists public.aviaries_name_key;
create unique index if not exists aviaries_section_number_key on public.aviaries (lower(name), coalesce(number, -1));
