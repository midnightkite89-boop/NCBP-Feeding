// Checks the stock list sums. Usage: node --import ./scripts/ts-resolve.mjs scripts/test-stock.ts
import { sexed, stockList } from '../src/stock';

let failures = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
  if (!ok) failures++;
};
const bird = (sex: string, extra: object = {}): any => ({ id: Math.random().toString(), name: 'x', species: 'Wattled crane', sex, status: 'active', ...extra });

// The example in the zoo standards: 2.1.1 at the start, +0.2.1 arrived, +0.0.2 born, −1.0.0 died, −0.1.0 departed = 1.2.4
const birds = [
  bird('M'), bird('M', { status: 'archived', left_on: '2022-05-01', left_kind: 'died' }),
  bird('F', { status: 'archived', left_on: '2022-08-01', left_kind: 'departed' }),
  bird('U'),
  bird('F', { came_on: '2022-03-01', came_kind: 'arrived' }), bird('F', { came_on: '2022-03-01', came_kind: 'arrived' }), bird('U', { came_on: '2022-04-01', came_kind: 'arrived' }),
  bird('U', { came_on: '2022-06-01', came_kind: 'born' }), bird('U', { came_on: '2022-06-01', came_kind: 'born' }),
  bird('M', { status: 'archived' }), // archived with no leaving date: not counted
  bird('M', { came_on: '2023-02-01', came_kind: 'arrived' }), // after the year: not counted
];
const [row] = stockList(birds, 2022, [{ species: 'wattled crane', scientific_name: 'Bugeranus carunculatus', iucn: 'VU', hazard: '2P' }]);
check('start 2.1.1', sexed(row.start) === '2.1.1', sexed(row.start));
check('arrived 0.2.1', sexed(row.arrived) === '0.2.1', sexed(row.arrived));
check('born 0.0.2', sexed(row.born) === '0.0.2', sexed(row.born));
check('died 1.0.0', sexed(row.died) === '1.0.0', sexed(row.died));
check('departed 0.1.0', sexed(row.departed) === '0.1.0', sexed(row.departed));
check('end 1.2.4', sexed(row.end) === '1.2.4', sexed(row.end));
check('species details from the species list', row.scientific === 'Bugeranus carunculatus' && row.iucn === 'VU' && row.hazard === '2P');
const [later] = stockList(birds, 2023, []);
check('next year starts where this one ended', sexed(later.start) === '1.2.4' && sexed(later.end) === '2.2.4', `${sexed(later.start)} → ${sexed(later.end)}`);
check('condor hazard defaults to 1', stockList([bird('M', { species: 'Andean condor' })], 2026, [])[0].hazard === '1');

console.log(failures ? `\n${failures} failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
