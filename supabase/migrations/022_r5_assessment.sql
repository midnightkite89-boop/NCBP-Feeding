-- R5 Accommodation Self-Assessment: the latest answers, kept with the other AAL settings.
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.aal_settings add column if not exists r5 jsonb;
