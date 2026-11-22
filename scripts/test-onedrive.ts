// Checks the files the OneDrive copier makes (no network). Writes a sample PDF to look at.
// Usage: node --import ./scripts/ts-resolve.mjs scripts/test-onedrive.ts [out.pdf]
import { writeFileSync } from 'node:fs';
import { breedingCsv, checkupPdf, feedSheetCsv, scoreText, sumFeeds } from '../supabase/functions/onedrive-sync/index.ts';

let failures = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
  if (!ok) failures++;
};

check('feeds add up', sumFeeds([{ amount: '11', food_type: 'Chick' }, { amount: '11', food_type: 'Chick' }, { amount: '½', food_type: 'Rabbit' }]) === '22 Chick, ½ Rabbit', sumFeeds([{ amount: '11', food_type: 'Chick' }, { amount: '11', food_type: 'Chick' }, { amount: '½', food_type: 'Rabbit' }]));
check('mixed feeds add up', sumFeeds([{ amount: '20 Chick, ½ Rabbit', food_type: null }, { amount: '20 Chick, ½ Rabbit', food_type: null }]) === '40 Chick, 1 Rabbit');
check('score with plus', scoreText(3.5) === '3+' && scoreText(4) === '4');

const birds = [
  { id: 'a', name: 'Inawashi', species: "Steller's sea eagle", team: 'aviary', aviary_id: 'eb2', route_order: 10 },
  { id: 'b', name: 'Husband', species: "Steller's sea eagle", team: 'aviary', aviary_id: 'eb2', route_order: 20 },
  { id: 'c', name: 'Shelby', species: 'Bald eagle', team: 'aviary', aviary_id: 'eb3', route_order: 30 },
];
const logs = [
  { bird_id: 'a', log_date: '2026-11-16', status: 'fed', food_type: 'Chick', amount: '11' },
  { bird_id: 'b', log_date: '2026-11-16', status: 'fed', food_type: 'Chick', amount: '11' },
  { bird_id: 'a', log_date: '2026-11-17', status: 'left', food_type: 'Chick', amount: '2' },
];
const sheet = feedSheetCsv('Eagle barn', '2026-11-16', birds, (id) => ({ eb2: 'Eagle barn 2', eb3: 'Eagle barn 3' })[id ?? ''] ?? '', logs);
const lines = sheet.trim().split('\r\n');
check('feed sheet: one row per aviary', lines.length === 4, `${lines.length} lines`);
check('feed sheet: shared aviary fed total and next-day leftover', lines[2].includes('Eagle barn 2,"Inawashi, Husband",22 Chick,,,2 Chick'), lines[2]);

const b = breedingCsv(2026, [{ log_date: '2026-04-02', aviary: 'Eagle barn 7', kind: 'egg', count: 2, notes: 'both, "first"', staff: 'Kieran' }]);
check('breeding row with quotes escaped', b.includes('02/04/2026,Eagle barn 7,Eggs laid,2,"both, ""first""",Kieran'), b.split('\r\n')[2]);

const pdf = await checkupPdf(
  {
    checked_on: '2026-11-21',
    bird: { name: 'Bambam', species: 'Martial eagle', sex: 'M' },
    aviary: 'Eagle barn 1',
    staff: 'Amy',
    done_with: 'CD',
    ring_seen: '141 CRP',
    condition_score: 3.5,
    weight_g: 4150,
    checks: { toes: { ok: true }, talons: { ok: true, note: 'trimmed' }, beak_out: { ok: true, note: 'coped – a long note that should be cut short to fit its column neatly' } },
    notes: 'Slight wear on the left carpal, keep an eye on it at the next check. Weighed on the new scales.',
    zims: false,
  },
  'National Centre for Birds of Prey',
);
check('health check PDF made', pdf.length > 1000 && new TextDecoder().decode(pdf.slice(0, 5)) === '%PDF-', `${pdf.length} bytes`);
if (process.argv[2]) writeFileSync(process.argv[2], pdf);

console.log(failures ? `\n${failures} failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
