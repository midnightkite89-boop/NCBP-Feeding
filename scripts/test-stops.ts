// Checks shared-aviary stops, feed totals and leftover trends.
// Usage: node --import ./scripts/ts-resolve.mjs scripts/test-stops.ts
import { feedStops } from '../src/aviary';
import { sumFeeds } from '../src/food';
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

console.log(failures ? `\n${failures} failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
