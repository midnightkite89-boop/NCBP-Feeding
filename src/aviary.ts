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

/**
 * Splits birds in route order into feeding stops. Birds that aren't on the flying team
 * (aviary birds, and flying birds resting for the winter) sharing an aviary are fed together
 * as one stop; flying-team birds are always a stop of their own.
 */
export function feedStops(ordered: Bird[]): Bird[][] {
  const fedTogether = (b: Bird) => b.team === 'aviary' || b.team === 'resting';
  const stops: Bird[][] = [];
  const byAviary = new Map<string, Bird[]>();
  for (const bird of ordered) {
    // Joins the aviary's stop wherever it is (a flying bird in between doesn't split it)
    const stop = fedTogether(bird) && bird.aviary_id ? byAviary.get(bird.aviary_id) : undefined;
    if (stop) stop.push(bird);
    else {
      stops.push([bird]);
      if (fedTogether(bird) && bird.aviary_id) byAviary.set(bird.aviary_id, stops.at(-1)!);
    }
  }
  return stops;
}

/**
 * Where a bird goes on the round when it's added or moved: straight after the birds already in
 * its aviary, else after the nearest lower-numbered aviary in the same section, else at the start
 * of the section, else at the end. Returns every route position that needs to change (in tens).
 */
export function placeOnRoute(bird: Bird, all: Bird[], aviaries: Aviary[]): { id: string; route_order: number }[] {
  const byId = new Map(aviaries.map((a) => [a.id, a]));
  const others = routeSort(all.filter((b) => b.status === 'active' && b.id !== bird.id), aviaries);
  const mine = bird.aviary_id ? byId.get(bird.aviary_id) : undefined;
  const sameSection = (b: Bird) => {
    const a = b.aviary_id ? byId.get(b.aviary_id) : undefined;
    return !!a && !!mine && a.name.toLowerCase() === mine.name.toLowerCase();
  };
  let at = others.length;
  if (mine) {
    const lastMate = others.findLastIndex((b) => b.aviary_id === mine.id);
    const lastLower = others.findLastIndex((b) => sameSection(b) && (byId.get(b.aviary_id!)!.number ?? -1) <= (mine.number ?? -1));
    const firstInSection = others.findIndex(sameSection);
    if (lastMate >= 0) at = lastMate + 1;
    else if (lastLower >= 0) at = lastLower + 1;
    else if (firstInSection >= 0) at = firstInSection;
  }
  const next = [...others.slice(0, at), bird, ...others.slice(at)];
  return next.map((b, i) => ({ id: b.id, route_order: (i + 1) * 10 })).filter((c, i) => next[i].route_order !== c.route_order);
}
