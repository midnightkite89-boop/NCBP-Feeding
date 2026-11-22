# Putting the NCBP app online

Do these in order. Tick them off as you go.

## 1. Supabase (the new NCBP project)

- [ ] **SQL Editor → New query.** Open `supabase/SETUP-NEW-CENTRE.sql`, copy all of it, paste, **Run**. Only do this once, on the empty project.
- [ ] **New query again.** Open `../ncbp/ncbp-data.sql` (in the `centre-apps/ncbp` folder), copy all of it, paste, **Run**. This loads the settings, 60 aviaries and 100 birds.
- [ ] **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up" → **Save**.
- [ ] **Authentication → Users → Add user → Create new user,** tick **Auto Confirm User**. Do yourself first, then Charlie Heap, Kieran Morrison, Amy Nicklin and Charlie Dilk. Hand passwords over in person.
- [ ] **SQL Editor:** make yourself, Charlie and Kieran admins and set everyone's names. Change the emails to the real ones, then **Run**:

```sql
update public.profiles p set role = 'admin', display_name = v.name
from (values
  ('chrisjohnson@smjfalconry.co.uk', 'Chris'),
  ('CHARLIE-HEAP-EMAIL', 'Charlie H'),
  ('KIERAN-EMAIL', 'Kieran')
) as v(email, name)
where p.id = (select id from auth.users where email = v.email);

update public.profiles p set display_name = v.name
from (values ('AMY-EMAIL', 'Amy'), ('CHARLIE-DILK-EMAIL', 'Charlie D')) as v(email, name)
where p.id = (select id from auth.users where email = v.email);
```

## 2. Netlify

- [ ] **Project configuration → Environment variables → Add a variable**, twice:
  - `VITE_SUPABASE_URL` = `https://srfkqpnqtkbgcsygiowa.supabase.co`
  - `VITE_SUPABASE_ANON_KEY` = `sb_publishable_xtk5OcKtI3SaO2amIla7ow_YyWBpGsB`
- [ ] Link the site to the `NCBP-Feeding` GitHub repo if it isn't already. Leave the build settings alone (they come from `netlify.toml`).

## 3. GitHub

- [ ] VS Code → **File → Open Folder** → `centre-apps/ncbp-app` → Source Control → **Publish Branch** (or **Sync Changes**). It's already pointed at `NCBP-Feeding`. Netlify then builds it.

## 4. Back in Supabase

- [ ] **Authentication → URL Configuration:** set **Site URL** to the Netlify address (shown at the top of the Netlify project, probably `https://ncbp-feeding.netlify.app`).
- [ ] Sign in on your phone and tell Claude, so it can check everything loaded.

## Updates since setup

- [x] **Health checks (11 Nov 2026):** Supabase → SQL Editor → paste all of `supabase/migrations/024_checkups.sql` → **Run**. Safe to run twice.
- [x] **Flying board (19 Nov 2026):** Supabase → SQL Editor → paste all of `supabase/migrations/025_flight_timetable.sql` → **Run**. Then a new query with `../ncbp/ncbp-update-2026-11-19.sql` → **Run** (placeholder demo times 11:30 / 13:30 / 15:30). Both safe to run twice.
- [x] **Visit changes (21 Nov 2026):** Supabase → SQL Editor → paste all of `supabase/migrations/026_health_form_breeding.sql` → **Run** (health check form, ZIMS tick, breeding). Safe to run twice.
- [ ] **Go live (when staff start for real):** run `../ncbp/ncbp-GO-LIVE.sql`. Clears every logged record; keeps birds, aviaries, staff and settings. Can't be undone.

## OneDrive copying (22 Nov 2026)

A folder per bird (record, health and vet log, health checks, photos), one weekly records sheet and breeding records are copied into a OneDrive folder once a night.
Microsoft app registration is done (client ID `ead7c9dc-355a-42b4-a286-2ba20efcbb90`, redirect `https://srfkqpnqtkbgcsygiowa.supabase.co/functions/v1/onedrive-auth`).

- [x] **SQL Editor:** paste all of `supabase/migrations/027_onedrive.sql` → **Run**.
- [x] **Edge Functions → Secrets → Add new secret**, four times:
  - `MS_CLIENT_ID` = `ead7c9dc-355a-42b4-a286-2ba20efcbb90`
  - `MS_CLIENT_SECRET` = the secret **Value** you copied from Azure (Certificates & secrets)
  - `APP_URL` = `https://ncbp-app.netlify.app`
  - `ONEDRIVE_SYNC_KEY` = the key on line 4 of `../ncbp/ncbp-onedrive-schedule.sql` (after `--`)
- [x] **Edge Functions → Deploy a new function → Via editor**, name `onedrive-auth`: replace everything with `supabase/functions/onedrive-auth/index.ts` → **Deploy**. Then open the function's **Details** and turn **off** "Verify JWT with legacy secret" / "Enforce JWT verification" → Save.
- [x] Same again for `onedrive-sync` with `supabase/functions/onedrive-sync/index.ts`, and turn Verify JWT **off** too.
- [x] **SQL Editor:** paste all of `../ncbp/ncbp-onedrive-schedule.sql` → **Run** (copies once a night).
- [ ] **In the app** (after Claude pushes): More → OneDrive copying → check the folder name → **Connect OneDrive**. The OneDrive's owner signs in and taps **Allow**. Then **Copy now**, again until it says everything is up to date (the first copy is big).

## Stock list (22 Nov 2026)

- [ ] **SQL Editor:** paste all of `supabase/migrations/028_stock_list.sql` → **Run** (arrival / leaving dates on birds, species IUCN and hazard; hazard filled in as 2, condors 1).
- [ ] **Edge Functions → onedrive-sync → Code:** replace everything with the new `supabase/functions/onedrive-sync/index.ts` → **Deploy** (adds the stock list to the OneDrive copy). Verify JWT stays off.
