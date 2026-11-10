// Joins schema.sql and every migration into one file for a brand-new Supabase project.
// Usage: node scripts/build-setup-sql.mjs  → supabase/SETUP-NEW-CENTRE.sql
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const dir = new URL('../supabase/', import.meta.url);
const migrations = readdirSync(new URL('migrations/', dir)).filter((f) => f.endsWith('.sql') && !f.startsWith('._')).sort();
const parts = [
  '-- Set up a brand-new centre: paste this whole file into Supabase > SQL Editor > New query, then press Run.\n-- Run it once, on an empty project. Built by scripts/build-setup-sql.mjs; do not edit by hand.\n',
  `-- ===== schema.sql =====\n${readFileSync(new URL('schema.sql', dir), 'utf8')}`,
  ...migrations.map((f) => `-- ===== migrations/${f} =====\n${readFileSync(new URL(`migrations/${f}`, dir), 'utf8')}`),
];
writeFileSync(new URL('SETUP-NEW-CENTRE.sql', dir), parts.join('\n\n'));
console.log(`Wrote SETUP-NEW-CENTRE.sql from schema.sql + ${migrations.length} migrations`);
