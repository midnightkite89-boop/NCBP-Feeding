# SMJ Feeding

Daily feeding round app for SMJ Falconry. It's a React + Vite PWA, backed by Supabase (Postgres, auth, realtime) and hosted on Netlify.

Setup instructions for non-developers are in [SETUP.md](SETUP.md).

## Development

```
npm install --no-bin-links   # the LaCie drive is exFAT, which can't store symlinks
cp .env.example .env.local   # then fill in the Supabase URL and anon key
npm run dev
```

- `npm run build`: type-check and production build
- `node scripts/test-schema.mjs`: runs `supabase/schema.sql` in an in-memory Postgres and checks the security rules
- `node scripts/test-csv.ts`: checks the bird CSV import planner

## How it fits together

| Where | What |
|---|---|
| `supabase/schema.sql` | Tables, security rules and triggers. The server decides `log_date` (Europe/London) and who made each log. Logs are voided, never deleted. |
| `src/store.tsx` | All data. Every change goes into an offline queue (localStorage) first and is sent with a client-generated id, so retries can't double-log. Realtime keeps every phone in sync. |
| `src/status.ts` | Works out each bird's status: to feed, more due, fed, fast day or fasting. |
| `src/pages` | Today, the aviary page (`/a/:slug`, opened by QR code) and the bird page |
| `src/admin` | Birds, aviaries, CSV import, QR sheet, staff |

## Demo mode (dev server only)

Try the app without a login or the real database: start the dev server, run
`node scripts/build-demo-data.mjs ../ncbp/ncbp-data.sql` once, then open `http://localhost:5174/?demo`.
Everything happens in that browser. `?demo=reset` starts again from the seed data, and `?demo=off` goes
back to the real database. Demo mode is never part of the live build.
