// Shows what importing a bird CSV would create in an empty database.
// Usage: node scripts/dry-run-import.ts data/SMJ-birds-for-feeding-app.csv
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { planImport } from '../src/admin/csv.ts';
import { aviaryLabel } from '../src/aviary.ts';

const { data } = Papa.parse<Record<string, string>>(readFileSync(process.argv[2], 'utf8'), { header: true, skipEmptyLines: 'greedy' });
const plan = planImport(data, [], []);
const byAviary = new Map<string, string[]>();
for (const r of plan.rows) {
  const label = r.aviaryName ? aviaryLabel({ name: r.aviaryName, number: r.aviaryNumber ?? null }) : '(no aviary)';
  byAviary.set(label, [...(byAviary.get(label) ?? []), r.name + (r.action === 'error' ? ` [ERROR: ${r.errors.join('; ')}]` : '')]);
}
const sorted = [...byAviary].sort(([a], [b]) => a.localeCompare(b, 'en-GB', { numeric: true }));
for (const [a, birds] of sorted) console.log(`${a.padEnd(14)} ${birds.join(', ')}`);
console.log(`\n${plan.rows.length} birds, ${plan.newAviaries.length} aviaries, ${plan.rows.filter((r) => r.action === 'error').length} errors`);
