-- Copying to Google Drive: a queue of things to copy, filled automatically.
-- The drive-sync function works through it. Run once in Supabase > SQL Editor. Safe to run twice.

create table if not exists public.drive_queue (
  id         bigserial primary key,
  kind       text not null,    -- bird_photo, health_entry, entry_removed, issue_closed, medication, med_stopped, dose, dose_removed
  ref_id     uuid not null,
  created_at timestamptz not null default now(),
  done_at    timestamptz,
  attempts   int not null default 0,
  last_error text,
  note       text
);
create index if not exists drive_queue_pending_idx on public.drive_queue (id) where done_at is null;

alter table public.drive_queue enable row level security;
drop policy if exists "admin read drive queue" on public.drive_queue;
create policy "admin read drive queue" on public.drive_queue for select to authenticated using (public.is_admin());

create or replace function public.drive_enqueue(p_kind text, p_ref uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.drive_queue (kind, ref_id) values (p_kind, p_ref);
$$;
revoke execute on function public.drive_enqueue(text, uuid) from public, anon, authenticated;

-- Admin: try failed copies again (e.g. after fixing a bird's Drive link)
create or replace function public.drive_retry_failed() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.drive_queue set attempts = 0, last_error = null where done_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.drive_retry_failed() from public, anon;
grant  execute on function public.drive_retry_failed() to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers: what gets copied
-- ---------------------------------------------------------------------------
create or replace function public.drive_on_bird() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.photo_path is not null and (tg_op = 'INSERT' or new.photo_path is distinct from old.photo_path) then
    perform public.drive_enqueue('bird_photo', new.id);
  end if;
  return new;
end $$;
drop trigger if exists drive_bird on public.birds;
create trigger drive_bird after insert or update of photo_path on public.birds for each row execute function public.drive_on_bird();

create or replace function public.drive_on_health_entry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform public.drive_enqueue('health_entry', new.id);
  elsif new.voided_at is not null and old.voided_at is null then perform public.drive_enqueue('entry_removed', new.id);
  end if;
  return new;
end $$;
drop trigger if exists drive_health_entry on public.health_entries;
create trigger drive_health_entry after insert or update of voided_at on public.health_entries for each row execute function public.drive_on_health_entry();

create or replace function public.drive_on_issue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.closed_at is not null and old.closed_at is null then perform public.drive_enqueue('issue_closed', new.id); end if;
  return new;
end $$;
drop trigger if exists drive_issue on public.health_issues;
create trigger drive_issue after update of closed_at on public.health_issues for each row execute function public.drive_on_issue();

create or replace function public.drive_on_medication() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform public.drive_enqueue('medication', new.id);
  elsif new.stopped_at is not null and old.stopped_at is null then perform public.drive_enqueue('med_stopped', new.id);
  end if;
  return new;
end $$;
drop trigger if exists drive_medication on public.medications;
create trigger drive_medication after insert or update of stopped_at on public.medications for each row execute function public.drive_on_medication();

create or replace function public.drive_on_dose() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform public.drive_enqueue('dose', new.id);
  elsif new.voided_at is not null and old.voided_at is null then perform public.drive_enqueue('dose_removed', new.id);
  end if;
  return new;
end $$;
drop trigger if exists drive_dose on public.med_doses;
create trigger drive_dose after insert or update of voided_at on public.med_doses for each row execute function public.drive_on_dose();

-- ---------------------------------------------------------------------------
-- Copy across everything already in the app (only the first time this runs)
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from public.drive_queue) then
    insert into public.drive_queue (kind, ref_id, created_at)
    select k, id, at from (
      select 'bird_photo' k, id, now() at from public.birds where photo_path is not null and status = 'active'
      union all select 'medication', id, created_at from public.medications where voided_at is null
      union all select 'health_entry', id, logged_at from public.health_entries where voided_at is null
      union all select 'dose', id, logged_at from public.med_doses where voided_at is null
      union all select 'issue_closed', id, closed_at from public.health_issues where closed_at is not null and voided_at is null
      union all select 'med_stopped', id, stopped_at from public.medications where stopped_at is not null and voided_at is null
    ) x order by at;
  end if;
end $$;
