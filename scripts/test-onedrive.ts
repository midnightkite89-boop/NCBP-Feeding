// Checks the files the OneDrive copier makes (no network). Writes a sample PDF to look at.
// Usage: node --import ./scripts/ts-resolve.mjs scripts/test-onedrive.ts [out.pdf]
import { writeFileSync } from 'node:fs';
import { birdRecordPdf, breedingCsv, checkupPdf, healthLogCsv, scoreText, sumFeeds, weeklyRecordsCsv, weightText } from '../supabase/functions/onedrive-sync/index.ts';

let failures = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
  if (!ok) failures++;
};

check('feeds add up', sumFeeds([{ amount: '11', food_type: 'Chick' }, { amount: '11', food_type: 'Chick' }, { amount: '½', food_type: 'Rabbit' }]) === '22 Chick, ½ Rabbit', sumFeeds([{ amount: '11', food_type: 'Chick' }, { amount: '11', food_type: 'Chick' }, { amount: '½', food_type: 'Rabbit' }]));
check('mixed feeds add up', sumFeeds([{ amount: '20 Chick, ½ Rabbit', food_type: null }, { amount: '20 Chick, ½ Rabbit', food_type: null }]) === '40 Chick, 1 Rabbit');
check('score with plus', scoreText(3.5) === '3+' && scoreText(4) === '4');

// The general weekly sheet: every bird, weight when weighed, fed and left
const wl = (bird_id: string, log_date: string, status: string, extra: object = {}) => ({ bird_id, log_date, status, food_type: null, amount: null, weight_g: null, ...extra });
const week = [
  wl('p', '2026-11-16', 'weighed', { weight_g: 650 }),
  wl('p', '2026-11-16', 'fed', { food_type: 'Chick', amount: '2' }),
  wl('a', '2026-11-16', 'fed', { food_type: 'Chick', amount: '11' }),
  wl('a', '2026-11-17', 'left', { food_type: 'Chick', amount: '2' }),
];
const sheet = weeklyRecordsCsv(
  '2026-11-16',
  [
    { id: 'p', name: 'Pyrite', weight_unit: 'g', aviary: 'Flying ground 1', section: 'Flying ground' },
    { id: 'a', name: 'Inawashi', weight_unit: 'g', aviary: 'Eagle barn 2', section: 'Eagle barn' },
  ],
  week,
);
const lines = sheet.trim().split('\r\n');
check('weekly sheet: section headings between birds', lines[2] === 'FLYING GROUND' && lines[4] === 'EAGLE BARN', lines.slice(2, 5).join(' / '));
check('weekly sheet: weighed bird shows weight and feed', lines[3].startsWith('Pyrite,Flying ground 1,650 g,2 Chick,,'), lines[3]);
check('weekly sheet: unweighed bird shows feed and next-day leftover', lines[5].startsWith('Inawashi,Eagle barn 2,,11 Chick,,,,2 Chick'), lines[5]);
check('lb/oz weights shown in lb/oz', weightText(1150, 'lb_oz') === '2 lb 8.57 oz', weightText(1150, 'lb_oz'));

const log = healthLogCsv('Bambam', [
  { date: '2026-11-20', time: '10:00', kind: 'Dose given', detail: 'Meloxicam, 0.1ml', action: '', by: 'Amy' },
  { date: '2026-11-18', time: '09:00', kind: 'Health issue', detail: 'Swollen foot', action: '', by: 'Kieran' },
]);
check('health log in date order', log.split('\r\n')[2].startsWith('18/11/2026,09:00,Health issue,Swollen foot'), log.split('\r\n')[2]);

const record = await birdRecordPdf('Bambam: bird record', [{ heading: 'Bird', rows: [['Name', 'Bambam'], ['Species', 'Martial eagle'], ['Ring / microchip', '']] }], 'National Centre for Birds of Prey');
check('bird record PDF made', new TextDecoder().decode(record.slice(0, 5)) === '%PDF-', `${record.length} bytes`);
if (process.argv[3]) writeFileSync(process.argv[3], record);

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
