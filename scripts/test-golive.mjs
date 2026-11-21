// Loads the NCBP data and test data into an in-memory copy, runs the go-live wipe, and checks what's left.
// Usage: node scripts/test-golive.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  create function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
  create publication supabase_realtime;`);
const run = (f) => db.exec(readFileSync(new URL(f, import.meta.url), 'utf8'));
await run('../supabase/SETUP-NEW-CENTRE.sql');
await run('../../ncbp/ncbp-data.sql');
await run('../../ncbp/ncbp-update-2026-11-19.sql');
await db.exec(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'chris@x.uk');
  update profiles set role = 'admin', display_name = 'Chris';`);
await run('../../ncbp/ncbp-test-data.sql');
const before = (await db.query(`select (select count(*)::int from feed_logs) f, (select count(*)::int from care_logs) c, (select count(*)::int from bird_checkups) k`)).rows[0];
await db.exec(`select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
  insert into flight_plan (slot_time, bird_ids) values ('11:30', array[(select id from birds limit 1)]);
  select set_config('request.jwt.claim.sub', '', false);`);
const res = await db.exec(readFileSync(new URL('../../ncbp/ncbp-GO-LIVE.sql', import.meta.url), 'utf8'));
const after = res.at(-1).rows[0];
const settings = (await db.query(`select round_names, demo_times, products from care_settings`)).rows[0];
console.log('before:', before);
console.log('after: ', after);
console.log('settings kept:', settings);
const ok = after.feed_logs == 0 && after.care_logs == 0 && after.checkups == 0 && after.requests == 0 && after.birds == 100 && after.aviaries == 60 && after.staff == 1 && settings.demo_times.length === 3;
console.log(ok ? 'PASS  go-live wipe leaves birds, aviaries, staff and settings' : 'FAIL');
process.exit(ok ? 0 : 1);
