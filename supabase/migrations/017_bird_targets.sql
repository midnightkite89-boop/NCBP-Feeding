-- Staff can change a bird's target weights and usual amount of food (nothing else).
-- Every change to those, by anyone, is logged; only admins can read the log.
-- Run once in Supabase > SQL Editor. Safe to run twice.

create table if not exists public.bird_changes (
  id               bigserial primary key,
  bird_id          uuid not null references public.birds on delete cascade,
  field            text not null,        -- target_weight_min, target_weight_max, default_portion, default_food
  old_value        text,
  new_value        text,
  changed_by       uuid references public.profiles,   -- the signed-in account (null = changed in Supabase directly)
  changed_for      uuid references public.profiles,   -- on a shared device: the person picked
  changed_for_name text,                               -- on a shared device: a volunteer's name
  note             text,
  changed_at       timestamptz not null default now()
);
create index if not exists bird_changes_bird_idx on public.bird_changes (bird_id, changed_at desc);

alter table public.bird_changes enable row level security;
drop policy if exists "admin read bird changes" on public.bird_changes;
create policy "admin read bird changes" on public.bird_changes for select to authenticated using (public.is_admin());

-- Log changes to the target weights and usual food, however they were made
create or replace function public.log_bird_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f   text;
  o   text;
  n   text;
  who uuid := auth.uid();
  forid uuid := nullif(current_setting('smj.changed_for', true), '')::uuid;
  forname text := nullif(current_setting('smj.changed_for_name', true), '');
  why text := nullif(current_setting('smj.change_note', true), '');
begin
  foreach f in array array['target_weight_min', 'target_weight_max', 'default_portion', 'default_food'] loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f) into o, n using old, new;
    if o is distinct from n then
      insert into public.bird_changes (bird_id, field, old_value, new_value, changed_by, changed_for, changed_for_name, note)
      values (new.id, f, o, n, who, forid, forname, why);
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists bird_changes_log on public.birds;
create trigger bird_changes_log after update on public.birds for each row execute function public.log_bird_changes();

-- The one way staff can change a bird: target weights (grams) and usual amount
create or replace function public.set_bird_targets(
  p_bird uuid, p_min numeric, p_max numeric, p_portion text,
  p_note text default null, p_for uuid default null, p_for_name text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare shared boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_min is not null and (p_min <= 0 or p_min > 20000) then raise exception 'Target min must be a weight in grams'; end if;
  if p_max is not null and (p_max <= 0 or p_max > 20000) then raise exception 'Target max must be a weight in grams'; end if;
  if p_min is not null and p_max is not null and p_min > p_max then raise exception 'Target min is bigger than target max'; end if;
  if p_portion is not null and length(trim(p_portion)) > 40 then raise exception 'Amount is too long'; end if;

  -- Only a shared device may say it was someone else
  select shared_device into shared from public.profiles where id = auth.uid();
  perform set_config('smj.changed_for', case when coalesce(shared, false) then coalesce(p_for::text, '') else '' end, true);
  perform set_config('smj.changed_for_name', case when coalesce(shared, false) and p_for is null then coalesce(left(trim(p_for_name), 40), '') else '' end, true);
  perform set_config('smj.change_note', coalesce(left(trim(p_note), 200), ''), true);

  update public.birds
     set target_weight_min = round(p_min, 1),
         target_weight_max = round(p_max, 1),
         default_portion   = nullif(trim(p_portion), '')
   where id = p_bird;
  if not found then raise exception 'Bird not found'; end if;
end $$;

revoke execute on function public.set_bird_targets(uuid, numeric, numeric, text, text, uuid, text) from public, anon;
grant  execute on function public.set_bird_targets(uuid, numeric, numeric, text, text, uuid, text) to authenticated;
revoke execute on function public.log_bird_changes() from public, anon, authenticated;
