-- Stock list for the zoo standards: when each bird came into the collection and when it left,
-- plus each species' IUCN Red List status and hazard category.
alter table public.birds
  add column if not exists came_on   date,
  add column if not exists came_kind text check (came_kind in ('arrived', 'born')),
  add column if not exists came_from text,          -- where it arrived from
  add column if not exists left_on   date,
  add column if not exists left_kind text check (left_kind in ('died', 'departed')),
  add column if not exists left_note text,          -- cause of death, or where it went
  add column if not exists zims_id   text;          -- local ID or GAN, to match ZIMS

create table if not exists public.species_info (
  species         text primary key,       -- the common name as used on the birds, lower case
  scientific_name text,
  iucn            text,                   -- e.g. LC, NT, VU, EN, CR
  hazard          text not null default '2',
  updated_at      timestamptz not null default now()
);
alter table public.species_info enable row level security;
drop policy if exists "read species" on public.species_info;
drop policy if exists "admin species" on public.species_info;
create policy "read species"  on public.species_info for select to authenticated using (true);
create policy "admin species" on public.species_info for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Every species already in the collection, hazard 2, condors 1 (admins change the rest in the app)
insert into public.species_info (species, hazard)
select distinct lower(trim(species)), case when species ilike '%condor%' then '1' else '2' end
from public.birds where species is not null and trim(species) <> ''
on conflict (species) do nothing;
