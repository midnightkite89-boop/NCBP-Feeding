// The annual stock list the zoo standards ask for: per species, males.females.unknown on 1 January,
// arrived, born, died, departed during the year, and the group on 31 December.
import type { Bird } from './types';

export interface SpeciesInfo {
  species: string;
  scientific_name: string | null;
  iucn: string | null;
  hazard: string;
}

export interface Sexed {
  m: number;
  f: number;
  u: number;
}
export interface StockRow {
  key: string;
  common: string;
  scientific: string;
  iucn: string;
  hazard: string;
  start: Sexed;
  arrived: Sexed;
  born: Sexed;
  died: Sexed;
  departed: Sexed;
  end: Sexed;
}

export const speciesKey = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
/** Hazard category to suggest before an admin sets it: condors 1, everything else 2 */
export const defaultHazard = (species: string) => (/condor/i.test(species) ? '1' : '2');
export const sexed = (n: Sexed) => `${n.m}.${n.f}.${n.u}`;
const zero = (): Sexed => ({ m: 0, f: 0, u: 0 });
const add = (n: Sexed, b: Pick<Bird, 'sex'>) => {
  if (b.sex === 'M') n.m++;
  else if (b.sex === 'F') n.f++;
  else n.u++;
};

/** A bird counts from the day it came in (or always, if we don't know) until the day it left */
const hereAtStartOf = (b: Bird, day: string) => (!b.came_on || b.came_on < day) && (!b.left_on || b.left_on >= day);
const hereAtEndOf = (b: Bird, day: string) => (!b.came_on || b.came_on <= day) && (!b.left_on || b.left_on > day);
/** Birds that count at all: active, or gone with a leaving date (an archived bird without one is left out) */
export const counted = (b: Bird) => b.status === 'active' || !!b.left_on;

export function stockList(birds: Bird[], year: number, info: SpeciesInfo[]): StockRow[] {
  const jan1 = `${year}-01-01`;
  const dec31 = `${year}-12-31`;
  const inYear = (d: string | null | undefined) => !!d && d >= jan1 && d <= dec31;
  const rows = new Map<string, StockRow>();
  for (const b of birds.filter(counted)) {
    const key = speciesKey(b.species);
    if (!key) continue;
    const touched = hereAtStartOf(b, jan1) || hereAtEndOf(b, dec31) || inYear(b.came_on) || inYear(b.left_on);
    if (!touched) continue;
    let row = rows.get(key);
    if (!row) {
      const i = info.find((x) => x.species === key);
      row = {
        key,
        common: b.species!.trim(),
        scientific: i?.scientific_name || b.scientific_name || '',
        iucn: i?.iucn ?? '',
        hazard: i?.hazard ?? defaultHazard(b.species!),
        start: zero(),
        arrived: zero(),
        born: zero(),
        died: zero(),
        departed: zero(),
        end: zero(),
      };
      rows.set(key, row);
    }
    if (!row.scientific && b.scientific_name) row.scientific = b.scientific_name;
    if (hereAtStartOf(b, jan1)) add(row.start, b);
    if (inYear(b.came_on)) add(b.came_kind === 'born' ? row.born : row.arrived, b);
    if (inYear(b.left_on)) add(b.left_kind === 'died' ? row.died : row.departed, b);
    if (hereAtEndOf(b, dec31)) add(row.end, b);
  }
  return [...rows.values()].sort((a, b) => a.common.localeCompare(b.common));
}

/** Things that would make the list wrong, to show above it */
export function stockWarnings(birds: Bird[]): string[] {
  const out: string[] = [];
  const noCame = birds.filter((b) => b.status === 'active' && !b.came_on).length;
  if (noCame) out.push(`${noCame} bird${noCame === 1 ? " hasn't" : "s haven't"} got a date they came in, so ${noCame === 1 ? 'it is' : 'they are'} counted as here all year.`);
  const goneNoDate = birds.filter((b) => b.status !== 'active' && !b.left_on).length;
  if (goneNoDate) out.push(`${goneNoDate} archived bird${goneNoDate === 1 ? " has" : "s have"} no leaving date, so ${goneNoDate === 1 ? "isn't" : "aren't"} counted. Add when ${goneNoDate === 1 ? 'it' : 'they'} died or left.`);
  const noSex = birds.filter((b) => counted(b) && b.sex !== 'M' && b.sex !== 'F').length;
  if (noSex) out.push(`${noSex} bird${noSex === 1 ? ' is' : 's are'} counted as unknown sex.`);
  return out;
}
