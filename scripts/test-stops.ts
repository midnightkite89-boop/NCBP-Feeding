// Checks shared-aviary stops, feed totals and leftover trends.
// Usage: node --import ./scripts/ts-resolve.mjs scripts/test-stops.ts
import { feedStops, placeOnRoute } from '../src/aviary';
import { spreadChange, sumFeeds } from '../src/food';
import { leftoverTrend } from '../src/leftovers';
import { birdStatus, quickFeedEntry } from '../src/status';

let failures = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
  if (!ok) failures++;
};
const bird = (id: string, aviary: string, team: string, food: string | null, portion: string): any => ({
  id, name: id, species: 'x', aviary_id: aviary, team, default_food: food, default_portion: portion, feeds_per_day: 1, fast_days: [],
});

const birds = [
  bird('Tacora', 'hw3', 'flying', 'Chick', '2'),
  bird('Palomar', 'hw3', 'flying', 'Chick', '2'),
  bird('Inawashi', 'eb2', 'aviary', 'Chick', '11'),
  bird('Husband', 'eb2', 'aviary', 'Chick', '11'),
  bird('Steller 3', 'eb2', 'aviary', 'Chick', '11'),
  bird('Shelby', 'eb3', 'aviary', 'Chick', '10'),
  bird('Andy', 'eb9', 'aviary', null, '20 Chick, ½ Rabbit'),
  bird('Mandy', 'eb9', 'aviary', null, '20 Chick, ½ Rabbit'),
];
const stops = feedStops(birds);
check('flying birds sharing an aviary stay separate', stops[0].length === 1 && stops[1].length === 1);
check('aviary birds sharing an aviary are one stop', stops[2].length === 3, stops.map((s) => s.length).join(','));
check('a lone aviary bird is its own stop', stops[3].length === 1);
// Kieran: kites resting for the winter in one aviary are one stop; one still flying stays separate
const kites = feedStops([bird('Pyrite', 'fg1', 'resting', 'Chick', '2'), bird('Cello', 'fg1', 'resting', 'Chick', '2'), bird('Beryl', 'fg1', 'flying', 'Chick', '2'), bird('Garnet', 'fg1', 'resting', 'Chick', '2')]);
check('resting birds sharing an aviary are one stop, even with a flying bird between', kites[0].length === 3 && kites[1].length === 1, kites.map((s) => s.length).join(','));
const entries = (s: any[]) => s.map((b) => quickFeedEntry(b, birdStatus(b, [], '2026-11-10')));
check('three eagles on 11 chicks = 33 Chick', sumFeeds(entries(stops[2])) === '33 Chick', sumFeeds(entries(stops[2])));
check('condor pair = 40 Chick, 1 Rabbit', sumFeeds(entries(stops[4])) === '40 Chick, 1 Rabbit', sumFeeds(entries(stops[4])));
check('condor FED has no stray food type', entries([birds[6]])[0].food_type === null && entries([birds[6]])[0].amount === '20 Chick, ½ Rabbit');

const left = (bird_id: string, log_date: string): any => ({ bird_id, log_date, status: 'left', amount: '1', food_type: 'Chick', logged_at: `${log_date}T08:00:00Z` });
const today = '2026-11-10';
check('one leftover: not flagged', !leftoverTrend('Shelby', [left('Shelby', today)], today).flagged);
check('today and yesterday: flagged', leftoverTrend('Shelby', [left('Shelby', '2026-11-09'), left('Shelby', today)], today).flagged);
check('3 of 7 days: flagged', leftoverTrend('Shelby', ['2026-11-04', '2026-11-06', '2026-11-08'].map((d) => left('Shelby', d)), today).text === 'Left food 3 of the last 7 days');
check('8 days ago is outside the week', !leftoverTrend('Shelby', ['2026-11-02', '2026-11-06', '2026-11-08'].map((d) => left('Shelby', d)), today).flagged);
check('shared aviary trend counts any bird in it', leftoverTrend(['Inawashi', 'Husband'], [left('Inawashi', '2026-11-09'), left('Husband', today)], today).flagged);

// Moving a bird to an aviary puts it next to the birds already there
const av = (id: string, name: string, number: number): any => ({ id, name, number, slug: id, archived: false });
const avs = [av('hw1', 'Hawk walk', 1), av('hw2', 'Hawk walk', 2), av('eb1', 'Eagle barn', 1), av('eb2', 'Eagle barn', 2), av('eb3', 'Eagle barn', 3)];
const rb = (id: string, aviary: string, order: number | null): any => ({ id, name: id, aviary_id: aviary, route_order: order, status: 'active' });
const route = [rb('a', 'hw1', 10), rb('b', 'hw2', 20), rb('c', 'eb1', 30), rb('d', 'eb3', 40)];
const orderAfter = (bird: any) => {
  const all = [...route.filter((b) => b.id !== bird.id), bird];
  const changes = new Map(placeOnRoute(bird, all, avs).map((c) => [c.id, c.route_order]));
  return all.map((b) => ({ id: b.id, o: changes.get(b.id) ?? b.route_order })).sort((x, y) => x.o - y.o).map((x) => x.id).join('');
};
check('new bird joins its aviary mates', orderAfter(rb('x', 'eb1', null)) === 'abcxd', orderAfter(rb('x', 'eb1', null)));
check('empty aviary goes after the lower number in its section', orderAfter(rb('x', 'eb2', null)) === 'abcxd', orderAfter(rb('x', 'eb2', null)));
check('moved bird leaves its old place', orderAfter({ ...rb('a', 'eb3', 10) }) === 'bcda', orderAfter({ ...rb('a', 'eb3', 10) }));

// − / + on a shared aviary changes the total, a bird at a time
const eagles = entries(stops[2]);
check('+1 on 33 Chick gives 34', sumFeeds(spreadChange(eagles, 1)!) === '34 Chick', sumFeeds(spreadChange(eagles, 1)!));
check('−4 on 33 Chick gives 29', sumFeeds(spreadChange(eagles, -4)!) === '29 Chick', sumFeeds(spreadChange(eagles, -4)!));
check('mixed condor feed has no − / +', spreadChange(entries(stops[4]), 1) === null);
check("can't go below half a chick each", spreadChange([{ amount: '1', food_type: 'Chick' }], -1) === null);

console.log(failures ? `\n${failures} failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
