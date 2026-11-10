-- Individual ferrets and their weights. Weights are ferret_logs with kind 'weigh'.
-- Run once in Supabase > SQL Editor. Safe to run twice.

create table if not exists public.ferrets (
  id       uuid primary key default gen_random_uuid(),
  cage_id  uuid references public.ferret_cages on delete set null,
  name     text not null,             -- e.g. "Polecat male 1" (rename to their real names any time)
  sort     int not null default 0,
  archived boolean not null default false
);

-- Starting list: polecat males x2 (Boys), polecat female x1 and albino females x2 (Girls)
insert into public.ferrets (cage_id, name, sort)
select c.id, f.name, f.sort
from (values ('Boys', 'Polecat male 1', 1), ('Boys', 'Polecat male 2', 2),
             ('Girls', 'Polecat female', 3), ('Girls', 'Albino female 1', 4), ('Girls', 'Albino female 2', 5)) as f(cage, name, sort)
left join public.ferret_cages c on c.name = f.cage
where not exists (select 1 from public.ferrets);

alter table public.ferret_logs add column if not exists ferret_id uuid references public.ferrets on delete cascade;
alter table public.ferret_logs add column if not exists weight_g numeric check (weight_g > 0 and weight_g < 10000);
alter table public.ferret_logs drop constraint if exists ferret_logs_kind_check;
alter table public.ferret_logs add constraint ferret_logs_kind_check check (kind in ('feed', 'clean', 'weigh'));
create index if not exists ferret_logs_weigh_idx on public.ferret_logs (ferret_id, logged_at desc) where kind = 'weigh';

alter table public.ferrets enable row level security;
drop policy if exists "read ferrets" on public.ferrets;
drop policy if exists "admin ferrets" on public.ferrets;
create policy "read ferrets"  on public.ferrets for select to authenticated using (true);
create policy "admin ferrets" on public.ferrets for all to authenticated using (public.is_admin()) with check (public.is_admin());

do $$ begin
  alter publication supabase_realtime add table public.ferrets;
exception when duplicate_object then null; end $$;
