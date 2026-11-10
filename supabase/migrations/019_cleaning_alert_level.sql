-- How loud the cleaning alerts are (the Clean tab badge and the chip on Today):
--   off   = no alerts
--   quiet = only aviaries past their "overdue" day (the default until the cleaning rota is agreed)
--   full  = overdue aviaries, baths due, daily sections and today's list
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.care_settings add column if not exists alert_level text not null default 'quiet'
  check (alert_level in ('off', 'quiet', 'full'));
