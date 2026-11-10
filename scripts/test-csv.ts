// Checks the CSV import planner. Usage: node scripts/test-csv.ts
import { planImport, parseFastDays } from '../src/admin/csv.ts';
import { formatWeight, gramsToLbOz, lbOzToGrams, parseWeight } from '../src/weight.ts';

let fails = 0;
const check = (name: string, ok: boolean, extra: unknown = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, ok ? '' : extra); if (!ok) fails++; };

const birds = [{ id: 'b1', name: 'Willow', fast_days: [], feeds_per_day: 1, status: 'active' }] as any;
const aviaries = [{ id: 'a1', name: 'Kite Pen', number: 4, slug: 'x', archived: false }];

const plan = planImport([
  { 'Name': 'willow', 'Default Food': 'chick', 'Fast Days': 'Sunday', 'Target Min (g)': '950g', 'target_max_g': '1050', 'Aviary': 'Kite Pen', 'Aviary Number': '4' },
  { name: 'Heidi', weight_unit: 'lb/oz', target_min: '5lb 4oz', target_max: '5:12' },
  { name: 'Tyke', weight_unit: 'stone', target_min: '2lb' },
  { name: 'Hoggle', species: 'Gyr Falcon', sex: 'male', aviary: 'Falcon Row', aviary_number: '7', fast_days: 'Mon;thu', feeds_per_day: '2', status: 'Active' },
  { name: 'Bracken', status: 'Dead', fast_days: 'none' },
  { name: '', species: 'x' },
  { name: 'Bad', fast_days: 'Funday', feeds_per_day: '9', target_min_g: '500', target_max_g: '400', sex: 'Q' },
  { name: 'HOGGLE' },
], birds, aviaries);

const [w, heidi, tyke, h, b, blank, bad, dup] = plan.rows;
check('matches existing case-insensitively', w.action === 'update' && w.existingId === 'b1', w);
check('messy headings understood', w.fields.default_food === 'Chick' && w.fields.target_weight_min === 950 && w.fields.target_weight_max === 1050, w.fields);
check('full weekday name', JSON.stringify(w.fields.fast_days) === '[7]', w.fields.fast_days);
check('blank cells left out (no overwrite)', !('species' in w.fields) && !('care_notes' in w.fields), w.fields);
check('new bird', h.action === 'add' && h.fields.sex === 'M' && h.fields.feeds_per_day === 2, h);
check('multi fast days', JSON.stringify(h.fields.fast_days) === '[1,4]', h.fields.fast_days);
check('dead -> archived', b.fields.status === 'archived' && JSON.stringify(b.fields.fast_days) === '[]', b.fields);
check('missing name is error', blank.action === 'error');
check('bad values all reported', bad.action === 'error' && bad.errors.length === 4, bad.errors);
check('duplicate name in file flagged', dup.action === 'error', dup.errors);
check('new aviary planned once, existing not', plan.newAviaries.length === 1 && plan.newAviaries[0].name === 'Falcon Row' && plan.newAviaries[0].number === 7, plan.newAviaries);
check('parseFastDays commas', JSON.stringify(parseFastDays('sat, sun')) === '[6,7]');
check('lb/oz targets converted to grams', heidi.fields.weight_unit === 'lb_oz' && heidi.fields.target_weight_min === lbOzToGrams(5, 4) && heidi.fields.target_weight_max === lbOzToGrams(5, 12), heidi.fields);
check('bad unit reported', tyke.action === 'error' && /weight_unit/.test(tyke.errors.join()), tyke.errors);
check('grams bird keeps grams', w.unit === 'g');

// weight conversions
check('2lb 3oz -> 992.2 g', lbOzToGrams(2, 3) === 992.2, lbOzToGrams(2, 3));
for (const [lb, oz] of [[2, 3], [0, 5.5], [1, 15.75], [5, 0.25]]) {
  const back = gramsToLbOz(lbOzToGrams(lb, oz));
  check(`round trip ${lb}lb ${oz}oz`, back.lb === lb && back.oz === oz, back);
}
check('format lb/oz', formatWeight(lbOzToGrams(2, 3.5), 'lb_oz') === '2 lb 3.5 oz', formatWeight(lbOzToGrams(2, 3.5), 'lb_oz'));
check('format under 1 lb', formatWeight(lbOzToGrams(0, 6), 'lb_oz') === '6 oz');
check('format grams', formatWeight(650, 'g') === '650 g');
for (const t of ['2lb 3oz', '2 lb 3 oz', '2lbs3oz', '2:3', '35oz', '35']) check(`parse "${t}"`, parseWeight(t, 'lb_oz') === lbOzToGrams(0, 35), parseWeight(t, 'lb_oz'));
check('parse "2lb"', parseWeight('2lb', 'lb_oz') === lbOzToGrams(2, 0));
check('parse junk is error', typeof parseWeight('heavy', 'lb_oz') === 'string');
check('parse grams', parseWeight('650g', 'g') === 650);

// sections + numbers
{
  const p = planImport([
    { name: 'A', aviary: 'Mews', aviary_number: '5' },
    { name: 'B', aviary: 'mews', aviary_number: '6' },
    { name: 'C', aviary: 'Mews', aviary_number: '5' },
    { name: 'D', aviary: 'Kite Pen', aviary_number: '4' },
    { name: 'E', aviary_number: '3' },
  ], [], [{ id: 'a1', name: 'Kite Pen', number: 4, slug: 'x', archived: false }]);
  check('Mews 5 and Mews 6 are separate new aviaries, Mews 5 once', JSON.stringify(p.newAviaries) === JSON.stringify([{ name: 'Mews', number: 5 }, { name: 'mews', number: 6 }]), p.newAviaries);
  check('number without section is an error', p.rows[4].action === 'error', p.rows[4].errors);
}

console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
