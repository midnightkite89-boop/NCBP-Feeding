-- Copying records into the centre's OneDrive folder (Microsoft Graph).
-- The app only ever sees the status row; the permission token and bookkeeping are server-only.
create table if not exists public.onedrive_settings (
  id            int primary key default 1 check (id = 1),
  folder_name   text not null default 'NCBP Bird Care App',  -- in the root of the connected OneDrive
  account       text,          -- who allowed it, e.g. charlie@ncbp.co.uk
  folder_id     text,
  connected_at  timestamptz,
  last_run_at   timestamptz,
  last_copied   int,
  last_error    text
);
insert into public.onedrive_settings (id) values (1) on conflict (id) do nothing;

alter table public.onedrive_settings enable row level security;
drop policy if exists "read onedrive" on public.onedrive_settings;
drop policy if exists "admin onedrive" on public.onedrive_settings;
create policy "read onedrive"  on public.onedrive_settings for select to authenticated using (true);
create policy "admin onedrive" on public.onedrive_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Server only (no policies, so the app can't read them): the Microsoft permission, sign-in
-- states while someone is on Microsoft's Allow page, and what has been copied already.
create table if not exists public.onedrive_tokens (
  id            int primary key default 1 check (id = 1),
  refresh_token text,
  updated_at    timestamptz not null default now()
);
create table if not exists public.onedrive_states (
  state      text primary key,
  user_id    uuid not null,
  created_at timestamptz not null default now()
);
create table if not exists public.onedrive_copied (
  key        text primary key,       -- e.g. checkup:<id>, feedsheet:<monday>:<barn>
  hash       text,                   -- what was last uploaded, so unchanged files aren't sent again
  copied_at  timestamptz not null default now()
);
alter table public.onedrive_tokens enable row level security;
alter table public.onedrive_states enable row level security;
alter table public.onedrive_copied enable row level security;
