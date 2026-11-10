// Runs supabase/schema.sql in an in-memory Postgres with a minimal Supabase stub,
// then checks the security rules and triggers behave. Usage: node scripts/test-schema.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create publication supabase_realtime;
`);
await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
await db.exec(`
  grant usage on schema public, auth, storage to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant execute on all functions in schema auth to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`);

const ADMIN = '00000000-0000-0000-0000-00000000000a';
const STAFF = '00000000-0000-0000-0000-00000000000b';
await db.exec(`insert into auth.users (id, email) values ('${ADMIN}', 'chris@x.uk'), ('${STAFF}', 'vicki@x.uk');
               update profiles set role = 'admin' where id = '${ADMIN}';`);

let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failures++; };
async function as(user, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.sub', '${user}', false); set role authenticated;`);
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec('reset role;'); }
}

check('profiles auto-created', (await db.query('select count(*)::int n from profiles')).rows[0].n === 2);
check('display name from email', (await db.query(`select display_name from profiles where id='${STAFF}'`)).rows[0].display_name === 'vicki');

let r = await as(ADMIN, `insert into aviaries (name, number) values ('Hawk Walk 1', 1) returning slug`);
check('admin adds aviary', !r.error && r.rows[0].slug.length === 6, r.error);
r = await as(ADMIN, `insert into aviaries (name, number) values ('hawk walk', 2), ('Hawk Walk', null)`);
check('same section, different numbers allowed', !r.error, r.error);
r = await as(ADMIN, `insert into aviaries (name, number) values ('HAWK WALK', 2)`);
check('same section + number rejected', /duplicate/.test(r.error ?? ''), r.error);
r = await as(STAFF, `insert into aviaries (name) values ('Sneaky')`);
check('staff cannot add aviary', !!r.error);
r = await as(ADMIN, `insert into birds (name, species, aviary_id, fast_days) select 'Willow', 'Red Kite', id, '{7}' from aviaries where name = 'Hawk Walk 1' returning id`);
check('admin adds bird', !r.error, r.error);
const bird = r.rows[0].id;
r = await as(STAFF, `update birds set name = 'Hacked'`);
check('staff cannot edit birds', (await db.query(`select name from birds`)).rows[0].name === 'Willow');
r = await as(STAFF, `update profiles set role = 'admin' where id = '${STAFF}'`);
check('staff cannot promote self', (await db.query(`select role from profiles where id='${STAFF}'`)).rows[0].role === 'staff');

r = await as(STAFF, `insert into feed_logs (id, bird_id, status, staff_id, log_date, logged_at)
                     values (gen_random_uuid(), $1, 'fed', '${ADMIN}', '2000-01-01', now() + interval '1 day') returning *`, [bird]);
check('staff logs a feed', !r.error, r.error);
const log = r.rows[0];
check('staff_id forced to real user', log.staff_id === STAFF);
check('log_date set by server', (await db.query('select today_london() d')).rows[0].d.getTime() === log.log_date.getTime());
check('future time clamped', new Date(log.logged_at) <= new Date());
r = await as(STAFF, `insert into feed_logs (bird_id, status, logged_at) values ($1, 'fed', now() - interval '30 days') returning logged_at`, [bird]);
check('ancient time clamped to 2 days', new Date(r.rows[0].logged_at) > new Date(Date.now() - 2.1 * 864e5));
r = await as(STAFF, `insert into feed_logs (id, bird_id, status) values ($1, $2, 'fed')`, [log.id, bird]);
check('duplicate offline retry rejected', /duplicate/.test(r.error ?? ''));
r = await as(STAFF, `update feed_logs set weight_g = 1 where id = $1`, [log.id]);
check('staff cannot edit a log', (await db.query('select weight_g from feed_logs where id=$1', [log.id])).rows[0].weight_g === null);
r = await as(STAFF, `delete from feed_logs where id = $1`, [log.id]);
check('staff cannot delete a log', (await db.query('select count(*)::int n from feed_logs where id=$1', [log.id])).rows[0].n === 1);
r = await as(STAFF, `select void_feed_log($1)`, [log.id]);
const v = (await db.query('select voided_by from feed_logs where id=$1', [log.id])).rows[0];
check('staff can void, recorded who', !r.error && v.voided_by === STAFF, r.error);
r = await as(STAFF, `insert into feed_logs (bird_id, status) values ($1, 'eaten')`, [bird]);
check('bad status rejected', !!r.error);

r = await as(STAFF, `insert into special_requests (bird_id, instruction) values ($1, 'Half ration today') returning id, created_by`, [bird]);
check('staff adds request', !r.error && r.rows[0].created_by === STAFF, r.error);
const req = r.rows[0].id;
r = await as(STAFF, `insert into special_requests (instruction) values ('Vet visit 2pm – keep Hawk Walk clear')`);
check('general notice (no bird)', !r.error, r.error);
r = await as(STAFF, `select clear_special_request($1)`, [req]);
check('staff clears request', !r.error && (await db.query('select cleared_by from special_requests where id=$1', [req])).rows[0].cleared_by === STAFF);
r = await as(STAFF, `delete from special_requests`);
check('staff cannot delete requests', (await db.query('select count(*)::int n from special_requests')).rows[0].n === 2);

r = await as(STAFF, `insert into storage.objects (bucket_id, name) values ('bird-photos', 'x.jpg')`);
check('staff cannot upload photos', !!r.error);
r = await as(ADMIN, `insert into storage.objects (bucket_id, name) values ('bird-photos', 'x.jpg')`);
check('admin uploads photos', !r.error, r.error);

// Upgrade scripts must run cleanly (twice) on top of the full schema
import { readdirSync } from 'node:fs';
const migDir = new URL('../supabase/migrations/', import.meta.url);
for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql') && !f.startsWith('._')).sort()) {
  for (const run of [1, 2]) {
    try { await db.exec(readFileSync(new URL(f, migDir), 'utf8')); } catch (e) { check(`${f} run ${run}`, false, e.message); }
  }
}
check('migrations re-runnable', true);
// Supabase grants signed-in users access to new tables automatically; mirror that here
await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;`);
r = await as(STAFF, `insert into feed_logs (bird_id, status, flight_type) values ($1, 'flown', 'party')`, [bird]);
check('unknown flight type rejected', !!r.error);
r = await as(STAFF, `insert into feed_logs (bird_id, status, logged_at, flight_type) values ($1, 'flown', now() - interval '3 hours', 'display') returning logged_at`, [bird]);
check('flown with earlier time', !r.error && new Date(r.rows[0].logged_at) < new Date(Date.now() - 2.9 * 36e5), r.error);
await db.exec(`insert into birds (name) values ('Luke'), ('Mr Chips')`);
await db.exec(readFileSync(new URL('../supabase/route-2026-10.sql', import.meta.url), 'utf8'));
const placed = (await db.query(`select name, route_order from birds where name in ('Luke', 'Mr Chips', 'Willow') order by route_order`)).rows;
check('route SQL places birds', placed.map((p) => `${p.name}:${p.route_order}`).join(',') === 'Luke:10,Willow:210,Mr Chips:400', placed);

// Splitting the shared New / Owls aviaries
await db.exec(`insert into aviaries (name) values ('New'), ('Owls');
  insert into birds (name, aviary_id) select 'Julianne', id from aviaries where name = 'New' and number is null;
  insert into birds (name, aviary_id) select 'Heidi', id from aviaries where name = 'New' and number is null;
  insert into birds (name, aviary_id) select n, (select id from aviaries where name = 'Owls' and number is null) from unnest(array['Earl','Candy','Molly']) n;`);
for (const run of [1, 2]) await db.exec(readFileSync(new URL('../supabase/own-aviaries-2026-10.sql', import.meta.url), 'utf8'));
const own = (await db.query(`select b.name, a.name || ' ' || a.number as aviary from birds b join aviaries a on a.id = b.aviary_id where b.name in ('Julianne','Heidi','Molly','Candy','Earl') order by b.name`)).rows;
check('five birds get their own aviaries', own.map((o) => `${o.name}:${o.aviary}`).join(',') === 'Candy:Owls 11,Earl:Owls 12,Heidi:New 4,Julianne:New 2,Molly:Owls 10', own);
const shared = (await db.query(`select name, archived from aviaries where number is null and name in ('New','Owls') order by name`)).rows;
check('old shared aviaries archived', shared.every((a) => a.archived) && shared.length === 2, shared);

// Care logs (006): cleaning, checks, concerns
r = await as(STAFF, `insert into care_logs (kind, aviary_id, tasks, product, staff_id) select 'aviary_clean', id, '{spot,disinfect}', 'Safe4', '${ADMIN}' from aviaries limit 1 returning staff_id, log_date`);
check('staff logs a clean (staff forced)', !r.error && r.rows[0].staff_id === STAFF, r.error);
r = await as(STAFF, `insert into care_logs (kind, bird_id, concern, notes) values ('bird_check', $1, true, 'Limping on left foot') returning id`, [bird]);
check('staff raises a concern', !r.error, r.error);
const concernId = r.rows?.[0]?.id;
r = await as(STAFF, `select resolve_concern($1, '  ')`, [concernId]);
check('resolve needs an action', !!r.error);
r = await as(STAFF, `select resolve_concern($1, 'Vet booked Tues')`, [concernId]);
const rc = (await db.query('select resolved_by, resolution from care_logs where id = $1', [concernId])).rows[0];
check('concern resolved with action + who', !r.error && rc.resolved_by === STAFF && rc.resolution === 'Vet booked Tues', r.error ?? rc);
r = await as(STAFF, `update care_logs set notes = 'edited'`);
check('staff cannot edit care logs', (await db.query(`select count(*)::int n from care_logs where notes = 'edited'`)).rows[0].n === 0);
r = await as(STAFF, `insert into care_logs (kind) values ('sweeping')`);
check('unknown care kind rejected', !!r.error);
r = await as(STAFF, `update care_settings set clean_due_days = 1`);
check('staff cannot change care settings', (await db.query('select clean_due_days from care_settings')).rows[0].clean_due_days === 7);
r = await as(ADMIN, `update care_settings set products = '{Safe4,F10}' returning products`);
check('admin changes care settings', !r.error && r.rows[0].products.length === 2, r.error);

// Ferrets (007)
const cages = (await db.query(`select name, ferrets from ferret_cages order by sort`)).rows;
check('ferret cages seeded', cages.map((c) => `${c.name}:${c.ferrets}`).join(',') === 'Boys:2,Girls:4', cages);
r = await as(STAFF, `insert into ferret_logs (cage_id, kind, food) select id, 'feed', 'Ferret biscuits' from ferret_cages where name = 'Boys' returning id, staff_id`);
check('staff logs a ferret feed', !r.error && r.rows[0].staff_id === STAFF, r.error);
const fid = r.rows?.[0]?.id;
r = await as(STAFF, `insert into ferret_logs (cage_id, kind, tasks) select id, 'clean', '{spot,full}' from ferret_cages where name = 'Girls'`);
check('staff logs a ferret clean', !r.error, r.error);
r = await as(STAFF, `select void_ferret_log($1)`, [fid]);
check('staff voids a ferret log', !r.error && (await db.query('select voided_by from ferret_logs where id=$1', [fid])).rows[0].voided_by === STAFF, r.error);
r = await as(STAFF, `update ferret_cages set ferrets = 9`);
check('staff cannot edit cages', (await db.query(`select max(ferrets)::int m from ferret_cages`)).rows[0].m === 4);
r = await as(STAFF, `insert into ferret_logs (cage_id, kind) select id, 'walk' from ferret_cages limit 1`);
check('unknown ferret kind rejected', !!r.error);
check('ferret food list default', (await db.query(`select ferret_foods from care_settings`)).rows[0].ferret_foods[0] === 'Ferret biscuits');

// Cleaning alerts (009)
r = await as(STAFF, `insert into care_logs (kind, aviary_id) select 'bath_check', id from aviaries limit 1`);
check('staff logs a bath check', !r.error, r.error);
r = await as(STAFF, `insert into care_logs (kind, aviary_id) select 'bath_clean', id from aviaries limit 1`);
check('staff logs a bath clean', !r.error, r.error);
const av1 = (await db.query(`select id from aviaries where not archived limit 1`)).rows[0].id;
r = await as(STAFF, `insert into clean_plan (plan_date, aviary_id, added_by, removed_at) values (current_date, $1, '${ADMIN}', now()) returning added_by, removed_at`, [av1]);
check('staff adds to plan (who forced, cannot pre-remove)', !r.error && r.rows[0].added_by === STAFF && r.rows[0].removed_at === null, r.error ?? r.rows);
r = await as(STAFF, `select remove_from_clean_plan(current_date, $1)`, [av1]);
const pl = (await db.query(`select removed_by, removed_at from clean_plan where aviary_id = $1 order by added_at desc, removed_at desc nulls last limit 1`, [av1])).rows[0];
check('staff takes aviary off plan', !r.error && pl.removed_by === STAFF && pl.removed_at, r.error ?? pl);
r = await as(STAFF, `update clean_plan set removed_at = null`);
check('staff cannot edit plan rows', (await db.query(`select count(*)::int n from clean_plan where removed_at is not null`)).rows[0].n === 1);
r = await as(STAFF, `update care_settings set bath_check_days = 9`);
check('staff cannot change bath timings', (await db.query('select bath_check_days from care_settings')).rows[0].bath_check_days === 1);
r = await as(ADMIN, `update care_settings set section_rules = '{"Back": {"due": 5, "overdue": 10}}', rota = '{"1": ["Back"]}' returning section_rules`);
check('admin sets section rules + rota', !r.error && r.rows[0].section_rules.Back.due === 5, r.error);
r = await as(STAFF, `update aviaries set has_bath = false`);
check('staff cannot change aviary bath setting', (await db.query(`select bool_and(has_bath) b from aviaries`)).rows[0].b === true);

// Flight tracks (010)
const flight = (await as(STAFF, `insert into feed_logs (bird_id, status, flight_type) values ($1, 'flown', 'experience') returning id`, [bird])).rows[0].id;
const fed = (await as(STAFF, `insert into feed_logs (bird_id, status) values ($1, 'fed') returning id`, [bird])).rows[0].id;
const trk = `'[[0,53.8,-1.97,20,10,1]]'`;
r = await as(STAFF, `insert into flight_tracks (feed_log_id, bird_id, uploaded_by, trim_start, trim_end, duration_s, distance_m, track) values ($1, gen_random_uuid(), '${ADMIN}', 0, 60, 60, 500, ${trk}) returning bird_id, uploaded_by`, [flight]);
check('staff adds a GPS track (bird + who forced)', !r.error && r.rows[0].bird_id === bird && r.rows[0].uploaded_by === STAFF, r.error ?? r.rows);
r = await as(STAFF, `insert into flight_tracks (feed_log_id, bird_id, trim_start, trim_end, duration_s, distance_m, track) values ($1, $2, 0, 60, 60, 500, ${trk})`, [fed, bird]);
check('track only on a flight', !!r.error);
r = await as(STAFF, `insert into flight_tracks (feed_log_id, bird_id, trim_start, trim_end, duration_s, distance_m, track) values ($1, $2, 0, 90, 90, 700, ${trk}) returning id`, [flight, bird]);
const live = (await db.query(`select count(*)::int n from flight_tracks where feed_log_id = $1 and voided_at is null`, [flight])).rows[0].n;
check('replacing voids the old track', !r.error && live === 1, r.error ?? live);
r = await as(STAFF, `select void_flight_track($1)`, [r.rows?.[0]?.id]);
check('staff removes a track', !r.error && (await db.query(`select count(*)::int n from flight_tracks where voided_at is null`)).rows[0].n === 0, r.error);
r = await as(STAFF, `update flight_tracks set distance_m = 1`);
check('staff cannot edit tracks', (await db.query(`select count(*)::int n from flight_tracks where distance_m = 1`)).rows[0].n === 0);

// Health (011)
r = await as(STAFF, `insert into health_issues (bird_id, title, opened_by, photo_every_days) values ($1, 'Dry, cracking front toes', '${ADMIN}', 2) returning id, opened_by`, [bird]);
check('staff opens an issue (who forced)', !r.error && r.rows[0].opened_by === STAFF, r.error);
const issue = r.rows?.[0]?.id;
r = await as(STAFF, `insert into health_entries (issue_id, bird_id, notes, photo_paths) values ($1, gen_random_uuid(), 'Cream applied', '{a/b.jpg}') returning bird_id, staff_id, log_date`, [issue]);
check('entry takes the issue bird + staff', !r.error && r.rows[0].bird_id === bird && r.rows[0].staff_id === STAFF, r.error ?? r.rows);
r = await as(STAFF, `insert into medications (bird_id, name_dose, med_type, amount, start_date, end_date, notes) values ($1, 'Meloxicam 1.5mg/ml', 'fluid', '0.07ml', current_date, current_date + 6, 'Give with food') returning id, created_by`, [bird]);
check('staff sets up medication', !r.error && r.rows[0].created_by === STAFF, r.error);
const med = r.rows?.[0]?.id;
r = await as(STAFF, `insert into medications (bird_id, name_dose, amount, start_date, end_date) values ($1, 'X', '1', current_date, current_date - 1)`, [bird]);
check('end before start rejected', !!r.error);
r = await as(STAFF, `insert into med_doses (medication_id, bird_id, dose_date, amount, staff_id) values ($1, gen_random_uuid(), current_date, '0.07ml', '${ADMIN}') returning bird_id, staff_id, id`, [med]);
check('dose given (bird + staff forced)', !r.error && r.rows[0].bird_id === bird && r.rows[0].staff_id === STAFF, r.error ?? r.rows);
const dose = r.rows?.[0]?.id;
r = await as(STAFF, `select void_health_row('med_doses', $1)`, [dose]);
check('dose undone (voided)', !r.error && (await db.query('select voided_by from med_doses where id = $1', [dose])).rows[0].voided_by === STAFF, r.error);
r = await as(STAFF, `select stop_medication($1, 'Course finished early')`, [med]);
check('medication stopped', !r.error && (await db.query('select stopped_by from medications where id = $1', [med])).rows[0].stopped_by === STAFF, r.error);
r = await as(STAFF, `select close_health_issue($1, 'Healed')`, [issue]);
check('issue closed with outcome', !r.error && (await db.query('select outcome from health_issues where id = $1', [issue])).rows[0].outcome === 'Healed', r.error);
r = await as(STAFF, `update health_issues set title = 'x'`);
check('staff cannot edit issues directly', (await db.query(`select count(*)::int n from health_issues where title = 'x'`)).rows[0].n === 0);
r = await as(STAFF, `select void_health_row('birds', $1)`, [bird]);
check('void only health tables', !!r.error);
r = await as(STAFF, `insert into storage.objects (bucket_id, name) values ('health-photos', 'x/1.jpg')`);
check('staff uploads a health photo', !r.error, r.error);

// Ferret weights (013)
const fl = (await db.query(`select f.name, c.name as cage from ferrets f left join ferret_cages c on c.id = f.cage_id order by f.sort`)).rows;
check('five ferrets seeded in the right cages', fl.map((f) => `${f.name}@${f.cage}`).join(',') === 'Polecat male 1@Boys,Polecat male 2@Boys,Polecat female@Girls,Albino female 1@Girls,Albino female 2@Girls', fl);
r = await as(STAFF, `insert into ferret_logs (cage_id, kind, ferret_id, weight_g) select cage_id, 'weigh', id, 1250 from ferrets where name = 'Polecat male 1' returning staff_id, weight_g`);
check('staff weighs a ferret', !r.error && r.rows[0].staff_id === STAFF && Number(r.rows[0].weight_g) === 1250, r.error);
r = await as(STAFF, `insert into ferret_logs (cage_id, kind, ferret_id, weight_g) select cage_id, 'weigh', id, -5 from ferrets limit 1`);
check('silly ferret weight rejected', !!r.error);
r = await as(STAFF, `update ferrets set name = 'x'`);
check('staff cannot rename ferrets', (await db.query(`select count(*)::int n from ferrets where name = 'x'`)).rows[0].n === 0);
r = await as(ADMIN, `update ferrets set name = 'Bandit' where name = 'Polecat male 2' returning name`);
check('admin renames a ferret', !r.error && r.rows.length === 1, r.error);

// Shared device (014)
const IPAD = '00000000-0000-0000-0000-00000000000c';
await db.exec(`insert into auth.users (id, email) values ('${IPAD}', 'shed-ipad@x.uk'); update profiles set shared_device = true where id = '${IPAD}';`);
r = await as(IPAD, `insert into feed_logs (bird_id, status, weight_g, logged_for) values ($1, 'weighed', 650, '${STAFF}') returning staff_id, logged_for`, [bird]);
check('device logs for a person', !r.error && r.rows[0].staff_id === IPAD && r.rows[0].logged_for === STAFF, r.error ?? r.rows);
r = await as(STAFF, `insert into feed_logs (bird_id, status, weight_g, logged_for) values ($1, 'weighed', 650, '${ADMIN}') returning logged_for`, [bird]);
check('normal account cannot log for others', !r.error && r.rows[0].logged_for === null, r.error ?? r.rows);
r = await as(IPAD, `insert into care_logs (kind, bird_id, logged_for) values ('bird_check', $1, '${IPAD}') returning logged_for`, [bird]);
check('device cannot log for a device', !r.error && r.rows[0].logged_for === null, r.error ?? r.rows);
r = await as(IPAD, `insert into feed_logs (bird_id, status, weight_g, logged_for_name) values ($1, 'weighed', 650, '  Sam  ') returning logged_for, logged_for_name`, [bird]);
check('device logs for a volunteer', !r.error && r.rows[0].logged_for_name === 'Sam', r.error ?? r.rows);
r = await as(STAFF, `insert into feed_logs (bird_id, status, weight_g, logged_for_name) values ($1, 'weighed', 650, 'Sam') returning logged_for_name`, [bird]);
check('normal account cannot name a volunteer', !r.error && r.rows[0].logged_for_name === null, r.error ?? r.rows);
r = await as(STAFF, `update profiles set shared_device = true where id = '${STAFF}'`);
check('staff cannot make themselves a device', (await db.query(`select shared_device from profiles where id = '${STAFF}'`)).rows[0].shared_device === false);

// Drive queue (014_drive_sync)
const qBefore = (await db.query(`select count(*)::int n from drive_queue`)).rows[0].n;
r = await as(STAFF, `insert into med_doses (medication_id, bird_id, dose_date) select id, bird_id, current_date from medications limit 1 returning id`);
const qd = r.rows?.[0]?.id;
check('a new dose is queued for Drive', !r.error && (await db.query(`select count(*)::int n from drive_queue where kind = 'dose' and ref_id = $1`, [qd])).rows[0].n === 1, r.error);
await as(STAFF, `select void_health_row('med_doses', $1)`, [qd]);
check('removing a dose queues a note', (await db.query(`select count(*)::int n from drive_queue where kind = 'dose_removed' and ref_id = $1`, [qd])).rows[0].n === 1);
await as(ADMIN, `update birds set photo_path = 'x/1.jpg' where id = $1`, [bird]);
check('a new bird photo is queued', (await db.query(`select count(*)::int n from drive_queue where kind = 'bird_photo' and ref_id = $1`, [bird])).rows[0].n === 1);
r = await as(STAFF, `select * from drive_queue`);
check('staff cannot read the Drive queue', !r.error && r.rows.length === 0, r.error);
r = await as(STAFF, `select drive_enqueue('dose', gen_random_uuid())`);
check('staff cannot add to the queue directly', !!r.error);
r = await as(STAFF, `select drive_retry_failed()`);
check('only admin can retry', !!r.error);
check('first run copied existing records into the queue', qBefore > 0, qBefore);

// Drive claim (016)
await db.exec(`insert into drive_queue (kind, ref_id) select 'dose', gen_random_uuid() from generate_series(1, 3)`);
const c1 = (await db.query(`select id from drive_claim(100)`)).rows.map((x) => x.id);
const c2 = (await db.query(`select id from drive_claim(100)`)).rows.length;
check('a second run claims nothing already claimed', c1.length > 0 && c2 === 0, { c1: c1.length, c2 });
r = await as(STAFF, `select * from drive_claim(5)`);
check('staff cannot claim queue items', !!r.error);

// Staff target changes (017)
const tb = (await db.query(`insert into birds (name, target_weight_min, target_weight_max, default_portion) values ('Targets Test', 600, 700, '2') returning id`)).rows[0].id;
r = await as(STAFF, `select set_bird_targets($1, 610, 720, '2½', 'Moulting')`, [tb]);
const tr = (await db.query(`select target_weight_min::float a, target_weight_max::float b, default_portion p from birds where id = $1`, [tb])).rows[0];
check('staff changes target weights and amount', !r.error && tr.a === 610 && tr.b === 720 && tr.p === '2½', r.error ?? tr);
const logRows = (await db.query(`select field, old_value, new_value, changed_by, note from bird_changes where bird_id = $1 order by field`, [tb])).rows;
check('each change logged with who and why', logRows.length === 3 && logRows.every((x) => x.changed_by === STAFF && x.note === 'Moulting'), logRows);
r = await as(STAFF, `select set_bird_targets($1, 800, 700, '2')`, [tb]);
check('min above max rejected', !!r.error);
r = await as(STAFF, `update birds set target_weight_min = 1, name = 'x' where id = $1`, [tb]);
check('staff still cannot edit birds directly', (await db.query(`select target_weight_min::float a from birds where id = $1`, [tb])).rows[0].a === 610);
r = await as(STAFF, `select * from bird_changes`);
check('staff cannot read the change log', !r.error && r.rows.length === 0, r.error);
r = await as(ADMIN, `select count(*)::int n from bird_changes`);
check('admin can read the change log', !r.error && r.rows[0].n >= 3, r.error);
await as(ADMIN, `update birds set default_food = 'Quail' where id = $1`, [tb]);
check('admin edits are logged too', (await db.query(`select changed_by from bird_changes where bird_id = $1 and field = 'default_food'`, [tb])).rows[0]?.changed_by === ADMIN);

// Corrections (018)
const orig = (await as(STAFF, `insert into feed_logs (bird_id, status, food_type, amount) values ($1, 'fed', 'Chick', '3') returning id`, [bird])).rows[0].id;
await as(STAFF, `select void_feed_log($1)`, [orig]);
r = await as(STAFF, `insert into feed_logs (bird_id, status, food_type, amount, replaces) values ($1, 'fed', 'Quail', '1', $2) returning replaces`, [bird, orig]);
check('a correction points back to the original', !r.error && r.rows[0].replaces === orig, r.error);
check('the original stays on record, voided', (await db.query(`select voided_by from feed_logs where id = $1`, [orig])).rows[0].voided_by === STAFF);

// AAL records (020)
await db.exec(readFileSync(new URL('../supabase/aal-register-import-2026-11.sql', import.meta.url), 'utf8').replace(/select name as[^;]*;/, ''));
check('register import fills ring numbers', (await db.query(`select ring_microchip r from birds where name = 'Luke'`)).rows[0]?.r === '28DWTAMAR14V');
r = await as(STAFF, `update aal_settings set owner = 'x'`);
check('staff cannot change AAL settings', (await db.query(`select owner from aal_settings`)).rows[0].owner !== 'x');
r = await as(STAFF, `select vet->>'phone' p from aal_settings`);
check('staff can read vet details (R4)', !r.error && r.rows[0].p === '01606 350 410', r.error);

// Outings (021)
r = await as(STAFF, `insert into outings (kind, venue, start_date, end_date, details) values ('show', 'Test Show', '2026-11-09', '2026-11-09', '{"birds": []}') returning id`);
check('staff can add an outing', !r.error, r.error);
const outingId = r.rows?.[0]?.id;
r = await as(STAFF, `update outings set details = '{"miles": "5"}' where id = $1 returning id`, [outingId]);
check('staff can fill in an outing', !r.error && r.rows.length === 1, r.error);
await as(STAFF, `delete from outings where id = $1`, [outingId]);
check('an outing cannot be deleted', (await db.query(`select 1 from outings where id = $1`, [outingId])).rows.length === 1);
r = await as(STAFF, `insert into outings (kind, venue, start_date, end_date) values ('picnic', 'x', '2026-11-09', '2026-11-09')`);
check('unknown outing kinds are refused', !!r.error);

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
