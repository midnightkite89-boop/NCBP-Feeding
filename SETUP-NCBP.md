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
