-- 1) Health check form to match NCBP's paper form: a tick and a note for each area checked,
--    the ring / microchip read on the day, who it was done with, and "added to ZIMS" (ticked later).
alter table public.bird_checkups
  add column if not exists checks       jsonb not null default '{}',  -- { "toes": { "ok": true, "note": "trimmed" }, ... }
  add column if not exists ring_seen    text,
  add column if not exists done_with    text,                         -- the second person, e.g. "CD"
  add column if not exists zims_at      timestamptz,
  add column if not exists zims_by      uuid references public.profiles;

create or replace function public.mark_checkup_zims(p_id uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.bird_checkups
     set zims_at = case when p_done then now() end, zims_by = case when p_done then auth.uid() end
   where id = p_id and voided_at is null;
end $$;
revoke execute on function public.mark_checkup_zims(uuid, boolean) from public, anon;
grant execute on function public.mark_checkup_zims(uuid, boolean) to authenticated;

-- 2) Breeding: mark breeding aviaries, then log nest checks, eggs, hatchings, fledging and notes
alter table public.aviaries add column if not exists breeding boolean not null default false;

create table if not exists public.breeding_logs (
  id         uuid primary key default gen_random_uuid(),
  aviary_id  uuid not null references public.aviaries on delete cascade,
  kind       text not null check (kind in ('nest_check', 'egg', 'hatched', 'fledged', 'lost', 'note')),
  count      int check (count is null or (count >= 0 and count <= 30)),
  notes      text,
  logged_at  timestamptz not null default now(),
  log_date   date not null,
  staff_id   uuid not null references public.profiles,
  voided_by  uuid references public.profiles,
  voided_at  timestamptz
);
create index if not exists breeding_logs_aviary_idx on public.breeding_logs (aviary_id, logged_at);

create or replace function public.breeding_logs_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.staff_id  := auth.uid();
  new.logged_at := greatest(least(coalesce(new.logged_at, now()), now()), now() - interval '7 days');
  new.log_date  := (new.logged_at at time zone 'Europe/London')::date;
  new.voided_by := null; new.voided_at := null;
  return new;
end $$;
drop trigger if exists breeding_logs_insert on public.breeding_logs;
create trigger breeding_logs_insert before insert on public.breeding_logs for each row execute function public.breeding_logs_before_insert();

create or replace function public.void_breeding_log(log_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.breeding_logs set voided_by = auth.uid(), voided_at = now() where id = log_id and voided_at is null;
end $$;
revoke execute on function public.void_breeding_log(uuid) from public, anon;
grant execute on function public.void_breeding_log(uuid) to authenticated;

alter table public.breeding_logs enable row level security;
drop policy if exists "read breeding" on public.breeding_logs;
drop policy if exists "add breeding" on public.breeding_logs;
create policy "read breeding" on public.breeding_logs for select to authenticated using (true);
create policy "add breeding"  on public.breeding_logs for insert to authenticated with check (auth.uid() is not null);
do $$ begin alter publication supabase_realtime add table public.breeding_logs; exception when duplicate_object then null; end $$;
