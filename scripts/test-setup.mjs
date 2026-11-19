// Runs SETUP-NEW-CENTRE.sql (plus any extra SQL files given) in an in-memory Postgres with a
// Supabase-like auth stub, then checks the flight timetable rules. Usage:
//   node scripts/test-setup.mjs [../ncbp/ncbp-data.sql ...]
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  create function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
  create publication supabase_realtime;
`);
await db.exec(readFileSync(new URL('../supabase/SETUP-NEW-CENTRE.sql', import.meta.url), 'utf8'));
for (const f of process.argv.slice(2)) await db.exec(readFileSync(f, 'utf8'));
const tables = (await db.query(`select count(*)::int n from information_schema.tables where table_schema = 'public'`)).rows[0].n;
console.log(`Setup OK: ${tables} tables`);

const U = '00000000-0000-0000-0000-0000000000b1';
await db.exec(`insert into auth.users (id, email) values ('${U}', 'staff@x.uk');
  grant usage on schema public, auth to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant execute on all functions in schema auth to authenticated;`);
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failures++; };
async function as(sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${U}', false); set role authenticated;`);
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { error: e.message }; } finally { await db.exec('reset role;'); }
}
const ins = await as(`insert into flight_plan (slot_time) values ('11:30') returning updated_by, plan_date = today_london() as today`);
check('staff can add a slot, stamped with who', ins.rows?.[0]?.updated_by === U && ins.rows[0].today, JSON.stringify(ins));
check('bad time refused', !!(await as(`insert into flight_plan (slot_time) values ('half eleven')`)).error);
check('same slot twice refused', !!(await as(`insert into flight_plan (slot_time) values ('11:30')`)).error);
const upd = await as(`update flight_plan set bird_ids = array[gen_random_uuid()] returning cardinality(bird_ids) n`);
check('staff can add birds to a slot', upd.rows?.[0]?.n === 1, JSON.stringify(upd));
const fly = await as(`insert into feed_logs (bird_id, status, flight_type, more_due) select id, 'flown', 'evening', false from birds limit 1 returning flight_type`);
check('owl evening flights allowed', fly.error == null, JSON.stringify(fly));
console.log(failures ? `\n${failures} failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
