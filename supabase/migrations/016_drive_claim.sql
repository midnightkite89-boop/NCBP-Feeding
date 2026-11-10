-- Drive copying: each queue item is claimed by one run, so two runs at the same moment
-- (the 5-minute timer and the Copy now button) never copy the same thing twice.
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.drive_queue add column if not exists claimed_at timestamptz;

create or replace function public.drive_claim(p_limit int) returns setof public.drive_queue
language sql security definer set search_path = public as $$
  update public.drive_queue q set claimed_at = now()
   where q.id in (
     select id from public.drive_queue
      where done_at is null and attempts < 10
        and (claimed_at is null or claimed_at < now() - interval '10 minutes')
      order by id
      limit p_limit
      for update skip locked)
  returning q.*;
$$;
revoke execute on function public.drive_claim(int) from public, anon, authenticated;
