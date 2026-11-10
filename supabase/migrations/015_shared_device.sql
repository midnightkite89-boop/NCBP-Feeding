-- Shared devices (e.g. the shed iPad): one login that several people use.
-- The device asks "who's using it?" and each log records that person as
-- logged_for, alongside the device account in staff_id. Volunteers have no
-- login: their typed first name goes in logged_for_name instead.
-- Run once in Supabase > SQL Editor. Safe to run twice.

alter table public.profiles add column if not exists shared_device boolean not null default false;

alter table public.feed_logs      add column if not exists logged_for uuid references public.profiles;
alter table public.care_logs      add column if not exists logged_for uuid references public.profiles;
alter table public.ferret_logs    add column if not exists logged_for uuid references public.profiles;
alter table public.med_doses      add column if not exists logged_for uuid references public.profiles;
alter table public.health_entries add column if not exists logged_for uuid references public.profiles;

alter table public.feed_logs      add column if not exists logged_for_name text;
alter table public.care_logs      add column if not exists logged_for_name text;
alter table public.ferret_logs    add column if not exists logged_for_name text;
alter table public.med_doses      add column if not exists logged_for_name text;
alter table public.health_entries add column if not exists logged_for_name text;

-- Only a shared-device account may name someone else: a real person (not
-- another device) or a volunteer's name. Anything else is quietly dropped.
create or replace function public.check_logged_for() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.logged_for is not null and (
       new.logged_for = auth.uid()
    or not exists (select 1 from public.profiles where id = auth.uid() and shared_device)
    or not exists (select 1 from public.profiles where id = new.logged_for and not shared_device)
  ) then
    new.logged_for := null;
  end if;
  new.logged_for_name := left(nullif(trim(new.logged_for_name), ''), 40);
  if new.logged_for is not null or not exists (select 1 from public.profiles where id = auth.uid() and shared_device) then
    new.logged_for_name := null;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['feed_logs', 'care_logs', 'ferret_logs', 'med_doses', 'health_entries'] loop
    execute format('drop trigger if exists zz_logged_for on public.%I', t);
    execute format('create trigger zz_logged_for before insert on public.%I for each row execute function public.check_logged_for()', t);
  end loop;
end $$;
