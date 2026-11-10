// Builds the demo database: runs SETUP-NEW-CENTRE.sql plus a centre's data SQL in an
// in-memory Postgres and saves every table as JSON for the browser-only demo mode.
// Usage: node scripts/build-demo-data.mjs ../ncbp/ncbp-data.sql  → src/demo/demo-data.json (not committed)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync } from 'node:fs';

const DEMO_USER = '00000000-0000-4000-8000-00000000d3e0';
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
  create publication supabase_realtime;
`);
await db.exec(readFileSync(new URL('../supabase/SETUP-NEW-CENTRE.sql', import.meta.url), 'utf8'));
if (process.argv[2]) await db.exec(readFileSync(process.argv[2], 'utf8'));
await db.exec(`insert into auth.users (id, email) values ('${DEMO_USER}', 'demo@example.com');
  update public.profiles set role = 'admin', display_name = 'Demo' where id = '${DEMO_USER}';`);

const tables = (await db.query(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).rows.map((r) => r.table_name);
const out = { user: DEMO_USER, tables: {} };
for (const t of tables) {
  const columns = (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t])).rows.map((r) => r.column_name);
  const rows = (await db.query(`select to_jsonb(x) j from public.${t} x`)).rows.map((r) => r.j);
  out.tables[t] = { columns, rows };
}
writeFileSync(new URL('../src/demo/demo-data.json', import.meta.url), JSON.stringify(out));
console.log(tables.map((t) => `${t}: ${out.tables[t].rows.length}`).join(', '));
