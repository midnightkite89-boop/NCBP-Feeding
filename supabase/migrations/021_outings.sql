-- Outings: one record per trip out with birds. Holds what R8 needs for every trip,
-- plus R6 and the site risk assessment (R7) for shows and weddings.
-- Run once in Supabase > SQL Editor. Safe to run twice.
create table if not exists public.outings (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('show', 'wedding', 'school', 'party', 'experience', 'other')),
  venue      text not null,
  start_date date not null,
  end_date   date not null,
  details    jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at  timestamptz
);
create index if not exists outings_start_idx on public.outings (start_date desc);

alter table public.outings enable row level security;
drop policy if exists "read outings" on public.outings;
drop policy if exists "add outings" on public.outings;
drop policy if exists "change outings" on public.outings;
-- Any signed-in staff can fill these in. There's no delete: a mistake is voided and stays on file.
create policy "read outings"   on public.outings for select to authenticated using (true);
create policy "add outings"    on public.outings for insert to authenticated with check (auth.uid() is not null);
create policy "change outings" on public.outings for update to authenticated using (true) with check (auth.uid() is not null);
