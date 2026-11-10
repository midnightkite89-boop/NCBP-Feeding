-- AAL records: the extra details on each bird for R1 and R2, plus R1/R4 settings.
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.birds add column if not exists scientific_name text;
alter table public.birds add column if not exists ring_microchip text;
alter table public.birds add column if not exists hatch_year int;
alter table public.birds add column if not exists a10_cert text;
alter table public.birds add column if not exists used_for text;
alter table public.birds add column if not exists supplier text;
alter table public.birds add column if not exists hatch_date text;
alter table public.birds add column if not exists arrival_date text;
alter table public.birds add column if not exists age_at_arrival text;
alter table public.birds add column if not exists neutered text;
alter table public.birds add column if not exists insured text;
alter table public.birds add column if not exists housed_alone text;
alter table public.birds add column if not exists enrichment text;
alter table public.birds add column if not exists enrichment_frequency text;
alter table public.birds add column if not exists vaccinations text;
alter table public.birds add column if not exists treatments text;
alter table public.birds add column if not exists feeding_regime text;
alter table public.birds add column if not exists exercise_regime text;
alter table public.birds add column if not exists record_notes text;
alter table public.birds add column if not exists died_on date;
alter table public.birds add column if not exists death_cause text;
alter table public.birds add column if not exists disposal_reason text;
alter table public.birds add column if not exists carcass_disposal text;

-- One row: details printed on R1 and R4
create table if not exists public.aal_settings (
  id              int primary key default 1 check (id = 1),
  owner           text not null default 'SMJ Falconry & Crafts',
  local_authority text,
  vet             jsonb not null default '{}'::jsonb
);
insert into public.aal_settings (id, vet) values (1, '{"name": "Avian Veterinary Services (Richard Jones)", "address": "16 Dalby Court, CW9 7TN", "phone": "01606 350 410"}'::jsonb)
on conflict (id) do nothing;

alter table public.aal_settings enable row level security;
drop policy if exists "read aal settings" on public.aal_settings;
drop policy if exists "admin aal settings" on public.aal_settings;
create policy "read aal settings"  on public.aal_settings for select to authenticated using (true);
create policy "admin aal settings" on public.aal_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
