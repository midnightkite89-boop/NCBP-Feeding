-- Each bird's folder in the SMJ Falconry Database on Google Drive (01 Birds).
-- Run once in Supabase > SQL Editor. Safe to run twice.
alter table public.birds add column if not exists drive_folder_url text;
