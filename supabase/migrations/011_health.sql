-- Health: issues tracked with dated photos and notes, medication courses and
-- each dose given. Anyone signed in can add; nothing is edited or deleted,
-- only closed, stopped or voided. Run once in Supabase > SQL Editor. Safe to run twice.

-- ---------------------------------------------------------------------------
-- Issues (e.g. "Dry, cracking front toes"), each with a timeline of entries
-- ---------------------------------------------------------------------------
create table if not exists public.health_issues (
  id               uuid primary key default gen_random_uuid(),
  bird_id          uuid not null references public.birds on delete cascade,
  title            text not null check (length(trim(title)) > 0),
  started_on       date not null default ((now() at time zone 'Europe/London')::date),
  photo_every_days int check (photo_every_days > 0),   -- photo reminder, e.g. every 2 days
  opened_by        uuid not null references public.profiles,
  opened_at        timestamptz not null default now(),
  closed_by        uuid references public.profiles,
  closed_at        timestamptz,
  outcome          text,                                 -- how it ended, e.g. "healed"
  voided_by        uuid references public.profiles,
  voided_at        timestamptz
);
create index if not exists health_issues_bird_idx on public.health_issues (bird_id);

create table if not exists public.health_entries (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null references public.health_issues on delete cascade,
  bird_id     uuid not null references public.birds on delete cascade,
  notes       text,
  action      text,                                -- action taken (R2 "record action taken")
  photo_paths text[] not null default '{}',        -- in the health-photos bucket
  logged_at   timestamptz not null default now(),
  log_date    date not null,
  staff_id    uuid not null references public.profiles,
  voided_by   uuid references public.profiles,
  voided_at   timestamptz
);
create index if not exists health_entries_issue_idx on public.health_entries (issue_id, logged_at);

-- ---------------------------------------------------------------------------
-- Medication: the top half of the paper chart. Doses: the bottom half.
-- ---------------------------------------------------------------------------
create table if not exists public.medications (
  id                 uuid primary key default gen_random_uuid(),
  bird_id            uuid not null references public.birds on delete cascade,
  issue_id           uuid references public.health_issues on delete set null,
  name_dose          text not null check (length(trim(name_dose)) > 0),  -- e.g. "Meloxicam 1.5mg/ml"
  med_type           text not null default 'fluid' check (med_type in ('tablet', 'fluid', 'injection', 'cream', 'drops', 'other')),
  amount             text not null,                 -- e.g. "0.07ml"
  times_per_day      int not null default 1 check (times_per_day between 1 and 6),
  every_days         int not null default 1 check (every_days between 1 and 14),  -- 2 = every other day
  start_date         date not null,
  end_date           date,                          -- null = until stopped
  notes              text,                          -- e.g. "give with food"
  prescribed_by      text,                          -- vet
  prescription_paths text[] not null default '{}',
  created_by         uuid not null references public.profiles,
  created_at         timestamptz not null default now(),
  stopped_by         uuid references public.profiles,
  stopped_at         timestamptz,
  stop_reason        text,
  voided_by          uuid references public.profiles,
  voided_at          timestamptz,
  check (end_date is null or end_date >= start_date)
);
create index if not exists medications_bird_idx on public.medications (bird_id);

create table if not exists public.med_doses (
  id            uuid primary key default gen_random_uuid(),
  medication_id uuid not null references public.medications on delete cascade,
  bird_id       uuid not null references public.birds on delete cascade,
  dose_date     date not null,
  amount        text,
  notes         text,
  logged_at     timestamptz not null default now(),
  staff_id      uuid not null references public.profiles,
  synced_at     timestamptz not null default now(),
  voided_by     uuid references public.profiles,
  voided_at     timestamptz
);
create index if not exists med_doses_med_idx on public.med_doses (medication_id, dose_date);
create index if not exists med_doses_date_idx on public.med_doses (dose_date);

-- ---------------------------------------------------------------------------
-- Who and when are always recorded by the server
-- ---------------------------------------------------------------------------
create or replace function public.health_issues_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.opened_by := auth.uid(); new.opened_at := now();
  new.closed_by := null; new.closed_at := null; new.outcome := null;
  new.voided_by := null; new.voided_at := null;
  return new;
end $$;
drop trigger if exists health_issues_insert on public.health_issues;
create trigger health_issues_insert before insert on public.health_issues for each row execute function public.health_issues_before_insert();

create or replace function public.health_entries_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.staff_id  := auth.uid();
  new.logged_at := greatest(least(coalesce(new.logged_at, now()), now()), now() - interval '2 days');
  new.log_date  := (new.logged_at at time zone 'Europe/London')::date;
  select bird_id into new.bird_id from public.health_issues where id = new.issue_id;
  new.voided_by := null; new.voided_at := null;
  return new;
end $$;
drop trigger if exists health_entries_insert on public.health_entries;
create trigger health_entries_insert before insert on public.health_entries for each row execute function public.health_entries_before_insert();

create or replace function public.medications_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := auth.uid(); new.created_at := now();
  new.stopped_by := null; new.stopped_at := null; new.stop_reason := null;
  new.voided_by := null; new.voided_at := null;
  return new;
end $$;
drop trigger if exists medications_insert on public.medications;
create trigger medications_insert before insert on public.medications for each row execute function public.medications_before_insert();

create or replace function public.med_doses_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.staff_id  := auth.uid();
  new.logged_at := greatest(least(coalesce(new.logged_at, now()), now()), now() - interval '2 days');
  new.synced_at := now();
  select bird_id into new.bird_id from public.medications where id = new.medication_id;
  new.voided_by := null; new.voided_at := null;
  return new;
end $$;
drop trigger if exists med_doses_insert on public.med_doses;
create trigger med_doses_insert before insert on public.med_doses for each row execute function public.med_doses_before_insert();

-- ---------------------------------------------------------------------------
-- Changes allowed after the fact
-- ---------------------------------------------------------------------------
create or replace function public.close_health_issue(p_id uuid, p_outcome text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.health_issues set closed_by = auth.uid(), closed_at = now(), outcome = nullif(trim(p_outcome), '')
   where id = p_id and closed_at is null;
end $$;

create or replace function public.reopen_health_issue(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.health_issues set closed_by = null, closed_at = null, outcome = null where id = p_id;
end $$;

create or replace function public.set_photo_reminder(p_id uuid, p_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.health_issues set photo_every_days = nullif(p_days, 0) where id = p_id;
end $$;

create or replace function public.stop_medication(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.medications set stopped_by = auth.uid(), stopped_at = now(), stop_reason = nullif(trim(p_reason), '')
   where id = p_id and stopped_at is null;
end $$;

create or replace function public.void_health_row(p_table text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_table = 'health_entries' then update public.health_entries set voided_by = auth.uid(), voided_at = now() where id = p_id and voided_at is null;
  elsif p_table = 'med_doses' then update public.med_doses set voided_by = auth.uid(), voided_at = now() where id = p_id and voided_at is null;
  elsif p_table = 'medications' then update public.medications set voided_by = auth.uid(), voided_at = now() where id = p_id and voided_at is null;
  elsif p_table = 'health_issues' then update public.health_issues set voided_by = auth.uid(), voided_at = now() where id = p_id and voided_at is null;
  else raise exception 'Unknown table %', p_table;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Security: everyone signed in reads and adds; changes only through the functions above
-- ---------------------------------------------------------------------------
alter table public.health_issues  enable row level security;
alter table public.health_entries enable row level security;
alter table public.medications    enable row level security;
alter table public.med_doses      enable row level security;

drop policy if exists "read issues" on public.health_issues;   drop policy if exists "add issues" on public.health_issues;
drop policy if exists "read entries" on public.health_entries; drop policy if exists "add entries" on public.health_entries;
drop policy if exists "read meds" on public.medications;       drop policy if exists "add meds" on public.medications;
drop policy if exists "read doses" on public.med_doses;        drop policy if exists "add doses" on public.med_doses;
create policy "read issues"  on public.health_issues  for select to authenticated using (true);
create policy "add issues"   on public.health_issues  for insert to authenticated with check (auth.uid() is not null);
create policy "read entries" on public.health_entries for select to authenticated using (true);
create policy "add entries"  on public.health_entries for insert to authenticated with check (auth.uid() is not null);
create policy "read meds"    on public.medications    for select to authenticated using (true);
create policy "add meds"     on public.medications    for insert to authenticated with check (auth.uid() is not null);
create policy "read doses"   on public.med_doses      for select to authenticated using (true);
create policy "add doses"    on public.med_doses      for insert to authenticated with check (auth.uid() is not null);

do $$
declare f text;
begin
  foreach f in array array['close_health_issue(uuid, text)', 'reopen_health_issue(uuid)', 'set_photo_reminder(uuid, int)', 'stop_medication(uuid, text)', 'void_health_row(text, uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Photos of injuries and prescriptions: private; staff can add, nobody deletes from the app
insert into storage.buckets (id, name, public) values ('health-photos', 'health-photos', false) on conflict (id) do nothing;
drop policy if exists "read health photos" on storage.objects;
drop policy if exists "add health photos" on storage.objects;
create policy "read health photos" on storage.objects for select to authenticated using (bucket_id = 'health-photos');
create policy "add health photos"  on storage.objects for insert to authenticated with check (bucket_id = 'health-photos');

-- Live updates
do $$ begin alter publication supabase_realtime add table public.health_issues;  exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.health_entries; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.medications;    exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.med_doses;      exception when duplicate_object then null; end $$;
