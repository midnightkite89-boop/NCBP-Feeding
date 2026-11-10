import type { Aviary, Bird } from './types';

// An aviary is a section (e.g. "Mews") plus an optional number within it.
// "Mews 5" and "Mews 6" are separate aviaries, each with its own QR code.

/** e.g. "Mews 5", or just "Owls" when there's no number */
export function aviaryLabel(a: Pick<Aviary, 'name' | 'number'>): string {
  return a.number != null ? `${a.name} ${a.number}` : a.name;
}

/** Matching key: same section (any capitals) and same number */
export function aviaryKey(name: string, number: number | null | undefined): string {
  return `${name.trim().toLowerCase()}#${number ?? ''}`;
}

/** Section A–Z, then number order, then unnumbered last */
export function compareAviaries(a: Aviary, b: Aviary): number {
  return a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' }) || (a.number ?? Infinity) - (b.number ?? Infinity);
}

/**
 * Birds in feeding-round order: by route position, then (for birds not yet
 * placed on the route) by aviary, then name.
 */
export function routeSort(birds: Bird[], aviaries: Aviary[]): Bird[] {
  const byId = new Map(aviaries.map((a) => [a.id, a]));
  return [...birds].sort((x, y) => {
    const rx = x.route_order ?? Infinity;
    const ry = y.route_order ?? Infinity;
    if (rx !== ry) return rx - ry;
    const ax = x.aviary_id ? byId.get(x.aviary_id) : undefined;
    const ay = y.aviary_id ? byId.get(y.aviary_id) : undefined;
    if (ax && ay) return compareAviaries(ax, ay) || x.name.localeCompare(y.name);
    if (ax || ay) return ax ? -1 : 1;
    return x.name.localeCompare(y.name);
  });
}

/** Splits an ordered bird list into runs by section, e.g. Mews, Weathering, New… */
export function sectionRuns(ordered: Bird[], aviaries: Aviary[]): { key: string; title: string; birds: Bird[] }[] {
  const byId = new Map(aviaries.map((a) => [a.id, a]));
  const runs: { key: string; title: string; birds: Bird[] }[] = [];
  for (const bird of ordered) {
    const title = (bird.aviary_id && byId.get(bird.aviary_id)?.name) || 'No aviary';
    const last = runs.at(-1);
    if (last?.title === title) last.birds.push(bird);
    else runs.push({ key: `${runs.length}-${title}`, title, birds: [bird] });
  }
  return runs;
}

/** Page for a whole section (e.g. all of the Mews), opened by the section QR code */
export function sectionPath(section: string): string {
  return `/s/${encodeURIComponent(section.trim().toLowerCase())}`;
}

/** Section names in the order the round first reaches them */
export function sectionsInRouteOrder(birds: Bird[], aviaries: Aviary[]): string[] {
  const byId = new Map(aviaries.map((a) => [a.id, a]));
  const seen: string[] = [];
  for (const b of routeSort(birds.filter((x) => x.status === 'active'), aviaries)) {
    const name = b.aviary_id ? byId.get(b.aviary_id)?.name : undefined;
    if (name && !seen.some((s) => s.toLowerCase() === name.toLowerCase())) seen.push(name);
  }
  return seen;
}
